/**
 * Merchant Config Service
 *
 * Central source of truth for:
 *   - Default config values
 *   - Goal → offer priority mapping
 *   - Risk level → incentive threshold mapping
 *   - Guardrail validation
 *   - Reusable loader (middleware) for decision engine usage
 */

import { getDb, collections } from '../database/mongodb.js';
import { GOAL_MAPPING, RISK_MAPPING } from '../../app/shared/merchantConfig.shared.js';

// ─── Default Config ─────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  goal: 'increase_aov',
  riskTolerance: 'balanced',
  guardrails: {
    maxDiscountCap: 20,
    inventoryMinThreshold: 0,
    sessionOfferLimit: 4,
    premiumSkuProtection: false,
    subscriptionProtection: false,
    excludedProductIds: [],
    excludedProductHandles: [],
    excludedCollectionIds: [],
    excludedCollectionHandles: [],
  },
  optimization: {
    topOfferType: null,
    updatedAt: null
  }
};

// ─── Goal/Risk mappings are shared (client-safe) ─────────────────────────────

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validates guardrail values.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateGuardrails(guardrails) {
  const errors = [];
  const { maxDiscountCap, inventoryMinThreshold, sessionOfferLimit } = guardrails;

  // maxDiscountCap: 0–90
  if (maxDiscountCap == null || isNaN(maxDiscountCap)) {
    errors.push('Max discount cap must be a number.');
  } else if (maxDiscountCap < 0) {
    errors.push('Max discount cap cannot be negative.');
  } else if (maxDiscountCap > 90) {
    errors.push('Max discount cap cannot exceed 90%. Use guardrails to stay competitive.');
  }

  // inventoryMinThreshold: 0–10000
  if (inventoryMinThreshold == null || isNaN(inventoryMinThreshold)) {
    errors.push('Inventory minimum threshold must be a number.');
  } else if (inventoryMinThreshold < 0) {
    errors.push('Inventory minimum threshold cannot be negative.');
  } else if (inventoryMinThreshold > 10000) {
    errors.push('Inventory minimum threshold cannot exceed 10,000 units.');
  }

  // sessionOfferLimit: 1–10
  if (sessionOfferLimit == null || isNaN(sessionOfferLimit)) {
    errors.push('Session offer limit must be a number.');
  } else if (sessionOfferLimit < 1) {
    errors.push('Session offer limit must be at least 1.');
  } else if (sessionOfferLimit > 10) {
    errors.push('Session offer limit cannot exceed 10 offers per session.');
  }

  if (guardrails.excludedProductIds != null && !Array.isArray(guardrails.excludedProductIds)) {
    errors.push('Excluded product IDs must be a list.');
  }

  if (guardrails.excludedProductHandles != null && !Array.isArray(guardrails.excludedProductHandles)) {
    errors.push('Excluded product handles must be a list.');
  }

  if (guardrails.excludedCollectionIds != null && !Array.isArray(guardrails.excludedCollectionIds)) {
    errors.push('Excluded collection IDs must be a list.');
  }

  if (guardrails.excludedCollectionHandles != null && !Array.isArray(guardrails.excludedCollectionHandles)) {
    errors.push('Excluded collection handles must be a list.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a full config payload (goal, riskTolerance, guardrails).
 * Returns { valid: boolean, errors: string[] }
 */
export function validateConfig({ goal, riskTolerance, guardrails }) {
  const errors = [];

  if (!GOAL_MAPPING[goal]) {
    errors.push(`Invalid goal: "${goal}". Must be one of: ${Object.keys(GOAL_MAPPING).join(', ')}.`);
  }

  if (!RISK_MAPPING[riskTolerance]) {
    errors.push(`Invalid risk tolerance: "${riskTolerance}". Must be one of: ${Object.keys(RISK_MAPPING).join(', ')}.`);
  }

  if (guardrails && typeof guardrails === 'object') {
    const guardrailResult = validateGuardrails(guardrails);
    errors.push(...guardrailResult.errors);
  } else {
    errors.push('Guardrails must be an object.');
  }

  return { valid: errors.length === 0, errors };
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

const _configCache = new Map();
const CONFIG_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export function invalidateMerchantConfigCache(shopId) {
  if (shopId) _configCache.delete(shopId);
}

// ─── Middleware / Reusable Loader ────────────────────────────────────────────

/**
 * getMerchantConfig(shopId)
 *
 * The canonical way for any part of the system to load merchant config.
 * Returns the saved config merged with DEFAULT_CONFIG, plus the computed
 * goal and risk mappings — so the caller gets a single complete object.
 *
 * This is the function the decision engine will call before generating offers.
 */
export async function getMerchantConfig(shopId) {
  const now = Date.now();
  const cached = _configCache.get(shopId);
  if (cached && (now - cached.ts) < CONFIG_CACHE_TTL) {
    return cached.data;
  }

  const db = await getDb();
  const saved = await db.collection(collections.merchantConfig).findOne(
    { shopId },
    { projection: { _id: 0 } }
  );

  const goal = saved?.goal ?? DEFAULT_CONFIG.goal;
  const riskTolerance = saved?.riskTolerance ?? DEFAULT_CONFIG.riskTolerance;
  const guardrails = {
    ...DEFAULT_CONFIG.guardrails,
    ...(saved?.guardrails ?? {}),
  };

  // Auto-migrate: if merchant never changed inventoryMinThreshold from the old default of 5,
  // reset it to the new default of 0 so existing stores aren't blocked by inventory filtering.
  if (guardrails.inventoryMinThreshold === 5 && saved?.guardrails?.inventoryMinThreshold === 5) {
    guardrails.inventoryMinThreshold = 0;
  }

  const VALID_OFFER_TYPES = new Set(['bundle', 'volume_discount', 'addon_upsell', 'subscription_upgrade']);
  const rawOptimization = saved?.optimization || DEFAULT_CONFIG.optimization;
  const optimization = {
    ...rawOptimization,
    topOfferType: VALID_OFFER_TYPES.has(rawOptimization?.topOfferType) ? rawOptimization.topOfferType : null,
  };

  const result = {
    shopId,
    goal,
    riskTolerance,
    guardrails,
    optimization,
    // Computed mappings — ready for the decision engine
    goalConfig: GOAL_MAPPING[goal],
    riskConfig: RISK_MAPPING[riskTolerance],
    // Meta
    isDefault: !saved,
    savedAt: saved?.updatedAt ?? null,
    createdAt: saved?.createdAt ?? null,
  };

  _configCache.set(shopId, { data: result, ts: Date.now() });
  return result;
}

// ─── Save ────────────────────────────────────────────────────────────────────

/**
 * saveMerchantConfig(shopId, { goal, riskTolerance, guardrails })
 *
 * Validates and persists merchant config.
 * Returns { success: boolean, errors: string[] }
 */
export async function saveMerchantConfig(shopId, { goal, riskTolerance, guardrails, optimization }) {
  const validation = validateConfig({ goal, riskTolerance, guardrails });
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  try {
    const db = await getDb();
    const now = new Date();
    const normalizeList = (value) => {
      if (!value) return [];
      const base = Array.isArray(value) ? value : [value];
      const clean = base
        .map((item) => String(item).trim())
        .filter(Boolean);
      return Array.from(new Set(clean));
    };

    const updateDoc = {
      shopId,
      goal,
      riskTolerance,
      guardrails: {
        maxDiscountCap: guardrails.maxDiscountCap,
        inventoryMinThreshold: guardrails.inventoryMinThreshold,
        sessionOfferLimit: guardrails.sessionOfferLimit,
        premiumSkuProtection: Boolean(guardrails.premiumSkuProtection),
        subscriptionProtection: Boolean(guardrails.subscriptionProtection),
        excludedProductIds: normalizeList(guardrails.excludedProductIds),
        excludedProductHandles: normalizeList(guardrails.excludedProductHandles).map((h) => h.toLowerCase()),
        excludedCollectionIds: normalizeList(guardrails.excludedCollectionIds),
        excludedCollectionHandles: normalizeList(guardrails.excludedCollectionHandles).map((h) => h.toLowerCase()),
      },
      updatedAt: now,
    };

    if (optimization !== undefined) {
      updateDoc.optimization = {
        topOfferType: optimization?.topOfferType ?? null,
        updatedAt: optimization?.updatedAt ?? now
      };
    }

    await db.collection(collections.merchantConfig).updateOne(
      { shopId },
      {
        $set: {
          ...updateDoc,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    // Invalidate cache so next read gets fresh data
    invalidateMerchantConfigCache(shopId);

    return { success: true, errors: [] };
  } catch (err) {
    console.error('[merchantConfig] Save error:', err);
    return { success: false, errors: ['Database error. Please try again.'] };
  }
}

/**
 * updateMerchantConfig(shopId, partialUpdates)
 *
 * Convenience helper for partial updates. Merges with existing config
 * and persists via saveMerchantConfig() so validation stays consistent.
 */
export async function updateMerchantConfig(shopId, updates = {}) {
  try {
    const existing = await getMerchantConfig(shopId);
    const merged = {
      goal: updates.goal ?? existing.goal ?? DEFAULT_CONFIG.goal,
      riskTolerance: updates.riskTolerance ?? existing.riskTolerance ?? DEFAULT_CONFIG.riskTolerance,
      guardrails: {
        ...(existing.guardrails ?? DEFAULT_CONFIG.guardrails),
        ...(updates.guardrails ?? {})
      },
      optimization: {
        ...(existing.optimization ?? DEFAULT_CONFIG.optimization),
        ...(updates.optimization ?? {})
      }
    };

    return await saveMerchantConfig(shopId, merged);
  } catch (err) {
    console.error('[merchantConfig] Update error:', err);
    return { success: false, errors: ['Database error. Please try again.'] };
  }
}
