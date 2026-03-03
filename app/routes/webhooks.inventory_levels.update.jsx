import { authenticate } from "../shopify.server";
import { ProductService } from "../../backend/services/productService.js";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  if (payload) {
    const inventoryItemId = payload.inventory_item_id;
    const available = payload.available;

    try {
      const productService = new ProductService();
      const result = await productService.updateInventoryByInventoryItemId(
        shop,
        inventoryItemId,
        available
      );

      if (result.matchedCount === 0) {
        console.warn(
          `⚠️ No product variant found for inventoryItemId ${inventoryItemId} (shop ${shop})`
        );
      }
    } catch (error) {
      console.error("❌ Error updating inventory from webhook:", error);
    }
  }

  return new Response();
};
