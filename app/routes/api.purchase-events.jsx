/**
 * API Route: Purchase Events Analytics
 *
 * GET /api/purchase-events
 *   Get all purchase events for the current shop
 *
 * GET /api/purchase-events/aov-lift
 *   Calculate AOV lift from upsell conversions
 *
 * GET /api/purchase-events/revenue-attribution
 *   Breakdown revenue by product/offer type
 *
 * GET /api/purchase-events/conversion-rate
 *   Calculate cart-add to purchase conversion rate
 */

import { authenticate } from '../shopify.server.js';
import {
  getAOVLift,
  getRevenueAttributionByProduct,
  getRevenueAttributionByOfferType,
  getPurchaseConversionRate
} from '../../backend/services/orderProcessingService.js';
import { getDb, collections } from '../../backend/database/mongodb.js';

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const shopData = await admin.graphql(`query { shop { myshopifyDomain } }`);
  const shopId = shopData.data?.shop?.myshopifyDomain;

  if (!shopId) {
    return new Response(JSON.stringify({ error: 'No shop found' }), { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'list';

  try {
    if (action === 'aov-lift') {
      const result = await getAOVLift(shopId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (action === 'revenue-by-product') {
      const result = await getRevenueAttributionByProduct(shopId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (action === 'revenue-by-type') {
      const result = await getRevenueAttributionByOfferType(shopId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (action === 'conversion-rate') {
      const result = await getPurchaseConversionRate(shopId);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default: list all purchase events
    const db = await getDb();
    const events = await db
      .collection(collections.purchaseEvents)
      .find({ shopId })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    return new Response(JSON.stringify({ success: true, events, count: events.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('❌ Error fetching purchase events:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
