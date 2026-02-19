import { json } from "@remix-run/node";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { GroqAIEngine } from "../../backend/services/groqAIEngine.js";

/**
 * Shopify App Proxy Handler for Secondary Recommendations
 * Returns AI recommendations based on a single product (the upsell product that was just added)
 *
 * URL Format: /apps/ai-upsell/secondary?id=gid://shopify/Product/{productId}
 * Maps to: /api/proxy/secondary?id=...&shop={shop}&...
 */

function verifyProxySignature(query) {
  const { signature, ...params } = query;

  if (!signature) {
    return false;
  }

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

function normalizeText(value) {
  return (value || '').toString().toLowerCase();
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
  'this', 'that', 'these', 'those', 'from', 'new', 'sale', 'best', 'top', 'set', 'pack',
  'piece', 'pieces', 'pair', 'pairs', 'size', 'sizes', 'women', 'woman', 'men', 'man',
  'unisex', 'limited', 'edition', 'collection'
]);

function tokenize(text) {
  const tokens = normalizeText(text).match(/[a-z0-9]+/g) || [];
  return tokens.filter(token => token.length >= 3 && !STOPWORDS.has(token));
}

function buildSearchText(product) {
  const tags = Array.isArray(product.tags) ? product.tags.join(' ') : (product.tags || '');
  return `${product.productType || ''} ${product.aiData?.category || ''} ${product.title || ''} ${tags}`.toLowerCase();
}

function extractTokensFromProduct(product) {
  const text = buildSearchText(product);
  return Array.from(new Set(tokenize(text)));
}

function inferCategoryLabel(product, tokens) {
  const typeTokens = tokenize(product.productType || product.aiData?.category || '');
  if (typeTokens.length > 0) return typeTokens[0];
  if (tokens && tokens.length > 0) return tokens[0];
  const titleTokens = tokenize(product.title || '');
  return titleTokens[0] || null;
}

function matchesByTokens(product, tokens) {
  if (!tokens || tokens.length === 0) return false;
  const text = buildSearchText(product);
  return tokens.some(token => text.includes(token));
}

function uniqueByProductId(products) {
  const seen = new Set();
  return products.filter(product => {
    const id = product?.productId ?? product?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

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
          variantId: variant?.id || null
        };
      }
    }
  } catch (err) {
    console.error('⚠️ Failed to fetch live inventory for secondary:', err.message);
  }

  return inventoryMap;
}

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const isDev = process.env.NODE_ENV !== "production";

    if (!verifyProxySignature(params)) {
      if (!isDev) {
        return json({ error: "Invalid signature" }, { status: 401 });
      }
      console.warn("⚠️ Skipping secondary app proxy signature validation in development");
    }

    const shop = params.shop;
    const productGid = params.id;

    if (!shop || !productGid) {
      return json({ error: "Missing required parameters" }, { status: 400 });
    }

    const productIdMatch = productGid.match(/Product\/(\d+)/);
    if (!productIdMatch) {
      return json({ error: "Invalid product ID format" }, { status: 400 });
    }

    const productId = parseInt(productIdMatch[1], 10);

    console.log(`🔄 Secondary recommendations for product: ${productId}`);

    const aiEngine = new GroqAIEngine();

    // Enforce same-category recommendations (broader match like "bracelet" regardless of material)
    let filteredRecommendations = [];
    let sourceTokens = [];
    let sourceTitleTokens = []; // title-only tokens — used for strict type filtering
    let sourceCategoryLabel = null;
    try {
      const sourceProduct = await aiEngine.getProductById(shop, productId);
      sourceTokens = extractTokensFromProduct(sourceProduct);
      sourceCategoryLabel = inferCategoryLabel(sourceProduct, sourceTokens);

      // Use TITLE-only tokens — category/tag tokens are too broad
      // (e.g. "Jewelry" matches both bracelets and earrings)
      sourceTitleTokens = tokenize(sourceProduct?.title || '');
      const sourceCategory = (sourceProduct?.aiData?.category || '').toLowerCase().trim();
      const DISPLAY_LIMIT = 4;

      if (sourceTitleTokens.length > 0) {
        const allProducts = await aiEngine.getProductsByShop(shop);
        const candidates = allProducts.filter(p => p.productId !== productId);

        // Step 1: Same-type products (title word match — e.g. bracelet → bracelet)
        const sameType = candidates.filter(p => matchesByTokens(p, sourceTitleTokens));

        if (sameType.length >= DISPLAY_LIMIT) {
          // Enough same-type products — show only same type
          filteredRecommendations = uniqueByProductId(sameType);
          console.log(`✅ ${sameType.length} same-type products found — showing same type only`);
        } else {
          // Not enough same-type — fill remaining slots with same-category products
          // e.g. necklace gets bracelets too (both are jewelry)
          const sameTypeIds = new Set(sameType.map(p => String(p.productId)));
          const sameCat = sourceCategory
            ? candidates.filter(p =>
                !sameTypeIds.has(String(p.productId)) &&
                (p.aiData?.category || '').toLowerCase().trim() === sourceCategory
              )
            : [];

          filteredRecommendations = uniqueByProductId([...sameType, ...sameCat]);
          console.log(`✅ ${sameType.length} same-type + ${sameCat.length} same-category products`);

          if (filteredRecommendations.length === 0) {
            console.warn('⚠️ No same-type or same-category products found for:', sourceTitleTokens);
          }
        }
      } else {
        console.warn('⚠️ Source product title missing; cannot filter secondary recommendations');
      }
    } catch (filterErr) {
      console.warn('⚠️ Failed to filter secondary recommendations by type:', filterErr?.message || filterErr);
    }

    if (filteredRecommendations.length === 0) {
      const recommendations = await aiEngine.findUpsellProducts(shop, productId, 8);
      if (sourceTitleTokens.length > 0) {
        const sameType = recommendations.filter(p => matchesByTokens(p, sourceTitleTokens));
        filteredRecommendations = sameType.length > 0 ? sameType : recommendations;
      } else {
        filteredRecommendations = recommendations;
      }
    }

    // Get admin client for inventory enrichment
    let adminClient = null;
    try {
      const { admin } = await authenticate.public.appProxy(request);
      adminClient = admin;
    } catch (authErr) {
      console.error('⚠️ Secondary appProxy auth failed:', authErr.message);
    }

    const recProductIds = filteredRecommendations.map(p => p.productId ?? p.id).filter(Boolean);
    const inventoryMap = await fetchLiveInventory(adminClient, recProductIds);

    const formattedRecommendations = filteredRecommendations.map(product => {
      const productIdValue = product.productId ?? product.id;
      const live = inventoryMap[productIdValue] || {};
      const recommendationType = product.recommendationType || 'similar';
      const confidence = product.confidence ?? 0.8;
      const reason = product.aiReason || (sourceCategoryLabel ? `More ${sourceCategoryLabel} styles` : 'Recommended for you');
      return {
        id: productIdValue,
        title: product.title,
        handle: product.handle,
        price: product.aiData?.price || "0",
        image: product.images?.[0]?.src || product.image?.src || "",
        reason,
        confidence,
        type: recommendationType,
        url: `/products/${product.handle}`,
        availableForSale: live.availableForSale ?? (product.status?.toUpperCase() === 'ACTIVE'),
        inventoryQuantity: live.inventoryQuantity ?? 0,
        inventoryPolicy: live.inventoryPolicy ?? 'continue',
        variantId: live.variantId || product.variants?.[0]?.id || null
      };
    });

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
    console.error("❌ Error in secondary proxy:", error);
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
