import { json } from "@remix-run/node";
import crypto from "crypto";
import { authenticate } from "../shopify.server";

function verifyProxySignature(query) {
  const { signature, ...params } = query;
  if (!signature) return false;
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('');
  const calculatedSignature = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest('hex');
  return calculatedSignature === signature;
}

/**
 * POST /apps/ai-upsell/discount
 * Creates a Shopify discount code for the given product at the AI-computed discount %.
 * Returns { code: 'AIUS-XXXX' } which the widget activates via /discount/CODE cookie.
 */
export const action = async ({ request }) => {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const isDev = process.env.NODE_ENV !== "production";

    if (!verifyProxySignature(params)) {
      if (!isDev) {
        return json({ error: "Invalid signature" }, { status: 401, headers: corsHeaders });
      }
      console.warn("⚠️ Skipping proxy signature validation in development");
    }

    const shop = params.shop;
    if (!shop) {
      return json({ error: "Missing shop parameter" }, { status: 400, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
    }

    const { productIds, productId: singleProductId, discountPercent } = body;

    // Support both new array format (productIds) and legacy single format (productId)
    const allProductIds = productIds
      ? (Array.isArray(productIds) ? productIds : [productIds]).map(String).filter(Boolean)
      : singleProductId ? [String(singleProductId)] : [];

    if (!allProductIds.length || !discountPercent || Number(discountPercent) <= 0) {
      return json({ error: "Missing productIds or discountPercent" }, { status: 400, headers: corsHeaders });
    }

    const { admin } = await authenticate.public.appProxy(request);
    if (!admin) {
      return json({ error: "Authentication failed" }, { status: 401, headers: corsHeaders });
    }

    // Generate a unique short-lived discount code
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const code = `AIUS-${suffix}`;
    const percentageDecimal = Math.min(Number(discountPercent) / 100, 1.0);
    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // expires in 2 hours
    const productGids = allProductIds.map(id => `gid://shopify/Product/${id}`);

    const response = await admin.graphql(
      `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          basicCodeDiscount: {
            title: `AI Upsell ${code}`,
            code,
            startsAt,
            endsAt,
            usageLimit: 5,
            appliesOncePerCustomer: false,
            customerSelection: {
              all: true,
            },
            customerGets: {
              value: { percentage: percentageDecimal },
              items: {
                products: {
                  productsToAdd: productGids,
                },
              },
            },
          },
        },
      }
    );

    const data = await response.json();
    const errors = data.data?.discountCodeBasicCreate?.userErrors || [];

    if (errors.length > 0) {
      console.error("❌ Discount code creation error:", errors);
      return json({ error: errors[0].message }, { status: 400, headers: corsHeaders });
    }

    console.log(`✅ AI upsell discount created: ${code} (${discountPercent}%) for products [${allProductIds.join(', ')}]`);
    return json({ code }, { headers: corsHeaders });

  } catch (error) {
    console.error("❌ Error in discount route:", error);
    return json(
      { error: error.message || "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
};
