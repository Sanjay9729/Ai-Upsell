import { authenticate } from "../shopify.server";
import { getDb } from "../../backend/database/connection.js";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  // Clean up MongoDB data when app is uninstalled
  if (shop) {
    try {
      const db = await getDb();

      // Delete all products for this shop
      const productsResult = await db.collection('products').deleteMany({ shopId: shop });
      console.log(`🗑️ Deleted ${productsResult.deletedCount} products for shop ${shop}`);

      console.log(`✅ Cleanup completed for shop ${shop}`);
    } catch (error) {
      console.error(`❌ Error cleaning up MongoDB data:`, error);
    }
  }

  return new Response();
};
