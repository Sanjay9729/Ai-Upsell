import { json } from "@remix-run/node";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";

/**
 * API endpoint to get AI-powered upsell recommendations
 * GET /api/upsell/:productId?shop=shop-domain.myshopify.com
 *
 * Note: Inventory enrichment happens in apps.ai-upsell.jsx (the proxy route)
 * using authenticate.public.appProxy() for proper token management.
 */
export const loader = async ({ params, request }) => {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const { productId } = params;

    if (!shop) {
      return json({ error: "Shop parameter is required" }, { status: 400 });
    }

    if (!productId) {
      return json({ error: "Product ID is required" }, { status: 400 });
    }

    // Initialize Groq AI Engine
    const aiEngine = new GroqAIEngine();

    // Get AI-powered upsell recommendations
    const recommendations = await aiEngine.findUpsellProducts(
      shop,
      productId,
      4 // Number of recommendations
    );

    // Format response for frontend (inventory will be enriched by proxy route)
    const formattedRecommendations = recommendations.map(product => ({
      id: product.productId,
      title: product.title,
      handle: product.handle,
      price: product.aiData?.price || "0",
      image: product.images?.[0]?.src || product.image?.src || "",
      reason: product.aiReason,
      confidence: product.confidence,
      type: product.recommendationType,
      url: `https://${shop}/products/${product.handle}`,
      availableForSale: product.status?.toUpperCase() === 'ACTIVE',
      variantId: product.variants?.[0]?.id || null
    }));

    console.log('📊 Recommendations (before inventory enrichment):', formattedRecommendations.map(r => ({
      title: r.title,
      availableForSale: r.availableForSale
    })));

    return json({
      success: true,
      productId,
      shop,
      recommendations: formattedRecommendations,
      count: formattedRecommendations.length
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (error) {
    console.error("❌ Error in upsell API:", error);
    return json({
      success: false,
      error: error.message,
      recommendations: []
    }, {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
};

// Handle CORS preflight requests
export const OPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
};
