/**
 * Autonomous Optimizer — Self-Tuning Learning Loop
 * 
 * Responsibilities:
 * 1. Detect underperforming placements + contexts
 * 2. Auto-pause offers below thresholds
 * 3. Reallocate placement emphasis
 * 4. Tune discount incentives + bundle configurations
 * 5. Log all decisions for explainability
 */

import { getDb, collections } from '../database/mongodb.js';
import { getMerchantConfig } from './merchantConfig.js';
import {
  autonomousPauseUnderperformers,
  autoTuneIncentives
} from './decisionEngineV2.js';

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const OPTIMIZATION_WINDOW = 7;  // Days
const MIN_SAMPLE_SIZE = 20;     // Minimum events to make a decision
const PAUSE_THRESHOLD_CONVERSION = 0.015; // 1.5% min conversion
const PAUSE_THRESHOLD_CTR = 0.03; // 3% min CTR

// ─── MAIN OPTIMIZATION LOOP ───────────────────────────────────────────────

/**
 * Run full autonomous optimization cycle
 * Called via cron job (daily or on-demand)
 */
export async function runAutonomousOptimization(shopId) {
  const startTime = Date.now();
  const log = {
    shopId,
    startedAt: new Date(),
    steps: [],
    summary: {}
  };

  try {
    console.log(`🤖 Starting autonomous optimization for ${shopId}`);

    // Step 1: Analyze performance by placement
    const placementAnalysis = await analyzePerformanceByPlacement(shopId);
    log.steps.push({
      step: 'placement_analysis',
      result: placementAnalysis,
      duration: Date.now() - startTime
    });

    // Step 2: Analyze performance by offer type
    const offerTypeAnalysis = await analyzePerformanceByOfferType(shopId);
    log.steps.push({
      step: 'offer_type_analysis',
      result: offerTypeAnalysis,
      duration: Date.now() - startTime
    });

    // Step 3: Autonomous pause underperformers
    const pauseResult = await autonomousPauseUnderperformers(shopId);
    log.steps.push({
      step: 'pause_underperformers',
      result: pauseResult,
      duration: Date.now() - startTime
    });

    // Step 4: Auto-tune incentives
    const tuneResult = await autoTuneIncentives(shopId);
    log.steps.push({
      step: 'tune_incentives',
      result: tuneResult,
      duration: Date.now() - startTime
    });

    // Step 5: Reallocate placement emphasis
    const reallocateResult = await reallocatePlacementEmphasis(shopId);
    log.steps.push({
      step: 'reallocate_placements',
      result: reallocateResult,
      duration: Date.now() - startTime
    });

    // Step 6: Check guardrail violations
    const guardrailResult = await checkGuardrailViolations(shopId);
    log.steps.push({
      step: 'guardrail_check',
      result: guardrailResult,
      duration: Date.now() - startTime
    });

    log.summary = {
      totalDuration: Date.now() - startTime,
      offersPaused: pauseResult.paused || 0,
      offersPromoted: pauseResult.promoted || 0,
      discountsTuned: tuneResult.tuned || 0,
      placementsReallocated: reallocateResult.reallocated || 0,
      guardrailViolations: guardrailResult.violations?.length || 0
    };

    log.status = 'success';
    log.completedAt = new Date();

    // Store optimization log
    const db = await getDb();
    await db.collection(collections.optimizationLogs).insertOne(log);

    console.log(`✅ Autonomous optimization completed:`, log.summary);

    return {
      success: true,
      summary: log.summary,
      log
    };

  } catch (error) {
    console.error('❌ Autonomous optimization failed:', error);
    log.status = 'failed';
    log.error = error.message;
    log.completedAt = new Date();

    // Store failed log
    const db = await getDb();
    await db.collection(collections.optimizationLogs).insertOne(log);

    return {
      success: false,
      error: error.message,
      log
    };
  }
}

// ─── PERFORMANCE ANALYSIS ─────────────────────────────────────────────────

/**
 * Analyze how each placement is performing
 */
async function analyzePerformanceByPlacement(shopId) {
  try {
    const db = await getDb();
    const windowStart = new Date(Date.now() - OPTIMIZATION_WINDOW * 24 * 60 * 60 * 1000);

    const placements = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart },
            isUpsellEvent: true
          }
        },
        {
          $group: {
            _id: '$placement',
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            clicks: { $sum: { $cond: [{ $eq: ['$eventType', 'click'] }, 1, 0] } },
            adds: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
            abandons: { $sum: { $cond: [{ $eq: ['$eventType', 'abandon'] }, 1, 0] } }
          }
        }
      ])
      .toArray();

    const analysis = {};
    const recommendations = [];

    for (const p of placements) {
      const placement = p._id || 'unknown';
      const ctr = p.views > 0 ? p.clicks / p.views : 0;
      const conversion = p.views > 0 ? p.adds / p.views : 0;
      const health = ctr >= 0.05 && conversion >= 0.02 ? 'healthy' : 'needs_attention';

      analysis[placement] = {
        views: p.views,
        clicks: p.clicks,
        adds: p.adds,
        ctr: parseFloat(ctr.toFixed(4)),
        conversion: parseFloat(conversion.toFixed(4)),
        health
      };

      if (health === 'needs_attention' && p.views >= MIN_SAMPLE_SIZE) {
        recommendations.push({
          placement,
          issue: ctr < 0.05 ? 'low_ctr' : 'low_conversion',
          action: conversion < 0.01 ? 'consider_pause' : 'tune_incentives'
        });
      }
    }

    return { analysis, recommendations };

  } catch (error) {
    console.error('❌ analyzePerformanceByPlacement failed:', error);
    return { analysis: {}, recommendations: [], error: error.message };
  }
}

/**
 * Analyze performance by offer type
 */
async function analyzePerformanceByOfferType(shopId) {
  try {
    const db = await getDb();
    const windowStart = new Date(Date.now() - OPTIMIZATION_WINDOW * 24 * 60 * 60 * 1000);

    // Get offer type from offer logs
    const typePerf = await db.collection(collections.decisionOffers)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart }
          }
        },
        {
          $lookup: {
            from: collections.upsellEvents,
            let: { offerId: '$offerId' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$offerId', '$$offerId'] },
                  timestamp: { $gte: windowStart }
                }
              },
              {
                $group: {
                  _id: '$eventType',
                  count: { $sum: 1 }
                }
              }
            ],
            as: 'events'
          }
        },
        {
          $group: {
            _id: '$offerType',
            totalOffers: { $sum: 1 },
            views: { $sum: { $cond: [{ $gt: [{ $size: '$events' }, 0] }, 1, 0] } },
            conversions: { $sum: { $cond: [{ $ne: [{ $arrayElemAt: ['$events.count', 0] }, null] }, 1, 0] } }
          }
        }
      ])
      .toArray();

    const analysis = {};
    for (const row of typePerf) {
      const offerType = row._id || 'unknown';
      const convRate = row.views > 0 ? row.conversions / row.views : 0;
      
      analysis[offerType] = {
        totalOffers: row.totalOffers,
        views: row.views,
        conversions: row.conversions,
        conversionRate: parseFloat(convRate.toFixed(4)),
        health: convRate >= 0.02 ? 'healthy' : 'weak'
      };
    }

    return { analysis };

  } catch (error) {
    console.error('❌ analyzePerformanceByOfferType failed:', error);
    return { analysis: {}, error: error.message };
  }
}

// ─── PLACEMENT REALLOCATION ───────────────────────────────────────────────

/**
 * Recommend placement shifts based on performance
 */
async function reallocatePlacementEmphasis(shopId) {
  try {
    const db = await getDb();
    const windowStart = new Date(Date.now() - OPTIMIZATION_WINDOW * 24 * 60 * 60 * 1000);

    // Get placement performance with ranking
    const placements = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart },
            isUpsellEvent: true
          }
        },
        {
          $group: {
            _id: '$placement',
            conversions: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } }
          }
        },
        {
          $project: {
            placement: '$_id',
            conversions: 1,
            views: 1,
            convRate: { $cond: [{ $gt: ['$views', 0] }, { $divide: ['$conversions', '$views'] }, 0] }
          }
        },
        {
          $sort: { convRate: -1 }
        }
      ])
      .toArray();

    const reallocations = [];
    const ranked = placements
      .filter(p => p.views >= MIN_SAMPLE_SIZE)
      .map((p, idx) => ({ ...p, rank: idx + 1 }));

    // Recommendations: shift budget from low performers to high performers
    const topPerformer = ranked[0];
    const lowPerformers = ranked.filter(p => p.convRate < PAUSE_THRESHOLD_CONVERSION);

    for (const low of lowPerformers) {
      if (topPerformer && topPerformer.placement !== low.placement) {
        reallocations.push({
          from: low.placement,
          to: topPerformer.placement,
          reason: `Shift from ${(low.convRate*100).toFixed(2)}% to ${(topPerformer.convRate*100).toFixed(2)}%`,
          expectedImprovement: topPerformer.convRate - low.convRate
        });
      }
    }

    return { ranked, reallocations: reallocations.length };

  } catch (error) {
    console.error('❌ reallocatePlacementEmphasis failed:', error);
    return { reallocations: 0, error: error.message };
  }
}

// ─── GUARDRAIL VIOLATIONS ─────────────────────────────────────────────────

/**
 * Check for guardrail violations and log them
 */
async function checkGuardrailViolations(shopId) {
  try {
    const db = await getDb();
    const violations = [];

    // Check 1: Offers with excessive discounts
    const excessiveDiscounts = await db.collection(collections.offerControls)
      .find({
        shopId,
        discountPercent: { $gt: 50 },
        status: { $ne: 'paused' }
      })
      .toArray();

    for (const offer of excessiveDiscounts) {
      violations.push({
        type: 'excessive_discount',
        offerId: offer.offerKey,
        value: offer.discountPercent,
        limit: 50,
        severity: 'high'
      });
    }

    // Check 2: Offers exceeding density limit
    const windowStart = new Date(Date.now() - OPTIMIZATION_WINDOW * 24 * 60 * 60 * 1000);
    const density = await db.collection(collections.decisionOffers)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart }
          }
        },
        {
          $group: {
            _id: null,
            totalOffers: { $sum: 1 },
            totalSessions: { $sum: 1 }
          }
        }
      ])
      .toArray();

    if (density.length > 0 && density[0].totalOffers > 100) {
      const ratio = density[0].totalOffers / Math.max(density[0].totalSessions, 1);
      if (ratio > 0.3) {
        violations.push({
          type: 'offer_density_high',
          ratio: parseFloat(ratio.toFixed(3)),
          limit: 0.3,
          severity: 'medium'
        });
      }
    }

    // Check 3: Conflicting offers active simultaneously
    const conflicts = await detectActiveConflicts(shopId, db);
    violations.push(...conflicts);

    // Log violations
    if (violations.length > 0) {
      await db.collection(collections.guardrailViolations).insertMany(
        violations.map(v => ({
          ...v,
          shopId,
          detectedAt: new Date()
        }))
      );
    }

    return { violations: violations.length };

  } catch (error) {
    console.error('❌ checkGuardrailViolations failed:', error);
    return { violations: 0, error: error.message };
  }
}

/**
 * Detect conflicting offers active at the same time
 */
async function detectActiveConflicts(shopId, db) {
  const conflicts = [];

  try {
    // Find offers on same product
    const duplicates = await db.collection(collections.offerControls)
      .aggregate([
        {
          $match: {
            shopId,
            status: { $ne: 'paused' }
          }
        },
        {
          $group: {
            _id: '$upsellProductId',
            offers: { $push: '$$ROOT' },
            count: { $sum: 1 }
          }
        },
        {
          $match: { count: { $gt: 1 } }
        }
      ])
      .toArray();

    for (const dup of duplicates) {
      conflicts.push({
        type: 'duplicate_offers',
        productId: dup._id,
        count: dup.count,
        severity: 'medium'
      });
    }

  } catch (error) {
    console.warn('⚠️ detectActiveConflicts failed:', error.message);
  }

  return conflicts;
}

// ─── AUTONOMOUS REBALANCING ───────────────────────────────────────────────

/**
 * Rebalance offer allocation across placements
 * Moves high-performing offers to better placements
 */
export async function rebalanceOfferAllocation(shopId) {
  try {
    const db = await getDb();

    // Get best-performing placements
    const windowStart = new Date(Date.now() - OPTIMIZATION_WINDOW * 24 * 60 * 60 * 1000);

    const bestPlacements = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart },
            isUpsellEvent: true
          }
        },
        {
          $group: {
            _id: '$placement',
            conversions: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } },
            views: { $sum: 1 }
          }
        },
        {
          $project: {
            placement: '$_id',
            convRate: { $divide: ['$conversions', { $max: ['$views', 1] }] }
          }
        },
        {
          $sort: { convRate: -1 }
        }
      ])
      .toArray();

    // Get offers that are underperforming in their current placement
    const underperformers = await db.collection(collections.decisionOffers)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart }
          }
        },
        {
          $group: {
            _id: {
              offerId: '$offerId',
              placement: '$placement'
            },
            views: { $sum: 1 },
            conversions: { $sum: 1 } // Placeholder
          }
        },
        {
          $match: {
            views: { $gte: MIN_SAMPLE_SIZE }
          }
        },
        {
          $project: {
            offerId: '$_id.offerId',
            currentPlacement: '$_id.placement',
            convRate: { $divide: ['$conversions', { $max: ['$views', 1] }] }
          }
        },
        {
          $match: {
            convRate: { $lt: PAUSE_THRESHOLD_CONVERSION }
          }
        }
      ])
      .toArray();

    const reallocated = [];

    for (const offer of underperformers) {
      const bestPlacement = bestPlacements[0];
      if (bestPlacement && bestPlacement.placement !== offer.currentPlacement) {
        // Recommend moving to best placement
        reallocated.push({
          offerId: offer.offerId,
          from: offer.currentPlacement,
          to: bestPlacement.placement,
          reason: 'Move to higher-performing placement'
        });
      }
    }

    return { reallocated: reallocated.length, details: reallocated };

  } catch (error) {
    console.error('❌ rebalanceOfferAllocation failed:', error);
    return { reallocated: 0, error: error.message };
  }
}

// ─── BUNDLE QUALITY OPTIMIZATION ──────────────────────────────────────────

/**
 * Check bundle quality and optimize compositions
 */
export async function optimizeBundleConfigurations(shopId) {
  try {
    const db = await getDb();
    const windowStart = new Date(Date.now() - OPTIMIZATION_WINDOW * 24 * 60 * 60 * 1000);

    // Get all bundles with their performance
    const bundlePerf = await db.collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: windowStart },
            'metadata.offerType': 'bundle'
          }
        },
        {
          $group: {
            _id: '$metadata.offerId',
            views: { $sum: { $cond: [{ $eq: ['$eventType', 'view'] }, 1, 0] } },
            conversions: { $sum: { $cond: [{ $eq: ['$eventType', 'cart_add'] }, 1, 0] } }
          }
        },
        {
          $match: { views: { $gte: MIN_SAMPLE_SIZE } }
        }
      ])
      .toArray();

    const recommendations = [];

    for (const bundle of bundlePerf) {
      const convRate = bundle.conversions / bundle.views;

      if (convRate < 0.01) {
        recommendations.push({
          bundleId: bundle._id,
          issue: 'poor_conversion',
          suggestion: 'Remove low-appeal items or increase discount',
          convRate: parseFloat(convRate.toFixed(4))
        });
      } else if (convRate > 0.05) {
        recommendations.push({
          bundleId: bundle._id,
          issue: 'high_conversion',
          suggestion: 'Consider increasing bundle price or reducing discount',
          convRate: parseFloat(convRate.toFixed(4))
        });
      }
    }

    return { recommendations: recommendations.length, details: recommendations };

  } catch (error) {
    console.error('❌ optimizeBundleConfigurations failed:', error);
    return { recommendations: 0, error: error.message };
  }
}

export const autonomousOptimizer = {
  runAutonomousOptimization,
  rebalanceOfferAllocation,
  optimizeBundleConfigurations
};
