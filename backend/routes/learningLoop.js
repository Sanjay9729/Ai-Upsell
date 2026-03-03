/**
 * Learning Loop Route — Optimization Feedback Loop
 *
 * Periodically runs the optimization engine to:
 * - Analyze conversion metrics by offer type
 * - Compute confidence threshold recommendations
 * - Adjust decision parameters based on performance
 * - Track AOV lift and revenue attribution
 *
 * Typically triggered by a cron job or admin dashboard action.
 */

import express from 'express';
import {
  optimizeForShop,
  analyzePerformanceByOfferType,
  analyzeAOVImpact,
  recommendConfidenceThresholds,
  simulateParameterChanges
} from '../services/optimizationEngine.js';
import { getDb, collections } from '../database/mongodb.js';
import { logger } from '../services/logger.js';

const router = express.Router();

/**
 * POST /api/learning-loop/optimize/:shopId
 * Run optimization cycle for a shop
 */
router.post('/optimize/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { lookbackDays, minDataPoints } = req.query;

    const options = {};
    if (lookbackDays) options.lookbackDays = parseInt(lookbackDays);
    if (minDataPoints) options.minDataPoints = parseInt(minDataPoints);

    const result = await optimizeForShop(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in optimize route:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning-loop/analyze-performance/:shopId
 * Analyze performance by offer type and placement
 */
router.post('/analyze-performance/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { startDate, endDate } = req.query;

    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    const result = await analyzePerformanceByOfferType(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in analyze-performance route:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning-loop/aov-impact/:shopId
 * Analyze AOV impact of upsells
 */
router.post('/aov-impact/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { startDate, endDate } = req.query;

    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    const result = await analyzeAOVImpact(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in aov-impact route:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning-loop/confidence-thresholds/:shopId
 * Get recommended confidence thresholds
 */
router.post('/confidence-thresholds/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { startDate } = req.query;

    const options = {};
    if (startDate) options.startDate = new Date(startDate);

    const result = await recommendConfidenceThresholds(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in confidence-thresholds route:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/learning-loop/simulate/:shopId
 * Simulate parameter changes before applying
 */
router.post('/simulate/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { minConfidence, discountPercent, maxOfferFrequency } = req.body;

    const parameterChanges = {};
    if (minConfidence !== undefined) parameterChanges.minConfidence = minConfidence;
    if (discountPercent !== undefined) parameterChanges.discountPercent = discountPercent;
    if (maxOfferFrequency !== undefined) parameterChanges.maxOfferFrequency = maxOfferFrequency;

    const result = await simulateParameterChanges(shopId, parameterChanges);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in simulate route:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/learning-loop/status/:shopId
 * Get optimization status and recent improvements
 */
router.get('/status/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const db = await getDb();

    // Get most recent optimization
    const optimizations = await db.collection(collections.optimizationLogs)
      .find({ shopId })
      .sort({ timestamp: -1 })
      .limit(5)
      .toArray();

    // Get improvement trend
    const totalOptimizations = await db.collection(collections.optimizationLogs)
      .countDocuments({ shopId });

    const lastOptimization = optimizations[0];
    const hasRecentOptimization = lastOptimization && 
      (Date.now() - lastOptimization.timestamp.getTime()) < 24 * 60 * 60 * 1000;

    logger.logRequest(req, res, Date.now() - startTime);
    res.json({
      success: true,
      status: {
        shopId,
        totalOptimizations,
        lastOptimization,
        hasRecentOptimization,
        recentHistory: optimizations.slice(1).map(o => ({
          timestamp: o.timestamp,
          updatesMade: o.updatesMade
        }))
      }
    });
  } catch (error) {
    console.error('Error in status route:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/learning-loop/health
 * Health check for learning loop system
 */
router.get('/health', async (req, res) => {
  try {
    const db = await getDb();
    
    // Check if collections exist
    const collections_list = await db.listCollections().toArray();
    const requiredCollections = ['upsell_events', 'optimization_logs', 'merchant_configs'];
    const missingCollections = requiredCollections.filter(
      c => !collections_list.some(col => col.name === c)
    );

    // Count recent optimization events
    const recentOps = await db.collection(collections.optimizationLogs)
      .countDocuments({
        timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });

    res.json({
      success: true,
      health: {
        status: missingCollections.length === 0 ? 'healthy' : 'degraded',
        database: {
          connected: true,
          missingCollections
        },
        optimizations: {
          recentCount: recentOps,
          period: '7_days'
        }
      }
    });
  } catch (error) {
    console.error('Error in health route:', error);
    res.status(500).json({
      success: false,
      health: {
        status: 'unhealthy',
        error: error.message
      }
    });
  }
});

export default router;
