/**
 * Cron Routes — Scheduled Automation
 *
 * Triggers background jobs:
 * - Learning loop optimization every 24 hours
 * - Offer re-evaluation every 12 hours
 * - Guardrail enforcement checks
 */

import express from 'express';
import { runScheduledOptimization, getAllActiveShopIds } from '../services/schedulerService.js';
import { runFullLearningLoop } from '../services/learningLoopEngine.js';
import { logger } from '../services/logger.js';

const router = express.Router();

/**
 * POST /api/cron/optimize
 * Run learning loop optimization for all shops
 * Triggered by external cron job
 */
router.post('/optimize', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.body;

    if (!shopId) {
      // Run for all active shops
      const shopIds = await getAllActiveShopIds();
      const results = [];

      for (const sid of shopIds) {
        const result = await runScheduledOptimization(sid, 'cron_global');
        results.push({
          shopId: sid,
          success: result.success,
          reason: result.reason
        });
      }

      logger.logOptimization('cron_optimize_all', {
        shopsProcessed: shopIds.length,
        successCount: results.filter(r => r.success).length,
        duration: Date.now() - startTime
      });

      return res.json({
        success: true,
        jobType: 'batch_optimize',
        results,
        duration: Date.now() - startTime
      });
    } else {
      // Run for single shop
      const result = await runScheduledOptimization(shopId, 'cron_manual');
      logger.logRequest(req, res, Date.now() - startTime);
      return res.json({
        success: result.success,
        jobType: 'single_optimize',
        shopId,
        result,
        duration: Date.now() - startTime
      });
    }
  } catch (error) {
    console.error('Error in cron optimize:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    });
  }
});

/**
 * POST /api/cron/learning-loop
 * Run full learning loop (includes auto-pause, placement reallocation, incentive tuning)
 * More aggressive than standard optimization
 */
router.post('/learning-loop', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.body;

    if (!shopId) {
      // Run for all active shops
      const shopIds = await getAllActiveShopIds();
      const results = [];

      for (const sid of shopIds) {
        try {
          const result = await runFullLearningLoop(sid);
          results.push({
            shopId: sid,
            success: result.success,
            actions: result.learning?.actions
          });
        } catch (err) {
          results.push({
            shopId: sid,
            success: false,
            error: err.message
          });
        }
      }

      logger.logOptimization('cron_learning_loop_all', {
        shopsProcessed: shopIds.length,
        successCount: results.filter(r => r.success).length,
        totalOffersPaused: results.reduce((sum, r) => sum + (r.actions?.pausedOffers?.length || 0), 0),
        duration: Date.now() - startTime
      });

      return res.json({
        success: true,
        jobType: 'batch_learning_loop',
        results,
        duration: Date.now() - startTime
      });
    } else {
      // Run for single shop
      const result = await runFullLearningLoop(shopId);
      logger.logRequest(req, res, Date.now() - startTime);
      return res.json({
        success: result.success,
        jobType: 'single_learning_loop',
        shopId,
        learning: result.learning,
        duration: Date.now() - startTime
      });
    }
  } catch (error) {
    console.error('Error in cron learning-loop:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    });
  }
});

/**
 * GET /api/cron/health
 * Health check for cron system
 */
router.get('/health', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'healthy',
      endpoints: [
        { name: 'optimize', method: 'POST', description: 'Run scheduled optimization' },
        { name: 'learning-loop', method: 'POST', description: 'Run full learning loop' }
      ]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

export default router;
