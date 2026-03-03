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
  console.log('🔔 webhooks.orders.created received:', request.method);
  
  if (request.method !== 'POST') {
    console.log('❌ Wrong method:', request.method);
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    console.log('📥 Request body:', JSON.stringify(body));
    
    const { orderId, totalPrice, lineItems, customerId, createdAt, shopId } = body;

    if (!shopId || !orderId || !lineItems) {
      console.log('❌ Missing fields. shopId:', shopId, 'orderId:', orderId, 'lineItems:', lineItems);
      return new Response(
        JSON.stringify({ error: 'Missing required fields: shopId, orderId, lineItems' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('✅ Valid request. Processing:', { shopId, orderId, itemCount: lineItems.length });

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

    console.log('📦 Processing order:', orderId);
    const result = await processPurchaseEvent(shopId, orderPayload);
    
    console.log('✅ Order processed. Upsells attributed:', result.upsellsAttributed);
    
    return new Response(
      JSON.stringify({
        success: true,
        upsellsAttributed: result.upsellsAttributed,
        purchases: result.purchases
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error processing purchase event:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
