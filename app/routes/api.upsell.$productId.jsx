import { json } from "@remix-run/node";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";
import { storeUpsellRecommendations } from "../../backend/services/upsellRecommendationsService.js";

/**
 * API endpoint to get AI-powered upsell recommendations
 * GET /api/upsell/:productId?shop=shop-domain.myshopify.com
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
      url: `https://${shop}/products/${product.handle}`,
      availableForSale: product.status === 'active', // Use product status from Shopify
      variantId: product.variants?.[0]?.id || null
    }));

    console.log('📊 Formatted recommendations for storage:', JSON.stringify(formattedRecommendations, null, 2));

    // Store formatted recommendations in MongoDB for analytics
    try {
      const storageData = {
        shopId: shop,
        sourceProductId: productId,
        recommendations: formattedRecommendations,
        recommendationContext: 'product_detail',
        metadata: {
          apiEndpoint: 'upsell.product',
          generatedBy: 'groqAIEngine'
        }
      };
      console.log('📤 Calling storeUpsellRecommendations with:', JSON.stringify(storageData, null, 2));

      const storeResult = await storeUpsellRecommendations(storageData);
      console.log('✅ Recommendations stored successfully:', storeResult);
    } catch (storeError) {
      console.error('❌ Failed to store recommendations:', storeError);
      console.error('❌ Error stack:', storeError.stack);
      // Don't fail the entire request if storage fails
    }

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
