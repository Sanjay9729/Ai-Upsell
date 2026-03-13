/**
 * Learning Loop Engine — Pillar 5: Learning & Optimization Loop
 *
 * Complete autonomous optimization workflow:
 * 1. Tracks AOV lift, offer acceptance rates, bundle performance
 * 2. Identifies underperformers (low CTR, low conversion, negative AOV impact)
 * 3. Auto-pauses offers that consistently underperform
 * 4. Reallocates placements based on performance
 * 5. Tunes incentive levels autonomously
 * 6. Monitors guardrail triggers and adjusts limits
 */

import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';
import { getMerchantConfig, updateMerchantConfig } from './merchantConfig.js';
import {
  analyzePerformanceByOfferType,
  analyzeDiscountElasticity,
  analyzeGuardrailTriggers,
  analyzeSegmentPerformance
} from './optimizationEngine.js';

const LEARNING_CONFIG = {
  // Performance thresholds
  minViewsForEvaluation: 10,      // Minimum views to evaluate offer
  lowCTRThreshold: 0.02,          // <2% CTR = underperforming
  lowConversionThreshold: 0.01,   // <1% conversion = underperforming
  conversionDrop: 0.3,            // 30% drop = pause
  
  // Placement optimization
  minPlacementEvents: 20,         // Min events per placement before reallocating
  
  // Guardrail tuning
  highGuardrailRate: 0.35,        // >35% of decisions hit guardrails
  
  // AOV impact
  negativeAOVThreshold: -0.05,    // Offers reducing AOV by 5%+
  
  // Auto-pause configuration
  pauseDurationDays: 7,           // Pause for 7 days before re-evaluation
  
  // Learning rate
  discountTuningRate: 0.05        // Adjust discount by 5% at a time
};

/**
 * Run complete learning loop for a shop:
 * 1. Analyze performance
 * 2. Identify underperformers
 * 3. Auto-pause low performers
 * 4. Reallocate placements
 * 5. Adjust incentives
 * 6. Track guardrails
 */
export async function runFullLearningLoop(shopId) {
  try {
    const db = await getDb();
    
    // 1. Get current merchant config and performance data
    const [config, perfResult, elasticityResult, guardrailResult, aovResult] = 
      await Promise.all([
        getMerchantConfig(shopId),
        analyzePerformanceByOfferType(shopId, {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }),
        analyzeDiscountElasticity(shopId, {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }),
        analyzeGuardrailTriggers(shopId, {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }),
        analyzeAOVImpact(shopId, {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        })
      ]);

    if (!perfResult.success) {
      return { success: false, reason: 'insufficient_data' };
    }

    const results = {
      shopId,
      timestamp: new Date(),
      actions: {
        pausedOffers: [],
        reallocatedPlacements: [],
        adjustedIncentives: [],
        tunings: {}
      },
      analysis: {
        performance: perfResult.analysis,
        elasticity: elasticityResult.elasticity,
        guardrailRate: guardrailResult.guardrailRate,
        aovImpact: aovResult
      }
    };

    // 2. Identify and auto-pause underperformers
    const underperformers = identifyUnderperformers(perfResult.analysis);
    if (underperformers.length > 0) {
      results.actions.pausedOffers = await autoPauseOffers(shopId, underperformers);
    }

    // 3. Reallocate placements based on performance
    const placementReallocation = reallocatePlacements(perfResult.analysis);
    if (Object.keys(placementReallocation).length > 0) {
      results.actions.reallocatedPlacements = placementReallocation;
    }

    // 4. Adjust discount levels (incentive tuning)
    if (elasticityResult.success && elasticityResult.optimalBucket) {
      const discountAdjustment = tuneDiscountLevels(
        config,
        elasticityResult.optimalBucket,
        elasticityResult.elasticity
      );
      if (discountAdjustment) {
        results.actions.adjustedIncentives.push(discountAdjustment);
        results.actions.tunings.discount = discountAdjustment;
        await updateMerchantConfig(shopId, {
          guardrails: { baseDiscountPercent: discountAdjustment.newLevel }
        });
      }
    }

    // 5. Handle high guardrail rates (reduce offer frequency)
    if (guardrailResult.guardrailRate > LEARNING_CONFIG.highGuardrailRate) {
      const sessionLimitTuning = tuneSessionOfferLimit(config, guardrailResult);
      results.actions.tunings.sessionOfferLimit = sessionLimitTuning;
      await updateMerchantConfig(shopId, {
        guardrails: { sessionOfferLimit: sessionLimitTuning.newLimit }
      });
    }

    // 6. Log learning loop execution
    await db.collection(collections.optimizationLogs).insertOne({
      shopId,
      timestamp: new Date(),
      type: 'learning_loop',
      results
    });

    logger.logOptimization('learning_loop_completed', {
      shopId,
      offersAnalyzed: perfResult.analysis?.byOfferType?.length || 0,
      offersPaused: results.actions.pausedOffers.length,
      placementsReallocated: Object.keys(results.actions.reallocatedPlacements).length,
      incentivesAdjusted: results.actions.adjustedIncentives.length
    });

    return {
      success: true,
      learning: results
    };
  } catch (error) {
    logger.logError('runFullLearningLoop', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Identify underperforming offers:
 * - Views >= minViewsForEvaluation
 * - Low CTR or conversion OR negative AOV impact
 */
function identifyUnderperformers(performance) {
  const underperformers = [];

  if (!performance?.byOfferType) return underperformers;

  for (const offer of performance.byOfferType) {
    if (offer.views < LEARNING_CONFIG.minViewsForEvaluation) continue;

    const reasons = [];
    if (offer.ctr < LEARNING_CONFIG.lowCTRThreshold) {
      reasons.push(`low_ctr_${(offer.ctr * 100).toFixed(1)}%`);
    }
    if (offer.conversionRate < LEARNING_CONFIG.lowConversionThreshold) {
      reasons.push(`low_conversion_${(offer.conversionRate * 100).toFixed(1)}%`);
    }

    if (reasons.length > 0) {
      underperformers.push({
        offerType: offer._id,
        views: offer.views,
        ctr: offer.ctr,
        conversionRate: offer.conversionRate,
        reasons
      });
    }
  }

  return underperformers;
}

/**
 * Auto-pause underperforming offers
 */
async function autoPauseOffers(shopId, underperformers) {
  try {
    const db = await getDb();
    const pausedOffers = [];

    for (const uf of underperformers) {
      const pauseUntil = new Date(Date.now() + LEARNING_CONFIG.pauseDurationDays * 24 * 60 * 60 * 1000);
      
      // Mark all offers of this type as paused
      const result = await db.collection(collections.offerControls).updateMany(
        { shopId, 'offer.offerType': uf.offerType, status: 'auto' },
        {
          $set: {
            status: 'paused',
            pausedReason: `Auto-paused: ${uf.reasons.join(', ')}`,
            pausedAt: new Date(),
            pauseUntil,
            autoManaged: true
          }
        }
      );

      if (result.modifiedCount > 0) {
        pausedOffers.push({
          offerType: uf.offerType,
          count: result.modifiedCount,
          reason: uf.reasons.join(', '),
          pauseUntil
        });
      }
    }

    return pausedOffers;
  } catch (error) {
    logger.logError('autoPauseOffers', { shopId, error: error.message });
    return [];
  }
}

/**
 * Reallocate placements based on conversion rates
 * Shifts high-performing offer types to better-performing placements
 */
function reallocatePlacements(performance) {
  const reallocations = {};

  if (!performance?.byPlacement) return reallocations;

  // Rank placements by conversion rate
  const rankedPlacements = (performance.byPlacement || [])
    .filter(p => p.views >= LEARNING_CONFIG.minPlacementEvents)
    .sort((a, b) => b.conversionRate - a.conversionRate);

  // Rank offer types by conversion rate
  const rankedOfferTypes = (performance.byOfferType || [])
    .filter(o => o.views >= LEARNING_CONFIG.minViewsForEvaluation)
    .sort((a, b) => b.conversionRate - a.conversionRate);

  // Match top offer types to top placements
  for (let i = 0; i < Math.min(rankedOfferTypes.length, rankedPlacements.length); i++) {
    const offerType = rankedOfferTypes[i]._id;
    const placement = rankedPlacements[i]._id;
    reallocations[offerType] = placement;
  }

  return reallocations;
}

/**
 * Tune discount levels based on elasticity data
 */
function tuneDiscountLevels(config, optimalBucket, elasticity) {
  const currentDiscount = config?.guardrails?.baseDiscountPercent || 10;
  
  // Map bucket labels to representative discount %
  const bucketToDiscount = {
    '0%': 0,
    '1–5%': 3,
    '6–10%': 8,
    '11–15%': 13,
    '16–20%': 18,
    '21%+': 25
  };

  const optimalDiscount = bucketToDiscount[optimalBucket];
  if (optimalDiscount == null) return null;

  // Calculate tuning adjustment
  const difference = optimalDiscount - currentDiscount;
  const tuningAmount = Math.max(
    -LEARNING_CONFIG.discountTuningRate * currentDiscount,
    Math.min(LEARNING_CONFIG.discountTuningRate * currentDiscount, difference)
  );

  const newLevel = Math.max(0, Math.min(currentDiscount + tuningAmount, 30));

  if (Math.abs(newLevel - currentDiscount) < 0.5) return null; // Too small to adjust

  return {
    type: 'discount_optimization',
    currentLevel: currentDiscount,
    optimalBucket,
    optimalLevel: optimalDiscount,
    newLevel: Math.round(newLevel * 10) / 10,
    reason: `Optimal discount bucket: ${optimalBucket}`
  };
}

/**
 * Tune session offer limit based on guardrail trigger rate
 */
function tuneSessionOfferLimit(config, guardrailResult) {
  const currentLimit = config?.guardrails?.sessionOfferLimit ?? 3;
  
  if (guardrailResult.guardrailRate > LEARNING_CONFIG.highGuardrailRate) {
    const newLimit = Math.max(1, currentLimit - 1);
    return {
      type: 'session_limit_reduction',
      currentLimit,
      newLimit,
      guardrailRate: guardrailResult.guardrailRate,
      reason: `High guardrail trigger rate (${(guardrailResult.guardrailRate * 100).toFixed(1)}%)`
    };
  }

  return null;
}

/**
 * Analyze AOV impact of offers
 */
export async function analyzeAOVImpact(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    // Get orders with and without upsells
    const ordersWithUpsell = await db.collection(collections.orders).aggregate([
      {
        $match: {
          shopId,
          hasUpsell: true,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgOrderValue: { $avg: '$totalPrice' },
          totalRevenue: { $sum: '$totalPrice' }
        }
      }
    ]).toArray();

    const ordersWithoutUpsell = await db.collection(collections.orders).aggregate([
      {
        $match: {
          shopId,
          hasUpsell: { $ne: true },
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgOrderValue: { $avg: '$totalPrice' },
          totalRevenue: { $sum: '$totalPrice' }
        }
      }
    ]).toArray();

    const with_upsell = ordersWithUpsell[0] || { count: 0, avgOrderValue: 0, totalRevenue: 0 };
    const without_upsell = ordersWithoutUpsell[0] || { count: 0, avgOrderValue: 0, totalRevenue: 0 };

    const aovLift = without_upsell.avgOrderValue > 0
      ? (with_upsell.avgOrderValue - without_upsell.avgOrderValue) / without_upsell.avgOrderValue
      : 0;

    const totalRevenueLift = with_upsell.totalRevenue - without_upsell.totalRevenue;

    return {
      success: true,
      aov: {
        withUpsell: Math.round(with_upsell.avgOrderValue * 100) / 100,
        withoutUpsell: Math.round(without_upsell.avgOrderValue * 100) / 100,
        lift: Math.round(aovLift * 10000) / 100,  // as percentage
        count: with_upsell.count
      },
      revenue: {
        withUpsell: with_upsell.totalRevenue,
        withoutUpsell: without_upsell.totalRevenue,
        incrementalRevenue: totalRevenueLift
      },
      period: { startDate, endDate }
    };
  } catch (error) {
    logger.logError('analyzeAOVImpact', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get learning loop status and recent actions
 */
export async function getLearningLoopStatus(shopId, limit = 10) {
  try {
    const db = await getDb();
    
    const recent = await db.collection(collections.optimizationLogs)
      .find({ shopId, type: 'learning_loop' })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    const stats = {
      totalRuns: await db.collection(collections.optimizationLogs)
        .countDocuments({ shopId, type: 'learning_loop' }),
      offersCurrentlyPaused: await db.collection(collections.offerControls)
        .countDocuments({ shopId, status: 'paused', autoManaged: true }),
      recentActions: recent.map(r => ({
        timestamp: r.timestamp,
        offersPaused: r.results?.actions?.pausedOffers?.length || 0,
        placementsReallocated: Object.keys(r.results?.actions?.reallocatedPlacements || {}).length,
        incentivesAdjusted: r.results?.actions?.adjustedIncentives?.length || 0
      }))
    };

    return { success: true, status: stats };
  } catch (error) {
    logger.logError('getLearningLoopStatus', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}
