import { json } from '@remix-run/node';
import { processPurchaseEvent } from "../../backend/services/orderProcessingService.js";

/**
 * POST /webhooks/orders/created
 *
 * Called from the PostPurchase checkout extension on the thank-you page.
 * Receives order data and attributes any upsell purchases to purchase_events.
 *
 * Body: { shopId, orderId, totalPrice, lineItems: [{ product_id, variant_id, title, price, quantity }], createdAt }
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const action = async ({ request }) => {
  // Handle CORS preflight from checkout extension
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { shopId, orderId, totalPrice, lineItems, customerId, createdAt } = body;

    console.log('[orders/created] Received:', { shopId, orderId, lineItemCount: lineItems?.length, lineItems: JSON.stringify(lineItems) });

    if (!shopId || !orderId) {
      console.log('[orders/created] Missing fields:', { shopId, orderId });
      return json({ error: 'Missing required fields: shopId, orderId' }, { status: 400 });
    }

    const orderPayload = {
      id: orderId,
      total_price: totalPrice,
      line_items: lineItems,
      customer: customerId ? { id: customerId } : null,
      created_at: createdAt || new Date().toISOString(),
    };

    const result = await processPurchaseEvent(shopId, orderPayload);

    return json({
      success: true,
      upsellsAttributed: result.upsellsAttributed,
    }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('Error processing purchase event:', error);
    return json({ error: error.message }, { status: 500, headers: CORS_HEADERS });
  }
};

export const loader = async () => {
  return json({ status: 'ok' });
};
