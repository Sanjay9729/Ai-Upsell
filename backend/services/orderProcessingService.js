/**
 * Order Processing Service
 *
 * Handles Shopify order webhooks and logs purchase events with revenue attribution.
 * For each line item in an order, checks if it was an upsell and logs:
 *   - Purchase event
 *   - AOV impact
 *   - Revenue attribution
 */

import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';

/**
 * processPurchaseEvent(shopId, orderPayload)
 *
 * Main entry point for order webhook processing.
 * Returns { upsellsAttributed: N, purchases: [...] }
 */
export async function processPurchaseEvent(shopId, orderPayload) {
  try {
    const db = await getDb();
    const orderId = orderPayload.id;
    const orderValue = parseFloat(orderPayload.total_price || 0);
    const lineItems = Array.isArray(orderPayload.line_items) ? orderPayload.line_items : [];

    if (lineItems.length === 0) {
      console.log(`⚠️ Order ${orderId} has no line items`);
      return { upsellsAttributed: 0, purchases: [] };
    }

    // Check each line item against upsell events from the last 6 hours
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const purchases = [];

    for (const lineItem of lineItems) {
      const productId = String(lineItem.product_id || '');
      const variantId = String(lineItem.variant_id || '');
      const title = lineItem.title || '';
      const quantity = Number(lineItem.quantity || 1);
      const price = parseFloat(lineItem.price || 0);
      const lineTotal = price * quantity;

      // Find matching upsell event
      const upsellEvent = await db
        .collection(collections.upsellEvents)
        .findOne(
          {
            shopId,
            upsellProductId: productId,
            eventType: 'cart_add',
            timestamp: { $gte: sixHoursAgo }
          },
          { sort: { timestamp: -1 } } // Most recent
        );

      if (upsellEvent) {
        // This product was an upsell! Log the purchase
        const purchaseEvent = {
          eventType: 'purchase',
          shopId,
          orderId: String(orderId),
          sourceProductId: upsellEvent.sourceProductId || null,
          upsellProductId: productId,
          upsellProductName: title,
          variantId,
          quantity,
          price,
          lineTotal,
          orderValue,
          customerId: orderPayload.customer?.id
            ? String(orderPayload.customer.id)
            : null,
          sessionId: upsellEvent.sessionId || null,
          recommendationType: upsellEvent.recommendationType || null,
          confidence: upsellEvent.confidence || null,
          metadata: {
            location: upsellEvent.metadata?.location || 'unknown',
            referrer: upsellEvent.metadata?.referrer || null,
            userAgent: upsellEvent.metadata?.userAgent || null,
            ipAddress: orderPayload.client_ip_address || null
          },
          isUpsellEvent: true,
          purchaseTimestamp: new Date(orderPayload.created_at || new Date()),
          cartAddTimestamp: upsellEvent.timestamp,
          timeToPurchase: new Date(orderPayload.created_at || new Date()) - upsellEvent.timestamp,
          timestamp: new Date()
        };

        const result = await db
          .collection(collections.purchaseEvents)
          .insertOne(purchaseEvent);

        logger.logDatabase('insert', 'purchaseEvents', {
          shopId,
          orderId,
          upsellProductId: productId,
          eventId: result.insertedId
        });

        purchases.push(purchaseEvent);

        console.log(
          `🎉 Purchase attributed: Product ${productId} (${title}) in order ${orderId}`
        );
      }
    }

    // Log AOV impact for this order
    if (purchases.length > 0) {
      const upsellRevenue = purchases.reduce((sum, p) => sum + p.lineTotal, 0);
      await logAOVImpact(shopId, {
        orderId,
        orderValue,
        upsellRevenue,
        upsellCount: purchases.length,
        purchases
      });
    }

    return {
      upsellsAttributed: purchases.length,
      purchases
    };
  } catch (error) {
    console.error('❌ Error processing purchase event:', error);
    logger.logDatabase('insert', 'purchaseEvents', {
      error: error.message,
      shopId
    });
    throw error;
  }
}

/**
 * logAOVImpact(shopId, { orderId, orderValue, upsellRevenue, upsellCount, purchases })
 *
 * Logs AOV impact data for analytics and learning loop.
 * Used to calculate AOV lift.
 */
async function logAOVImpact(shopId, { orderId, orderValue, upsellRevenue, upsellCount, purchases }) {
  try {
    const db = await getDb();

    const aovRecord = {
      shopId,
      orderId: String(orderId),
      orderValue,
      upsellRevenue,
      upsellCount,
      aovContribution: (upsellRevenue / orderValue) * 100, // % of order value
      upsellProductIds: purchases.map(p => p.upsellProductId),
      timestamp: new Date()
    };

    await db.collection(collections.aovImpact).insertOne(aovRecord);

    console.log(`📈 AOV impact logged: $${upsellRevenue} of $${orderValue}`);
  } catch (error) {
    console.error('⚠️ Error logging AOV impact:', error);
  }
}

/**
 * getAOVLift(shopId, options = {})
 *
 * Calculate AOV lift from upsell events over a period.
 * Returns: { averageAOV, averageUpsellRevenue, liftPercent, ordersAnalyzed }
 */
export async function getAOVLift(
  shopId,
  { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate = new Date() } = {}
) {
  try {
    const db = await getDb();

    const aovData = await db
      .collection(collections.aovImpact)
      .find({
        shopId,
        timestamp: { $gte: startDate, $lte: endDate }
      })
      .toArray();

    if (aovData.length === 0) {
      return {
        averageAOV: 0,
        averageUpsellRevenue: 0,
        liftPercent: 0,
        ordersAnalyzed: 0,
        period: { startDate, endDate }
      };
    }

    const totalOrderValue = aovData.reduce((sum, r) => sum + r.orderValue, 0);
    const totalUpsellRevenue = aovData.reduce((sum, r) => sum + r.upsellRevenue, 0);
    const averageAOV = totalOrderValue / aovData.length;
    const averageUpsellRevenue = totalUpsellRevenue / aovData.length;
    const liftPercent = (averageUpsellRevenue / averageAOV) * 100;

    return {
      averageAOV: Math.round(averageAOV * 100) / 100,
      averageUpsellRevenue: Math.round(averageUpsellRevenue * 100) / 100,
      liftPercent: Math.round(liftPercent * 100) / 100,
      ordersAnalyzed: aovData.length,
      period: { startDate, endDate }
    };
  } catch (error) {
    console.error('❌ Error calculating AOV lift:', error);
    return {
      averageAOV: 0,
      averageUpsellRevenue: 0,
      liftPercent: 0,
      ordersAnalyzed: 0,
      error: error.message
    };
  }
}

/**
 * getRevenueAttributionByProduct(shopId, options = {})
 *
 * Breakdown: Which upsell products drove the most revenue?
 */
export async function getRevenueAttributionByProduct(
  shopId,
  { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate = new Date() } = {}
) {
  try {
    const db = await getDb();

    const attribution = await db
      .collection(collections.purchaseEvents)
      .aggregate([
        {
          $match: {
            shopId,
            eventType: 'purchase',
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$upsellProductId',
            productName: { $first: '$upsellProductName' },
            totalRevenue: { $sum: '$lineTotal' },
            totalQuantity: { $sum: '$quantity' },
            purchaseCount: { $sum: 1 },
            avgPrice: { $avg: '$price' }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 20 }
      ])
      .toArray();

    return {
      success: true,
      attribution,
      period: { startDate, endDate }
    };
  } catch (error) {
    console.error('❌ Error getting revenue attribution:', error);
    return {
      success: false,
      attribution: [],
      error: error.message
    };
  }
}

/**
 * getRevenueAttributionByOfferType(shopId, options = {})
 *
 * Breakdown: Which offer types (bundle, addon, volume) drove revenue?
 */
export async function getRevenueAttributionByOfferType(
  shopId,
  { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate = new Date() } = {}
) {
  try {
    const db = await getDb();

    const attribution = await db
      .collection(collections.purchaseEvents)
      .aggregate([
        {
          $match: {
            shopId,
            eventType: 'purchase',
            timestamp: { $gte: startDate, $lte: endDate },
            recommendationType: { $ne: null }
          }
        },
        {
          $group: {
            _id: '$recommendationType',
            totalRevenue: { $sum: '$lineTotal' },
            totalQuantity: { $sum: '$quantity' },
            purchaseCount: { $sum: 1 },
            avgPrice: { $avg: '$price' }
          }
        },
        { $sort: { totalRevenue: -1 } }
      ])
      .toArray();

    return {
      success: true,
      attribution,
      period: { startDate, endDate }
    };
  } catch (error) {
    console.error('❌ Error getting revenue attribution by type:', error);
    return {
      success: false,
      attribution: [],
      error: error.message
    };
  }
}

/**
 * getPurchaseConversionRate(shopId, options = {})
 *
 * From cart_add → purchase. What % of upsells actually convert to orders?
 */
export async function getPurchaseConversionRate(
  shopId,
  { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate = new Date() } = {}
) {
  try {
    const db = await getDb();

    const cartAdds = await db
      .collection(collections.upsellEvents)
      .countDocuments({
        shopId,
        eventType: 'cart_add',
        timestamp: { $gte: startDate, $lte: endDate }
      });

    const purchases = await db
      .collection(collections.purchaseEvents)
      .countDocuments({
        shopId,
        eventType: 'purchase',
        timestamp: { $gte: startDate, $lte: endDate }
      });

    const conversionRate = cartAdds > 0 ? (purchases / cartAdds) * 100 : 0;

    return {
      success: true,
      cartAdds,
      purchases,
      conversionRate: Math.round(conversionRate * 100) / 100,
      period: { startDate, endDate }
    };
  } catch (error) {
    console.error('❌ Error calculating purchase conversion rate:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
