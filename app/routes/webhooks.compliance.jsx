import { authenticate } from "../shopify.server";
import { getDb } from "../../backend/database/connection.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Customer requested their data. This app stores no personal customer data.
      break;

    case "CUSTOMERS_REDACT":
      // Customer requested deletion of their data. This app stores no personal customer data.
      break;

    case "SHOP_REDACT":
      // Fired 48 hours after shop uninstalls. Delete all shop data.
      try {
        const db = await getDb();

        const productsResult = await db.collection("products").deleteMany({ shopId: shop });
        console.log(`Deleted ${productsResult.deletedCount} products for shop ${shop}`);

        const sessionsResult = await db.collection("shopify_sessions").deleteMany({
          _id: { $regex: shop.replace(/\./g, "\\.") },
        });
        console.log(`Deleted ${sessionsResult.deletedCount} sessions for shop ${shop}`);
      } catch (error) {
        console.error(`Error redacting shop data for ${shop}:`, error);
      }
      break;

    default:
      console.warn(`Unhandled compliance topic: ${topic}`);
  }

  return new Response();
};
