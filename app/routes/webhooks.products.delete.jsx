import { authenticate } from "../shopify.server";
import { deleteProduct } from "../../backend/database/collections.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  if (payload) {
    try {
      const productId = payload.id;
      const shopId = shop;
      
      console.log(`🗑️ Attempting to delete product ${productId} for shop ${shopId}`);
      
      // Delete the product from MongoDB
      const deleteResult = await deleteProduct(shopId, productId.toString());
      
      console.log(`✅ Product ${productId} deletion result:`, {
        acknowledged: deleteResult.acknowledged,
        deletedCount: deleteResult.deletedCount
      });
      
      if (deleteResult.deletedCount === 0) {
        console.log(`⚠️ Product ${productId} was not found in database (may have already been deleted)`);
      }
      
    } catch (error) {
      console.error(`❌ Error deleting product from MongoDB:`, error);
    }
  }

  return new Response();
};
