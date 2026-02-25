import { json } from "@remix-run/node";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";
import { ensureProductFromAdminGraphQL, getProductById } from "../../backend/database/collections.js";

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
    const isDev = process.env.NODE_ENV !== "production";

    // Verify the request is from Shopify
    if (!verifyProxySignature(params)) {
      if (!isDev) {
        return json({ error: "Invalid signature" }, { status: 401 });
      }
      console.warn("⚠️ Skipping app proxy signature validation in development");
    }

    const shop = params.shop;
    const productGid = params.id; // Format: gid://shopify/Product/{id}
    const userId = params.userId || null;

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

    // Self-heal: if webhook missed, fetch product via Admin GraphQL and upsert
    const { admin } = await authenticate.public.appProxy(request);
    if (admin?.graphql) {
      const existing = await getProductById(shop, productId);
      const updatedAt = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const stale = !existing || (Date.now() - updatedAt > 10 * 60 * 1000);
      if (stale) {
        const refreshPromise = ensureProductFromAdminGraphQL(shop, admin.graphql, productId);
        if (!existing) {
          // Product not in DB yet — must wait before AI can find it
          await refreshPromise;
        } else {
          // Product exists but stale — refresh in background, don't block AI
          refreshPromise.catch(err => console.warn('⚠️ Background product refresh failed:', err));
        }
      }
    } else {
      console.warn('⚠️ No admin client from appProxy auth');
    }

    // Get AI-powered upsell recommendations (pass userId for per-user personalization)
    const recommendations = await aiEngine.findUpsellProducts(shop, productId, 4, userId);

    // Use source product already fetched by AI engine — no extra DB query needed
    const sourceProductTitle = recommendations._sourceProduct?.title || `Product ${productId}`;
    console.log(`📝 Source product title: ${sourceProductTitle}`);

    // Format response for frontend
    const formattedRecommendations = recommendations.map(product => ({
      id: product.productId,
      title: product.title,
      handle: product.handle,
      price: product.aiData?.price || "0",
      compareAtPrice: product.aiData?.compareAtPrice || null,
      image: product.images?.[0]?.src || product.image?.src || "",
      reason: product.aiReason,
      confidence: product.confidence,
      type: product.recommendationType,
      url: `/products/${product.handle}`,
      availableForSale: product.status?.toUpperCase() === 'ACTIVE',
      variantId: product.variants?.[0]?.id || null
    }));

    // Enrich with live inventory from Shopify Admin API
    try {
      if (admin) {
        const productGids = formattedRecommendations.map(r => `gid://shopify/Product/${r.id}`);
        const gqlResponse = await admin.graphql(
          `#graphql
          query getInventory($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                status
                totalInventory
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryPolicy
                      inventoryQuantity
                      compareAtPrice
                    }
                  }
                }
              }
            }
          }`,
          { variables: { ids: productGids } }
        );
        const gqlData = await gqlResponse.json();
        console.log('📦 Shopify inventory response:', JSON.stringify(gqlData.data?.nodes?.map(n => ({
          id: n?.id, status: n?.status, totalInventory: n?.totalInventory
        })), null, 2));

        const inventoryMap = {};
        for (const node of gqlData.data?.nodes || []) {
          if (!node || !node.id) continue;
          const numericId = node.id.match(/Product\/(\d+)/)?.[1];
          if (numericId) {
            const variant = node.variants?.edges?.[0]?.node;
            const policy = variant?.inventoryPolicy === 'DENY' ? 'deny' : 'continue';
            const totalInv = node.totalInventory ?? variant?.inventoryQuantity ?? 0;
            const allVariants = (node.variants?.edges || []).map(e => {
              const v = e.node;
              const vPolicy = v.inventoryPolicy === 'DENY' ? 'deny' : 'continue';
              return {
                id: v.id.split('/').pop(),
                title: v.title,
                price: v.price,
                compareAtPrice: v.compareAtPrice || null,
                available: node.status === 'ACTIVE' && (v.inventoryQuantity > 0 || vPolicy === 'continue')
              };
            });
            inventoryMap[numericId] = {
              availableForSale: node.status === 'ACTIVE' && (totalInv > 0 || policy === 'continue'),
              inventoryQuantity: totalInv,
              inventoryPolicy: policy,
              variantId: variant?.id || null,
              compareAtPrice: variant?.compareAtPrice || null,
              variants: allVariants
            };
          }
        }
        console.log('📦 Inventory map:', inventoryMap);

        // Merge inventory into recommendations
        formattedRecommendations.forEach((rec, i) => {
          const live = inventoryMap[String(rec.id)] || {};
          if (live.availableForSale !== undefined) {
            formattedRecommendations[i] = {
              ...rec,
              availableForSale: live.availableForSale,
              inventoryQuantity: live.inventoryQuantity,
              inventoryPolicy: live.inventoryPolicy,
              variantId: live.variantId || rec.variantId,
              compareAtPrice: live.compareAtPrice || rec.compareAtPrice,
              variants: live.variants || []
            };
          }
        });
      }
    } catch (invError) {
      console.error('⚠️ Inventory enrichment failed:', invError.message);
    }

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
