import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Proxy route for /apps/ai-upsell
 * Uses authenticate.public.appProxy to get an admin client with valid token
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  // Extract product ID from the request
  const productIdParam = searchParams.get("id");

  if (!productIdParam) {
    return json({ error: "Product ID is required" }, { status: 400 });
  }

  // Extract numeric product ID from gid://shopify/Product/123 format
  const productIdMatch = productIdParam.match(/Product\/(\d+)/);
  if (!productIdMatch) {
    return json({ error: "Invalid product ID format" }, { status: 400 });
  }

  const productId = productIdMatch[1];
  const shop = searchParams.get("shop") || "shreyatestdemo.myshopify.com";

  console.log(`🔄 Proxying request for product ID: ${productId}`);

  try {
    // Forward to the actual API endpoint to get AI recommendations
    const response = await fetch(`${url.origin}/api/upsell/${productId}?shop=${shop}`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Enrich recommendations with live inventory from Shopify Admin API
    if (data.success && data.recommendations?.length > 0) {
      try {
        const { admin } = await authenticate.public.appProxy(request);

        if (admin) {
          const productGids = data.recommendations.map(r => `gid://shopify/Product/${r.id}`);

          const gqlResponse = await admin.graphql(
            `#graphql
            query getInventory($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  availableForSale
                  totalInventory
                  variants(first: 1) {
                    edges {
                      node {
                        id
                        inventoryPolicy
                        inventoryQuantity
                      }
                    }
                  }
                }
              }
            }`,
            { variables: { ids: productGids } }
          );

          const gqlData = await gqlResponse.json();
          console.log('📦 Shopify inventory response:', JSON.stringify(gqlData, null, 2));

          const inventoryMap = {};
          for (const node of gqlData.data?.nodes || []) {
            if (!node || !node.id) continue;
            const numericId = node.id.match(/Product\/(\d+)/)?.[1];
            if (numericId) {
              const variant = node.variants?.edges?.[0]?.node;
              inventoryMap[numericId] = {
                availableForSale: node.availableForSale,
                inventoryQuantity: node.totalInventory ?? variant?.inventoryQuantity ?? 0,
                inventoryPolicy: variant?.inventoryPolicy === 'DENY' ? 'deny' : 'continue',
                variantId: variant?.id || null
              };
            }
          }

          console.log('📦 Inventory map:', inventoryMap);

          // Merge inventory into recommendations
          data.recommendations = data.recommendations.map(rec => {
            const live = inventoryMap[String(rec.id)] || {};
            return {
              ...rec,
              availableForSale: live.availableForSale ?? rec.availableForSale,
              inventoryQuantity: live.inventoryQuantity ?? rec.inventoryQuantity ?? 0,
              inventoryPolicy: live.inventoryPolicy ?? rec.inventoryPolicy ?? 'continue',
            };
          });
        } else {
          console.warn('⚠️ No admin client from appProxy auth');
        }
      } catch (invError) {
        console.error('⚠️ Inventory enrichment failed:', invError.message);
      }
    }

    return json(data, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (error) {
    console.error("❌ Error proxying upsell request:", error);
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

export const OPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
};
