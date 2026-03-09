/**
 * Optimization Engine — Analytics Feedback Loop
 *
 * Continuously tunes decision parameters based on conversion data:
 * - Adjusts offer type priorities based on actual performance
 * - Tunes discount levels based on AOV impact
 * - Refines placement strategies based on placement-specific conversion rates
 * - Learns product affinity patterns
 */

import { getDb, collections } from '../database/mongodb.js';
import { getUpsellStats, getConversionRate } from './analyticsService.js';
import { getMerchantConfig, updateMerchantConfig } from './merchantConfig.js';
import { logger } from './logger.js';
import { recommendBundles } from './bundleEngine.js';

const OPTIMIZATION_CONFIG = {
  minDataPoints: 20, // Min events to run optimization
  lookbackDays: 7, // Analyze last 7 days of data
  tuningRate: 0.1, // Learning rate for parameter adjustments (0-1)
  minChangeThreshold: 0.02 // Only apply if 2% improvement
};

/**
 * Run full optimization cycle: analyze performance, update decision parameters
 */
export async function optimizeForShop(shopId, options = {}) {
  try {
    const {
      minDataPoints = OPTIMIZATION_CONFIG.minDataPoints,
      lookbackDays = OPTIMIZATION_CONFIG.lookbackDays,
      tuningRate = OPTIMIZATION_CONFIG.tuningRate
    } = options;

    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // 1. Get event count — bail if insufficient data
    const db = await getDb();
    const eventCount = await db.collection(collections.upsellEvents).countDocuments({
      shopId,
      isUpsellEvent: true,
      timestamp: { $gte: since }
    });

    if (eventCount < minDataPoints) {
      return {
        success: false,
        reason: 'insufficient_data',
        eventCount,
        minRequired: minDataPoints
      };
    }

    // 2. Fetch performance metrics
    const [statsResult, configResult] = await Promise.all([
      getUpsellStats(shopId, { startDate: since }),
      getMerchantConfig(shopId)
    ]);

    if (!statsResult.success) {
      return { success: false, reason: 'stats_fetch_failed', error: statsResult.error };
    }

    const currentConfig = configResult || {};
    const performance = analyzePerformance(statsResult.stats);

    // 3. Compute recommended tuning
    const tuning = computeTuning(performance, currentConfig, tuningRate);

    // 4. Apply tuning if meets threshold
    const updates = { guardrails: {}, optimization: {} };
    let updatesMade = 0;

    for (const [key, value] of Object.entries(tuning)) {
      if (value.changePercent >= OPTIMIZATION_CONFIG.minChangeThreshold) {
        if (key === 'discountCap') {
          updates.guardrails.maxDiscountCap = value.recommended;
          updatesMade += 1;
        }
        if (key === 'topOfferType') {
          updates.optimization.topOfferType = value.recommended;
          updatesMade += 1;
        }
      }
    }

    const hasGuardrailUpdates = Object.keys(updates.guardrails).length > 0;
    const hasOptimizationUpdates = Object.keys(updates.optimization).length > 0;
    if (hasGuardrailUpdates || hasOptimizationUpdates) {
      await updateMerchantConfig(shopId, updates);
    }

    // 5. Autonomously recommend bundles based on co-purchase patterns
    const bundleResult = await recommendBundles(shopId).catch((err) => ({
      success: false,
      error: err?.message || String(err),
      count: 0
    }));

    // 6. Run segment-aware optimization in parallel (+ confidence thresholds + placement perf)
    const [segmentResult, elasticityResult, guardrailResult, thresholdResult, placementResult] = await Promise.all([
      optimizeForSegments(shopId).catch(() => ({ success: false })),
      analyzeDiscountElasticity(shopId, { startDate: since }).catch(() => ({ success: false })),
      analyzeGuardrailTriggers(shopId, { startDate: since }).catch(() => ({ success: false })),
      recommendConfidenceThresholds(shopId, { startDate: since }).catch(() => ({ success: false })),
      analyzePerformanceByOfferType(shopId, { startDate: since }).catch(() => ({ success: false }))
    ]);

    // Additional tuning from full-cycle analysis: session offer limit, confidence threshold, top placement
    const secondaryUpdates = { guardrails: {}, optimization: {} };
    let secondaryUpdatesMade = 0;

    if (guardrailResult.success && guardrailResult.guardrailRate > 30) {
      const currentLimit = currentConfig.guardrails?.sessionOfferLimit ?? 3;
      const newLimit = Math.max(1, currentLimit - 1);
      if (newLimit < currentLimit) {
        secondaryUpdates.guardrails.sessionOfferLimit = newLimit;
        secondaryUpdatesMade += 1;
      }
    }

    if (thresholdResult.success) {
      const recommended = thresholdResult.analysis?.recommendedThreshold;
      const currentThreshold = currentConfig.optimization?.confidenceThreshold ?? 0.5;
      if (recommended != null && Math.abs(recommended - currentThreshold) >= 0.1) {
        secondaryUpdates.optimization.confidenceThreshold = recommended;
        secondaryUpdatesMade += 1;
      }
    }

    if (placementResult.success) {
      const placements = (placementResult.analysis?.byPlacement || [])
        .filter(p => p.cartAdds >= 5)
        .sort((a, b) => b.conversionRate - a.conversionRate);
      const bestPlacement = placements[0];
      if (bestPlacement?._id) {
        secondaryUpdates.optimization.topPlacement = bestPlacement._id;
        secondaryUpdatesMade += 1;
      }
    }

    if (secondaryUpdatesMade > 0) {
      await updateMerchantConfig(shopId, secondaryUpdates);
      updatesMade += secondaryUpdatesMade;
      // Merge secondary updates into appliedUpdates for logging
      Object.assign(updates.guardrails, secondaryUpdates.guardrails);
      Object.assign(updates.optimization, secondaryUpdates.optimization);
    }

    // 7. Log optimization result
    const result = {
      success: true,
      optimization: {
        shopId,
        period: { startDate: since },
        eventCount,
        performance,
        tuning,
        updatesMade,
        appliedUpdates: updates,
        bundleRecommendations: bundleResult?.success ? bundleResult.count : 0,
        segmentInsights: segmentResult.success ? {
          bestSegment: segmentResult.bestSegment,
          conversionRate: segmentResult.conversionRate
        } : null,
        discountOptimal: elasticityResult.success ? elasticityResult.optimalBucket : null,
        guardrailRate: guardrailResult.success ? guardrailResult.guardrailRate : null,
        confidenceThreshold: thresholdResult.success ? thresholdResult.analysis?.recommendedThreshold : null,
        topPlacement: placementResult.success ? (placementResult.analysis?.byPlacement || []).filter(p => p.cartAdds >= 5).sort((a, b) => b.conversionRate - a.conversionRate)[0]?._id : null
      }
    };

    logger.logOptimization('optimize_shop', result.optimization);

    return result;
  } catch (error) {
    logger.logError('optimizeForShop', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Analyze performance by offer type, placement, and discount level
 */
export async function analyzePerformanceByOfferType(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    const matchStage = {
      shopId,
      isUpsellEvent: true,
      timestamp: { $gte: startDate, $lte: endDate }
    };

    // Performance by offer type
    const typePerformance = await db.collection(collections.upsellEvents).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$metadata.offerType',
          views: {
            $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] }
          },
          clicks: {
            $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] }
          },
          cartAdds: {
            $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] }
          },
          avgConfidence: { $avg: '$confidence' }
        }
      },
      {
        $project: {
          _id: 1,
          views: 1,
          clicks: 1,
          cartAdds: 1,
          avgConfidence: 1,
          ctr: { $cond: [{ $gt: ['$views', 0] }, { $divide: ['$clicks', '$views'] }, 0] },
          conversionRate: { $cond: [{ $gt: ['$views', 0] }, { $divide: ['$cartAdds', '$views'] }, 0] }
        }
      }
    ]).toArray();

    // Performance by placement
    const placementPerformance = await db.collection(collections.upsellEvents).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$metadata.location',
          views: {
            $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] }
          },
          cartAdds: {
            $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          _id: 1,
          views: 1,
          cartAdds: 1,
          conversionRate: { $cond: [{ $gt: ['$views', 0] }, { $divide: ['$cartAdds', '$views'] }, 0] }
        }
      }
    ]).toArray();

    return {
      success: true,
      analysis: {
        byOfferType: typePerformance,
        byPlacement: placementPerformance,
        period: { startDate, endDate }
      }
    };
  } catch (error) {
    logger.logError('analyzePerformanceByOfferType', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Analyze AOV (Average Order Value) impact of upsells
 */
export async function analyzeAOVImpact(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    // Get cart add events with price metadata
    const events = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          eventType: 'cart_add',
          timestamp: { $gte: startDate, $lte: endDate },
          'metadata.price': { $exists: true }
        }
      },
      {
        $group: {
          _id: '$upsellProductId',
          count: { $sum: 1 },
          totalValue: { $sum: '$metadata.price' },
          avgPrice: { $avg: '$metadata.price' }
        }
      },
      { $sort: { totalValue: -1 } },
      { $limit: 20 }
    ]).toArray();

    // Compute aggregates
    const totalCartsWithUpsell = events.reduce((sum, e) => sum + e.count, 0);
    const totalUpsellValue = events.reduce((sum, e) => sum + e.totalValue, 0);
    const avgUpsellValue = totalCartsWithUpsell > 0 ? totalUpsellValue / totalCartsWithUpsell : 0;

    return {
      success: true,
      analysis: {
        totalCartsWithUpsell,
        totalUpsellValue,
        avgUpsellValue: Math.round(avgUpsellValue * 100) / 100,
        topUpsellProducts: events,
        period: { startDate, endDate }
      }
    };
  } catch (error) {
    logger.logError('analyzeAOVImpact', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Recommend confidence threshold adjustments based on placement performance
 */
export async function recommendConfidenceThresholds(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    } = options;

    // Group by confidence buckets and measure conversion
    const thresholdAnalysis = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          isUpsellEvent: true,
          timestamp: { $gte: startDate },
          confidence: { $exists: true }
        }
      },
      {
        $bucket: {
          groupBy: '$confidence',
          boundaries: [0, 0.3, 0.5, 0.7, 0.85, 1.0],
          default: 'unknown',
          output: {
            count: { $sum: 1 },
            cartAdds: {
              $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] }
            }
          }
        }
      },
      {
        $project: {
          confidenceBucket: '$_id',
          events: '$count',
          conversions: '$cartAdds',
          conversionRate: { $cond: [{ $gt: ['$count', 0] }, { $divide: ['$cartAdds', '$count'] }, 0] }
        }
      }
    ]).toArray();

    // Find optimal threshold (highest conversion rate with decent volume)
    const recommended = thresholdAnalysis
      .filter(t => t.events >= 10) // Min volume
      .sort((a, b) => b.conversionRate - a.conversionRate)[0];

    return {
      success: true,
      analysis: {
        byConfidenceBucket: thresholdAnalysis,
        recommendedThreshold: recommended?.confidenceBucket || 0.7,
        period: { startDate }
      }
    };
  } catch (error) {
    logger.logError('recommendConfidenceThresholds', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Simulate what would happen with different parameter settings
 */
export async function simulateParameterChanges(shopId, parameterChanges = {}) {
  try {
    // Fetch recent decision data
    const db = await getDb();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const decisions = await db.collection(collections.decisionLogs)
      .find({
        shopId,
        timestamp: { $gte: since }
      })
      .limit(1000)
      .toArray();

    if (decisions.length === 0) {
      return {
        success: false,
        reason: 'no_decision_data',
        simulation: null
      };
    }

    // Re-score each decision with new parameters
    let improvementCount = 0;
    let totalScore = 0;
    let totalNewScore = 0;

    for (const decision of decisions) {
      const oldScore = decision.decisionScore || 0;
      let newScore = oldScore;

      if (parameterChanges.minConfidence !== undefined) {
        newScore *= (parameterChanges.minConfidence / (decision.config?.minConfidence || 0.5));
      }

      if (parameterChanges.discountPercent !== undefined) {
        // Higher discount might improve conversion (but with diminishing returns)
        const discountDelta = parameterChanges.discountPercent - (decision.config?.discountPercent || 10);
        newScore += (discountDelta * 0.05);
      }

      totalScore += oldScore;
      totalNewScore += Math.min(1, Math.max(0, newScore));

      if (newScore > oldScore) improvementCount += 1;
    }

    const estimatedImprovement = (totalNewScore - totalScore) / totalScore;

    return {
      success: true,
      simulation: {
        decisions: decisions.length,
        improvementCount,
        estimatedImprovementPercent: (estimatedImprovement * 100).toFixed(2),
        isWorthApplying: Math.abs(estimatedImprovement) >= OPTIMIZATION_CONFIG.minChangeThreshold,
        parametersSimulated: parameterChanges
      }
    };
  } catch (error) {
    logger.logError('simulateParameterChanges', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

export const VALID_OFFER_TYPES = new Set(['bundle', 'volume_discount', 'addon_upsell', 'subscription_upgrade']);

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Analyze performance metrics from stats
 */
function analyzePerformance(stats) {
  const overall = stats.overall || [];
  const byType = stats.performanceByType || [];

  const analysis = {
    totalEvents: overall.reduce((sum, s) => sum + s.count, 0),
    eventBreakdown: overall.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {}),
    typePerformance: {}
  };

  for (const t of byType) {
    analysis.typePerformance[t._id] = {
      count: t.count,
      avgConfidence: Math.round((t.avgConfidence || 0) * 100) / 100
    };
  }

  return analysis;
}

/**
 * Compute tuning recommendations based on performance
 */
function computeTuning(performance, currentConfig, tuningRate) {
  const tuning = {};

  // Tune offer type priorities based on actual performance
  const topPerformer = Object.entries(performance.typePerformance)
    .sort(([, a], [, b]) => b.count - a.count)[0];

  if (topPerformer && currentConfig.goal) {
    const [type] = topPerformer;
    if (VALID_OFFER_TYPES.has(type)) {
      tuning.topOfferType = {
        current: currentConfig.optimization?.topOfferType || null,
        recommended: type,
        changePercent: 1 // Always apply if there's clear winner
      };
    }
  }

  // Tune discount based on event count sensitivity
  const totalEvents = performance.totalEvents;
  const avgConfidence = Object.values(performance.typePerformance)
    .reduce((sum, p) => sum + p.avgConfidence, 0) / Math.max(1, Object.keys(performance.typePerformance).length);

  if (avgConfidence < 0.5 && currentConfig.guardrails?.maxDiscountCap) {
    // Low confidence = higher discount to stimulate conversions
    tuning.discountCap = {
      current: currentConfig.guardrails.maxDiscountCap,
      recommended: Math.min(30, currentConfig.guardrails.maxDiscountCap * (1 + tuningRate)),
      changePercent: tuningRate
    };
  } else if (avgConfidence > 0.75 && totalEvents > 100) {
    // High confidence = lower discount to preserve margins
    tuning.discountCap = {
      current: currentConfig.guardrails.maxDiscountCap,
      recommended: Math.max(5, currentConfig.guardrails.maxDiscountCap * (1 - tuningRate * 0.5)),
      changePercent: -tuningRate * 0.5
    };
  }

  return tuning;
}

// ─── New Pillar 5 Analysis Functions ─────────────────────────────────────────

/**
 * Analyze performance broken down by customer segment.
 * Segments: anonymous, known_customer (has customerId), or metadata.segment values.
 */
export async function analyzeSegmentPerformance(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    const rows = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          isUpsellEvent: true,
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $project: {
          eventType: 1,
          'metadata.offerType': 1,
          segment: {
            $ifNull: [
              '$metadata.segment',
              {
                $cond: [
                  { $ifNull: ['$customerId', false] },
                  'known_customer',
                  'anonymous'
                ]
              }
            ]
          }
        }
      },
      {
        $group: {
          _id: { segment: '$segment', eventType: '$eventType' },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const segmentMap = {};
    for (const row of rows) {
      const seg = row._id.segment || 'unknown';
      if (!segmentMap[seg]) {
        segmentMap[seg] = { segment: seg, views: 0, clicks: 0, cartAdds: 0 };
      }
      if (row._id.eventType === 'view') segmentMap[seg].views += row.count;
      if (row._id.eventType === 'click') segmentMap[seg].clicks += row.count;
      if (row._id.eventType === 'cart_add') segmentMap[seg].cartAdds += row.count;
    }

    const segments = Object.values(segmentMap).map((s) => ({
      ...s,
      ctr: s.views > 0 ? +((s.clicks / s.views) * 100).toFixed(2) : 0,
      conversionRate: s.views > 0 ? +((s.cartAdds / s.views) * 100).toFixed(2) : 0
    }));

    return { success: true, segments, period: { startDate, endDate } };
  } catch (error) {
    logger.logError('analyzeSegmentPerformance', { shopId, error: error.message });
    return { success: false, error: error.message, segments: [] };
  }
}

/**
 * Analyze discount elasticity — how does discount % affect acceptance rate?
 * Groups events by discount bucket (0%, 1-5%, 6-10%, 11-15%, 16-20%, 21%+)
 * and measures cart_add rate per bucket.
 */
export async function analyzeDiscountElasticity(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    const buckets = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          isUpsellEvent: true,
          timestamp: { $gte: startDate, $lte: endDate },
          'metadata.discountPercent': { $exists: true }
        }
      },
      {
        $bucket: {
          groupBy: '$metadata.discountPercent',
          boundaries: [0, 1, 6, 11, 16, 21, 100],
          default: 'unknown',
          output: {
            total: { $sum: 1 },
            cartAdds: {
              $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] }
            },
            avgDiscount: { $avg: '$metadata.discountPercent' }
          }
        }
      }
    ]).toArray();

    const bucketLabels = {
      0: '0%',
      1: '1–5%',
      6: '6–10%',
      11: '11–15%',
      16: '16–20%',
      21: '21%+',
      unknown: 'No discount data'
    };

    const elasticity = buckets.map((b) => ({
      bucket: bucketLabels[b._id] || String(b._id),
      total: b.total,
      cartAdds: b.cartAdds,
      conversionRate: b.total > 0 ? +((b.cartAdds / b.total) * 100).toFixed(2) : 0,
      avgDiscount: b.avgDiscount != null ? +b.avgDiscount.toFixed(1) : null
    }));

    // Find optimal bucket (highest conversion with at least 5 events)
    const optimal = [...elasticity]
      .filter((b) => b.total >= 5)
      .sort((a, b) => b.conversionRate - a.conversionRate)[0] || null;

    return {
      success: true,
      elasticity,
      optimalBucket: optimal?.bucket || null,
      optimalConversionRate: optimal?.conversionRate || null,
      period: { startDate, endDate }
    };
  } catch (error) {
    logger.logError('analyzeDiscountElasticity', { shopId, error: error.message });
    return { success: false, error: error.message, elasticity: [] };
  }
}

/**
 * Analyze how often guardrails were triggered.
 * Reads decision logs where guardrails blocked or modified offers.
 */
export async function analyzeGuardrailTriggers(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    const triggers = await db.collection(collections.decisionLogs).aggregate([
      {
        $match: {
          shopId,
          timestamp: { $gte: startDate, $lte: endDate },
          'guardrailsApplied': { $exists: true, $ne: [] }
        }
      },
      { $unwind: '$guardrailsApplied' },
      {
        $group: {
          _id: '$guardrailsApplied',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    const totalDecisions = await db.collection(collections.decisionLogs).countDocuments({
      shopId,
      timestamp: { $gte: startDate, $lte: endDate }
    });

    const totalTriggers = triggers.reduce((sum, t) => sum + t.count, 0);

    return {
      success: true,
      triggers: triggers.map((t) => ({
        guardrail: t._id,
        count: t.count,
        percentage: totalDecisions > 0 ? +((t.count / totalDecisions) * 100).toFixed(1) : 0
      })),
      totalDecisions,
      totalTriggers,
      guardrailRate: totalDecisions > 0
        ? +((totalTriggers / totalDecisions) * 100).toFixed(1)
        : 0,
      period: { startDate, endDate }
    };
  } catch (error) {
    logger.logError('analyzeGuardrailTriggers', { shopId, error: error.message });
    return { success: false, error: error.message, triggers: [] };
  }
}

/**
 * Run segment-aware optimization: tune parameters per segment.
 * Currently adjusts topOfferType globally based on best-converting segment signals.
 */
export async function optimizeForSegments(shopId) {
  try {
    const segmentResult = await analyzeSegmentPerformance(shopId);
    if (!segmentResult.success || segmentResult.segments.length === 0) {
      return { success: false, reason: 'no_segment_data' };
    }

    const db = await getDb();

    // Find which segment converts best and capture its profile
    const best = [...segmentResult.segments].sort(
      (a, b) => b.conversionRate - a.conversionRate
    )[0];

    if (!best || best.views < 10) {
      return { success: false, reason: 'insufficient_segment_data' };
    }

    // Persist segment insights for the decision engine to reference
    await db.collection(collections.merchantConfig).updateOne(
      { shopId },
      {
        $set: {
          'optimization.segmentInsights': {
            bestSegment: best.segment,
            bestCtr: best.ctr,
            bestConversionRate: best.conversionRate,
            analyzedAt: new Date()
          }
        }
      },
      { upsert: true }
    );

    return {
      success: true,
      bestSegment: best.segment,
      conversionRate: best.conversionRate,
      segments: segmentResult.segments
    };
  } catch (error) {
    logger.logError('optimizeForSegments', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}
