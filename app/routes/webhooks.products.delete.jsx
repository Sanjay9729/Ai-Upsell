import { authenticate } from "../shopify.server";
import { deleteProduct } from "../../backend/database/collections.js";

export const action = async ({ request }) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  if (session && payload) {
    try {
      // Delete the product from MongoDB
      await deleteProduct(shop, payload.id.toString());
      console.log(`✅ Product ${payload.id} deleted from MongoDB`);
    } catch (error) {
      console.error(`❌ Error deleting product from MongoDB:`, error);
    }
  }

  return new Response();
};
