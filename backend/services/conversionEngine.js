/**
 * Conversion Engine — Pillar 5
 *
 * Reads purchase_events + upsell_events to compute per-product-pair
 * conversion rates. Results cached 15 min per shop.
 *
 * Two exports:
 *   getConversionStats(shopId)       — full stats object (used by groqAIEngine)
 *   getConfidenceBoost(...)          — 0–0.2 boost value (used by decisionEngine)
 */

import { getDb } from '../database/mongodb.js';

const CACHE = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const LOOKBACK_DAYS = 14;
const MIN_VIEWS = 5;
const MAX_BOOST = 0.2; // max +20% confidence boost

/**
 * getConversionStats(shopId)
 *
 * Returns:
 * {
 *   byProduct: { [upsellProductId]: { views, purchases, rate } },
 *   byPair:    { [`${sourceId}:${upsellId}`]: { views, purchases, rate } },
 *   byType:    { [recommendationType]: { views, purchases, rate } },
 *   topConverting: [upsellProductId, ...],  // top 10 by conversion rate
 *   dataAge: 'fresh' | 'empty'
 * }
 */
export async function getConversionStats(shopId) {
  const cached = CACHE.get(shopId);
  if (cached && cached.expiresAt > Date.now()) return cached.stats;
  const stats = await computeConversionStats(shopId);
  CACHE.set(shopId, { stats, expiresAt: Date.now() + CACHE_TTL_MS });
  return stats;
}

/**
 * getConfidenceBoost(shopId, sourceProductId, upsellProductId, recommendationType)
 *
 * Returns a boost value 0–0.2 based on how well this product pair has converted
 * historically. Called by decisionEngine before final scoring.
 *
 * Boost formula (weighted signals):
 *   pair rate   × 60%
 *   product rate × 30%
 *   type rate   × 10%
 * Scale: 10%+ conversion → +0.2; below 2% → 0.
 */
export async function getConfidenceBoost(shopId, sourceProductId, upsellProductId, recommendationType) {
  try {
    const stats = await getConversionStats(shopId);
    if (stats.dataAge === 'empty') return 0;

    const pairKey = `${sourceProductId}:${upsellProductId}`;
    const pairStat = stats.byPair[pairKey];
    const productStat = stats.byProduct[String(upsellProductId)];
    const typeStat = stats.byType[recommendationType];

    const pairRate = pairStat?.views >= MIN_VIEWS ? pairStat.rate : null;
    const productRate = productStat?.views >= MIN_VIEWS ? productStat.rate : null;
    const typeRate = typeStat?.views >= MIN_VIEWS ? typeStat.rate : null;

    const signals = [pairRate, productRate, typeRate].filter(r => r !== null);
    if (signals.length === 0) return 0;

    // Use weighted formula when all three are available, otherwise plain average
    const avgRate = signals.length === 3
      ? (pairRate * 0.6 + productRate * 0.3 + typeRate * 0.1)
      : signals.reduce((a, b) => a + b, 0) / signals.length;

    // Scale: 2% baseline, 10% ceiling → linearly maps to 0–MAX_BOOST
    const boost = Math.min(MAX_BOOST, Math.max(0, (avgRate - 0.02) / 0.08) * MAX_BOOST);
    return Math.round(boost * 100) / 100;
  } catch (err) {
    console.warn('⚠️ getConfidenceBoost failed:', err.message);
    return 0;
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function computeConversionStats(shopId) {
  const empty = {
    byProduct: {}, byPair: {}, byType: {},
    topConverting: [], dataAge: 'empty'
  };

  try {
    const db = await getDb();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const [views, purchases] = await Promise.all([
      db.collection('upsell_events').aggregate([
        {
          $match: {
            shopId,
            eventType: 'view',
            isUpsellEvent: true,
            timestamp: { $gte: since }
          }
        },
        {
          $group: {
            _id: {
              src: '$sourceProductId',
              upsell: '$upsellProductId',
              type: '$recommendationType'
            },
            count: { $sum: 1 }
          }
        }
      ]).toArray(),
      db.collection('purchase_events').aggregate([
        { $match: { shopId, timestamp: { $gte: since } } },
        {
          $group: {
            _id: {
              src: '$sourceProductId',
              upsell: '$upsellProductId',
              type: '$recommendationType'
            },
            count: { $sum: 1 }
          }
        }
      ]).toArray()
    ]);

    if (!views.length && !purchases.length) return empty;

    const byProduct = {}, byPair = {}, byType = {};

    const inc = (map, key, field, val) => {
      if (!map[key]) map[key] = { views: 0, purchases: 0, rate: 0 };
      map[key][field] += val;
    };

    for (const v of views) {
      const pid = String(v._id.upsell || '');
      inc(byProduct, pid, 'views', v.count);
      inc(byPair, `${v._id.src}:${pid}`, 'views', v.count);
      inc(byType, v._id.type || 'unknown', 'views', v.count);
    }

    for (const p of purchases) {
      const pid = String(p._id.upsell || '');
      inc(byProduct, pid, 'purchases', p.count);
      inc(byPair, `${p._id.src}:${pid}`, 'purchases', p.count);
      inc(byType, p._id.type || 'unknown', 'purchases', p.count);
    }

    // Compute conversion rates
    for (const map of [byProduct, byPair, byType]) {
      for (const key of Object.keys(map)) {
        const e = map[key];
        e.rate = e.views > 0
          ? Math.round((e.purchases / e.views) * 1000) / 1000
          : 0;
      }
    }

    // Top converting products (requires minimum views)
    const topConverting = Object.entries(byProduct)
      .filter(([, v]) => v.views >= MIN_VIEWS)
      .sort(([, a], [, b]) => b.rate - a.rate)
      .slice(0, 10)
      .map(([id]) => id);

    console.log(`📊 Conversion stats for ${shopId}: ${topConverting.length} top-converting products`);
    return { byProduct, byPair, byType, topConverting, dataAge: 'fresh' };
  } catch (err) {
    console.error('⚠️ computeConversionStats failed:', err.message);
    return empty;
  }
}
