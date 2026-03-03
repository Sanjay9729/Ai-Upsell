import { json } from "@remix-run/node";
import { getDb, collections } from "../../backend/database/mongodb.js";

/**
 * Public debug API: /api/merchant_intelligence?shopId=...
 * Mirrors server.js endpoint so it works with `shopify app dev`.
 */
export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const shopId = url.searchParams.get("shopId");

    const db = await getDb();
    const filter = shopId ? { shopId } : {};
    const docs = await db.collection(collections.merchantIntelligence)
      .find(filter)
      .sort({ updatedAt: -1 })
      .toArray();

    return json({
      success: true,
      count: docs.length,
      merchant_intelligence: docs,
      timestamp: new Date().toISOString()
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    console.error("Error in merchant_intelligence API (Remix):", error);
    return json({
      success: false,
      message: "Failed to fetch merchant intelligence from MongoDB",
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
};

export const OPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
};

