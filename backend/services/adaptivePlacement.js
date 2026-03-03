/**
 * Adaptive Placement Service — Pillar 4
 *
 * Reads upsell_events grouped by metadata.location to compute
 * per-placement conversion rates for each shop.
 * Results are cached (10-min TTL) to avoid DB pressure on every request.
 *
 * Placement labels (from metadata.location in upsell_events):
 *   'product_page'        ← product page widget
 *   'cart_drawer'         ← cart page / cart drawer widget (stored as 'cart_page_secondary')
 */

import { getDb } from '../database/mongodb.js';

const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LOOKBACK_DAYS = 7;
const MIN_VIEWS_TO_RANK = 10;

const LOCATION_TO_PLACEMENT = {
  product_page: 'product_page',
  cart_page_secondary: 'cart_drawer',
  cart_drawer: 'cart_drawer',
};

/**
 * getPlacementStats(shopId)
 *
 * Returns per-placement stats for the last 7 days (cached 10 min).
 *
 * @returns {object} Shape:
 * {
 *   product_page:  { views: N, conversions: N, rate: 0.xx } | null,
 *   cart_drawer:   { views: N, conversions: N, rate: 0.xx } | null,
 *   rankedPlacements: ['cart_drawer', 'product_page'],  // best → worst
 *   dataAge: 'fresh' | 'insufficient' | 'empty'
 * }
 */
export async function getPlacementStats(shopId) {
  const cached = CACHE.get(shopId);
  if (cached && cached.expiresAt > Date.now()) return cached.stats;

  const stats = await computePlacementStats(shopId);
  CACHE.set(shopId, { stats, expiresAt: Date.now() + CACHE_TTL_MS });
  return stats;
}

/**
 * shouldPreferHighConfidenceOnly(shopId, placement)
 *
 * Returns true if this placement converts < 70% as well as the best placement
 * AND has enough data (≥10 views). Decision engine raises minAcceptanceProbability
 * to 0.4 when this returns true, filtering out low-confidence offers.
 */
export async function shouldPreferHighConfidenceOnly(shopId, placement) {
  const stats = await getPlacementStats(shopId);
  if (stats.dataAge === 'empty' || stats.dataAge === 'insufficient') return false;

  const current = stats[placement];
  if (!current || current.views < MIN_VIEWS_TO_RANK) return false;

  const bestRate = Math.max(
    ...stats.rankedPlacements.map(p => stats[p]?.rate || 0)
  );
  if (bestRate <= 0) return false;

  return current.rate < bestRate * 0.7;
}

/**
 * getSeenProductsInSession(shopId, sessionId)
 *
 * Returns a Set of upsellProductIds already shown in the last 30 minutes
 * for this session. Used to prevent duplicate exposure across placements.
 */
export async function getSeenProductsInSession(shopId, sessionId) {
  if (!sessionId) return new Set();
  try {
    const db = await getDb();
    const col = db.collection('upsell_events');
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const docs = await col
      .find(
        { shopId, sessionId, timestamp: { $gte: since } },
        { projection: { upsellProductId: 1 } }
      )
      .toArray();
    return new Set(docs.map(d => String(d.upsellProductId)).filter(Boolean));
  } catch (err) {
    console.warn('⚠️ getSeenProductsInSession failed:', err.message);
    return new Set();
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function computePlacementStats(shopId) {
  const empty = {
    product_page: null,
    cart_drawer: null,
    rankedPlacements: ['product_page', 'cart_drawer'],
    dataAge: 'empty'
  };

  try {
    const db = await getDb();
    const col = db.collection('upsell_events');
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const rows = await col.aggregate([
      {
        $match: {
          shopId,
          isUpsellEvent: true,
          timestamp: { $gte: since }
        }
      },
      {
        $group: {
          _id: {
            location: '$metadata.location',
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    if (rows.length === 0) return empty;

    // Aggregate counts per placement
    const counters = {};
    for (const row of rows) {
      const rawLoc = row._id.location || 'product_page';
      const placement = LOCATION_TO_PLACEMENT[rawLoc] || 'product_page';
      if (!counters[placement]) counters[placement] = { views: 0, conversions: 0 };
      if (row._id.eventType === 'view') counters[placement].views += row.count;
      if (row._id.eventType === 'cart_add') counters[placement].conversions += row.count;
    }

    const result = { dataAge: 'fresh' };
    for (const p of ['product_page', 'cart_drawer']) {
      const c = counters[p] || { views: 0, conversions: 0 };
      result[p] = {
        views: c.views,
        conversions: c.conversions,
        rate: c.views > 0
          ? Math.round((c.conversions / c.views) * 1000) / 1000
          : 0
      };
    }

    // Rank placements by conversion rate — only include those with enough data
    const ranked = ['product_page', 'cart_drawer']
      .filter(p => result[p] && result[p].views >= MIN_VIEWS_TO_RANK)
      .sort((a, b) => (result[b]?.rate || 0) - (result[a]?.rate || 0));

    result.rankedPlacements = ranked.length > 0
      ? ranked
      : ['product_page', 'cart_drawer'];

    if (ranked.length === 0) result.dataAge = 'insufficient';

    console.log(`📊 Adaptive placement stats for ${shopId}:`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('⚠️ computePlacementStats failed:', err.message);
    return empty;
  }
}

// ─── Upstream/Downstream Shift Logic ────────────────────────────────────────

/**
 * Recommend placement shift based on conversion performance
 * If product_page converts well, shift earlier offers there (upstream)
 * If cart_drawer converts poorly, shift to later placements (downstream)
 */
export async function recommendPlacementShift(shopId) {
  const stats = await getPlacementStats(shopId);

  if (stats.dataAge === 'empty' || stats.dataAge === 'insufficient') {
    return { recommendation: 'insufficient_data', shift: null };
  }

  const productPageRate = stats.product_page?.rate || 0;
  const cartDrawerRate = stats.cart_drawer?.rate || 0;

  // Threshold: if one placement is 20% better, recommend shift
  const SHIFT_THRESHOLD = 0.2;

  if (productPageRate > cartDrawerRate * (1 + SHIFT_THRESHOLD)) {
    // Product page winning — shift more offers upstream
    return {
      recommendation: 'shift_upstream',
      from: 'cart_drawer',
      to: 'product_page',
      reasoning: `Product page converts ${((productPageRate / cartDrawerRate - 1) * 100).toFixed(1)}% better`,
      actionable: true
    };
  }

  if (cartDrawerRate > productPageRate * (1 + SHIFT_THRESHOLD)) {
    // Cart drawer winning — shift offers downstream
    return {
      recommendation: 'shift_downstream',
      from: 'product_page',
      to: 'cart_drawer',
      reasoning: `Cart drawer converts ${((cartDrawerRate / productPageRate - 1) * 100).toFixed(1)}% better`,
      actionable: true
    };
  }

  return {
    recommendation: 'maintain_current',
    shift: null,
    reasoning: 'Placements perform similarly',
    actionable: false
  };
}

/**
 * Compute optimal offer limit per placement based on diminishing returns
 * Analyzes: as we add more offers, does conversion drop?
 */
export async function computeOptimalOfferLimitPerPlacement(shopId) {
  try {
    const db = await getDb();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const conversionByOfferCount = await db.collection('upsell_events').aggregate([
      {
        $match: {
          shopId,
          isUpsellEvent: true,
          timestamp: { $gte: since },
          'metadata.offerCount': { $exists: true }
        }
      },
      {
        $bucket: {
          groupBy: '$metadata.offerCount',
          boundaries: [0, 1, 2, 3, 4, 5, 10],
          output: {
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            conversions: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } }
          }
        }
      },
      {
        $project: {
          offerCount: '$_id',
          views: 1,
          conversions: 1,
          conversionRate: {
            $cond: [{ $gt: ['$views', 0] }, { $divide: ['$conversions', '$views'] }, 0]
          }
        }
      },
      { $sort: { offerCount: 1 } }
    ]).toArray();

    // Find where diminishing returns kick in
    let optimalLimit = 4; // Default
    let peakRate = 0;

    for (const bucket of conversionByOfferCount) {
      if (bucket.conversionRate > peakRate) {
        peakRate = bucket.conversionRate;
        optimalLimit = bucket.offerCount;
      }
    }

    return {
      success: true,
      analysis: {
        byOfferCount: conversionByOfferCount,
        optimalLimit,
        peakConversionRate: Math.round(peakRate * 100 * 100) / 100
      }
    };
  } catch (err) {
    console.warn('⚠️ computeOptimalOfferLimitPerPlacement failed:', err.message);
    return { success: false, optimalLimit: 4, error: err.message };
  }
}

/**
 * Compute sequential placement strategy
 * E.g., if user sees offer on product page, don't repeat on cart
 */
export async function getSequentialPlacementStrategy(shopId, sessionId) {
  try {
    if (!sessionId) return { strategy: 'default', seenProducts: new Set() };

    const db = await getDb();
    const since = new Date(Date.now() - 30 * 60 * 1000); // Last 30 min

    const seenInSession = await db.collection('upsell_events').aggregate([
      {
        $match: {
          shopId,
          sessionId,
          timestamp: { $gte: since }
        }
      },
      {
        $group: {
          _id: null,
          products: { $addToSet: '$upsellProductId' },
          locations: { $addToSet: '$metadata.location' }
        }
      }
    ]).toArray();

    if (seenInSession.length === 0) {
      return { strategy: 'default', seenProducts: new Set(), seenLocations: new Set() };
    }

    const [session] = seenInSession;
    return {
      strategy: 'avoid_duplication',
      seenProducts: new Set(session.products || []),
      seenLocations: new Set(session.locations || [])
    };
  } catch (err) {
    console.warn('⚠️ getSequentialPlacementStrategy failed:', err.message);
    return { strategy: 'default', seenProducts: new Set() };
  }
}

/**
 * Recommend total offer frequency across all placements
 * Accounts for placement-specific saturation
 */
export async function recommendPlacementFrequency(shopId, placement) {
  const stats = await getPlacementStats(shopId);

  if (stats.dataAge === 'empty' || stats.dataAge === 'insufficient') {
    return {
      placement,
      recommendedFrequency: 4,
      reasoning: 'Insufficient data - using default',
      confidence: 0.3
    };
  }

  const placementStats = stats[placement];
  if (!placementStats) {
    return {
      placement,
      recommendedFrequency: 4,
      reasoning: 'Unknown placement',
      confidence: 0.2
    };
  }

  const conversionRate = placementStats.rate;

  // Lower conversion rate = lower frequency (avoid user fatigue)
  if (conversionRate < 0.05) {
    return {
      placement,
      recommendedFrequency: 2,
      reasoning: `Low conversion rate (${(conversionRate * 100).toFixed(1)}%) - reduce frequency`,
      confidence: 0.8
    };
  }

  if (conversionRate < 0.1) {
    return {
      placement,
      recommendedFrequency: 3,
      reasoning: `Moderate conversion rate (${(conversionRate * 100).toFixed(1)}%)`,
      confidence: 0.8
    };
  }

  // Higher conversion rate = can afford more offers
  return {
    placement,
    recommendedFrequency: 4,
    reasoning: `High conversion rate (${(conversionRate * 100).toFixed(1)}%) - maintain frequency`,
    confidence: 0.8
  };
}
