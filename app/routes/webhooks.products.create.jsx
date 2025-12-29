import { authenticate } from "../shopify.server";
import { syncProductsToMongoDB } from "../../backend/database/collections.js";

export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  if (session) {
    try {
      // Sync all products when a new product is created
      await syncProductsToMongoDB(shop, session.accessToken);
      console.log(`✅ Products synced to MongoDB after product creation`);
    } catch (error) {
      console.error(`❌ Error syncing products to MongoDB:`, error);
    }
  }

  return new Response();
};
