import { getDb } from './connection.js';
import { ProductService } from '../services/productService.js';

/**
 * Get all products from MongoDB
 * Returns array of all products stored in the database
 */
export async function getAllProducts() {
  const db = await getDb();
  const productsCollection = db.collection('products');
  
  try {
    const products = await productsCollection.find({}).toArray();
    console.log(`📦 Retrieved ${products.length} products from MongoDB`);
    return products;
  } catch (error) {
    console.error('❌ Error fetching products from MongoDB:', error);
    throw error;
  }
}

/**
 * Get products by shop ID
 * Returns products for a specific shop
 */
export async function getProductsByShop(shopId) {
  const db = await getDb();
  const productsCollection = db.collection('products');
  
  try {
    const products = await productsCollection.find({ shopId }).toArray();
    console.log(`📦 Retrieved ${products.length} products for shop: ${shopId}`);
    return products;
  } catch (error) {
    console.error('❌ Error fetching products by shop:', error);
    throw error;
  }
}

/**
 * Sync products from Shopify to MongoDB using GraphQL (preferred method)
 * This implements Step 1 of the AI Upsell Flow with images
 */
export async function syncProductsWithGraphQL(shopId, adminGraphQL, options = {}) {
  const productService = new ProductService();

  try {
    console.log(`🔄 Starting GraphQL product sync for shop: ${shopId}`);

    let hasNextPage = true;
    let cursor = null;
    let allProducts = [];

    // Fetch all products using pagination
    while (hasNextPage) {
      const response = await adminGraphQL(
        `#graphql
        query getProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                legacyResourceId
                title
                description
                handle
                vendor
                productType
                tags
                status
                createdAt
                updatedAt
                collections(first: 25) {
                  nodes {
                    id
                    handle
                    title
                  }
                }
                images(first: 10) {
                  edges {
                    node {
                      id
                      url
                      altText
                      width
                      height
                    }
                  }
                }
                variants(first: 100) {
                  edges {
                    node {
                      id
                      price
                      compareAtPrice
                      inventoryQuantity
                      inventoryItem {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        {
          variables: {
            cursor: cursor
          }
        }
      );

      const data = await response.json();
      const productsData = data.data?.products;

      if (!productsData) {
        console.error('❌ No products data in GraphQL response');
        break;
      }

      allProducts = allProducts.concat(productsData.edges);
      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

      console.log(`📡 Fetched ${allProducts.length} products so far...`);
    }

    console.log(`📡 Total fetched: ${allProducts.length} products from Shopify`);
    const productNodes = allProducts.map(({ node }) => node);
    const result = await productService.syncProductsFromGraphQL(shopId, productNodes, options);

    const syncedCount = options.returnIds ? result.count : result;
    console.log(`✅ Successfully synced ${syncedCount} products with images to MongoDB`);

    return result;

  } catch (error) {
    console.error('❌ Error syncing products with GraphQL:', error);
    throw error;
  }
}

/**
 * Sync products from Shopify to MongoDB using REST API (fallback method)
 * This implements Step 1 of the AI Upsell Flow
 */
export async function syncProductsToMongoDB(shopId, accessToken) {
  const productService = new ProductService();
  
  try {
    console.log(`🔄 Starting product sync for shop: ${shopId}`);
    
    // Use environment credentials if not provided
    const finalAccessToken = accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
    const finalShopId = shopId || process.env.SHOP_CUSTOM_DOMAIN;
    
    if (!finalAccessToken || !finalShopId) {
      throw new Error('Shopify credentials not provided. Set SHOPIFY_ACCESS_TOKEN and SHOP_CUSTOM_DOMAIN in .env');
    }
    
    // Fetch products from Shopify Admin API
    const shopifyProducts = await fetchShopifyProducts(finalShopId, finalAccessToken);
    console.log(`📡 Fetched ${shopifyProducts.length} products from Shopify`);

    const syncedCount = await productService.syncProducts(shopId, shopifyProducts);
    
    console.log(`✅ Successfully synced ${syncedCount} products to MongoDB`);
    return syncedCount;
    
  } catch (error) {
    console.error('❌ Error syncing products to MongoDB:', error);
    throw error;
  }
}

/**
 * Update a single product in MongoDB
 */
export async function updateProduct(shopId, productId, updateData) {
  const db = await getDb();
  const productsCollection = db.collection('products');
  
  try {
    const result = await productsCollection.updateOne(
      { shopId, productId },
      { $set: { ...updateData, updatedAt: new Date() } }
    );
    
    console.log(`📝 Updated product ${productId} for shop ${shopId}`);
    return result;
  } catch (error) {
    console.error('❌ Error updating product:', error);
    throw error;
  }
}

/**
 * Delete a product from MongoDB
 * Handles both string and number product IDs to ensure compatibility
 */
export async function deleteProduct(shopId, productId) {
  const db = await getDb();
  const productsCollection = db.collection('products');
  
  try {
    // Try multiple query patterns to handle both string and number IDs
    const deleteFilters = [
      { shopId, productId: productId.toString() },
      { shopId, productId: parseInt(productId, 10) },
      { shopId, productId: Number(productId) }
    ];
    
    let totalDeleted = 0;
    let lastResult = null;
    
    for (const filter of deleteFilters) {
      const result = await productsCollection.deleteOne(filter);
      if (result.deletedCount > 0) {
        totalDeleted += result.deletedCount;
        lastResult = result;
        console.log(`🗑️ Deleted product ${productId} for shop ${shopId} using filter:`, filter);
        break; // Stop after first successful deletion
      }
    }
    
    if (totalDeleted === 0) {
      console.log(`⚠️ No product found to delete for ID ${productId} and shop ${shopId}`);
      // Return a result indicating no deletion occurred
      return { acknowledged: true, deletedCount: 0 };
    }
    
    return lastResult || { acknowledged: true, deletedCount: totalDeleted };
  } catch (error) {
    console.error('❌ Error deleting product:', error);
    throw error;
  }
}

/**
 * Get product by ID and shop
 */
export async function getProductById(shopId, productId) {
  const db = await getDb();
  const productsCollection = db.collection('products');
  
  try {
    const numericId = Number(productId);
    const stringId = productId != null ? String(productId) : null;
    const filters = [
      { shopId, productId: numericId },
      stringId ? { shopId, productId: stringId } : null
    ].filter(Boolean);

    for (const filter of filters) {
      const product = await productsCollection.findOne(filter);
      if (product) return product;
    }

    return null;
  } catch (error) {
    console.error('❌ Error fetching product by ID:', error);
    throw error;
  }
}

/**
 * Ensure a single product exists in MongoDB by fetching from Shopify Admin GraphQL.
 * Used as a self-healing fallback when webhooks are missed.
 */
export async function ensureProductFromAdminGraphQL(shopId, adminGraphQL, productId) {
  if (!adminGraphQL) return null;
  const productService = new ProductService();

  try {
    const gid = `gid://shopify/Product/${productId}`;
    const response = await adminGraphQL(
      `#graphql
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          legacyResourceId
          title
          description
          handle
          vendor
          productType
          tags
          status
          createdAt
          updatedAt
          collections(first: 25) {
            nodes {
              id
              handle
              title
            }
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
                width
                height
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                price
                compareAtPrice
                inventoryQuantity
                inventoryItem {
                  id
                }
              }
            }
          }
        }
      }`,
      { variables: { id: gid } }
    );

    const data = await response.json();
    const product = data?.data?.product;
    if (!product) return null;

    const mapped = productService.mapProductFromGraphQL(shopId, product);
    await productService.upsertProducts([mapped]);

    console.log(`✅ Self-healed product ${mapped.productId} for shop ${shopId}`);
    return mapped;
  } catch (error) {
    console.error('❌ Self-heal product failed:', error);
    return null;
  }
}

/**
 * Upsert a single product directly from a webhook payload (REST format).
 * Does not require a Shopify session — works even if the offline token has expired.
 * Used by products/create and products/update webhooks.
 */
export async function upsertProductFromWebhookPayload(shopId, payload) {
  const productService = new ProductService();

  try {
    const db = await getDb();
    const existing = await db.collection(collections.products).findOne(
      { shopId, productId: payload.id },
      { projection: { collectionIds: 1, collectionHandles: 1, collectionTitles: 1 } }
    );

    const product = productService.mapProductFromRest(shopId, payload);
    if (existing) {
      product.collectionIds = existing.collectionIds || [];
      product.collectionHandles = existing.collectionHandles || [];
      product.collectionTitles = existing.collectionTitles || [];
    }
    await productService.upsertProducts([product]);

    console.log(`✅ Upserted product ${payload.id} (${payload.title}) for shop ${shopId}`);
    return product;
  } catch (error) {
    console.error('❌ Error upserting product from webhook payload:', error);
    throw error;
  }
}

/**
 * Create indexes for better performance
 */
export async function createIndexes() {
  const db = await getDb();
  const productsCollection = db.collection('products');
  
  try {
    await productsCollection.createIndex({ shopId: 1, productId: 1 }, { unique: true });
    await productsCollection.createIndex({ shopId: 1, tags: 1 });
    await productsCollection.createIndex({ shopId: 1, vendor: 1 });
    await productsCollection.createIndex({ shopId: 1, productType: 1 });
    await productsCollection.createIndex({ shopId: 1, collectionIds: 1 });
    await productsCollection.createIndex({ shopId: 1, collectionHandles: 1 });
    
    console.log('📊 MongoDB indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    throw error;
  }
}

/**
 * Remove products that no longer exist in Shopify.
 * Uses both numeric and string forms of IDs for safety.
 */
export async function pruneProductsNotInList(shopId, productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    console.warn(`⚠️ Prune skipped for ${shopId}: empty product list`);
    return 0;
  }

  const db = await getDb();
  const productsCollection = db.collection('products');

  const idSet = new Set();
  productIds.forEach((id) => {
    idSet.add(String(id));
    const numeric = Number(id);
    if (Number.isFinite(numeric)) idSet.add(numeric);
  });

  const idList = Array.from(idSet);

  try {
    const result = await productsCollection.deleteMany({
      shopId,
      productId: { $nin: idList }
    });
    if (result.deletedCount > 0) {
      console.log(`🧹 Pruned ${result.deletedCount} stale products for ${shopId}`);
    }
    return result.deletedCount;
  } catch (error) {
    console.error(`❌ Error pruning stale products for ${shopId}:`, error);
    throw error;
  }
}

// Helper functions for data processing

/**
 * Fetch products from Shopify Admin API
 */
async function fetchShopifyProducts(shopId, accessToken) {
  // Use the latest stable API version
  const baseUrl = `https://${shopId}/admin/api/2024-10`;
  
  console.log(`🔗 Making API call to: ${baseUrl}/products.json`);
  console.log(`🔑 Using access token: ${accessToken.substring(0, 10)}...`);
  
  const response = await fetch(`${baseUrl}/products.json`, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json'
    }
  });
  
  console.log(`📡 Shopify API response status: ${response.status} ${response.statusText}`);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Shopify API error details:`, errorText);
    throw new Error(`Shopify API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log(`📦 Successfully fetched ${data.products?.length || 0} products from Shopify`);
  return data.products || [];
}

/**
 * Extract keywords from product title and description
 */
function extractKeywords(text) {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should']);
  
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 20); // Limit to top 20 keywords
}

/**
 * Extract color from product data
 */
function extractColor(product) {
  const colors = ['red', 'blue', 'green', 'black', 'white', 'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'navy', 'teal', 'maroon', 'beige', 'cream', 'gold', 'silver'];
  const text = (product.title + ' ' + (product.body_html || '')).toLowerCase();
  
  for (const color of colors) {
    if (text.includes(color)) {
      return color;
    }
  }
  return null;
}

/**
 * Extract style from product data
 */
function extractStyle(product) {
  const styles = ['casual', 'formal', 'sport', 'elegant', 'vintage', 'modern', 'classic', 'minimalist', 'bohemian', 'preppy', 'grunge'];
  const text = (product.title + ' ' + (product.body_html || '') + ' ' + (product.tags || '')).toLowerCase();
  
  for (const style of styles) {
    if (text.includes(style)) {
      return style;
    }
  }
  return null;
}

/**
 * Extract features from product data
 */
function extractFeatures(product) {
  const features = [];
  const text = (product.title + ' ' + (product.body_html || '') + ' ' + (product.tags || '')).toLowerCase();
  
  const featurePatterns = [
    /waterproof|water resistant/,
    /breathable/,
    /washable/,
    /stretch|elastic/,
    /insulated|warm/,
    /lightweight/,
    /durable/,
    /adjustable/,
    /portable|foldable/,
    /wireless|bluetooth/
  ];

  featurePatterns.forEach((pattern, index) => {
    if (pattern.test(text)) {
      features.push(['waterproof', 'breathable', 'washable', 'stretch', 'insulated', 'lightweight', 'durable', 'adjustable', 'portable', 'wireless'][index]);
    }
  });

  return features;
}
