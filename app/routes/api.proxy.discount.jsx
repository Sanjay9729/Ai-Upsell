import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

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

     const shop = params.shop;
     if (!shop) {
       console.error("❌ Missing shop parameter in URL");
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

     // Generate a unique short-lived discount code
     const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
     const code = `AIUS-${suffix}`;
     const percentageDecimal = Math.min(Number(discountPercent) / 100, 1.0);

     console.log(`📝 Creating discount code in Shopify: ${code} (${discountPercent}%)`);

     // Try to get admin client to create discount in Shopify
     let admin = null;
     try {
       const authResult = await authenticate.public.appProxy(request);
       admin = authResult?.admin || null;
     } catch (authErr) {
       console.warn("⚠️ App proxy auth failed:", authErr.message);
       // Try alternate admin access via sessionToken
       try {
         const sessionToken = request.headers.get('authorization')?.replace('Bearer ', '');
         console.log("⚠️ Attempting to get admin without session token");
       } catch (_) {}
     }

     // If admin available, create discount in Shopify
     if (admin) {
       try {
         const startsAt = new Date().toISOString();
         const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
         
         console.log(`📝 Creating discount code in Shopify: ${code} with ${allProductIds.length} products`);
         
         const response = await admin.graphql(
           `#graphql
           mutation createDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
             discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
               codeDiscountNode { id }
               userErrors { field code message }
             }
           }`,
           {
             variables: {
               basicCodeDiscount: {
                 title: `AI Upsell ${code}`,
                 code,
                 combinesWith: {
                   productDiscounts: true,
                   orderDiscounts: true,
                   shippingDiscounts: false
                 },
                 appliesOncePerCustomer: false,
                 usageLimit: 1000,
                 startsAt,
                 endsAt,
                 customerGets: {
                   value: { percentage: percentageDecimal },
                   items: { all: true }
                 },
                 customerSelection: { all: true }
               }
             }
           }
         );

         const data = await response.json();
         const topLevelErrors = Array.isArray(data.errors) ? data.errors : [];
         const errors = data.data?.discountCodeBasicCreate?.userErrors || [];

         if (topLevelErrors.length > 0) {
           console.error("❌ Shopify GraphQL top-level errors:", topLevelErrors);
           return json({ error: topLevelErrors[0]?.message || "Discount could not be created" }, { status: 500, headers: corsHeaders });
         }

         if (errors.length > 0) {
           console.warn("⚠️ Shopify discount creation warning:", errors[0]?.message, errors);
           return json({ error: errors[0]?.message || "Discount could not be created" }, { status: 500, headers: corsHeaders });
         }
         
         if (data.data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
           console.log(`✅ Discount created successfully in Shopify: ${code}`);
           return json({ code }, { status: 200, headers: corsHeaders });
         } else {
           console.warn("⚠️ Discount creation returned no ID");
           return json({ error: "Discount could not be created" }, { status: 500, headers: corsHeaders });
         }
       } catch (gqlErr) {
         console.error("❌ GraphQL error creating discount:", gqlErr.message, gqlErr);
         return json({ error: gqlErr.message || "Discount could not be created" }, { status: 500, headers: corsHeaders });
       }
     } else {
       console.warn("⚠️ No admin client available for discount creation");
     }

     // Do NOT return a fake code — a code that doesn't exist in Shopify will be
     // silently rejected at checkout, giving the impression the discount works
     // while the customer is charged full price.
     console.error("❌ Discount creation failed and no admin client available. Returning error.");
     return json({ error: "Discount could not be created" }, { status: 500, headers: corsHeaders });

   } catch (error) {
      console.error("❌ Error in discount route:", error.message, error.stack);
      return json(
        { error: error.message || "Internal server error" },
        { status: 500, headers: corsHeaders }
      );
    }
};
