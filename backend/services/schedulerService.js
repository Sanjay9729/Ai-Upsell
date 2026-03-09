/**
 * Scheduler Service — Pillar 5: Learning & Optimization Loop
 *
 * Manages per-shop optimization scheduling.
 * Tracks last run time, prevents duplicate runs, and stores history.
 * Designed to be triggered:
 *   1. By the /api/cron/optimize endpoint (external cron)
 *   2. Lazily from proxy routes (background trigger if overdue)
 */

import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';

const OPTIMIZATION_INTERVAL_HOURS = 24;

/**
 * Check if a shop's optimization is overdue
 */
export async function shouldRunOptimization(shopId) {
  try {
    const db = await getDb();
    const state = await db.collection(collections.schedulerState).findOne({ shopId });

    if (!state?.lastOptimizationAt) return true;

    const hoursSinceLast =
      (Date.now() - new Date(state.lastOptimizationAt).getTime()) / (1000 * 60 * 60);

    return hoursSinceLast >= OPTIMIZATION_INTERVAL_HOURS;
  } catch {
    return false; // On error, don't trigger
  }
}

/**
 * Run optimization for a shop and record state + history
 */
export async function runScheduledOptimization(shopId, triggeredBy = 'cron') {
  const db = await getDb();

  // Mark as running to prevent duplicate concurrent runs
  const stateResult = await db.collection(collections.schedulerState).findOneAndUpdate(
    { shopId, isRunning: { $ne: true } },
    { $set: { shopId, isRunning: true, startedAt: new Date(), triggeredBy } },
    { upsert: true, returnDocument: 'after' }
  );

  // If another process is already running, skip
  if (!stateResult && !stateResult?.isRunning === false) {
    return { success: false, reason: 'already_running' };
  }

  const startedAt = new Date();

  try {
    // Lazy-import to avoid circular deps at module load
    const { optimizeForShop } = await import('./optimizationEngine.js');
    const result = await optimizeForShop(shopId);

    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;

    // Update scheduler state
    await db.collection(collections.schedulerState).updateOne(
      { shopId },
      {
        $set: {
          isRunning: false,
          lastOptimizationAt: finishedAt,
          lastResult: result.success ? 'success' : 'insufficient_data',
          lastReason: result.reason || null,
          triggeredBy,
          durationMs
        }
      },
      { upsert: true }
    );

    // Write history record
    await db.collection(collections.optimizationHistory).insertOne({
      shopId,
      triggeredBy,
      startedAt,
      finishedAt,
      durationMs,
      success: result.success,
      reason: result.reason || null,
      eventCount: result.optimization?.eventCount || 0,
      updatesMade: result.optimization?.updatesMade || 0,
      appliedUpdates: result.optimization?.appliedUpdates || {},
      bundleRecommendations: result.optimization?.bundleRecommendations || 0,
      tuning: result.optimization?.tuning || {}
    });

    logger.logOptimization('scheduled_optimization', {
      shopId,
      triggeredBy,
      success: result.success,
      durationMs
    });

    return result;
  } catch (error) {
    await db.collection(collections.schedulerState).updateOne(
      { shopId },
      {
        $set: {
          isRunning: false,
          lastResult: 'error',
          lastError: error.message,
          lastOptimizationAt: new Date()
        }
      },
      { upsert: true }
    );

    await db.collection(collections.optimizationHistory).insertOne({
      shopId,
      triggeredBy,
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      success: false,
      reason: 'error',
      error: error.message
    });

    logger.logError('scheduledOptimization', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get current scheduler state for a shop
 */
export async function getSchedulerState(shopId) {
  const db = await getDb();
  return db.collection(collections.schedulerState).findOne({ shopId });
}

/**
 * Get optimization run history for a shop
 */
export async function getOptimizationHistory(shopId, limit = 20) {
  const db = await getDb();
  return db
    .collection(collections.optimizationHistory)
    .find({ shopId })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Get all shops that have merchant config (need optimization)
 */
export async function getAllActiveShopIds() {
  const db = await getDb();
  const docs = await db
    .collection(collections.merchantConfig)
    .find({}, { projection: { shopId: 1 } })
    .toArray();
  return docs.map((d) => d.shopId).filter(Boolean);
}
