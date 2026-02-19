import { authenticate } from "../shopify.server";
import { upsertProductFromWebhookPayload } from "../../backend/database/collections.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  if (payload) {
    try {
      await upsertProductFromWebhookPayload(shop, payload);
      console.log(`✅ Product ${payload.id} updated in MongoDB`);
    } catch (error) {
      console.error(`❌ Error updating product in MongoDB:`, error);
    }
  }

  return new Response();
};
