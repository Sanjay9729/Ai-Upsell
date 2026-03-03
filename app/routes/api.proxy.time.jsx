import { json } from "@remix-run/node";
import crypto from "crypto";
import { getDb, collections } from "../../backend/database/mongodb.js";
import { clearUserProductCache } from "../../backend/services/groqAIEngine.js";

/**
 * Shopify App Proxy – Time Tracking (Product + Cart Analytics)
 * Receives POST from storefront: /apps/ai-upsell/time
 * Maps to: /api/proxy/time
 *
 * Payload:
 *   Product: { context: "product", productId, productTitle, shop, timeSpentSeconds, userId }
 *   Cart:    { context: "cart", shop, timeSpentSeconds, userId, cartItemCount?, cartTotalPrice? }
 */

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function verifyProxySignature(query) {
  const { signature, ...params } = query;
  if (!signature) return false;

  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");

  const calculated = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest("hex");

  return calculated === signature;
}

// OPTIONS – preflight support
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return json({ status: "ok", message: "Time tracking proxy active" }, { headers: CORS_HEADERS });
};

export const action = async ({ request }) => {
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }

    // Verify Shopify proxy signature (warn only – same pattern as analytics route)
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    if (!verifyProxySignature(params)) {
      console.warn("⚠️ Time-tracking proxy: signature verification failed");
    }

    const body = await request.json();
    const {
      context,
      productId,
      productTitle,
      shop,
      timeSpentSeconds,
      userId,
      customerName,
      cartItemCount,
      cartTotalPrice,
      cartProductIds
    } = body;

    const isCart = context === "cart";

    if (!shop || timeSpentSeconds == null || (!isCart && !productId)) {
      return json(
        {
          success: false,
          error: isCart
            ? "Missing required fields: shop, timeSpentSeconds"
            : "Missing required fields: productId, shop, timeSpentSeconds"
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const seconds = Math.round(Number(timeSpentSeconds));
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) {
      return json(
        { success: false, error: "Invalid timeSpentSeconds value" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const db = await getDb();
    const recordedAt = new Date();

    if (isCart) {
      const record = {
        shop,
        timeSpentSeconds: seconds,
        userId: userId || null,
        customerName: (customerName && typeof customerName === 'string') ? customerName.trim().slice(0, 100) : null,
        recordedAt
      };

      const countNum = Number(cartItemCount);
      if (Number.isFinite(countNum) && countNum >= 0) {
        record.cartItemCount = Math.floor(countNum);
      }

      const totalNum = Number(cartTotalPrice);
      if (Number.isFinite(totalNum) && totalNum >= 0) {
        record.cartTotalPrice = Math.round(totalNum);
      }

      if (Array.isArray(cartProductIds) && cartProductIds.length > 0) {
        record.cartProductIds = cartProductIds
          .map(id => Number(id))
          .filter(id => Number.isFinite(id) && id > 0);
      }

      await db.collection(collections.cartTimeEvents).insertOne(record);
      console.log(`🧺 Cart time tracked: shop=${shop} seconds=${seconds} userId=${userId || 'anonymous'} products=${record.cartProductIds?.length || 0}`);
    } else {
      const record = {
        shop,
        productId: String(productId),
        productTitle: productTitle || null,
        timeSpentSeconds: seconds,
        userId: userId || null,
        recordedAt,
      };

      await db.collection(collections.productTimeEvents).insertOne(record);

      // Invalidate the recommendation cache for this user+product so the next
      // visit gets a fresh, profile-aware Groq call instead of a stale cached result
      if (userId) {
        clearUserProductCache(shop, productId, userId);
      }

      console.log(`⏱️ Time tracked: product=${productId} shop=${shop} seconds=${seconds} userId=${userId || 'anonymous'}`);
    }

    return json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("❌ Time tracking proxy error:", error);
    return json(
      { success: false, error: error.message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
