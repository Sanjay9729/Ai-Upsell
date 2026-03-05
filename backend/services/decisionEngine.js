/**
 * Decision Engine — Pillar 3 V1
 *
 * Orchestrates what to offer, to whom, and when.
 * Uses goal + risk settings plus AI recommendations to rank and filter offers.
 */

import { getMerchantConfig, DEFAULT_CONFIG } from './merchantConfig.js';
import { GOAL_MAPPING, RISK_MAPPING } from '../../app/shared/merchantConfig.shared.js';
import { GroqAIEngine } from './groqAIEngine.js';
import { getPlacementStats, shouldPreferHighConfidenceOnly } from './adaptivePlacement.js';
import { getConfidenceBoost } from './conversionEngine.js';
import { getSafetyMode } from './safetyMode.js';
import {
  getMerchantContext,
  getOfferControlMap,
  buildOfferKey,
  logDecisionOffers
} from './merchandisingIntelligence.js';

const DEFAULT_LIMIT = 4;

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

  // Safety Mode check — block all offers when active
  const safetyActive = await getSafetyMode(shopId).catch(() => false);
  if (safetyActive) {
    console.log(`🛡️ Safety mode active for ${shopId} — skipping all offers`);
    return { offers: [], meta: { reason: 'safety_mode_active', status: 'safety_mode' }, sourceProduct: null };
  }

  const config = await loadConfig(shopId);
  const guardrails = config.guardrails || {};
  const goalConfig = config.goalConfig || GOAL_MAPPING[config.goal] || GOAL_MAPPING[DEFAULT_CONFIG.goal];
  const riskConfig = config.riskConfig || RISK_MAPPING[config.riskTolerance] || RISK_MAPPING[DEFAULT_CONFIG.riskTolerance];
  const normalizedPlacement = normalizePlacement(placement);
  const merchantContext = await getMerchantContext(shopId);

  if (!isPlacementAllowed(normalizedPlacement, riskConfig)) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'placement_blocked'),
      sourceProduct: null
    };
  }

  const effectiveLimit = computeEffectiveLimit(limit, guardrails, riskConfig);
  if (effectiveLimit <= 0) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'limit_zero'),
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
  const boostMap = {};
  await Promise.all(candidates.map(async (p) => {
    boostMap[p.productId] = await getConfidenceBoost(shopId, sourceProductId, p.productId, p.recommendationType).catch(() => 0);
  }));

  const { offers, meta } = await decideFromCandidates(recommendations, {
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
    merchantContext
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

  return { offers, meta: { ...meta, adaptivePlacement: placementStats }, sourceProduct };
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

  // Safety Mode check — block all offers when active
  const safetyActive = await getSafetyMode(shopId).catch(() => false);
  if (safetyActive) {
    console.log(`🛡️ Safety mode active for ${shopId} — skipping all cart offers`);
    return { offers: [], meta: { reason: 'safety_mode_active', status: 'safety_mode' }, cartProducts: [] };
  }

  const config = await loadConfig(shopId);
  const guardrails = config.guardrails || {};
  const goalConfig = config.goalConfig || GOAL_MAPPING[config.goal] || GOAL_MAPPING[DEFAULT_CONFIG.goal];
  const riskConfig = config.riskConfig || RISK_MAPPING[config.riskTolerance] || RISK_MAPPING[DEFAULT_CONFIG.riskTolerance];
  const normalizedPlacement = normalizePlacement(placement);
  const merchantContext = await getMerchantContext(shopId);

  if (!isPlacementAllowed(normalizedPlacement, riskConfig)) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'placement_blocked'),
      cartProducts: []
    };
  }

  const effectiveLimit = computeEffectiveLimit(limit, guardrails, riskConfig);
  if (effectiveLimit <= 0) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, normalizedPlacement, 0, 'limit_zero'),
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

  // Pre-compute conversion boosts — Pillar 5
  const cartCandidates = Array.isArray(recommendations) ? recommendations : [];
  const boostMap = {};
  await Promise.all(cartCandidates.map(async (p) => {
    boostMap[p.productId] = await getConfidenceBoost(shopId, null, p.productId, p.recommendationType).catch(() => 0);
  }));

  const { offers, meta } = await decideFromCandidates(recommendations, {
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
    merchantContext
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

  return { offers, meta: { ...meta, adaptivePlacement: placementStats }, cartProducts };
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
  merchantContext = null
}) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  if (list.length === 0) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, placement, 0, 'no_candidates')
    };
  }

  // Merchant controls (approve/pause/guide)
  const offerKeys = list.map((p) => buildOfferKey({
    contextKey,
    sourceProductId,
    upsellProductId: p.productId
  }));
  const controlMap = await getOfferControlMap(shopId, offerKeys);
  const withControls = list.map((p) => {
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

  const controlFiltered = withControls.filter((p) => p._control?.status !== 'paused');
  if (controlFiltered.length === 0) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, placement, 0, 'paused_all')
    };
  }

  // Raise the confidence bar on underperforming placements (Pillar 4 adaptive)
  const baseMinAcceptance = Number(riskConfig?.minAcceptanceProbability ?? 0);
  const minAcceptance = conservativeMode ? Math.max(baseMinAcceptance, 0.4) : baseMinAcceptance;
  if (conservativeMode) {
    console.log(`📊 Adaptive: conservative mode ON for placement "${placement}" — minAcceptance raised to ${minAcceptance}`);
  }

  // Apply conversion-based confidence boost — Pillar 5
  const withConfidence = controlFiltered.map((p) => {
    const base = Number.isFinite(Number(p?.confidence)) ? Number(p.confidence) : 0.5;
    const boost = boostMap[p.productId] || 0;
    if (boost > 0) console.log(`📈 Conversion boost +${boost} for product ${p.productId}`);
    return { ...p, _confidence: Math.min(1, base + boost) };
  });

  const filtered = withConfidence.filter((p) => p._confidence >= minAcceptance);
  const base = filtered.length > 0 ? filtered : withConfidence;

  const maxPrice = Math.max(0, ...base.map(getProductPrice));
  const maxInventory = Math.max(0, ...base.map(getProductInventory));

  const scored = base.map((product) => {
    const price = getProductPrice(product);
    const inventory = getProductInventory(product);
    const isSubscription = aiEngine.isSubscriptionProduct(product);
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
    const score = roundToThree(Math.min(1, scoreResult.score + controlBoost + contextBoost));
    if (contextBoost > 0) {
      console.log(`🧭 Merchant context boost applied to product ${product.productId}`);
    }
    const offerType = selectOfferType(config.goal, {
      isSubscription,
      inventory,
      maxInventory,
      merchantContext
    });
    const extraReasons = [];
    if (contextBoost > 0 && merchantContext?.priority && merchantContext.priority !== 'none') {
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
  const limited = scored.slice(0, limit);
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
      riskConfig: RISK_MAPPING[DEFAULT_CONFIG.riskTolerance]
    };
  }
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

function computeEffectiveLimit(limit, guardrails, riskConfig) {
  const desired = Number(limit) || 0;
  if (desired <= 0) return 0;
  const riskLimit = Number(riskConfig?.maxOfferFrequency);
  const guardrailLimit = Number(guardrails?.sessionOfferLimit);

  let effective = desired;
  if (Number.isFinite(riskLimit)) effective = Math.min(effective, riskLimit);
  if (Number.isFinite(guardrailLimit)) effective = Math.min(effective, guardrailLimit);
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

function selectOfferType(goal, { isSubscription, inventory, maxInventory, merchantContext }) {
  const basePriority = GOAL_MAPPING[goal]?.offerPriority || ['addon_upsell'];
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
  for (const type of priority) {
    if (type === 'subscription_upgrade' && isSubscription) return 'subscription_upgrade';
    if (type === 'volume_discount' && maxInventory > 0 && inventory / maxInventory >= 0.7)
      return 'volume_discount';
    if (type === 'bundle') return 'bundle';
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

  return hit ? 0.04 : 0;
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
    byType[byType[offer.offerType]] = offer;
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
