/**
 * Decision Engine — Pillar 3 V1
 *
 * Orchestrates what to offer, to whom, and when.
 * Uses goal + risk settings plus AI recommendations to rank and filter offers.
 */

import { getMerchantConfig, DEFAULT_CONFIG } from './merchantConfig.js';
import { GOAL_MAPPING, RISK_MAPPING } from '../../app/shared/merchantConfig.shared.js';
import { GroqAIEngine } from './groqAIEngine.js';
import {
  getPlacementStats,
  shouldPreferHighConfidenceOnly,
  recommendPlacementShift,
  getSeenProductsInSession
} from './adaptivePlacement.js';
import { getConfidenceBoost } from './conversionEngine.js';
import { getSafetyMode } from './safetyMode.js';
import {
  getMerchantContext,
  getOfferControlMap,
  buildOfferKey,
  logDecisionOffers
} from './merchandisingIntelligence.js';
import { getDb, collections } from '../database/mongodb.js';

/**
 * Fire-and-forget guardrail event logger.
 * Never throws — guardrail logging must never block offer delivery.
 */
async function logGuardrailEvent(shopId, guardrailType, context = {}) {
  try {
    const db = await getDb();
    await db.collection(collections.guardrailEvents).insertOne({
      shopId,
      guardrailType,
      timestamp: new Date(),
      ...context
    });
  } catch (_) {
    // intentionally silent
  }
}

const DEFAULT_LIMIT = 4;
const ALLOWED_OFFER_TYPES = new Set([
  'bundle',
  'volume_discount',
  'addon_upsell',
  'subscription_upgrade'
]);

const PLACEMENT_ALIASES = {
  product: 'product_page',
  product_page: 'product_page',
  cart: 'cart_drawer',
  cart_drawer: 'cart_drawer',
  checkout: 'checkout',
  post_purchase: 'post_purchase'
};

export async function decideProductOffers({
  shopId,
  productId,
  userId = null,
  limit = DEFAULT_LIMIT,
  placement = 'product_page'
} = {}) {
  if (!shopId || !productId) {
    return { offers: [], meta: { reason: 'missing_inputs' }, sourceProduct: null };
  }

  // Run all independent setup queries in parallel to reduce latency
  const sessionId = userId || null;
  const [safetyActive, config, merchantContext, placementShift, seenProducts] = await Promise.all([
    getSafetyMode(shopId).catch(() => false),
    loadConfig(shopId),
    getMerchantContext(shopId),
    recommendPlacementShift(shopId).catch(() => null),
    getSeenProductsInSession(shopId, sessionId).catch(() => new Set()),
  ]);

  if (safetyActive) {
    console.log(`🛡️ Safety mode active for ${shopId} — skipping all offers`);
    logGuardrailEvent(shopId, 'safety_mode_active', { placement, productId });
    return { offers: [], meta: { reason: 'safety_mode_active', status: 'safety_mode' }, sourceProduct: null };
  }

  const guardrails = config.guardrails || {};
  const goalConfig = applyOptimizationOverrides(
    config.goalConfig || GOAL_MAPPING[config.goal] || GOAL_MAPPING[DEFAULT_CONFIG.goal],
    config.optimization
  );
  const riskConfig = config.riskConfig || RISK_MAPPING[config.riskTolerance] || RISK_MAPPING[DEFAULT_CONFIG.riskTolerance];
  const normalizedPlacement = normalizePlacement(placement);

  if (!isPlacementAllowed(normalizedPlacement, riskConfig)) {
    logGuardrailEvent(shopId, 'placement_blocked', { placement: normalizedPlacement, productId });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'placement_blocked'),
      sourceProduct: null
    };
  }

  // Do not fully suppress cart-drawer offers; shift is advisory for cart context.
  const shiftBlocksPlacement = normalizedPlacement === 'cart_drawer'
    ? false
    : shouldBlockPlacement(normalizedPlacement, placementShift);
  if (shiftBlocksPlacement) {
    logGuardrailEvent(shopId, 'placement_shifted', {
      placement: normalizedPlacement,
      productId,
      shiftFrom: placementShift?.from,
      shiftTo: placementShift?.to
    });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'placement_shifted', {
        placementShift
      }),
      sourceProduct: null
    };
  }

  const effectiveLimit = computeEffectiveLimit(limit, guardrails, riskConfig, seenProducts);
  if (effectiveLimit <= 0) {
    logGuardrailEvent(shopId, 'session_offer_limit', {
      placement: normalizedPlacement,
      productId,
      seenCount: seenProducts?.size || 0,
      sessionOfferLimit: guardrails?.sessionOfferLimit ?? null
    });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'limit_zero', {
        placementShift,
        seenProducts: seenProducts?.size || 0
      }),
      sourceProduct: null
    };
  }

  // Adaptive placement — fetch stats in parallel with AI, never block on failure
  const [placementStats, conservativeMode, aiEngine] = await Promise.all([
    getPlacementStats(shopId).catch(() => null),
    shouldPreferHighConfidenceOnly(shopId, normalizedPlacement).catch(() => false),
    Promise.resolve(new GroqAIEngine())
  ]);

  const recommendations = await aiEngine.findUpsellProducts(
    shopId,
    productId,
    effectiveLimit,
    userId
  );

  const sourceProduct = recommendations?._sourceProduct || null;
  const sourceProductId = sourceProduct?.productId || productId;

  // Pre-compute conversion boosts — Pillar 5
  const candidates = Array.isArray(recommendations) ? recommendations : [];

  // Inject merchant focus products into candidate pool if not already present
  await injectFocusProducts(candidates, shopId, merchantContext, sourceProductId);

  const boostMap = {};
  await Promise.all(candidates.map(async (p) => {
    boostMap[p.productId] = await getConfidenceBoost(shopId, sourceProductId, p.productId, p.recommendationType).catch(() => 0);
  }));

  const { offers, meta } = await decideFromCandidates(candidates, {
    shopId,
    config,
    goalConfig,
    riskConfig,
    guardrails,
    placement: normalizedPlacement,
    aiEngine,
    limit: effectiveLimit,
    conservativeMode,
    boostMap,
    contextKey: 'product',
    sourceProductId,
    merchantContext,
    seenProductIds: seenProducts,
    contextProductIds: [sourceProductId].filter(Boolean)
  });

  logDecisionOffers({
    shopId,
    contextKey: 'product',
    placement: normalizedPlacement,
    sourceProduct,
    cartProducts: [],
    offers,
    meta,
    merchantContext
  });

  return { offers, meta: { ...meta, adaptivePlacement: placementStats, placementShift, seenProducts: seenProducts?.size || 0 }, sourceProduct };
}

export async function decideCartOffers({
  shopId,
  cartProductIds,
  userId = null,
  limit = DEFAULT_LIMIT,
  placement = 'cart_drawer'
} = {}) {
  if (!shopId || !Array.isArray(cartProductIds) || cartProductIds.length === 0) {
    return { offers: [], meta: { reason: 'missing_inputs' }, cartProducts: [] };
  }

  // Run all independent setup queries in parallel to reduce latency
  const sessionId = userId || null;
  const [safetyActive, config, merchantContext, placementShift, seenProducts] = await Promise.all([
    getSafetyMode(shopId).catch(() => false),
    loadConfig(shopId),
    getMerchantContext(shopId),
    recommendPlacementShift(shopId).catch(() => null),
    getSeenProductsInSession(shopId, sessionId).catch(() => new Set()),
  ]);

  if (safetyActive) {
    console.log(`🛡️ Safety mode active for ${shopId} — skipping all cart offers`);
    logGuardrailEvent(shopId, 'safety_mode_active', { placement, cartProductCount: cartProductIds.length });
    return { offers: [], meta: { reason: 'safety_mode_active', status: 'safety_mode' }, cartProducts: [] };
  }

  const guardrails = config.guardrails || {};
  const goalConfig = applyOptimizationOverrides(
    config.goalConfig || GOAL_MAPPING[config.goal] || GOAL_MAPPING[DEFAULT_CONFIG.goal],
    config.optimization
  );
  const riskConfig = config.riskConfig || RISK_MAPPING[config.riskTolerance] || RISK_MAPPING[DEFAULT_CONFIG.riskTolerance];
  const normalizedPlacement = normalizePlacement(placement);

  if (!isPlacementAllowed(normalizedPlacement, riskConfig)) {
    logGuardrailEvent(shopId, 'placement_blocked', { placement: normalizedPlacement, cartProductCount: cartProductIds.length });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'placement_blocked'),
      cartProducts: []
    };
  }

  // Do not fully suppress cart-drawer offers; shift is advisory for cart context.
  const shiftBlocksPlacement = normalizedPlacement === 'cart_drawer'
    ? false
    : shouldBlockPlacement(normalizedPlacement, placementShift);
  if (shiftBlocksPlacement) {
    logGuardrailEvent(shopId, 'placement_shifted', {
      placement: normalizedPlacement,
      shiftFrom: placementShift?.from,
      shiftTo: placementShift?.to,
      cartProductCount: cartProductIds.length
    });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'placement_shifted', {
        placementShift
      }),
      cartProducts: []
    };
  }

  const effectiveLimit = computeEffectiveLimit(limit, guardrails, riskConfig, seenProducts);
  if (effectiveLimit <= 0) {
    logGuardrailEvent(shopId, 'session_offer_limit', {
      placement: normalizedPlacement,
      seenCount: seenProducts?.size || 0,
      sessionOfferLimit: guardrails?.sessionOfferLimit ?? null,
      cartProductCount: cartProductIds.length
    });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'limit_zero', {
        placementShift,
        seenProducts: seenProducts?.size || 0
      }),
      cartProducts: []
    };
  }

  // Adaptive placement — fetch stats in parallel with AI, never block on failure
  const [placementStats, conservativeMode, aiEngine] = await Promise.all([
    getPlacementStats(shopId).catch(() => null),
    shouldPreferHighConfidenceOnly(shopId, normalizedPlacement).catch(() => false),
    Promise.resolve(new GroqAIEngine())
  ]);

  const recommendations = await aiEngine.findCartUpsellProducts(
    shopId,
    cartProductIds,
    effectiveLimit,
    userId
  );

  const cartProducts = recommendations?._cartProducts || [];

  // Merchant-approved products: force-include them even if AI didn't pick them
  const aiCandidates = Array.isArray(recommendations) ? recommendations : [];

  // Inject merchant focus products/collections into candidate pool
  await injectFocusProducts(aiCandidates, shopId, merchantContext, null);

  const mergedCandidates = await mergeApprovedProducts(shopId, 'cart', null, aiCandidates, cartProductIds, guardrails);

  // Pre-compute conversion boosts — Pillar 5
  const boostMap = {};
  await Promise.all(mergedCandidates.map(async (p) => {
    boostMap[p.productId] = await getConfidenceBoost(shopId, null, p.productId, p.recommendationType).catch(() => 0);
  }));

  const { offers, meta } = await decideFromCandidates(mergedCandidates, {
    shopId,
    config,
    goalConfig,
    riskConfig,
    guardrails,
    placement: normalizedPlacement,
    aiEngine,
    limit: effectiveLimit,
    conservativeMode,
    boostMap,
    contextKey: 'cart',
    sourceProductId: null,
    merchantContext,
    seenProductIds: seenProducts,
    contextProductIds: cartProductIds
  });

  logDecisionOffers({
    shopId,
    contextKey: 'cart',
    placement: normalizedPlacement,
    sourceProduct: null,
    cartProducts,
    offers,
    meta,
    merchantContext
  });

  return { offers, meta: { ...meta, adaptivePlacement: placementStats, placementShift, seenProducts: seenProducts?.size || 0 }, cartProducts };
}

// ─── Core Decision Logic ────────────────────────────────────────────────────

async function decideFromCandidates(candidates, {
  shopId,
  config,
  goalConfig,
  riskConfig,
  guardrails,
  placement,
  aiEngine,
  limit,
  conservativeMode = false,
  boostMap = {},
  contextKey = 'product',
  sourceProductId = null,
  merchantContext = null,
  seenProductIds = null,
  contextProductIds = []
}) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  if (list.length === 0) {
    logGuardrailEvent(shopId, 'no_candidates', { placement, contextKey, sourceProductId });
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, placement, 0, 'no_candidates')
    };
  }

  const seenSet = seenProductIds instanceof Set ? seenProductIds : new Set();
  let dedupedBySession = seenSet.size > 0
    ? list.filter((p) => !seenSet.has(String(p?.productId || p?.id || '')))
    : list;

  if (dedupedBySession.length === 0) {
    // Allow repeats for product and cart placements so we never return empty due to prior views/add-to-cart.
    if (contextKey === 'product' || placement === 'product_page' || placement === 'cart_drawer') {
      dedupedBySession = list;
    } else {
      logGuardrailEvent(shopId, 'seen_in_session', { placement, contextKey, seenCount: seenSet.size });
      return {
        offers: [],
        meta: buildMeta(config, goalConfig, riskConfig, placement, 0, 'seen_in_session', {
          seenProducts: seenSet.size
        })
      };
    }
  }

  // Merchant controls (approve/pause/guide)
  const offerKeys = dedupedBySession.map((p) => buildOfferKey({
    contextKey,
    sourceProductId,
    upsellProductId: p.productId
  }));
  const controlMap = await getOfferControlMap(shopId, offerKeys);
  const withControls = dedupedBySession.map((p) => {
    const offerKey = buildOfferKey({
      contextKey,
      sourceProductId,
      upsellProductId: p.productId
    });
    return {
      ...p,
      _offerKey: offerKey,
      _control: controlMap[offerKey] || null
    };
  });

  const pausedOffers = withControls.filter((p) => p._control?.status === 'paused');
  if (pausedOffers.length > 0) {
    console.log(`⏸️ Paused offers filtered out: ${pausedOffers.map(p => p.title || p.productId).join(', ')}`);
    pausedOffers.forEach((p) => {
      logGuardrailEvent(shopId, 'paused_offer', {
        placement,
        contextKey,
        productId: p.productId,
        productTitle: p.title || null
      });
    });
  }
  const controlFiltered = withControls.filter((p) => p._control?.status !== 'paused');
  if (controlFiltered.length === 0) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, placement, 0, 'paused_all')
    };
  }

  // Raise the confidence bar on underperforming placements (Pillar 4 adaptive)
  const baseMinAcceptance = Number(riskConfig?.minAcceptanceProbability ?? 0);
  const biasPenalty = goalConfig?.placementBias && goalConfig.placementBias !== placement ? 0.05 : 0;
  const minAcceptanceBase = conservativeMode ? Math.max(baseMinAcceptance, 0.4) : baseMinAcceptance;
  const minAcceptance = Math.min(1, minAcceptanceBase + biasPenalty);
  if (conservativeMode) {
    console.log(`📊 Adaptive: conservative mode ON for placement "${placement}" — minAcceptance raised to ${minAcceptance}`);
  }
  if (biasPenalty > 0) {
    console.log(`📍 Placement bias applied for "${placement}" — minAcceptance +${biasPenalty}`);
  }

  // Apply conversion-based confidence boost — Pillar 5
  const withConfidence = controlFiltered.map((p) => {
    const base = Number.isFinite(Number(p?.confidence)) ? Number(p.confidence) : 0.5;
    const boost = boostMap[p.productId] || 0;
    if (boost > 0) console.log(`📈 Conversion boost +${boost} for product ${p.productId}`);
    return { ...p, _confidence: Math.min(1, base + boost) };
  });

  const filtered = withConfidence.filter((p) => p._confidence >= minAcceptance);
  const lowConfidenceDropped = withConfidence.filter((p) => p._confidence < minAcceptance);
  if (lowConfidenceDropped.length > 0) {
    lowConfidenceDropped.forEach((p) => {
      logGuardrailEvent(shopId, 'low_confidence', {
        placement,
        contextKey,
        productId: p.productId,
        confidence: p._confidence,
        minAcceptance
      });
    });
  }
  const base = filtered.length > 0 ? filtered : withConfidence;

  const maxPrice = Math.max(0, ...base.map(getProductPrice));
  const maxInventory = Math.max(0, ...base.map(getProductInventory));
  const bundleEligibility = await getBundleEligibilityMap({
    shopId,
    sourceProductId,
    candidateProductIds: base.map(p => p.productId),
    contextProductIds
  });

  const scored = base.map((product) => {
    const price = getProductPrice(product);
    const inventory = getProductInventory(product);
    const isSubscription = aiEngine.isSubscriptionProduct(product);
    const bundleEligible = Boolean(bundleEligibility[String(product.productId || product.id)]) || product.recommendationType === 'bundle';
    const scoreResult = scoreCandidate(config.goal, {
      confidence: product._confidence,
      price,
      maxPrice,
      inventory,
      maxInventory,
      isSubscription
    });
    const controlBoost = getControlBoost(product?._control);
    const contextBoost = getContextBoost(product, merchantContext);
    const priorityBoost = getPriorityBoost(product, merchantContext, { price, maxPrice, inventory, maxInventory, isSubscription });
    const score = roundToThree(Math.min(1, scoreResult.score + controlBoost + contextBoost + priorityBoost));
    if (contextBoost > 0) {
      console.log(`🧭 Merchant context boost applied to product ${product.productId}`);
    }
    if (priorityBoost > 0) {
      console.log(`🎯 Priority boost +${priorityBoost} applied to product ${product.productId} (${merchantContext?.priority})`);
    }
    const offerType = selectOfferType(config.goal, {
      isSubscription,
      inventory,
      maxInventory,
      merchantContext,
      goalConfig,
      bundleEligible,
      guardrails
    });
    const extraReasons = [];
    if ((contextBoost > 0 || priorityBoost > 0) && merchantContext?.priority && merchantContext.priority !== 'none') {
      extraReasons.push(`Merchant priority: ${merchantContext.priority}`);
    }
    if (product?._control?.status === 'approved') extraReasons.push('Merchant approved');
    if (product?._control?.status === 'guided') {
      extraReasons.push(product?._control?.note ? `Merchant guidance: ${product._control.note}` : 'Merchant guided');
    }

    return {
      ...product,
      decisionScore: score,
      decisionReason: extraReasons.length > 0
        ? `${scoreResult.reason} • ${extraReasons.join(' • ')}`
        : scoreResult.reason,
      offerType
    };
  });

  scored.sort((a, b) => {
    const rankA = getTypePriorityRank(a.offerType, goalConfig);
    const rankB = getTypePriorityRank(b.offerType, goalConfig);
    if (rankA !== rankB) return rankA - rankB;
    return (b.decisionScore || 0) - (a.decisionScore || 0);
  });

  const conflictResolved = resolveOfferConflicts(scored);
  const limited = conflictResolved.slice(0, limit);
  const discountPercent = computeDiscountPercent(guardrails, riskConfig);

  const offers = limited.map((product) => ({
    ...product,
    discountPercent
  }));

  return {
    offers,
    meta: buildMeta(config, goalConfig, riskConfig, placement, offers.length, 'ok', {
      discountPercent
    })
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadConfig(shopId) {
  try {
    return await getMerchantConfig(shopId);
  } catch (err) {
    return {
      shopId,
      goal: DEFAULT_CONFIG.goal,
      riskTolerance: DEFAULT_CONFIG.riskTolerance,
      guardrails: DEFAULT_CONFIG.guardrails,
      goalConfig: GOAL_MAPPING[DEFAULT_CONFIG.goal],
      riskConfig: RISK_MAPPING[DEFAULT_CONFIG.riskTolerance],
      optimization: DEFAULT_CONFIG.optimization
    };
  }
}

function applyOptimizationOverrides(goalConfig, optimization) {
  const base = goalConfig || {};
  const topOfferType = optimization?.topOfferType;
  if (!topOfferType || !ALLOWED_OFFER_TYPES.has(topOfferType)) return base;

  const priority = Array.isArray(base.offerPriority) ? [...base.offerPriority] : [];
  const idx = priority.indexOf(topOfferType);

  // Only allow promotion within the top 2 positions of the goal's natural priority.
  // Prevents the learning engine from overriding the goal's primary offer type
  // with a lower-ranked type (e.g. volume_discount overriding addon_upsell for revenue_per_visitor).
  if (idx <= 0 || idx > 1) return base;

  priority.splice(idx, 1);
  priority.unshift(topOfferType);

  return {
    ...base,
    offerPriority: priority,
    topOfferType
  };
}

async function getBundleEligibilityMap({
  shopId,
  sourceProductId = null,
  candidateProductIds = [],
  contextProductIds = []
} = {}) {
  const map = {};
  const candidates = (candidateProductIds || [])
    .map((id) => (id != null ? String(id) : null))
    .filter(Boolean);
  if (!shopId || candidates.length === 0) return map;

  try {
    const db = await getDb();
    const col = db.collection(collections.bundles);
    const candidateSet = new Set(candidates);

    if (sourceProductId) {
      const sourceId = String(sourceProductId);
      const bundles = await col.find({
        shopId,
        status: 'active',
        $and: [
          { productIds: sourceId },
          { productIds: { $in: candidates } }
        ]
      }).toArray();

      for (const bundle of bundles) {
        for (const pid of bundle.productIds || []) {
          const key = String(pid);
          if (candidateSet.has(key) && key !== sourceId) {
            map[key] = true;
          }
        }
      }
      return map;
    }

    const contextIds = (contextProductIds || [])
      .map((id) => (id != null ? String(id) : null))
      .filter(Boolean);
    if (contextIds.length === 0) return map;

    const bundles = await col.find({
      shopId,
      status: 'active',
      $and: [
        { productIds: { $in: candidates } },
        { productIds: { $in: contextIds } }
      ]
    }).toArray();

    for (const bundle of bundles) {
      for (const pid of bundle.productIds || []) {
        const key = String(pid);
        if (candidateSet.has(key) && !contextIds.includes(key)) {
          map[key] = true;
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ getBundleEligibilityMap failed:', err.message);
  }

  return map;
}

function normalizePlacement(value) {
  const key = String(value || '').toLowerCase().trim();
  return PLACEMENT_ALIASES[key] || 'product_page';
}

function isPlacementAllowed(placement, riskConfig) {
  const allowed = riskConfig?.allowedPlacements || [];
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(placement);
}

function computeEffectiveLimit(limit, guardrails, riskConfig, seenProducts = null) {
  const desired = Number(limit) || 0;
  if (desired <= 0) return 0;
  const riskLimit = Number(riskConfig?.maxOfferFrequency);
  const guardrailLimit = Number(guardrails?.sessionOfferLimit);

  let effective = desired;
  if (Number.isFinite(riskLimit)) effective = Math.min(effective, riskLimit);
  if (Number.isFinite(guardrailLimit)) effective = Math.min(effective, guardrailLimit);

  // seenProducts is used only for deduplication in decideFromCandidates,
  // not for reducing the per-page limit — otherwise the widget stops showing
  // after sessionOfferLimit total cart-adds, breaking repeat visitors.

  return Math.max(0, effective);
}

function computeDiscountPercent(guardrails, riskConfig) {
  const cap = Number(guardrails?.maxDiscountCap);
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  const multiplier = Number(riskConfig?.discountMultiplier);
  const safeMultiplier = Number.isFinite(multiplier) ? multiplier : 1;
  const raw = cap * safeMultiplier;
  const bounded = Math.max(0, Math.min(cap, raw));
  return Math.round(bounded * 100) / 100;
}

function getProductPrice(product) {
  const aiPrice = Number(product?.aiData?.price);
  if (Number.isFinite(aiPrice) && aiPrice > 0) return aiPrice;

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  for (const v of variants) {
    const price = Number(v?.price);
    if (Number.isFinite(price) && price > 0) return price;
  }

  return 0;
}

function getProductInventory(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length === 0) return 0;
  return variants.reduce((max, v) => {
    const qty = Number(v?.inventoryQuantity || 0);
    return qty > max ? qty : max;
  }, 0);
}

function scoreCandidate(goal, { confidence, price, maxPrice, inventory, maxInventory, isSubscription }) {
  const conf = Number.isFinite(confidence) ? confidence : 0.5;
  const priceScore = maxPrice > 0 ? price / maxPrice : 0;
  const inventoryScore = maxInventory > 0 ? inventory / maxInventory : 0;
  const subscriptionScore = isSubscription ? 1 : 0;

  if (goal === 'increase_aov') {
    return {
      score: roundToThree(conf * 0.6 + priceScore * 0.4),
      reason: priceScore >= 0.6 ? 'Higher price supports AOV' : 'Likely to convert'
    };
  }

  if (goal === 'revenue_per_visitor') {
    return {
      score: roundToThree(conf * 0.7 + priceScore * 0.3),
      reason: 'Balanced revenue and acceptance'
    };
  }

  if (goal === 'subscription_adoption') {
    return {
      score: roundToThree(conf * 0.5 + subscriptionScore * 0.5),
      reason: isSubscription ? 'Subscription alignment' : 'Likely to convert'
    };
  }

  if (goal === 'inventory_movement') {
    return {
      score: roundToThree(conf * 0.5 + inventoryScore * 0.5),
      reason: inventoryScore >= 0.6 ? 'High inventory to move' : 'Likely to convert'
    };
  }

  return { score: roundToThree(conf), reason: 'Likely to convert' };
}

function selectOfferType(goal, { isSubscription, inventory, maxInventory, merchantContext, goalConfig, bundleEligible, guardrails }) {
  const basePriority = goalConfig?.offerPriority || GOAL_MAPPING[goal]?.offerPriority || ['addon_upsell'];
  const priority = [...basePriority];
  if (merchantContext?.preferBundles) {
    const idx = priority.indexOf('bundle');
    if (idx > 0) {
      priority.splice(idx, 1);
      priority.unshift('bundle');
    } else if (idx === -1) {
      priority.unshift('bundle');
    }
  }
  const discountCap = Number(guardrails?.maxDiscountCap || 0);
  const hasDiscountBudget = Number.isFinite(discountCap) && discountCap > 0;
  for (const type of priority) {
    if (type === 'subscription_upgrade' && isSubscription) return 'subscription_upgrade';
    if (type === 'volume_discount' && hasDiscountBudget) {
      return 'volume_discount';
    }
    if (type === 'bundle' && bundleEligible) return 'bundle';
    if (type === 'addon_upsell') return 'addon_upsell';
  }
  return 'addon_upsell';
}

function getTypePriorityRank(offerType, goalConfig) {
  const priority = goalConfig?.offerPriority || ['addon_upsell'];
  const rank = priority.indexOf(offerType);
  return rank === -1 ? priority.length : rank;
}

function buildMeta(config, goalConfig, riskConfig, placement, count, status, extra = {}) {
  return {
    status,
    placement,
    count,
    goal: config.goal,
    riskTolerance: config.riskTolerance,
    minAcceptanceProbability: riskConfig?.minAcceptanceProbability ?? null,
    maxOfferFrequency: riskConfig?.maxOfferFrequency ?? null,
    offerPriority: goalConfig?.offerPriority || [],
    placementBias: goalConfig?.placementBias || null,
    guardrails: {
      maxDiscountCap: config?.guardrails?.maxDiscountCap ?? null,
      inventoryMinThreshold: config?.guardrails?.inventoryMinThreshold ?? null,
      sessionOfferLimit: config?.guardrails?.sessionOfferLimit ?? null,
      premiumSkuProtection: config?.guardrails?.premiumSkuProtection ?? null,
      subscriptionProtection: config?.guardrails?.subscriptionProtection ?? null
    },
    ...extra
  };
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}

function getControlBoost(control) {
  if (!control) return 0;
  if (control.status === 'approved') return 0.08;
  if (control.status === 'guided') return 0.05;
  return 0;
}

function getContextBoost(product, merchantContext) {
  if (!merchantContext) return 0;
  const {
    focusProductIds = [],
    focusProductHandles = [],
    focusCollectionIds = [],
    focusCollectionHandles = []
  } = merchantContext;
  const id = String(product?.productId || product?.id || '');
  const handle = String(product?.handle || '').toLowerCase();
  const collectionIds = Array.isArray(product?.collectionIds) ? product.collectionIds.map(String) : [];
  const collectionHandles = Array.isArray(product?.collectionHandles)
    ? product.collectionHandles.map((h) => String(h).toLowerCase())
    : [];

  const hit =
    (id && focusProductIds.includes(id)) ||
    (handle && focusProductHandles.includes(handle)) ||
    collectionIds.some((cid) => focusCollectionIds.includes(cid)) ||
    collectionHandles.some((ch) => focusCollectionHandles.includes(ch));

  return hit ? 0.25 : 0;
}

/**
 * getPriorityBoost — real scoring logic for each merchant priority.
 * Each case uses actual product data (price, inventory, subscription status)
 * so the boost is deterministic, not LLM-dependent.
 */
function getPriorityBoost(product, merchantContext, { price, maxPrice, inventory, maxInventory, isSubscription }) {
  const priority = merchantContext?.priority;
  if (!priority || priority === 'none') return 0;

  switch (priority) {
    case 'push_new_collection': {
      // Boost products that belong to merchant's focus collections (set alongside this priority)
      const inFocus = getContextBoost(product, merchantContext) > 0;
      return inFocus ? 0.2 : 0;
    }

    case 'clear_overstock': {
      // Boost high-inventory products — ratio of this product's stock vs max in pool
      if (maxInventory > 0 && Number.isFinite(inventory)) {
        const ratio = inventory / maxInventory;
        if (ratio >= 0.7) return 0.25;
        if (ratio >= 0.4) return 0.12;
      }
      return 0;
    }

    case 'grow_subscriptions': {
      // Boost subscription-eligible products strongly
      return isSubscription ? 0.30 : 0;
    }

    case 'maximize_margin': {
      // Boost higher-priced products (proxy for margin)
      if (maxPrice > 0 && Number.isFinite(price)) {
        const ratio = price / maxPrice;
        if (ratio >= 0.7) return 0.25;
        if (ratio >= 0.4) return 0.12;
      }
      return 0;
    }

    case 'custom': {
      // Custom is driven by Groq prompt + Focus Products; no extra numeric boost needed
      return 0;
    }

    default:
      return 0;
  }
}

// ─── Offer Stacking & Conflict Resolution ───────────────────────────────────

/**
 * Detect conflicts between offers (same product, incompatible types)
 * Returns true if offers should NOT both be shown
 */
export function detectOfferConflict(offer1, offer2) {
  // Same product = conflict
  if (offer1.productId === offer2.productId) return true;

  // Subscription + addon on same base product = conflict (can't stack)
  if (offer1.offerType === 'subscription_upgrade' && offer2.offerType === 'addon_upsell') {
    return offer1.sourceProductId === offer2.sourceProductId;
  }

  // Two subscription upsells = conflict (only one per source)
  if (offer1.offerType === 'subscription_upgrade' && offer2.offerType === 'subscription_upgrade') {
    return offer1.sourceProductId === offer2.sourceProductId;
  }

  return false;
}

/**
 * Resolve conflicts in offer list using stacking strategy
 * Prefers: approved > guided > high confidence > recent
 */
export function resolveOfferConflicts(offers) {
  if (!Array.isArray(offers) || offers.length <= 1) return offers;

  const resolved = [];
  const seenProductIds = new Set();
  const seenSubscriptionSources = new Set();

  // Sort by conflict priority
  const sorted = offers.slice().sort((a, b) => {
    const scoreA = getConflictPriority(a);
    const scoreB = getConflictPriority(b);
    return scoreB - scoreA;
  });

  for (const offer of sorted) {
    // Check product conflict
    if (seenProductIds.has(offer.productId)) continue;

    // Check subscription source conflict
    if (offer.offerType === 'subscription_upgrade') {
      const sourceKey = `sub_${offer.sourceProductId}`;
      if (seenSubscriptionSources.has(sourceKey)) continue;
      seenSubscriptionSources.add(sourceKey);
    }

    resolved.push(offer);
    seenProductIds.add(offer.productId);
  }

  return resolved;
}

/**
 * Compute priority score for conflict resolution
 * Higher = wins in conflicts
 */
function getConflictPriority(offer) {
  let score = 0;

  // Control boost
  if (offer._control?.status === 'approved') score += 100;
  else if (offer._control?.status === 'guided') score += 50;

  // Confidence boost
  score += (offer.decisionScore || 0) * 10;

  // Type boost (subscriptions are harder to sell, keep them)
  if (offer.offerType === 'subscription_upgrade') score += 30;

  return score;
}

/**
 * Stack compatible offers to create complementary pairs
 * E.g., main upsell + warranty/protection addon
 */
export async function stackCompatibleOffers(offers, { shopId, sourceProductId }) {
  if (!Array.isArray(offers) || offers.length < 2) return offers;

  // Group by type
  const byType = {};
  for (const offer of offers) {
    if (!byType[offer.offerType]) byType[offer.offerType] = [];
    byType[offer.offerType].push(offer);
  }

  // If we have both main upsell and addon, keep both (they stack)
  if (byType.addon_upsell?.length > 0 && byType.bundle?.length > 0) {
    return offers; // Allow stacking
  }

  // Only one subscription per source
  if (byType.subscription_upgrade?.length > 1) {
    return [byType.subscription_upgrade[0], ...offers.filter(o => o.offerType !== 'subscription_upgrade')];
  }

  return offers;
}

function shouldBlockPlacement(placement, placementShift) {
  if (!placementShift?.actionable) return false;
  if (!placementShift?.from || !placementShift?.to) return false;
  if (placement !== placementShift.from) return false;
  return placementShift.recommendation === 'shift_upstream' || placementShift.recommendation === 'shift_downstream';
}

/**
 * injectFocusProducts — mutates `candidates` in-place.
 * Adds merchant focus products from merchantContext if not already present.
 */
async function injectFocusProducts(candidates, shopId, merchantContext, sourceProductId) {
  try {
    const focusIds = (merchantContext?.focusProductIds || []).map(String).filter(Boolean);
    const focusCollectionIds = (merchantContext?.focusCollectionIds || []).map(String).filter(Boolean);
    const focusCollectionHandles = (merchantContext?.focusCollectionHandles || []).map(s => String(s).toLowerCase()).filter(Boolean);

    console.log(`🎯 injectFocusProducts: focusCollectionIds=${JSON.stringify(focusCollectionIds)}, focusCollectionHandles=${JSON.stringify(focusCollectionHandles)}, focusProductIds=${JSON.stringify(focusIds)}`);

    if (focusIds.length === 0 && focusCollectionIds.length === 0 && focusCollectionHandles.length === 0) {
      console.log('🎯 injectFocusProducts: nothing to inject, returning early');
      return;
    }

    const existingIds = new Set(candidates.map(p => String(p?.productId || p?.id || '')));
    const db = await getDb();

    // Inject focus product IDs
    if (focusIds.length > 0) {
      const missing = focusIds.filter(id => !existingIds.has(id) && String(sourceProductId) !== id);
      if (missing.length > 0) {
        const products = await db.collection(collections.products)
          .find({ shopId, productId: { $in: missing.map(Number) } })
          .toArray();
        console.log(`🎯 injectFocusProducts: injecting ${products.length} focus products`);
        for (const p of products) {
          candidates.push({ ...p, confidence: 0.7, aiReason: 'Merchant focus product', recommendationType: 'merchant_focus' });
          existingIds.add(String(p.productId));
        }
      }
    }

    // Inject products from focus collections
    if (focusCollectionIds.length > 0 || focusCollectionHandles.length > 0) {
      const query = { shopId, status: { $in: ['ACTIVE', 'active'] } };
      const orClauses = [];
      if (focusCollectionIds.length > 0) orClauses.push({ collectionIds: { $in: focusCollectionIds } });
      if (focusCollectionHandles.length > 0) orClauses.push({ collectionHandles: { $in: focusCollectionHandles } });
      query.$or = orClauses;

      console.log(`🎯 injectFocusProducts: querying collection products with`, JSON.stringify(query));

      const collectionProducts = await db.collection(collections.products)
        .find(query)
        .limit(20)
        .toArray();

      console.log(`🎯 injectFocusProducts: found ${collectionProducts.length} collection products`);

      for (const p of collectionProducts) {
        const pid = String(p.productId);
        if (!existingIds.has(pid) && pid !== String(sourceProductId)) {
          candidates.push({ ...p, confidence: 0.7, aiReason: 'Merchant focus collection product', recommendationType: 'merchant_focus' });
          existingIds.add(pid);
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ injectFocusProducts failed:', err.message);
  }
}

/**
 * mergeApprovedProducts — returns new array with AI candidates + any manually
 * approved products that AI did not include.
 * Approved products are force-included so merchants see them immediately.
 */
async function mergeApprovedProducts(shopId, contextKey, sourceProductId, aiCandidates, excludeIds = [], guardrails = {}) {
  try {
    const db = await getDb();
    const srcFilter = sourceProductId ? String(sourceProductId) : 'cart';

    // Find all approved controls matching this context
    const approved = await db.collection(collections.offerControls)
      .find({ shopId, contextKey, status: 'approved' })
      .toArray();

    if (!approved.length) return aiCandidates;

    const existingIds = new Set((aiCandidates || []).map(p => String(p?.productId || p?.id || '')));
    const excludeSet = new Set((Array.isArray(excludeIds) ? excludeIds : [...excludeIds]).map(String));

    const missingIds = approved
      .map(a => a.upsellProductId)
      .filter(Boolean)
      .map(String)
      .filter(id => !existingIds.has(id) && !excludeSet.has(id));

    if (missingIds.length === 0) return aiCandidates;

    const products = await db.collection(collections.products)
      .find({ shopId, productId: { $in: missingIds.map(Number) } })
      .toArray();

    const injected = products
      .filter(p => {
        const status = p.status ? String(p.status).toUpperCase() : null;
        return !status || status === 'ACTIVE';
      })
      .map(p => ({
        ...p,
        confidence: 0.75,
        aiReason: 'Merchant approved product',
        recommendationType: 'merchant_approved'
      }));

    console.log(`✅ mergeApprovedProducts: injected ${injected.length} approved product(s) into ${contextKey} candidates`);
    return [...(aiCandidates || []), ...injected];
  } catch (err) {
    console.warn('⚠️ mergeApprovedProducts failed:', err.message);
    return aiCandidates;
  }
}
