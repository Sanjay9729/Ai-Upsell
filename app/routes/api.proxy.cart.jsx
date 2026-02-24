import { json } from "@remix-run/node";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";

/**
 * Fetch live inventory using authenticated admin client from appProxy
 */
async function fetchLiveInventory(admin, productIds) {
  const inventoryMap = {};
  if (!admin) return inventoryMap;

  try {
    const productGids = productIds.map(id => `gid://shopify/Product/${id}`);
    const response = await admin.graphql(
      `#graphql
      query getInventory($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            status
            totalInventory
            variants(first: 1) {
              edges {
                node {
                  id
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

    const data = await response.json();
    for (const node of data.data?.nodes || []) {
      if (!node || !node.id) continue;
      const numericId = node.id.match(/Product\/(\d+)/)?.[1];
      if (numericId) {
        const variant = node.variants?.edges?.[0]?.node;
        const policy = variant?.inventoryPolicy === 'DENY' ? 'deny' : 'continue';
        const totalInv = node.totalInventory ?? variant?.inventoryQuantity ?? 0;
        inventoryMap[numericId] = {
          availableForSale: node.status === 'ACTIVE' && (totalInv > 0 || policy === 'continue'),
          inventoryQuantity: totalInv,
          inventoryPolicy: policy,
          variantId: variant?.id || null,
          compareAtPrice: variant?.compareAtPrice || null
        };
      }
    }
    console.log('🛒 Live inventory map for cart:', inventoryMap);
  } catch (err) {
    console.error('⚠️ Failed to fetch live inventory for cart:', err.message);
  }

  return inventoryMap;
}

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
    const isDev = process.env.NODE_ENV !== "production";

    // Verify the request is from Shopify
    if (!verifyProxySignature(params)) {
      if (!isDev) {
        return json({ error: "Invalid signature" }, { status: 401 });
      }
      console.warn("⚠️ Skipping cart app proxy signature validation in development");
    }

    const shop = params.shop;
    const productGidsJson = params.ids; // Format: JSON array of GIDs
    const userId = params.userId || null;

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

    // Run AI and auth in parallel — auth is not needed until inventory fetch
    const [recommendations, authResult] = await Promise.all([
      aiEngine.findCartUpsellProducts(shop, productIds, 4, userId),
      authenticate.public.appProxy(request).catch(authErr => {
        console.error('⚠️ Cart appProxy auth failed:', authErr.message);
        return { admin: null };
      })
    ]);
    const adminClient = authResult?.admin || null;

    // Use cart products already fetched by AI engine — no extra DB query needed
    const validCartProducts = recommendations._cartProducts || [];
    const cartSourceTitle = validCartProducts.length > 0
      ? validCartProducts.map(p => p.title).join(', ')
      : 'Cart Items';

    console.log(`📝 Final cart source title: ${cartSourceTitle}`);

    // Fetch live inventory from Shopify Admin API
    const recProductIds = recommendations.map(p => p.productId);
    const inventoryMap = await fetchLiveInventory(adminClient, recProductIds);

    // Format response for frontend
    const formattedRecommendations = recommendations.map(product => {
      const live = inventoryMap[product.productId] || {};
      return {
        id: product.productId,
        title: product.title,
        handle: product.handle,
        price: product.aiData?.price || "0",
        compareAtPrice: live.compareAtPrice || product.aiData?.compareAtPrice || null,
        image: product.images?.[0]?.src || product.image?.src || "",
        reason: product.aiReason,
        confidence: product.confidence,
        type: product.recommendationType,
        url: `/products/${product.handle}`,
        availableForSale: live.availableForSale ?? (product.status?.toUpperCase() === 'ACTIVE'),
        inventoryQuantity: live.inventoryQuantity ?? 0,
        inventoryPolicy: live.inventoryPolicy ?? 'continue',
        variantId: live.variantId || product.variants?.[0]?.id || null
      };
    });

    // Return response in Liquid-compatible format
    return json({
      success: true,
      cartProductIds: productIds,
      shop,
      sourceTitle: cartSourceTitle, // <--- Added source title for frontend tracking
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
