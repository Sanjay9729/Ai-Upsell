/**
 * Pillar 6 — Merchandising Intelligence Service
 * Scalable: uses batch aggregations instead of per-document DB calls (no N+1 queries)
 */

import { getDb, collections } from '../database/mongodb.js';

/**
 * Get bundle-type offers with performance metrics.
 * Single aggregate for all performance data — no N+1 queries.
 */
export async function getBundlesWithPerformance(shopId, limit = 50) {
  if (!shopId) return [];
  try {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Step 1: Fetch bundle offers (one query)
    const bundleOffers = await db.collection(collections.offerLogs)
      .find({ shopId, offerType: 'bundle' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    if (bundleOffers.length === 0) return [];

    // Step 2: Collect all unique src+upsell pairs
    const pairs = bundleOffers.map(b => ({
      src: b.sourceProductId ?? null,
      upsell: b.upsellProductId ?? null
    }));

    // Step 3: ONE aggregate for all performance data (not per-bundle)
    const perfRows = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          timestamp: { $gte: thirtyDaysAgo },
          $or: pairs.map(p => ({
            sourceProductId: p.src,
            upsellProductId: p.upsell
          }))
        }
      },
      {
        $group: {
          _id: {
            src: '$sourceProductId',
            upsell: '$upsellProductId',
            eventType: '$eventType',
            segment: { $ifNull: ['$metadata.segment', 'unknown'] }
          },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Step 4: ONE query for all offer controls
    const offerKeys = bundleOffers.map(b => b.offerKey).filter(Boolean);
    const controls = offerKeys.length > 0
      ? await db.collection(collections.offerControls)
          .find({ shopId, offerKey: { $in: offerKeys } })
          .toArray()
      : [];
    const controlMap = {};
    for (const c of controls) controlMap[c.offerKey] = c;

    // Step 5: Build performance map keyed by "src:upsell"
    const perfMap = {};
    const segMap = {};
    for (const row of perfRows) {
      const key = `${row._id.src}:${row._id.upsell}`;
      if (!perfMap[key]) perfMap[key] = { views: 0, clicks: 0, cartAdds: 0 };
      if (row._id.eventType === 'view') perfMap[key].views += row.count;
      if (row._id.eventType === 'click') perfMap[key].clicks += row.count;
      if (row._id.eventType === 'cart_add') perfMap[key].cartAdds += row.count;

      // Segment breakdown
      if (!segMap[key]) segMap[key] = {};
      const seg = row._id.segment;
      if (!segMap[key][seg]) segMap[key][seg] = { views: 0, clicks: 0, adds: 0 };
      if (row._id.eventType === 'view') segMap[key][seg].views += row.count;
      if (row._id.eventType === 'click') segMap[key][seg].clicks += row.count;
      if (row._id.eventType === 'cart_add') segMap[key][seg].adds += row.count;
    }

    // Step 6: Assemble final result (no extra DB calls)
    return bundleOffers.map(bundle => {
      const key = `${bundle.sourceProductId ?? null}:${bundle.upsellProductId ?? null}`;
      const perf = perfMap[key] || { views: 0, clicks: 0, cartAdds: 0 };
      const ctr = perf.views > 0 ? (perf.clicks / perf.views) * 100 : 0;
      const conversion = perf.views > 0 ? (perf.cartAdds / perf.views) * 100 : 0;
      const segs = segMap[key] || {};
      const control = controlMap[bundle.offerKey] || null;

      return {
        bundleId: bundle.offerId || String(bundle._id),
        offerKey: bundle.offerKey,
        sourceProductId: bundle.sourceProductId,
        sourceProductName: bundle.sourceProductName,
        upsellProductId: bundle.upsellProductId,
        upsellProductName: bundle.upsellProductName,
        contextKey: bundle.contextKey || 'product',
        createdAt: bundle.createdAt,
        discountPercent: bundle.discountPercent,
        decisionScore: bundle.decisionScore,
        confidence: bundle.confidence,
        decisionReason: bundle.decisionReason,
        aiReason: bundle.aiReason,
        goal: bundle.goal,
        performance: {
          views: perf.views,
          clicks: perf.clicks,
          cartAdds: perf.cartAdds,
          ctr: parseFloat(ctr.toFixed(2)),
          conversion: parseFloat(conversion.toFixed(2))
        },
        segmentBreakdown: Object.entries(segs).map(([seg, s]) => ({
          segment: seg,
          views: s.views,
          clicks: s.clicks,
          adds: s.adds,
          ctr: s.views > 0 ? parseFloat(((s.clicks / s.views) * 100).toFixed(2)) : 0,
          conversion: s.views > 0 ? parseFloat(((s.adds / s.views) * 100).toFixed(2)) : 0
        })),
        marginImpact: bundle.discountPercent ? -bundle.discountPercent : 0,
        controlStatus: control?.status || 'auto',
        controlNote: control?.note || null,
        recommendedAction: getRecommendedAction({ ctr, conversion, views: perf.views })
      };
    });
  } catch (err) {
    console.warn('⚠️ getBundlesWithPerformance failed:', err.message);
    return [];
  }
}

/**
 * Get explainability data for recent offers.
 * Single aggregate for performance — no N+1 queries.
 */
export async function getExplainabilityDashboard(shopId, limit = 20) {
  if (!shopId) return [];
  try {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Step 1: Fetch recent offers (one query)
    const offers = await db.collection(collections.offerLogs)
      .find({ shopId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    if (offers.length === 0) return [];

    // Step 2: ONE aggregate for all performance data
    const pairs = offers.map(o => ({
      sourceProductId: o.sourceProductId ?? null,
      upsellProductId: o.upsellProductId ?? null
    }));

    const perfRows = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          timestamp: { $gte: thirtyDaysAgo },
          $or: pairs.map(p => ({
            sourceProductId: p.sourceProductId,
            upsellProductId: p.upsellProductId
          }))
        }
      },
      {
        $group: {
          _id: {
            src: '$sourceProductId',
            upsell: '$upsellProductId',
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Step 3: Build perf map
    const perfMap = {};
    for (const row of perfRows) {
      const key = `${row._id.src}:${row._id.upsell}`;
      if (!perfMap[key]) perfMap[key] = { views: 0, clicks: 0, adds: 0 };
      if (row._id.eventType === 'view') perfMap[key].views += row.count;
      if (row._id.eventType === 'click') perfMap[key].clicks += row.count;
      if (row._id.eventType === 'cart_add') perfMap[key].adds += row.count;
    }

    // Step 4: Assemble (no extra DB calls)
    return offers.map(offer => {
      const key = `${offer.sourceProductId ?? null}:${offer.upsellProductId ?? null}`;
      const perf = perfMap[key] || { views: 0, clicks: 0, adds: 0 };
      const conf = Number.isFinite(Number(offer.confidence)) ? Number(offer.confidence) : 0;
      const score = Number.isFinite(Number(offer.decisionScore)) ? Number(offer.decisionScore) : 0;

      return {
        offerId: offer.offerId,
        offerKey: offer.offerKey,
        sourceProduct: offer.sourceProductName || offer.sourceProductId || 'Cart',
        upsellProduct: offer.upsellProductName || offer.upsellProductId,
        offerType: offer.offerType,
        placement: offer.placement,
        discountPercent: offer.discountPercent,
        decisionScore: score,
        confidence: conf,
        goal: offer.goal,
        riskTolerance: offer.riskTolerance,
        createdAt: offer.createdAt,
        whyCreated: [
          offer.decisionReason,
          offer.goal ? `Goal: ${offer.goal}` : null
        ].filter(Boolean),
        whyShown: [
          offer.aiReason,
          offer.placement ? `Placement: ${offer.placement}` : null
        ].filter(Boolean),
        dataSignals: [
          { signal: 'AI Confidence', value: conf, weight: 0.3 },
          { signal: 'Decision Score', value: score, weight: 0.4 },
          { signal: 'Conversion (30d)', value: perf.views > 0 ? parseFloat(((perf.adds / perf.views) * 100).toFixed(1)) : 0, weight: 0.3 }
        ],
        performance: {
          views: perf.views,
          clicks: perf.clicks,
          adds: perf.adds,
          ctr: perf.views > 0 ? parseFloat(((perf.clicks / perf.views) * 100).toFixed(2)) : 0,
          conversion: perf.views > 0 ? parseFloat(((perf.adds / perf.views) * 100).toFixed(2)) : 0
        }
      };
    });
  } catch (err) {
    console.warn('⚠️ getExplainabilityDashboard failed:', err.message);
    return [];
  }
}

/**
 * Segment performance analysis — already a single aggregate, stays as-is.
 */
export async function getSegmentPerformanceAnalysis(shopId) {
  if (!shopId) return [];
  try {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await db.collection(collections.upsellEvents).aggregate([
      { $match: { shopId, timestamp: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: {
            segment: { $ifNull: ['$metadata.segment', 'unknown'] },
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const segmentMap = {};
    for (const row of rows) {
      const seg = row._id.segment;
      if (!segmentMap[seg]) segmentMap[seg] = { segment: seg, views: 0, clicks: 0, adds: 0 };
      if (row._id.eventType === 'view') segmentMap[seg].views = row.count;
      if (row._id.eventType === 'click') segmentMap[seg].clicks = row.count;
      if (row._id.eventType === 'cart_add') segmentMap[seg].adds = row.count;
    }

    return Object.values(segmentMap).map(s => ({
      segment: s.segment,
      views: s.views,
      clicks: s.clicks,
      cartAdds: s.adds,
      ctr: s.views > 0 ? parseFloat(((s.clicks / s.views) * 100).toFixed(2)) : 0,
      conversion: s.views > 0 ? parseFloat(((s.adds / s.views) * 100).toFixed(2)) : 0,
      health: getSegmentHealth(s.views, s.clicks, s.adds),
      recommendation: getSegmentRecommendation(s.views, s.clicks, s.adds)
    }));
  } catch (err) {
    console.warn('⚠️ getSegmentPerformanceAnalysis failed:', err.message);
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRecommendedAction({ ctr, conversion, views }) {
  if (views < 10) return 'monitor';
  if (conversion < 1) return 'pause';
  if (conversion > 5) return 'approve';
  return 'monitor';
}

function getSegmentHealth(views, clicks, adds) {
  const ctr = views > 0 ? (clicks / views) * 100 : 0;
  const conv = views > 0 ? (adds / views) * 100 : 0;
  if (views < 5) return 'insufficient_data';
  if (conv > 5 && ctr > 5) return 'excellent';
  if (conv > 2 && ctr > 3) return 'good';
  if (conv > 0 && ctr > 1) return 'needs_work';
  return 'poor';
}

function getSegmentRecommendation(views, clicks, adds) {
  const conv = views > 0 ? (adds / views) * 100 : 0;
  const clickRate = views > 0 ? (clicks / views) * 100 : 0;
  if (conv < 1) return 'Increase discount or improve offer relevance';
  if (clickRate < 2) return 'Optimize placement or offer copy';
  if (views < 50) return 'Gather more data before acting';
  return 'Maintain current strategy';
}
