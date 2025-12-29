import { json } from "@remix-run/node";
import crypto from "crypto";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";

/**
 * Shopify App Proxy Handler
 * Handles requests from storefront via /apps/ai-upsell proxy
 *
 * URL Format: /apps/ai-upsell?id=gid://shopify/Product/{productId}
 * Maps to: /api/proxy?id=gid://shopify/Product/{productId}&shop={shop}&...
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
    const productGid = params.id; // Format: gid://shopify/Product/{id}

    if (!shop || !productGid) {
      return json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Extract numeric product ID from GID
    const productIdMatch = productGid.match(/Product\/(\d+)/);
    if (!productIdMatch) {
      return json({ error: "Invalid product ID format" }, { status: 400 });
    }

    // Convert to number to match MongoDB storage format
    const productId = parseInt(productIdMatch[1], 10);

    console.log(`🔍 Looking for product ID: ${productId} (type: ${typeof productId})`);

    // Initialize Groq AI Engine
    const aiEngine = new GroqAIEngine();

    // Get AI-powered upsell recommendations
    const recommendations = await aiEngine.findUpsellProducts(shop, productId, 4);

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
      productId,
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
    console.error("❌ Error in app proxy:", error);
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
