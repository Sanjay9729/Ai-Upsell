/**
 * Decision Engine — Pillar 3 V1
 *
 * Orchestrates what to offer, to whom, and when.
 * Uses goal + risk settings plus AI recommendations to rank and filter offers.
 */

import { getMerchantConfig, DEFAULT_CONFIG } from './merchantConfig.js';
import { GOAL_MAPPING, RISK_MAPPING } from '../../app/shared/merchantConfig.shared.js';
import { GroqAIEngine } from './groqAIEngine.js';

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

  const config = await loadConfig(shopId);
  const guardrails = config.guardrails || {};
  const goalConfig = config.goalConfig || GOAL_MAPPING[config.goal] || GOAL_MAPPING[DEFAULT_CONFIG.goal];
  const riskConfig = config.riskConfig || RISK_MAPPING[config.riskTolerance] || RISK_MAPPING[DEFAULT_CONFIG.riskTolerance];
  const normalizedPlacement = normalizePlacement(placement);

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

  const aiEngine = new GroqAIEngine();
  const recommendations = await aiEngine.findUpsellProducts(
    shopId,
    productId,
    effectiveLimit,
    userId
  );

  const sourceProduct = recommendations?._sourceProduct || null;
  const { offers, meta } = decideFromCandidates(recommendations, {
    config,
    goalConfig,
    riskConfig,
    guardrails,
    placement: normalizedPlacement,
    aiEngine,
    limit: effectiveLimit
  });

  return { offers, meta, sourceProduct };
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

  const config = await loadConfig(shopId);
  const guardrails = config.guardrails || {};
  const goalConfig = config.goalConfig || GOAL_MAPPING[config.goal] || GOAL_MAPPING[DEFAULT_CONFIG.goal];
  const riskConfig = config.riskConfig || RISK_MAPPING[config.riskTolerance] || RISK_MAPPING[DEFAULT_CONFIG.riskTolerance];
  const normalizedPlacement = normalizePlacement(placement);

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

  const aiEngine = new GroqAIEngine();
  const recommendations = await aiEngine.findCartUpsellProducts(
    shopId,
    cartProductIds,
    effectiveLimit,
    userId
  );

  const cartProducts = recommendations?._cartProducts || [];
  const { offers, meta } = decideFromCandidates(recommendations, {
    config,
    goalConfig,
    riskConfig,
    guardrails,
    placement: normalizedPlacement,
    aiEngine,
    limit: effectiveLimit
  });

  return { offers, meta, cartProducts };
}

// ─── Core Decision Logic ────────────────────────────────────────────────────

function decideFromCandidates(candidates, { config, goalConfig, riskConfig, guardrails, placement, aiEngine, limit }) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  if (list.length === 0) {
    return {
      offers: [],
      meta: buildMeta(config, goalConfig, riskConfig, placement, 0, 'no_candidates')
    };
  }

  const minAcceptance = Number(riskConfig?.minAcceptanceProbability ?? 0);
  const withConfidence = list.map((p) => ({
    ...p,
    _confidence: Number.isFinite(Number(p?.confidence)) ? Number(p.confidence) : 0.5
  }));

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
    const offerType = selectOfferType(config.goal, {
      isSubscription,
      inventory,
      maxInventory
    });

    return {
      ...product,
      decisionScore: scoreResult.score,
      decisionReason: scoreResult.reason,
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

function selectOfferType(goal, { isSubscription, inventory, maxInventory }) {
  const priority = GOAL_MAPPING[goal]?.offerPriority || ['addon_upsell'];
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
    ...extra
  };
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
}
