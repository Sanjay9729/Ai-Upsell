import { authenticate } from "../shopify.server";
import { getDb } from "../../backend/database/connection.js";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  if (shop) {
    try {
      const db = await getDb();

      // Delete all products for this shop
      const productsResult = await db.collection('products').deleteMany({ shopId: shop });
      console.log(`🗑️ Deleted ${productsResult.deletedCount} products for shop ${shop}`);

      // Delete all sessions for this shop from shopify_sessions
      const sessionsResult = await db.collection('shopify_sessions').deleteMany({
        _id: { $regex: shop.replace(/\./g, '\\.') }
      });
      console.log(`🗑️ Deleted ${sessionsResult.deletedCount} sessions for shop ${shop}`);

      console.log(`✅ Cleanup completed for shop ${shop}`);
    } catch (error) {
      console.error(`❌ Error cleaning up MongoDB data:`, error);
    }
  }

  return new Response();
};
