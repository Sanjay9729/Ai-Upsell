import { json } from "@remix-run/node";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";
import { storeUpsellRecommendations } from "../../backend/services/upsellRecommendationsService.js";

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
    
    // Get source product title from the AI engine (which already fetched it)
    let sourceProductTitle = `Product ${productId}`;
    
    // The AI engine already fetched the current product, so let's get it from there
    try {
      const currentProduct = await aiEngine.getProductById(shop, productId);
      if (currentProduct && currentProduct.title) {
        sourceProductTitle = currentProduct.title;
        console.log(`🤖 Got source product title from AI engine: ${sourceProductTitle}`);
      }
    } catch (error) {
      console.warn(`⚠️ Could not get source product title:`, error);
    }
    
    console.log(`📝 Final source product title: ${sourceProductTitle}`);

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
      url: `/products/${product.handle}`,
      availableForSale: product.status?.toUpperCase() === 'ACTIVE',
      variantId: product.variants?.[0]?.id || null
    }));

    // Enrich with live inventory from Shopify Admin API
    try {
      const { admin } = await authenticate.public.appProxy(request);
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
            inventoryMap[numericId] = {
              availableForSale: node.status === 'ACTIVE' && (totalInv > 0 || policy === 'continue'),
              inventoryQuantity: totalInv,
              inventoryPolicy: policy,
              variantId: variant?.id || null
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
              variantId: live.variantId || rec.variantId
            };
          }
        });
      } else {
        console.warn('⚠️ No admin client from appProxy auth');
      }
    } catch (invError) {
      console.error('⚠️ Inventory enrichment failed:', invError.message);
    }

    // Store recommendations in MongoDB for analytics
    try {
      const storageData = {
        shopId: shop,
        sourceProductId: productId.toString(),
        sourceProductName: sourceProductTitle,
        recommendations: formattedRecommendations,
        recommendationContext: 'product_detail',
        metadata: {
          apiEndpoint: 'proxy.ai-upsell',
          generatedBy: 'groqAIEngine'
        }
      };
      console.log('📦 Storing recommendations from working proxy route...');
      
      const storeResult = await storeUpsellRecommendations(storageData);
      console.log('✅ Recommendations stored successfully from proxy:', storeResult);
    } catch (storeError) {
      console.error('❌ Failed to store recommendations from proxy:', storeError);
      // Don't fail the entire request if storage fails
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
