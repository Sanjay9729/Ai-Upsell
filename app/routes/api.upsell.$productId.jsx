import { json } from "@remix-run/node";
import { decideProductOffers } from "../../backend/services/decisionEngine.js";

function getOfferTypeExtras(offerType, discountPercent) {
  if (offerType === 'bundle') {
    return { tagline: 'Bundle & Save' };
  }
  if (offerType === 'volume_discount') {
    const t1 = Math.round((discountPercent || 0) * 0.6);
    const t2 = discountPercent || 0;
    return {
      tagline: 'Buy More, Save More',
      tiers: [
        { quantity: 2, discountPercent: t1, label: '2+ items' },
        { quantity: 3, discountPercent: t2, label: '3+ items' },
      ],
    };
  }
  if (offerType === 'subscription_upgrade') {
    return { tagline: 'Subscribe & Save', interval: 'monthly' };
  }
  return {};
}

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

    // Run decision engine to select offers
    const decision = await decideProductOffers({
      shopId: shop,
      productId,
      userId: null,
      limit: 4,
      placement: "product_page"
    });
    const recommendations = decision.offers || [];

    // Format response for frontend (inventory will be enriched by proxy route)
    const formattedRecommendations = recommendations.map(product => {
      const offerType = product.offerType || "addon_upsell";
      const baseDiscountPercent = product.discountPercent ?? decision.meta?.discountPercent ?? null;
      const offerTypeExtras = getOfferTypeExtras(offerType, baseDiscountPercent);
      const discountPercent = (offerType === 'volume_discount' || offerType === 'subscription_upgrade') ? 0 : baseDiscountPercent;
      return ({
      id: product.productId,
      title: product.title,
      handle: product.handle,
      price: product.aiData?.price || "0",
      image: product.images?.[0]?.src || product.image?.src || "",
      reason: product.aiReason,
      confidence: product.confidence,
      type: product.recommendationType || "similar",
      offerType,
      discountPercent,
      sellingPlanId: product.sellingPlanId || product.sellingPlanIds?.[0] || null,
      sellingPlanIdNumeric: product.sellingPlanIdNumeric || (product.sellingPlanId ? String(product.sellingPlanId).match(/\/(\d+)$/)?.[1] : null),
      decisionScore: product.decisionScore ?? null,
      decisionReason: product.decisionReason ?? null,
      url: `https://${shop}/products/${product.handle}`,
      availableForSale: product.status?.toUpperCase() === 'ACTIVE',
      variantId: product.variants?.[0]?.id || null,
      ...offerTypeExtras
    })});

    console.log('📊 Recommendations (before inventory enrichment):', formattedRecommendations.map(r => ({
      title: r.title,
      availableForSale: r.availableForSale
    })));

    return json({
      success: true,
      productId,
      shop,
      recommendations: formattedRecommendations,
      count: formattedRecommendations.length,
      decision: decision.meta || null
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
