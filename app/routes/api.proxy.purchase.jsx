import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { processPurchaseEvent } from '../../backend/services/orderProcessingService.js';

/**
 * App Proxy: POST /apps/ai-upsell/purchase
 *
 * Called from the Shopify order status page "Additional Scripts" section.
 * Shopify.checkout is available there with full order data.
 * The app proxy automatically provides the shop domain via query params.
 */
export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shopId = session?.shop;

    if (!shopId) {
      return json({ error: 'Could not identify shop' }, { status: 400 });
    }

    const body = await request.json();
    const { orderId, totalPrice, lineItems } = body;

    console.log('[proxy/purchase] Received from order status page:', { shopId, orderId, lineItemCount: lineItems?.length });

    if (!orderId || !lineItems?.length) {
      return json({ error: 'Missing orderId or lineItems' }, { status: 400 });
    }

    const orderPayload = {
      id: String(orderId),
      total_price: String(totalPrice || '0'),
      line_items: lineItems.map(item => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        title: item.title || '',
        price: String(item.price || '0'),
        quantity: Number(item.quantity || 1),
      })),
      created_at: new Date().toISOString(),
    };

    const result = await processPurchaseEvent(shopId, orderPayload);

    console.log('[proxy/purchase] Done:', { shopId, orderId, upsellsAttributed: result.upsellsAttributed });

    return json({ success: true, upsellsAttributed: result.upsellsAttributed }, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  } catch (error) {
    console.error('[proxy/purchase] Error:', error.message);
    return json({ error: error.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
};

export const loader = async () => {
  return json({ status: 'ok' });
};
