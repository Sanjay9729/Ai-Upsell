import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';

/**
 * Track an upsell event (cart addition, click, view, etc.)
 */
export async function trackUpsellEvent({
  eventType,
  shopId,
  sourceProductId,
  sourceProductName = null,
  upsellProductId,
  upsellProductName = null,
  variantId,
  customerId = null,
  sessionId = null,
  recommendationType = null,
  confidence = null,
  quantity = 1,
  metadata = {}
}) {
  try {
    const db = await getDb();
    const event = {
      eventType,
      shopId,
      sourceProductId: sourceProductId?.toString(),
      sourceProductName,
      upsellProductId: upsellProductId?.toString(),
      upsellProductName,
      variantId: variantId?.toString(),
      customerId,
      sessionId,
      recommendationType,
      confidence,
      quantity,
      metadata,
      isUpsellEvent: true, // ← NEW: Clear identifier for upsell events
      timestamp: new Date()
    };

    const result = await db.collection(collections.upsellEvents).insertOne(event);

    logger.logDatabase('insert', 'upsellEvents', {
      shopId,
      eventType,
      sourceProductId,
      upsellProductId,
      eventId: result.insertedId
    });

    return { success: true, eventId: result.insertedId };
  } catch (error) {
    console.error('Error tracking upsell event:', error);
    logger.logDatabase('insert', 'upsellEvents', { error: error.message, shopId });
    return { success: false, error: error.message };
  }
}

/**
 * Get analytics for a specific shop
 */
export async function getUpsellAnalytics(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default: last 30 days
      endDate = new Date(),
      eventType = null,
      sourceProductId = null,
      limit = 1000,
      includeNonUpsell = false // NEW: Only include upsell events by default
    } = options;

    const query = {
      shopId,
      timestamp: { $gte: startDate, $lte: endDate }
    };

    // Only include upsell events by default
    if (!includeNonUpsell) {
      query.isUpsellEvent = true;
    }

    if (eventType) {
      query.eventType = eventType;
    }

    if (sourceProductId) {
      query.sourceProductId = sourceProductId.toString();
    }

    const events = await db.collection(collections.upsellEvents)
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return { success: true, events, count: events.length };
  } catch (error) {
    console.error('Error getting upsell analytics:', error);
    return { success: false, error: error.message, events: [], count: 0 };
  }
}

/**
 * Get aggregated statistics for upsell performance
 */
export async function getUpsellStats(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate = new Date(),
      includeNonUpsell = false // NEW: Only include upsell events by default
    } = options;

    const matchStage = {
      shopId,
      timestamp: { $gte: startDate, $lte: endDate }
    };

    // Only include upsell events by default
    if (!includeNonUpsell) {
      matchStage.isUpsellEvent = true;
    }

    // Overall stats
    const overallStats = await db.collection(collections.upsellEvents).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      }
    ]).toArray();

    // Top performing upsell products
    const topUpsellProducts = await db.collection(collections.upsellEvents).aggregate([
      { $match: { ...matchStage, eventType: 'cart_add' } },
      {
        $group: {
          _id: '$upsellProductId',
          addToCartCount: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      },
      { $sort: { addToCartCount: -1 } },
      { $limit: 10 }
    ]).toArray();

    // Top source products that drive upsells
    const topSourceProducts = await db.collection(collections.upsellEvents).aggregate([
      { $match: { ...matchStage, eventType: 'cart_add' } },
      {
        $group: {
          _id: '$sourceProductId',
          addToCartCount: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      },
      { $sort: { addToCartCount: -1 } },
      { $limit: 10 }
    ]).toArray();

    // Performance by recommendation type
    const performanceByType = await db.collection(collections.upsellEvents).aggregate([
      { $match: { ...matchStage, eventType: 'cart_add', recommendationType: { $ne: null } } },
      {
        $group: {
          _id: '$recommendationType',
          count: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Daily trend
    const dailyTrend = await db.collection(collections.upsellEvents).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]).toArray();

    return {
      success: true,
      stats: {
        overall: overallStats,
        topUpsellProducts,
        topSourceProducts,
        performanceByType,
        dailyTrend,
        period: {
          startDate,
          endDate
        }
      }
    };
  } catch (error) {
    console.error('Error getting upsell stats:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get conversion rate for upsells
 */
export async function getConversionRate(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate = new Date(),
      sourceProductId = null,
      includeNonUpsell = false // NEW: Only include upsell events by default
    } = options;

    const matchStage = {
      shopId,
      timestamp: { $gte: startDate, $lte: endDate }
    };

    // Only include upsell events by default
    if (!includeNonUpsell) {
      matchStage.isUpsellEvent = true;
    }

    if (sourceProductId) {
      matchStage.sourceProductId = sourceProductId.toString();
    }

    const stats = await db.collection(collections.upsellEvents).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const clicks = stats.find(s => s._id === 'click')?.count || 0;
    const cartAdds = stats.find(s => s._id === 'cart_add')?.count || 0;
    const views = stats.find(s => s._id === 'view')?.count || 0;

    return {
      success: true,
      conversionRate: {
        views,
        clicks,
        cartAdds,
        clickThroughRate: views > 0 ? (clicks / views * 100).toFixed(2) : 0,
        addToCartRate: clicks > 0 ? (cartAdds / clicks * 100).toFixed(2) : 0,
        overallConversionRate: views > 0 ? (cartAdds / views * 100).toFixed(2) : 0
      }
    };
  } catch (error) {
    console.error('Error calculating conversion rate:', error);
    return { success: false, error: error.message };
  }
}
