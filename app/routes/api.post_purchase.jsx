import { json } from "@remix-run/node";
import { getDb, collections } from "../../backend/database/mongodb.js";

/**
 * Public debug API: /api/post_purchase
 *
 * GET /api/post_purchase
 *   All purchase_events records.
 *
 * GET /api/post_purchase?shopId=store.myshopify.com
 *   Filter by shop.
 *
 * GET /api/post_purchase?shopId=...&type=aov
 *   AOV impact records from aov_impact collection.
 *
 * GET /api/post_purchase?shopId=...&type=cart_adds
 *   Offer acceptances on the thank-you page (upsell_events with location=post_purchase).
 *
 * GET /api/post_purchase?shopId=...&limit=50
 *   Limit number of results (max 500, default 100).
 */
export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const shopId = url.searchParams.get("shopId");
    const type = url.searchParams.get("type") || "events";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);

    const db = await getDb();
    const shopFilter = shopId ? { shopId } : {};

    if (type === "aov") {
      const docs = await db
        .collection(collections.aovImpact)
        .find(shopFilter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return json({
        success: true,
        type: "aov_impact",
        count: docs.length,
        data: docs,
        timestamp: new Date().toISOString(),
      }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (type === "cart_adds") {
      const docs = await db
        .collection(collections.upsellEvents)
        .find({
          ...shopFilter,
          eventType: "cart_add",
          "metadata.location": "post_purchase",
        })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return json({
        success: true,
        type: "post_purchase_cart_adds",
        count: docs.length,
        data: docs,
        timestamp: new Date().toISOString(),
      }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // Default: purchase_events
    const docs = await db
      .collection(collections.purchaseEvents)
      .find(shopFilter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return json({
      success: true,
      type: "purchase_events",
      count: docs.length,
      data: docs,
      timestamp: new Date().toISOString(),
    }, { headers: { "Access-Control-Allow-Origin": "*" } });

  } catch (error) {
    console.error("Error in post_purchase API:", error);
    return json({
      success: false,
      message: "Failed to fetch post-purchase data from MongoDB",
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
};

export const OPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};
