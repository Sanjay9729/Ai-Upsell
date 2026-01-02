import { json } from "@remix-run/node";
import crypto from "crypto";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";

/**
 * Shopify App Proxy Handler for Cart Page
 * Handles requests from cart page via /apps/ai-upsell/cart proxy
 *
 * URL Format: /apps/ai-upsell/cart?ids=["gid://shopify/Product/123", "gid://shopify/Product/456"]
 * Maps to: /api/proxy/cart?ids=...&shop={shop}&...
 */

function verifyProxySignature(query) {
  const { signature, ...params } = query;

  if (!signature) {
    return false;
  }

  // Sort parameters and create query string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('');

  // Calculate HMAC
  const calculatedSignature = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest('hex');

  return calculatedSignature === signature;
}

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);

    // Verify the request is from Shopify
    if (!verifyProxySignature(params)) {
      return json({ error: "Invalid signature" }, { status: 401 });
    }

    const shop = params.shop;
    const productGidsJson = params.ids; // Format: JSON array of GIDs

    if (!shop || !productGidsJson) {
      return json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Parse the product IDs array
    let productGids;
    try {
      productGids = JSON.parse(productGidsJson);
    } catch (error) {
      return json({ error: "Invalid product IDs format" }, { status: 400 });
    }

    if (!Array.isArray(productGids) || productGids.length === 0) {
      return json({
        success: true,
        recommendations: [],
        count: 0,
        message: "Empty cart - no recommendations"
      });
    }

    // Extract numeric product IDs from GIDs
    const productIds = productGids
      .map(gid => {
        const match = gid.match(/Product\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter(id => id !== null);

    if (productIds.length === 0) {
      return json({ error: "No valid product IDs found" }, { status: 400 });
    }

    console.log(`🛒 Cart-based recommendations for ${productIds.length} products`);

    // Initialize Groq AI Engine
    const aiEngine = new GroqAIEngine();

    // Get AI-powered cart upsell recommendations
    const recommendations = await aiEngine.findCartUpsellProducts(shop, productIds, 4);

    // Format response for frontend
    const formattedRecommendations = recommendations.map(product => ({
      id: product.productId,
      title: product.title,
      handle: product.handle,
      price: product.aiData?.price || "0",
      image: product.images?.[0]?.src || product.image?.src || "",
      reason: product.aiReason,
      confidence: product.confidence,
      type: product.recommendationType,
      url: `/products/${product.handle}`
    }));

    // Return response in Liquid-compatible format
    return json({
      success: true,
      cartProductIds: productIds,
      shop,
      recommendations: formattedRecommendations,
      count: formattedRecommendations.length
    }, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });

  } catch (error) {
    console.error("❌ Error in cart proxy:", error);
    return json({
      success: false,
      error: error.message,
      recommendations: []
    }, {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
};
