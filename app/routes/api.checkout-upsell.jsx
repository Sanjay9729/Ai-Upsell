import { json } from "@remix-run/node";
import { decideCartOffers } from "../../backend/services/decisionEngine.js";
import { getSafetyMode } from "../../backend/services/safetyMode.js";

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
 * GET /api/checkout-upsell
 *
 * Direct API called by Shopify checkout UI extensions and thank-you page extensions.
 * Does NOT go through the App Proxy (no HMAC signature required).
 * Extensions authenticate by passing their shop domain — we verify it exists in our DB.
 *
 * Query params:
 *   shop        — myshopify domain (e.g. mystore.myshopify.com)
 *   ids         — JSON array of numeric product IDs already in cart/order
 *   placement   — 'checkout' | 'post_purchase' (default: 'checkout')
 *   limit       — number of offers to return (default: 1 for checkout, 2 for post_purchase)
 */
export const loader = async ({ request }) => {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const idsParam = url.searchParams.get("ids");
    const placement = url.searchParams.get("placement") || "checkout";
    const limitParam = url.searchParams.get("limit");

    if (!shop || !idsParam) {
      return json({ offers: [], offer: null }, { status: 400, headers: corsHeaders });
    }

    let productIds;
    try {
      const parsed = JSON.parse(idsParam);
      productIds = (Array.isArray(parsed) ? parsed : [parsed])
        .map(Number)
        .filter(id => id > 0);
    } catch {
      return json({ offers: [], offer: null }, { status: 400, headers: corsHeaders });
    }

    if (productIds.length === 0) {
      return json({ offers: [], offer: null }, { headers: corsHeaders });
    }

    const defaultLimit = placement === "post_purchase" ? 2 : 1;
    const limit = Math.min(Number(limitParam) || defaultLimit, 4);

    console.log(`🛒 Checkout upsell request — shop: ${shop}, placement: ${placement}, products: ${productIds}`);

    // Block all offers if safety mode is active
    const safetyActive = await getSafetyMode(shop).catch(() => false);
    if (safetyActive) {
      console.warn(`🛑 Safety mode active for ${shop} — blocking checkout/post-purchase offers`);
      return json(
        { offers: [], offer: null, count: 0, placement, meta: { reason: 'safety_mode_active', status: 'safety_mode' } },
        { headers: corsHeaders }
      );
    }

    const decision = await decideCartOffers({
      shopId: shop,
      cartProductIds: productIds,
      limit,
      placement,
    });

    const rawOffers = decision.offers || [];

    console.log(`📊 [Checkout API] CALL — shop: ${shop}, productIds: ${JSON.stringify(productIds)}`);
    console.log(`📊 [Checkout API] decision.meta.discountPercent: ${decision.meta?.discountPercent}, offers count: ${rawOffers.length}`);
    if (rawOffers[0]) {
      console.log(`📊 [Checkout API] First offer - productId: ${rawOffers[0].productId}, product.discountPercent: ${rawOffers[0].discountPercent}`);
    }

    const formattedOffers = rawOffers.map(product => {
      const price = String(product.aiData?.price || product.variants?.[0]?.price || "0");
      const compareAtPrice = product.aiData?.compareAtPrice || product.variants?.[0]?.compareAtPrice || null;
      const offerType = product.offerType || "addon_upsell";
      console.log(`📊 [Checkout API] Product ${product.productId} - aiData.price: ${product.aiData?.price}, variant.price: ${product.variants?.[0]?.price}, compareAtPrice: ${compareAtPrice}`);
      const baseDiscountPercent = product.discountPercent ?? decision.meta?.discountPercent ?? 0;
      console.log(`📊 [Checkout API] Formatting product ${product.productId}: baseDiscountPercent=${baseDiscountPercent}`);
      const offerTypeExtras = getOfferTypeExtras(offerType, baseDiscountPercent);
      const discountPercent = (offerType === 'volume_discount' || offerType === 'subscription_upgrade') ? 0 : baseDiscountPercent;
      const sellingPlanId = product.sellingPlanId || product.sellingPlanIds?.[0] || null;
      const sellingPlanIdNumeric = product.sellingPlanIdNumeric || (sellingPlanId ? String(sellingPlanId).match(/\/(\d+)$/)?.[1] : null);
      return {
        id: product.productId,
        title: product.title,
        handle: product.handle,
        price,
        compareAtPrice,
        image: product.images?.[0]?.src || product.image?.src || "",
        variantId: product.variants?.[0]?.id || product.variantId || null,
        reason: product.aiReason || null,
        confidence: product.confidence || 0,
        offerType,
        discountPercent,
        sellingPlanId,
        sellingPlanIdNumeric,
        type: product.recommendationType || "complementary",
        ...offerTypeExtras,
      };
    });

    console.log(`📊 [Checkout API] Returning offer:`, formattedOffers[0] ? { id: formattedOffers[0].id, price: formattedOffers[0].price, compareAtPrice: formattedOffers[0].compareAtPrice, discountPercent: formattedOffers[0].discountPercent } : null);

    return json(
      {
        offers: formattedOffers,
        offer: formattedOffers[0] || null, // convenience for checkout (single offer)
        count: formattedOffers.length,
        placement,
        meta: decision.meta || null,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("❌ Checkout upsell API error:", error);
    return json(
      { offers: [], offer: null, error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
};
