/**
 * Pillar 6 — Merchandising Intelligence Service
 * Provides comprehensive bundle review, segment analysis, context injection, and explainability
 */

const { getDb, collections } = require("../database/mongodb");

/**
 * Get all bundles with performance metrics, margin/inventory impact, and segment breakdown
 */
async function getBundlesWithPerformance(shopId, limit = 50) {
  const db = await getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get all offers of type 'bundle'
  const bundles = await db.collection(collections.decisionOffers).find({
    shopId,
    offerType: 'bundle'
  }).limit(limit).toArray();

  // Enrich with performance data
  const bundlesEnriched = await Promise.all(bundles.map(async (bundle) => {
    const perfKey = `${bundle.sourceProductId}:${bundle.upsellProductId}`;

    // Get performance events for this bundle
    const events = await db.collection(collections.upsellEvents).find({
      shopId,
      sourceProductId: bundle.sourceProductId,
      upsellProductId: bundle.upsellProductId,
      timestamp: { $gte: thirtyDaysAgo }
    }).toArray();

    const views = events.filter(e => e.eventType === 'view').length;
    const clicks = events.filter(e => e.eventType === 'click').length;
    const cartAdds = events.filter(e => e.eventType === 'cart_add').length;
    const purchases = events.filter(e => e.eventType === 'purchase').length;

    const ctr = views > 0 ? (clicks / views) * 100 : 0;
    const conversion = views > 0 ? (cartAdds / views) * 100 : 0;
    const purchaseRate = cartAdds > 0 ? (purchases / cartAdds) * 100 : 0;

    // Get segment breakdown
    const segmentData = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          sourceProductId: bundle.sourceProductId,
          upsellProductId: bundle.upsellProductId,
          timestamp: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: '$metadata.segment',
          views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
          adds: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } }
        }
      }
    ]).toArray();

    // Calculate margin impact (estimated from offer type)
    const estimatedMarginImpact = bundle.discount ? -bundle.discount : 0;

    // Get control status
    const control = await db.collection(collections.offerControls).findOne({
      shopId,
      offerKey: bundle.offerId
    });

    return {
      bundleId: bundle.offerId,
      offerId: bundle.offerId,
      sourceProductId: bundle.sourceProductId,
      sourceProductName: bundle.sourceProductName,
      upsellProductId: bundle.upsellProductId,
      upsellProductName: bundle.upsellProductName,
      createdAt: bundle.createdAt,
      discount: bundle.discount,
      performance: {
        views,
        clicks,
        cartAdds,
        purchases,
        ctr: parseFloat(ctr.toFixed(2)),
        conversion: parseFloat(conversion.toFixed(2)),
        purchaseRate: parseFloat(purchaseRate.toFixed(2))
      },
      segmentBreakdown: segmentData.map(seg => ({
        segment: seg._id || 'unknown',
        views: seg.views,
        clicks: seg.clicks,
        adds: seg.adds,
        ctr: seg.views > 0 ? parseFloat(((seg.clicks / seg.views) * 100).toFixed(2)) : 0,
        conversion: seg.views > 0 ? parseFloat(((seg.adds / seg.views) * 100).toFixed(2)) : 0
      })),
      marginImpact: estimatedMarginImpact,
      inventoryImpact: 'neutral',
      controlStatus: control?.status || 'auto',
      controlNote: control?.note || null,
      recommendedAction: getRecommendedAction({ ctr, conversion, views })
    };
  }));

  return bundlesEnriched;
}

/**
 * Get segment-based performance with first-time, returning, subscription, and high-LTV breakdown
 */
async function getSegmentPerformanceAnalysis(shopId) {
  const db = await getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const segments = await db.collection(collections.upsellEvents).aggregate([
    {
      $match: {
        shopId,
        timestamp: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          segment: { $ifNull: ['$metadata.segment', 'unknown'] },
          eventType: '$eventType'
        },
        count: { $sum: 1 },
        totalValue: { $sum: { $ifNull: ['$metadata.orderValue', 0] } }
      }
    }
  ]).toArray();

  const segmentMap = {};
  for (const row of segments) {
    const segment = row._id.segment;
    if (!segmentMap[segment]) {
      segmentMap[segment] = { segment, views: 0, clicks: 0, adds: 0, value: 0 };
    }
    if (row._id.eventType === 'view') segmentMap[segment].views = row.count;
    if (row._id.eventType === 'click') segmentMap[segment].clicks = row.count;
    if (row._id.eventType === 'cart_add') segmentMap[segment].adds = row.count;
    segmentMap[segment].value += row.totalValue;
  }

  const segmentAnalysis = Object.values(segmentMap).map(s => ({
    segment: s.segment,
    views: s.views,
    clicks: s.clicks,
    cartAdds: s.adds,
    ctr: s.views > 0 ? parseFloat(((s.clicks / s.views) * 100).toFixed(2)) : 0,
    conversion: s.views > 0 ? parseFloat(((s.adds / s.views) * 100).toFixed(2)) : 0,
    totalOrderValue: parseFloat(s.value.toFixed(2)),
    health: getSegmentHealth(s.views, s.clicks, s.adds),
    recommendation: getSegmentRecommendation(s.views, s.clicks, s.adds)
  }));

  return segmentAnalysis;
}

/**
 * Get context injection effectiveness - merchant focus vs AI generated
 */
async function getContextInjectionEffectiveness(shopId) {
  const db = await getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get merchant context
  const context = await db.collection(collections.merchantIntelligence).findOne({ shopId });

  // Analyze performance of merchant-focused vs AI-generated offers
  const comparison = await db.collection(collections.upsellEvents).aggregate([
    {
      $match: {
        shopId,
        timestamp: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: '$metadata.recommendationType',
        views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
        clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
        adds: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
        value: { $sum: { $ifNull: ['$metadata.orderValue', 0] } }
      }
    }
  ]).toArray();

  const effectiveness = {
    merchantFocus: null,
    aiGenerated: null,
    context: {
      priority: context?.priority || 'none',
      focusProducts: context?.focusProductIds || [],
      focusCollections: context?.focusCollectionIds || [],
      preferBundles: context?.preferBundles || false,
      notes: context?.notes || ''
    }
  };

  for (const row of comparison) {
    const type = row._id || 'auto';
    const ctr = row.views > 0 ? (row.clicks / row.views) * 100 : 0;
    const conv = row.views > 0 ? (row.adds / row.views) * 100 : 0;

    const data = {
      type,
      views: row.views,
      clicks: row.clicks,
      adds: row.adds,
      ctr: parseFloat(ctr.toFixed(2)),
      conversion: parseFloat(conv.toFixed(2)),
      totalValue: parseFloat(row.value.toFixed(2)),
      avgOrderValue: row.adds > 0 ? parseFloat((row.value / row.adds).toFixed(2)) : 0
    };

    if (type === 'merchant_focus' || type === 'merchant_approved') {
      effectiveness.merchantFocus = data;
    } else {
      effectiveness.aiGenerated = data;
    }
  }

  // Calculate effectiveness score
  if (effectiveness.merchantFocus && effectiveness.aiGenerated) {
    effectiveness.merchantFocusWins = effectiveness.merchantFocus.ctr > effectiveness.aiGenerated.ctr ? 'ctr' : 
                                      effectiveness.merchantFocus.conversion > effectiveness.aiGenerated.conversion ? 'conversion' : 'tie';
  }

  return effectiveness;
}

/**
 * Get explainability data - why each offer was created
 */
async function getExplainabilityDashboard(shopId, limit = 20) {
  const db = await getDb();

  const offers = await db.collection(collections.decisionOffers).find({
    shopId
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  const explainability = await Promise.all(offers.map(async (offer) => {
    // Get control/approval history
    const controls = await db.collection(collections.offerLogs).find({
      shopId,
      offerId: offer.offerId
    }).sort({ timestamp: -1 }).toArray();

    // Get performance
    const events = await db.collection(collections.upsellEvents).find({
      shopId,
      sourceProductId: offer.sourceProductId,
      upsellProductId: offer.upsellProductId
    }).toArray();

    const views = events.filter(e => e.eventType === 'view').length;
    const clicks = events.filter(e => e.eventType === 'click').length;
    const adds = events.filter(e => e.eventType === 'cart_add').length;

    return {
      offerId: offer.offerId,
      sourceProduct: offer.sourceProductName || offer.sourceProductId,
      upsellProduct: offer.upsellProductName || offer.upsellProductId,
      offerType: offer.offerType,
      placement: offer.placement,
      discount: offer.discount,
      decisionScore: offer.decisionScore,
      confidence: offer.confidence,
      createdAt: offer.createdAt,
      whyCreated: offer.decisionReason ? [offer.decisionReason] : [],
      whyShown: offer.aiReason ? [offer.aiReason] : [],
      dataSignals: [
        { signal: 'AI Confidence', value: offer.confidence, weight: 0.3 },
        { signal: 'Goal Alignment', value: offer.decisionScore * 0.2, weight: 0.2 },
        { signal: 'Performance History', value: clicks > 0 ? (adds / clicks) * 100 : 0, weight: 0.2 },
        { signal: 'Control Status', value: offer.controlStatus || 'auto', weight: 0.3 }
      ],
      performance: {
        views,
        clicks,
        adds,
        ctr: views > 0 ? parseFloat(((clicks / views) * 100).toFixed(2)) : 0,
        conversion: views > 0 ? parseFloat(((adds / views) * 100).toFixed(2)) : 0
      },
      automationJourney: controls.map(c => ({
        date: c.timestamp,
        action: c.action,
        details: c.details
      })),
      nextReviewDate: new Date(offer.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    };
  }));

  return explainability;
}

/**
 * Helper: Determine recommended action for a bundle
 */
function getRecommendedAction(perf) {
  const { ctr, conversion, views } = perf;
  
  if (views < 10) return 'monitor';
  if (conversion < 1) return 'pause';
  if (ctr < 3) return 'boost_discount';
  if (conversion > 5) return 'approve';
  return 'watch';
}

/**
 * Helper: Determine segment health
 */
function getSegmentHealth(views, clicks, adds) {
  const ctr = views > 0 ? (clicks / views) * 100 : 0;
  const conv = views > 0 ? (adds / views) * 100 : 0;

  if (views < 5) return 'insufficient_data';
  if (conv > 5 && ctr > 5) return 'excellent';
  if (conv > 2 && ctr > 3) return 'good';
  if (conv > 0 && ctr > 1) return 'needs_work';
  return 'poor';
}

/**
 * Helper: Get segment recommendation
 */
function getSegmentRecommendation(views, clicks, adds) {
  const ctr = views > 0 ? (clicks / views) * 100 : 0;
  const conv = views > 0 ? (adds / views) * 100 : 0;

  if (conv < 1) return 'increase_discount';
  if (ctr < 2) return 'optimize_placement';
  if (views < 50) return 'gather_more_data';
  return 'maintain_current_strategy';
}

module.exports = {
  getBundlesWithPerformance,
  getSegmentPerformanceAnalysis,
  getContextInjectionEffectiveness,
  getExplainabilityDashboard
};
