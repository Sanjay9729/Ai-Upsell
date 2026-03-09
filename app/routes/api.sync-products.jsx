import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { syncProductsWithGraphQL } from "../../backend/database/collections.js";

export const action = async ({ request }) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    console.log(`[sync-products] Starting full product sync for ${shop}`);

    const result = await syncProductsWithGraphQL(shop, admin.graphql);
    const count = typeof result === "number" ? result : result?.count ?? 0;

    console.log(`[sync-products] Sync complete: ${count} products synced for ${shop}`);

    return json({ success: true, count });
  } catch (err) {
    console.error("[sync-products] Error:", err);
    return json({ success: false, error: err.message }, { status: 500 });
  }
};
