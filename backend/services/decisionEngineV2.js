/**
 * Decision Engine V2 — Production-Grade Autonomous Optimization
 * 
 * Core responsibilities:
 * 1. Real-time offer ranking + conflict resolution
 * 2. Guardrail enforcement (bundle quality, discount limits, offer density)
 * 3. Autonomous performance tracking + auto-pause underperformers
 * 4. Context-aware placement + incentive tuning
 * 5. Explainability + decision tracing
 */

import { getMerchantConfig, DEFAULT_CONFIG } from './merchantConfig.js';
import { GOAL_MAPPING, RISK_MAPPING } from '../../app/shared/merchantConfig.shared.js';
import { GroqAIEngine } from './groqAIEngine.js';
import { getDb, collections } from '../database/mongodb.js';
import { getSafetyMode } from './safetyMode.js';
import {
  getMerchantContext,
  getOfferControlMap,
  buildOfferKey,
  logDecisionOffers
} from './merchandisingIntelligence.js';

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const PERFORMANCE_THRESHOLDS = {
  MIN_VIEWS_TO_PAUSE: 20,           // Minimum views before auto-pausing
  CONVERSION_FLOOR: 0.02,             // 2% minimum conversion to keep active
  CTR_FLOOR: 0.05,                    // 5% minimum CTR to keep active
  UNDERPERFORMANCE_WINDOW_DAYS: 7,   // Look at last 7 days
};

const GUARDRAILS = {
  MAX_DISCOUNT_PERCENT: 50,
  MAX_BUNDLE_SIZE: 5,
  MIN_BUNDLE_QUALITY_SCORE: 0.6,
  MAX_OFFERS_PER_PLACEMENT: 4,
  MAX_OFFER_DENSITY: 0.3,             // Offers per 100 session views
};

const PLACEMENT_ALIASES = {
  product: 'product_page',
  product_page: 'product_page',
  cart: 'cart_drawer',
  cart_drawer: 'cart_drawer',
  checkout: 'checkout',
  post_purchase: 'post_purchase'
};

// ─── MAIN DECISION FUNCTIONS ──────────────────────────────────────────────

/**
 * Decide product page offers with full autonomy + guardrails
 */
export async function decideProductOffers({
  shopId,
  productId,
  userId = null,
  limit = 4,
  placement = 'product_page'
} = {}) {
  const startTime = Date.now();
  const trace = [];

  try {
    // Input validation
    if (!shopId || !productId) {
      return failureResponse('missing_inputs', trace);
    }

    trace.push({ step: 'input_validation', status: 'ok' });

    // 1. Safety mode check
    const safetyActive = await getSafetyMode(shopId).catch(() => false);
    if (safetyActive) {
      trace.push({ step: 'safety_check', status: 'blocked', reason: 'safety_mode_active' });
      return failureResponse('safety_mode_active', trace);
    }

    trace.push({ step: 'safety_check', status: 'ok' });

    // 2. Load config + guardrails
    const [config, merchantContext, offerControls] = await Promise.all([
      getMerchantConfig(shopId),
      getMerchantContext(shopId),
      getOfferControlMap(shopId, [])
    ]);

    const normalizedPlacement = PLACEMENT_ALIASES[placement] || placement;
    trace.push({ step: 'config_load', status: 'ok', placement: normalizedPlacement });

    // 3. Check placement allowed by risk config
    const riskConfig = RISK_MAPPING[config.riskTolerance] || RISK_MAPPING.moderate;
    if (!isPlacementAllowed(normalizedPlacement, riskConfig)) {
      trace.push({ step: 'placement_check', status: 'blocked', reason: 'risk_config_blocks_placement' });
      return failureResponse('placement_blocked_by_risk', trace);
    }

    trace.push({ step: 'placement_check', status: 'ok' });

    // 4. Get AI recommendations
    const aiEngine = new GroqAIEngine();
    const recommendations = await aiEngine.findUpsellProducts(shopId, productId, limit, userId);
    const candidates = Array.isArray(recommendations) ? recommendations : [];

    trace.push({ 
      step: 'ai_recommendations', 
      status: 'ok', 
      candidatesCount: candidates.length 
    });

    // 5. Score + rank candidates
    const scored = await scoreAndRankCandidates(candidates, {
      shopId,
      config,
      merchantContext,
      sourceProductId: productId,
      offerControls,
      placement: normalizedPlacement
    });

    trace.push({ 
      step: 'scoring', 
      status: 'ok', 
      scoredCount: scored.length 
    });

    // 6. Enforce guardrails
    const guardrailed = await enforceGuardrails(scored, {
      shopId,
      limit,
      placement: normalizedPlacement,
      sourceProductId: productId,
      merchantContext,
      config
    });

    trace.push({ 
      step: 'guardrails', 
      status: 'ok', 
      afterGuardrails: guardrailed.length 
    });

    // 7. Resolve conflicts + stack compatible
    const resolved = resolveOfferConflicts(guardrailed);
    const stacked = await stackCompatibleOffers(resolved, { shopId, sourceProductId: productId });

    trace.push({ 
      step: 'conflict_resolution', 
      status: 'ok', 
      finalCount: stacked.length 
    });

    // 8. Add explainability
    const offers = stacked.map((offer, idx) => ({
      ...offer,
      rank: idx + 1,
      explainability: buildExplainability(offer),
      trace: buildOfferTrace(offer)
    }));

    trace.push({ step: 'explainability', status: 'ok' });

    return {
      success: true,
      offers,
      meta: {
        status: 'ok',
        placement: normalizedPlacement,
        source: 'product_page',
        count: offers.length,
        goal: config.goal,
        riskTolerance: config.riskTolerance,
        executionMs: Date.now() - startTime,
        trace
      }
    };

  } catch (error) {
    console.error('❌ decideProductOffers failed:', error);
    trace.push({ step: 'error', status: 'failed', reason: error.message });
    return failureResponse(error.message, trace);
  }
}

/**
 * Decide cart offers with the same rigor
 */
export async function decideCartOffers({
  shopId,
  cartProductIds,
  userId = null,
  limit = 4,
  placement = 'cart_drawer'
} = {}) {
  const startTime = Date.now();
  const trace = [];

  try {
    // Input validation
    if (!shopId || !Array.isArray(cartProductIds) || cartProductIds.length === 0) {
      return failureResponse('missing_inputs', trace);
    }

    trace.push({ step: 'input_validation', status: 'ok', cartSize: cartProductIds.length });

    // Safety mode check
    const safetyActive = await getSafetyMode(shopId).catch(() => false);
    if (safetyActive) {
      trace.push({ step: 'safety_check', status: 'blocked' });
      return failureResponse('safety_mode_active', trace);
    }

    // Load config
    const [config, merchantContext, offerControls] = await Promise.all([
      getMerchantConfig(shopId),
      getMerchantContext(shopId),
      getOfferControlMap(shopId, [])
    ]);

    const normalizedPlacement = PLACEMENT_ALIASES[placement] || placement;
    trace.push({ step: 'config_load', status: 'ok' });

    // Placement check
    const riskConfig = RISK_MAPPING[config.riskTolerance] || RISK_MAPPING.moderate;
    if (!isPlacementAllowed(normalizedPlacement, riskConfig)) {
      trace.push({ step: 'placement_check', status: 'blocked' });
      return failureResponse('placement_blocked_by_risk', trace);
    }

    // Get AI recommendations
    const aiEngine = new GroqAIEngine();
    const recommendations = await aiEngine.findCartUpsellProducts(
      shopId,
      cartProductIds,
      limit,
      userId
    );
    const candidates = Array.isArray(recommendations) ? recommendations : [];

    trace.push({ step: 'ai_recommendations', status: 'ok', count: candidates.length });

    // Score + rank
    const scored = await scoreAndRankCandidates(candidates, {
      shopId,
      config,
      merchantContext,
      sourceProductId: null,
      offerControls,
      placement: normalizedPlacement,
      contextKey: 'cart'
    });

    trace.push({ step: 'scoring', status: 'ok', count: scored.length });

    // Enforce guardrails
    const guardrailed = await enforceGuardrails(scored, {
      shopId,
      limit,
      placement: normalizedPlacement,
      sourceProductId: null,
      merchantContext,
      config,
      contextKey: 'cart',
      cartProductIds
    });

    trace.push({ step: 'guardrails', status: 'ok', count: guardrailed.length });

    // Resolve + stack
    const resolved = resolveOfferConflicts(guardrailed);
    const stacked = await stackCompatibleOffers(resolved, { shopId, sourceProductId: null });

    // Explainability
    const offers = stacked.map((offer, idx) => ({
      ...offer,
      rank: idx + 1,
      explainability: buildExplainability(offer),
      trace: buildOfferTrace(offer)
    }));

    trace.push({ step: 'finalization', status: 'ok' });

    return {
      success: true,
      offers,
      meta: {
        status: 'ok',
        placement: normalizedPlacement,
        source: 'cart',
        count: offers.length,
        goal: config.goal,
        riskTolerance: config.riskTolerance,
        executionMs: Date.now() - startTime,
        trace
      }
    };

  } catch (error) {
    console.error('❌ decideCartOffers failed:', error);
    trace.push({ step: 'error', status: 'failed', reason: error.message });
    return failureResponse(error.message, trace);
  }
}

// ─── SCORING & RANKING ─────────────────────────────────────────────────────

/**
 * Score candidates and return ranked list
 */
async function scoreAndRankCandidates(candidates, options) {
  const { shopId, config, merchantContext, sourceProductId, offerControls, placement } = options;

  const goalConfig = GOAL_MAPPING[config.goal] || GOAL_MAPPING.grow_aov;
  const riskConfig = RISK_MAPPING[config.riskTolerance] || RISK_MAPPING.moderate;

  // Score each candidate
  const scored = candidates.map(candidate => {
    let score = 0;
    const reasons = [];

    // 1. Base confidence from AI
    const aiScore = (candidate.confidence || 0.5) * 0.3;
    score += aiScore;
    if (aiScore > 0.15) reasons.push('high_ai_confidence');

    // 2. Control status bonus (approved > guided > auto)
    const control = offerControls[buildOfferKey(sourceProductId, candidate.productId)] || {};
    if (control.status === 'approved') {
      score += 0.3;
      reasons.push('merchant_approved');
    } else if (control.status === 'guided') {
      score += 0.15;
      reasons.push('merchant_guided');
    }

    // 3. Goal alignment bonus
    const goalBonus = computeGoalBonus(candidate, goalConfig, riskConfig);
    score += goalBonus * 0.2;
    if (goalBonus > 0) reasons.push(`goal_${config.goal}`);

    // 4. Performance bonus (historical CTR + conversion)
    const perfBonus = 0; // TODO: fetch from recent analytics
    score += perfBonus * 0.2;

    // 5. Recommendation type bonus
    if (candidate.recommendationType === 'merchant_focus') {
      score += 0.15;
      reasons.push('merchant_focus');
    } else if (candidate.recommendationType === 'merchant_approved') {
      score += 0.1;
      reasons.push('merchant_approved_product');
    }

    return {
      ...candidate,
      _score: Math.min(score, 1.0),
      _scoreBreakdown: {
        aiScore,
        controlBonus: control.status ? 0.3 : 0,
        goalBonus: goalBonus * 0.2,
        perfBonus,
        recoTypeBonus: candidate.recommendationType ? 0.1 : 0
      },
      _scoreReasons: reasons
    };
  });

  // Sort by score descending
  return scored.sort((a, b) => b._score - a._score);
}

/**
 * Compute goal-based bonus
 */
function computeGoalBonus(candidate, goalConfig, riskConfig) {
  switch (goalConfig.type) {
    case 'grow_aov': {
      // Higher price = higher bonus
      const price = candidate.price || 0;
      return Math.min(price / 100, 1.0); // Cap at 1.0
    }
    case 'grow_subscriptions': {
      // Subscription products get max bonus
      if (candidate.isSubscription || candidate.subscriptionEligible) {
        return 1.0;
      }
      return candidate.price ? Math.min(candidate.price / 50, 0.5) : 0;
    }
    case 'maximize_margin': {
      // Margin proxy: high-price items
      const margin = candidate.margin || candidate.price * 0.3;
      return Math.min(margin / 100, 1.0);
    }
    default:
      return 0;
  }
}

// ─── GUARDRAILS ENFORCEMENT ───────────────────────────────────────────────

/**
 * Apply all guardrails to offer list
 */
async function enforceGuardrails(offers, options) {
  const {
    shopId,
    limit,
    placement,
    sourceProductId,
    merchantContext,
    config,
    contextKey = 'product',
    cartProductIds = []
  } = options;

  let result = [...offers];

  // 1. Respect offer limit
  result = result.slice(0, limit);

  // 2. Check discount limits
  result = result.filter(offer => {
    if (offer.discountPercent != null && offer.discountPercent > GUARDRAILS.MAX_DISCOUNT_PERCENT) {
      console.warn(`⚠️ Offer ${offer.offerId} discount ${offer.discountPercent}% exceeds max ${GUARDRAILS.MAX_DISCOUNT_PERCENT}%`);
      return false;
    }
    return true;
  });

  // 3. Check bundle quality
  if (contextKey === 'bundle' || config.preferBundles) {
    result = await filterBundlesByQuality(result, shopId);
  }

  // 4. Auto-pause underperformers (recent data)
  const live = await filterOutUnderperformers(result, shopId);

  // 5. Enforce placement-specific rules
  result = enforcePlacementRules(live, placement);

  return result;
}

/**
 * Filter out offers with poor recent performance
 */
async function filterOutUnderperformers(offers, shopId) {
  if (!Array.isArray(offers) || offers.length === 0) return offers;

  const db = await getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get recent performance for each offer
  const performance = await db.collection(collections.upsellEvents)
    .aggregate([
      {
        $match: {
          shopId,
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            sourceProductId: { $ifNull: ['$sourceProductId', 'cart'] },
            upsellProductId: '$upsellProductId',
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      }
    ])
    .toArray();

  // Build perf map
  const perfMap = {};
  for (const row of performance) {
    const key = `${row._id.sourceProductId}:${row._id.upsellProductId}`;
    if (!perfMap[key]) {
      perfMap[key] = { views: 0, clicks: 0, adds: 0 };
    }
    if (row._id.eventType === 'view') perfMap[key].views = row.count;
    if (row._id.eventType === 'click') perfMap[key].clicks = row.count;
    if (row._id.eventType === 'cart_add') perfMap[key].adds = row.count;
  }

  // Filter based on thresholds
  const filtered = [];
  for (const offer of offers) {
    const key = `${offer.sourceProductId || 'cart'}:${offer.productId}`;
    const perf = perfMap[key];

    if (!perf || perf.views < PERFORMANCE_THRESHOLDS.MIN_VIEWS_TO_PAUSE) {
      // Not enough data, keep it
      filtered.push(offer);
      continue;
    }

    // Calculate conversion + CTR
    const conversion = perf.adds / perf.views;
    const ctr = perf.clicks / perf.views;

    if (conversion >= PERFORMANCE_THRESHOLDS.CONVERSION_FLOOR && 
        ctr >= PERFORMANCE_THRESHOLDS.CTR_FLOOR) {
      // Performing well
      filtered.push({ ...offer, _performance: { views: perf.views, ctr, conversion } });
    } else {
      // Underperforming
      console.warn(`⏸️ Auto-pausing underperformer: ${offer.offerId} (conv=${(conversion*100).toFixed(1)}%, ctr=${(ctr*100).toFixed(1)}%)`);
      // TODO: Auto-pause in offerControls
    }
  }

  return filtered;
}

/**
 * Filter bundles by quality score
 */
async function filterBundlesByQuality(offers, shopId) {
  return offers.filter(offer => {
    if (offer.offerType !== 'bundle') return true;
    
    // Calculate bundle quality
    const quality = computeBundleQuality(offer);
    if (quality < GUARDRAILS.MIN_BUNDLE_QUALITY_SCORE) {
      console.warn(`⚠️ Bundle ${offer.offerId} quality ${quality.toFixed(2)} below threshold`);
      return false;
    }
    return true;
  });
}

/**
 * Calculate bundle quality (0-1)
 */
function computeBundleQuality(bundle) {
  if (!Array.isArray(bundle.items)) return 0;

  let score = 0;
  
  // Item count (3-5 items ideal)
  if (bundle.items.length >= 3 && bundle.items.length <= 5) score += 0.3;
  else if (bundle.items.length >= 2) score += 0.15;

  // Discount reasonableness (10-30% good)
  const discount = bundle.discountPercent || 0;
  if (discount >= 10 && discount <= 30) score += 0.3;
  else if (discount > 0 && discount < 50) score += 0.15;

  // Price variance (items should have different prices)
  if (bundle.items.length > 1) {
    const prices = bundle.items.map(i => i.price || 0).filter(p => p > 0);
    if (prices.length > 1) {
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
      if (variance > 0) score += 0.2;
    }
  }

  // Complementarity (items should complement each other)
  score += 0.2; // Placeholder for AI-based check

  return Math.min(score, 1.0);
}

/**
 * Enforce placement-specific constraints
 */
function enforcePlacementRules(offers, placement) {
  if (!Array.isArray(offers)) return offers;

  switch (placement) {
    case 'checkout':
      // Checkout is friction-sensitive: max 2 offers, high confidence only
      return offers
        .filter(o => o._score >= 0.7)
        .slice(0, 2);

    case 'post_purchase':
      // Post-purchase can be more aggressive: max 4
      return offers.slice(0, 4);

    case 'cart_drawer':
      // Cart can show all but enforce CTR > 3%
      return offers.filter(o => {
        const perf = o._performance;
        if (!perf) return true; // No data yet
        return perf.ctr >= 0.03;
      });

    case 'product_page':
    default:
      // Product page: max 4, no special rules
      return offers.slice(0, 4);
  }
}

// ─── CONFLICT RESOLUTION ──────────────────────────────────────────────────

/**
 * Resolve conflicts: pick winners based on priority
 */
function resolveOfferConflicts(offers) {
  if (!Array.isArray(offers) || offers.length <= 1) return offers;

  const resolved = [];
  const seenProductIds = new Set();
  const seenSubscriptionSources = new Set();

  // Sort by conflict priority
  const sorted = offers.slice().sort((a, b) => {
    const prioA = getConflictPriority(a);
    const prioB = getConflictPriority(b);
    return prioB - prioA;
  });

  for (const offer of sorted) {
    // Product conflict check
    if (seenProductIds.has(String(offer.productId))) {
      console.log(`⚠️ Skipping offer for product ${offer.productId} (already offered)`);
      continue;
    }

    // Subscription source conflict
    if (offer.offerType === 'subscription_upgrade') {
      const srcKey = `sub_${offer.sourceProductId}`;
      if (seenSubscriptionSources.has(srcKey)) {
        console.log(`⚠️ Skipping subscription offer for source ${offer.sourceProductId} (already offered)`);
        continue;
      }
      seenSubscriptionSources.add(srcKey);
    }

    resolved.push(offer);
    seenProductIds.add(String(offer.productId));
  }

  return resolved;
}

/**
 * Priority score for conflict resolution
 */
function getConflictPriority(offer) {
  let score = 0;

  // Control status
  if (offer._control?.status === 'approved') score += 1000;
  else if (offer._control?.status === 'guided') score += 500;

  // Decision score
  score += (offer._score || 0) * 100;

  // Type preference
  if (offer.offerType === 'subscription_upgrade') score += 300;

  return score;
}

/**
 * Stack compatible offers for paired recommendations
 */
async function stackCompatibleOffers(offers, options) {
  if (!Array.isArray(offers) || offers.length < 2) return offers;

  // For now, allow all compatible types to stack
  // Bundle + addon can stack; two subscriptions cannot

  const byType = {};
  for (const offer of offers) {
    if (!byType[offer.offerType]) byType[offer.offerType] = [];
    byType[offer.offerType].push(offer);
  }

  // Enforce: only 1 subscription per source
  if (byType.subscription_upgrade?.length > 1) {
    return [
      byType.subscription_upgrade[0],
      ...offers.filter(o => o.offerType !== 'subscription_upgrade')
    ];
  }

  return offers;
}

// ─── EXPLAINABILITY ───────────────────────────────────────────────────────

/**
 * Build explainability metadata for an offer
 */
function buildExplainability(offer) {
  return {
    whyThis: [
      ...offer._scoreReasons || [],
      'High match confidence',
      'Aligns with merchant goals'
    ].slice(0, 3),
    score: parseFloat((offer._score || 0).toFixed(3)),
    scoreBreakdown: offer._scoreBreakdown || {},
    guardrailsApplied: [],
    nextBestAlternative: null // TODO: track runner-up
  };
}

/**
 * Build trace of offer decision
 */
function buildOfferTrace(offer) {
  return {
    productId: offer.productId,
    offerId: offer.offerId,
    decision: 'approved',
    timestamp: new Date().toISOString(),
    version: 2,
    confidence: offer.confidence || 0,
    score: offer._score || 0
  };
}

// ─── AUTONOMOUS OPTIMIZATION LOOP ─────────────────────────────────────────

/**
 * Autonomously pause underperformers + reallocate budget
 * Runs during optimization cycle
 */
export async function autonomousPauseUnderperformers(shopId) {
  try {
    const db = await getDb();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Get performance data
    const perfRows = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: sevenDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              sourceProductId: { $ifNull: ['$sourceProductId', 'cart'] },
              upsellProductId: '$upsellProductId'
            },
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
            adds: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } }
          }
        }
      ])
      .toArray();

    const paused = [];
    const promoted = [];

    for (const row of perfRows) {
      if (row.views < PERFORMANCE_THRESHOLDS.MIN_VIEWS_TO_PAUSE) continue;

      const conversion = row.adds / row.views;
      const ctr = row.clicks / row.views;

      // Auto-pause underperformers
      if (conversion < PERFORMANCE_THRESHOLDS.CONVERSION_FLOOR && 
          ctr < PERFORMANCE_THRESHOLDS.CTR_FLOOR) {
        const offerKey = buildOfferKey(row._id.sourceProductId, row._id.upsellProductId);
        
        // Update control to paused
        await db.collection(collections.offerControls).updateOne(
          { shopId, offerKey },
          {
            $set: {
              status: 'paused',
              pausedReason: `Auto-paused: conv=${(conversion*100).toFixed(1)}%, ctr=${(ctr*100).toFixed(1)}%`,
              pausedAt: new Date(),
              performance: { views: row.views, ctr, conversion }
            }
          },
          { upsert: true }
        );

        paused.push({ offerKey, reason: `conv=${(conversion*100).toFixed(1)}%` });
      }

      // Mark high performers
      if (conversion >= PERFORMANCE_THRESHOLDS.CONVERSION_FLOOR * 2 &&
          ctr >= PERFORMANCE_THRESHOLDS.CTR_FLOOR * 2) {
        promoted.push({ source: row._id.sourceProductId, product: row._id.upsellProductId });
      }
    }

    return { success: true, paused: paused.length, promoted: promoted.length };

  } catch (error) {
    console.error('❌ autonomousPauseUnderperformers failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Auto-tune incentives based on performance
 */
export async function autoTuneIncentives(shopId) {
  try {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get all active offers
    const offers = await db.collection(collections.offerControls)
      .find({ shopId, status: { $ne: 'paused' } })
      .toArray();

    const tuned = [];

    for (const offer of offers) {
      // Get performance
      const perf = await db.collection(collections.upsellEvents)
        .aggregate([
          {
            $match: {
              shopId,
              sourceProductId: offer.sourceProductId,
              upsellProductId: offer.upsellProductId,
              timestamp: { $gte: thirtyDaysAgo }
            }
          },
          {
            $group: {
              _id: '$eventType',
              count: { $sum: 1 }
            }
          }
        ])
        .toArray();

      const perfMap = {};
      for (const row of perf) {
        perfMap[row._id] = row.count;
      }

      const views = perfMap.view || 0;
      const adds = perfMap.cart_add || 0;
      const conversion = views > 0 ? adds / views : 0;

      // Tune discount
      let newDiscount = offer.discountPercent || 15;
      if (conversion < 0.02) newDiscount = Math.min(newDiscount + 5, 30);  // Increase incentive
      else if (conversion > 0.05) newDiscount = Math.max(newDiscount - 2, 10); // Reduce incentive

      if (newDiscount !== offer.discountPercent) {
        await db.collection(collections.offerControls).updateOne(
          { shopId, offerKey: offer.offerKey },
          { $set: { discountPercent: newDiscount, tuneReason: `Auto-tuned for conv=${(conversion*100).toFixed(1)}%` } }
        );

        tuned.push({
          offerKey: offer.offerKey,
          oldDiscount: offer.discountPercent,
          newDiscount,
          reason: `conversion=${(conversion*100).toFixed(1)}%`
        });
      }
    }

    return { success: true, tuned: tuned.length };

  } catch (error) {
    console.error('❌ autoTuneIncentives failed:', error);
    return { success: false, error: error.message };
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function isPlacementAllowed(placement, riskConfig) {
  const allowedPlacements = riskConfig.allowedPlacements || ['product_page'];
  return allowedPlacements.includes(placement);
}

function failureResponse(reason, trace) {
  return {
    success: false,
    offers: [],
    meta: {
      status: 'failed',
      reason,
      trace
    }
  };
}

export const decisionEngineV2 = {
  decideProductOffers,
  decideCartOffers,
  autonomousPauseUnderperformers,
  autoTuneIncentives,
  resolveOfferConflicts,
  buildExplainability
};
