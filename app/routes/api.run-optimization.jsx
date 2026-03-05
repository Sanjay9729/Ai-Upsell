import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * POST /api/run-optimization
 *
 * Manually triggers the optimization engine for the current shop.
 * Used by the admin dashboard to run optimization on-demand.
 * Requires admin authentication.
 */
export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  try {
    const { optimizeForShop } = await import("../../backend/services/optimizationEngine.js");
    const result = await optimizeForShop(shopId);

    return json({
      success: result.success,
      shopId,
      reason: result.reason || null,
      error: result.error || null,
      optimization: result.optimization || null
    });
  } catch (error) {
    console.error("❌ Manual optimization failed:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};

export const loader = async () => {
  return json({ status: "ok", message: "POST to this route to run optimization" });
};
