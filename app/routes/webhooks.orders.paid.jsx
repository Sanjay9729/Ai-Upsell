import { authenticate } from "../shopify.server";
import { processPurchaseEvent } from "../../backend/services/orderProcessingService.js";

/**
 * POST /webhooks/orders/paid
 *
 * Shopify native ORDERS_PAID webhook.
 * Fired by Shopify directly when an order is paid — reliable, no extension dependency.
 * Payload is Shopify's native snake_case order object.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[webhooks/orders/paid] topic=${topic} shop=${shop} orderId=${payload?.id} lineItems=${payload?.line_items?.length}`);

  try {
    const result = await processPurchaseEvent(shop, payload);
    console.log(`[webhooks/orders/paid] attributed=${result.upsellsAttributed} purchases`);
  } catch (err) {
    console.error('[webhooks/orders/paid] Error:', err.message);
  }

  return new Response(null, { status: 200 });
};
