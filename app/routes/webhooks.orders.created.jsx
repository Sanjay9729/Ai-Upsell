import { json } from '@remix-run/node';
import { processPurchaseEvent } from "../../backend/services/orderProcessingService.js";

/**
 * API Route: POST /api/purchase-event
 * 
 * Accepts manual purchase event tracking from frontend/checkout.
 * Since orders/create webhook requires protected data approval,
 * we track purchases via frontend API instead.
 * 
 * Request body:
 * {
 *   orderId: string,
 *   totalPrice: number,
 *   lineItems: [{ productId, variantId, title, price, quantity }],
 *   customerId?: string,
 *   createdAt?: string
 * }
 */
export async function action({ request }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { orderId, totalPrice, lineItems, customerId, createdAt, shopId } = 
      await request.json();

    if (!shopId || !orderId || !lineItems) {
      return json(
        { error: 'Missing required fields: shopId, orderId, lineItems' },
        { status: 400 }
      );
    }

    // Mock order payload for compatibility with processPurchaseEvent
    const orderPayload = {
      id: orderId,
      total_price: totalPrice,
      line_items: lineItems,
      customer: customerId ? { id: customerId } : null,
      created_at: createdAt || new Date().toISOString(),
      client_ip_address: request.headers.get('x-forwarded-for') || 'unknown'
    };

    console.log(`📦 Manual purchase event: Order ${orderId}, Total: $${totalPrice}`);

    const result = await processPurchaseEvent(shopId, orderPayload);
    
    return json({
      success: true,
      upsellsAttributed: result.upsellsAttributed,
      purchases: result.purchases
    });
  } catch (error) {
    console.error('❌ Error processing purchase event:', error);
    return json(
      { error: error.message },
      { status: 500 }
    );
  }
}
