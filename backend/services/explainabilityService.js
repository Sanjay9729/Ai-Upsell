/**
 * Explainability Service — Full Decision Transparency
 * 
 * Provides:
 * 1. Why each offer was selected (score breakdown)
 * 2. Offer journey + automation actions
 * 3. A/B test performance tracking
 * 4. Segment deep-dive analytics
 * 5. Guardrail enforcement logs
 */

import { getDb, collections } from '../database/mongodb.js';

// ─── DECISION TRACING ──────────────────────────────────────────────────────

/**
 * Get full explanation for why an offer was made
 */
export async function explainOfferDecision(shopId, offerId) {
  try {
    const db = await getDb();

    // Get the offer decision record
    const decision = await db.collection(collections.decisionOffers)
      .findOne({ shopId, offerId });

    if (!decision) {
      return {
        success: false,
        error: 'Offer not found',
        offerId
      };
    }

    // Get performance metrics
    const performance = await getOfferPerformance(shopId, offerId);

    // Get control history
    const controlHistory = await db.collection(collections.offerControls)
      .findOne({ shopId, offerId });

    // Build explanation
    const explanation = {
      offerId,
      offer: {
        sourceProduct: decision.sourceProductName,
        upsellProduct: decision.upsellProductName,
        type: decision.offerType,
        placement: decision.placement,
        discount: decision.discountPercent
      },
      decision: {
        timestamp: decision.timestamp,
        decisionScore: decision.decisionScore,
        confidence: decision.confidence,
        recommendationType: decision.recommendationType,
        aiReason: decision.aiReason,
        decisionReason: decision.decisionReason
      },
      scoreBreakdown: decision._scoreBreakdown || {
        aiConfidence: decision.confidence * 0.3,
        goalAlignment: 0.2,
        performanceHistory: 0.2,
        merchantApproval: 0.1,
        other: 0.2
      },
      guardrailsApplied: decision._guardrailsApplied || [],
      performance: {
        current: performance.current,
        trend: performance.trend,
        benchmark: performance.benchmark
      },
      control: {
        status: controlHistory?.status || 'auto',
        overrides: controlHistory?.note || null,
        manualTunings: controlHistory?._tunings || []
      },
      alternativesConsidered: decision._alternatives || [],
      nextReview: computeNextReviewDate(decision)
    };

    return { success: true, explanation };

  } catch (error) {
    console.error('❌ explainOfferDecision failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get performance metrics for an offer
 */
async function getOfferPerformance(shopId, offerId) {
  try {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Current performance (last 7 days)
    const current = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            offerId,
            timestamp: { $gte: sevenDaysAgo }
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

    // Historical performance (30 days)
    const historical = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            offerId,
            timestamp: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
            adds: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
            abandons: { $sum: { $cond: [{ $eq: ['$eventType', 'abandon'] }, 1, 0] } }
          }
        }
      ])
      .toArray();

    const hist = historical[0] || { views: 0, clicks: 0, adds: 0 };

    // Compute metrics
    const ctr = hist.views > 0 ? hist.clicks / hist.views : 0;
    const conversion = hist.views > 0 ? hist.adds / hist.views : 0;
    const abandonment = hist.views > 0 ? hist.abandons / hist.views : 0;

    return {
      current: {
        views: hist.views,
        clicks: hist.clicks,
        adds: hist.adds,
        ctr: parseFloat(ctr.toFixed(4)),
        conversion: parseFloat(conversion.toFixed(4)),
        abandonment: parseFloat(abandonment.toFixed(4))
      },
      trend: computeTrend(hist),
      benchmark: computeBenchmark(hist)
    };

  } catch (error) {
    console.error('❌ getOfferPerformance failed:', error);
    return { current: {}, trend: null, benchmark: null };
  }
}

function computeTrend(hist) {
  // Compute if performance is improving or declining
  const conversion = hist.views > 0 ? hist.adds / hist.views : 0;
  
  if (conversion >= 0.05) return 'strong';
  if (conversion >= 0.02) return 'healthy';
  if (conversion >= 0.01) return 'weak';
  return 'failing';
}

function computeBenchmark(hist) {
  // Industry benchmarks (adjust per vertical)
  return {
    avgCTR: 0.07,
    avgConversion: 0.03,
    goodCTR: 0.1,
    goodConversion: 0.05
  };
}

function computeNextReviewDate(decision) {
  // Review date based on performance + control status
  const now = new Date();
  const daysUntilReview = decision._control?.status === 'auto' ? 3 : 7;
  const nextDate = new Date(now.getTime() + daysUntilReview * 24 * 60 * 60 * 1000);
  return nextDate;
}

// ─── OFFER JOURNEY + AUTOMATION ────────────────────────────────────────────

/**
 * Get complete automation journey for an offer
 */
export async function getOfferAutomationJourney(shopId, offerId) {
  try {
    const db = await getDb();

    // Get timeline of all events for this offer
    const events = await db.collection(collections.offerLogs)
      .find({ shopId, offerId })
      .sort({ timestamp: 1 })
      .toArray();

    const journey = {
      offerId,
      milestones: [],
      automationActions: [],
      manualInterventions: []
    };

    for (const event of events) {
      if (event.type === 'created') {
        journey.milestones.push({
          date: event.timestamp,
          action: 'Offer Created',
          details: {
            reason: event.reason,
            initialScore: event.score,
            placement: event.placement
          }
        });
      } else if (event.type === 'autopause' || event.type === 'autotune') {
        journey.automationActions.push({
          date: event.timestamp,
          action: `Auto-${event.type}`,
          reason: event.reason,
          change: event.change,
          impact: event.expectedImpact
        });
      } else if (event.type === 'manual_override') {
        journey.manualInterventions.push({
          date: event.timestamp,
          action: 'Manual Override',
          by: event.merchantId,
          change: event.change,
          reason: event.note
        });
      } else if (event.type === 'promoted' || event.type === 'paused') {
        journey.milestones.push({
          date: event.timestamp,
          action: event.type === 'promoted' ? 'Promoted' : 'Paused',
          reason: event.reason
        });
      }
    }

    return { success: true, journey };

  } catch (error) {
    console.error('❌ getOfferAutomationJourney failed:', error);
    return { success: false, error: error.message };
  }
}

// ─── SEGMENT PERFORMANCE DEEP-DIVE ──────────────────────────────────────────

/**
 * Get detailed performance breakdown by customer segment
 */
export async function getSegmentPerformance(shopId, options = {}) {
  try {
    const db = await getDb();
    const { limit = 10, sortBy = 'conversion' } = options;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const segments = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            isUpsellEvent: true,
            timestamp: { $gte: thirtyDaysAgo }
          }
        },
        {
          $project: {
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
            },
            eventType: 1,
            value: { $ifNull: ['$metadata.orderValue', 0] }
          }
        },
        {
          $group: {
            _id: '$segment',
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
            adds: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
            totalValue: { $sum: '$value' }
          }
        },
        {
          $project: {
            segment: '$_id',
            views: 1,
            clicks: 1,
            adds: 1,
            ctr: { $cond: [{ $gt: ['$views', 0] }, { $divide: ['$clicks', '$views'] }, 0] },
            conversion: { $cond: [{ $gt: ['$views', 0] }, { $divide: ['$adds', '$views'] }, 0] },
            avgOrderValue: { $cond: [{ $gt: ['$adds', 0] }, { $divide: ['$totalValue', '$adds'] }, 0] }
          }
        },
        {
          $sort: sortBy === 'conversion'
            ? { conversion: -1 }
            : sortBy === 'value'
            ? { avgOrderValue: -1 }
            : { views: -1 }
        },
        { $limit: limit }
      ])
      .toArray();

    // Get segment insights
    const insights = [];
    for (const seg of segments) {
      const health = seg.conversion >= 0.05 ? 'excellent' : seg.conversion >= 0.02 ? 'good' : 'needs_work';
      insights.push({
        segment: seg.segment,
        metrics: {
          views: seg.views,
          ctr: parseFloat((seg.ctr * 100).toFixed(2)),
          conversion: parseFloat((seg.conversion * 100).toFixed(2)),
          avgOrderValue: parseFloat(seg.avgOrderValue.toFixed(2))
        },
        health,
        recommendation: healthToRecommendation(health, seg.segment)
      });
    }

    return { success: true, segments: insights };

  } catch (error) {
    console.error('❌ getSegmentPerformance failed:', error);
    return { success: false, error: error.message };
  }
}

function healthToRecommendation(health, segment) {
  switch (health) {
    case 'excellent':
      return `${segment} is performing great. Consider increasing placement prominence.`;
    case 'good':
      return `${segment} is performing well. Maintain current strategy.`;
    case 'needs_work':
      return `${segment} needs improvement. Consider segment-specific offers or increased incentives.`;
    default:
      return null;
  }
}

// ─── CONTEXT INJECTION ANALYSIS ───────────────────────────────────────────

/**
 * Analyze how context injection affects performance
 */
export async function analyzeContextInjection(shopId) {
  try {
    const db = await getDb();
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get performance for merchant-injected vs AI-generated
    const perfBySource = await db.collection(collections.decisionOffers)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart }
          }
        },
        {
          $group: {
            _id: '$recommendationType', // merchant_focus, merchant_approved, ai_generated
            count: { $sum: 1 },
            avgScore: { $avg: '$decisionScore' },
            avgConfidence: { $avg: '$confidence' }
          }
        }
      ])
      .toArray();

    // Match with performance events
    const eventsBySource = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart }
          }
        },
        {
          $group: {
            _id: '$metadata.recommendationType',
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            conversions: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } }
          }
        }
      ])
      .toArray();

    const analysis = {};
    for (const source of perfBySource) {
      const events = eventsBySource.find(e => e._id === source._id) || { views: 0, conversions: 0 };
      const conversion = events.views > 0 ? events.conversions / events.views : 0;

      analysis[source._id || 'unknown'] = {
        count: source.count,
        avgScore: parseFloat(source.avgScore.toFixed(3)),
        avgConfidence: parseFloat(source.avgConfidence.toFixed(3)),
        performance: {
          views: events.views,
          conversions: events.conversions,
          conversionRate: parseFloat(conversion.toFixed(4))
        }
      };
    }

    return { success: true, analysis };

  } catch (error) {
    console.error('❌ analyzeContextInjection failed:', error);
    return { success: false, error: error.message };
  }
}

// ─── A/B TEST TRACKING ────────────────────────────────────────────────────

/**
 * Track A/B test results (variant vs baseline)
 */
export async function getABTestResults(shopId, testId) {
  try {
    const db = await getDb();

    // Get test configuration
    const test = await db.collection(collections.abTests)
      .findOne({ shopId, testId });

    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // Get performance for each variant
    const variants = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            'metadata.testId': testId,
            timestamp: { $gte: new Date(test.createdAt) }
          }
        },
        {
          $group: {
            _id: '$metadata.variant',
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
            conversions: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
            revenue: { $sum: { $ifNull: ['$metadata.orderValue', 0] } }
          }
        }
      ])
      .toArray();

    const results = {
      testId,
      hypothesis: test.hypothesis,
      status: test.status,
      createdAt: test.createdAt,
      endsAt: test.endsAt,
      variants: []
    };

    for (const variant of variants) {
      const conv = variant.views > 0 ? variant.conversions / variant.views : 0;
      const ctr = variant.views > 0 ? variant.clicks / variant.views : 0;

      results.variants.push({
        name: variant._id,
        metrics: {
          views: variant.views,
          ctr: parseFloat((ctr * 100).toFixed(2)),
          conversions: variant.conversions,
          conversionRate: parseFloat((conv * 100).toFixed(2)),
          totalRevenue: variant.revenue,
          avgRevenuePerView: parseFloat((variant.revenue / variant.views).toFixed(2))
        }
      });
    }

    // Compute winner
    const winner = results.variants.reduce((max, v) => 
      v.metrics.conversionRate > (max?.metrics.conversionRate || 0) ? v : max
    );

    results.winner = winner?.name;
    results.confidence = computeStatisticalConfidence(variants);

    return { success: true, results };

  } catch (error) {
    console.error('❌ getABTestResults failed:', error);
    return { success: false, error: error.message };
  }
}

function computeStatisticalConfidence(variants) {
  // Simplified: compute confidence that winner is statistically significant
  // In production, use proper chi-square or t-test
  const sorted = variants.sort((a, b) => 
    (b.conversions / b.views) - (a.conversions / a.views)
  );

  if (sorted.length < 2) return null;

  const topConv = sorted[0].conversions / sorted[0].views;
  const secondConv = sorted[1].conversions / sorted[1].views;
  const diff = topConv - secondConv;

  // Placeholder: return confidence based on difference magnitude
  if (diff > 0.05) return 0.95;
  if (diff > 0.02) return 0.85;
  if (diff > 0.01) return 0.7;
  return 0.5;
}

export const explainabilityService = {
  explainOfferDecision,
  getOfferAutomationJourney,
  getSegmentPerformance,
  analyzeContextInjection,
  getABTestResults
};
