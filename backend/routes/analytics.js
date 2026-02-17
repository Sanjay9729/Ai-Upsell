import express from 'express';
import {
  trackUpsellEvent,
  getUpsellAnalytics,
  getUpsellStats,
  getConversionRate
} from '../services/analyticsService.js';
import { logger } from '../services/logger.js';

const router = express.Router();

/**
 * Track an upsell event
 * POST /api/analytics/track
 */
router.post('/track', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      eventType,
      shopId,
      sourceProductId,
      sourceProductName,
      upsellProductId,
      upsellProductName,
      variantId,
      customerId,
      sessionId,
      recommendationType,
      confidence,
      quantity,
      metadata
    } = req.body;

    // Validate required fields
    if (!eventType || !shopId || !upsellProductId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: eventType, shopId, upsellProductId'
      });
    }

    // Valid event types (only cart_add since we removed views)
    const validEventTypes = ['cart_add'];
    if (!validEventTypes.includes(eventType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid eventType. Only 'cart_add' events are allowed: ${validEventTypes.join(', ')}`
      });
    }

    // STRICT VALIDATION: Only allow events with clear upsell context
    if (!metadata || !metadata.location) {
      return res.status(400).json({
        success: false,
        error: 'UPSELL EVENTS ONLY: Events must include metadata.location (product_detail_page or cart_page)'
      });
    }

    const validLocations = ['product_detail_page', 'cart_page'];
    if (!validLocations.includes(metadata.location)) {
      return res.status(400).json({
        success: false,
        error: `Invalid location. Must be one of: ${validLocations.join(', ')}`
      });
    }

    const result = await trackUpsellEvent({
      eventType,
      shopId,
      sourceProductId,
      sourceProductName,
      upsellProductId,
      upsellProductName,
      variantId,
      customerId,
      sessionId,
      recommendationType,
      confidence,
      quantity: quantity || 1,
      metadata: metadata || {}
    });

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in track analytics endpoint:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get upsell events for a shop
 * GET /api/analytics/events/:shopId
 */
router.get('/events/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const {
      startDate,
      endDate,
      eventType,
      sourceProductId,
      limit
    } = req.query;

    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);
    if (eventType) options.eventType = eventType;
    if (sourceProductId) options.sourceProductId = sourceProductId;
    if (limit) options.limit = parseInt(limit);

    const result = await getUpsellAnalytics(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in get analytics events endpoint:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get aggregated statistics for a shop
 * GET /api/analytics/stats/:shopId
 */
router.get('/stats/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { startDate, endDate } = req.query;

    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    const result = await getUpsellStats(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in get analytics stats endpoint:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get conversion rate for a shop
 * GET /api/analytics/conversion/:shopId
 */
router.get('/conversion/:shopId', async (req, res) => {
  const startTime = Date.now();
  try {
    const { shopId } = req.params;
    const { startDate, endDate, sourceProductId } = req.query;

    const options = {};
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);
    if (sourceProductId) options.sourceProductId = sourceProductId;

    const result = await getConversionRate(shopId, options);

    logger.logRequest(req, res, Date.now() - startTime);
    res.json(result);
  } catch (error) {
    console.error('Error in get conversion rate endpoint:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Track upsell product interactions (for frontend compatibility)
 * POST /api/analytics/upsell
 */
router.post('/upsell', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      productId,
      shopId,
      upsellProductIds = [],
      clickedProductIds = [],
      timestamp
    } = req.body;

    // Validate required fields
    if (!productId || !shopId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: productId, shopId'
      });
    }

    const results = [];

    // Track views for all displayed upsell products
    for (const upsellProductId of upsellProductIds) {
      try {
        const result = await trackUpsellEvent({
          eventType: 'view',
          shopId,
          sourceProductId: productId,
          upsellProductId: upsellProductId,
          timestamp: timestamp ? new Date(timestamp) : new Date()
        });
        results.push({ productId: upsellProductId, type: 'view', result });
      } catch (error) {
        console.error(`Error tracking view for product ${upsellProductId}:`, error);
        results.push({ productId: upsellProductId, type: 'view', error: error.message });
      }
    }

    // Track clicks for clicked products
    for (const clickedProductId of clickedProductIds) {
      try {
        const result = await trackUpsellEvent({
          eventType: 'click',
          shopId,
          sourceProductId: productId,
          upsellProductId: clickedProductId,
          timestamp: timestamp ? new Date(timestamp) : new Date()
        });
        results.push({ productId: clickedProductId, type: 'click', result });
      } catch (error) {
        console.error(`Error tracking click for product ${clickedProductId}:`, error);
        results.push({ productId: clickedProductId, type: 'click', error: error.message });
      }
    }

    logger.logRequest(req, res, Date.now() - startTime);
    res.json({
      success: true,
      message: 'Upsell analytics tracked successfully',
      results,
      summary: {
        viewsTracked: upsellProductIds.length,
        clicksTracked: clickedProductIds.length
      }
    });
  } catch (error) {
    console.error('Error in upsell analytics endpoint:', error);
    logger.logRequest(req, { statusCode: 500 }, Date.now() - startTime);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
