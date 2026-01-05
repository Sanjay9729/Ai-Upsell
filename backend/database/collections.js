import { getDb } from './connection.js';

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
export async function syncProductsWithGraphQL(shopId, adminGraphQL) {
  const db = await getDb();
  const productsCollection = db.collection('products');

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
                variants(first: 1) {
                  edges {
                    node {
                      price
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

    // Process products for MongoDB storage
    const lightProducts = allProducts.map(({ node: product }) => ({
      shopId,
      productId: parseInt(product.legacyResourceId, 10),
      title: product.title,
      description: product.description || '',
      tags: product.tags || [],
      vendor: product.vendor || '',
      productType: product.productType || '',
      handle: product.handle,
      status: product.status,
      createdAt: new Date(product.createdAt),
      updatedAt: new Date(product.updatedAt),
      // Store all product images from GraphQL
      images: product.images.edges.map(({ node: img }) => ({
        id: img.id,
        src: img.url,
        alt: img.altText || product.title,
        width: img.width,
        height: img.height
      })),
      image: product.images.edges.length > 0 ? {
        id: product.images.edges[0].node.id,
        src: product.images.edges[0].node.url,
        alt: product.images.edges[0].node.altText || product.title
      } : null,
      // Store light product data + AI data
      aiData: {
        keywords: extractKeywords(product.title + ' ' + (product.description || '')),
        category: product.productType || '',
        price: product.variants.edges[0]?.node.price || '0',
        color: extractColor({ title: product.title, body_html: product.description, tags: product.tags.join(',') }),
        style: extractStyle({ title: product.title, body_html: product.description, tags: product.tags.join(',') }),
        brand: product.vendor || '',
        features: extractFeatures({ title: product.title, body_html: product.description, tags: product.tags.join(',') })
      }
    }));

    // Bulk upsert to MongoDB
    const operations = lightProducts.map(product => ({
      updateOne: {
        filter: { shopId: product.shopId, productId: product.productId },
        update: { $set: product },
        upsert: true
      }
    }));

    const result = await productsCollection.bulkWrite(operations);
    const syncedCount = lightProducts.length;

    console.log(`✅ Successfully synced ${syncedCount} products with images to MongoDB`);
    return syncedCount;

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
  const db = await getDb();
  const productsCollection = db.collection('products');
  
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
    
    // Process products for MongoDB storage
    const lightProducts = shopifyProducts.map(product => ({
      shopId,
      productId: product.id,
      title: product.title,
      description: product.body_html || '',
      tags: product.tags ? product.tags.split(',').map(tag => tag.trim()) : [],
      vendor: product.vendor || '',
      productType: product.product_type || '',
      handle: product.handle,
      status: product.status,
      createdAt: new Date(product.created_at),
      updatedAt: new Date(product.updated_at),
      // Store all product images
      images: product.images || [],
      image: product.image || null, // Primary image for backward compatibility
      // Store light product data + AI data
      aiData: {
        keywords: extractKeywords(product.title + ' ' + (product.body_html || '')),
        category: product.product_type || '',
        price: product.variants?.[0]?.price || '0',
        color: extractColor(product),
        style: extractStyle(product),
        brand: product.vendor || '',
        features: extractFeatures(product)
      }
    }));

    // Bulk upsert to MongoDB
    const operations = lightProducts.map(product => ({
      updateOne: {
        filter: { shopId: product.shopId, productId: product.productId },
        update: { $set: product },
        upsert: true
      }
    }));

    const result = await productsCollection.bulkWrite(operations);
    const syncedCount = lightProducts.length;
    
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
    const product = await productsCollection.findOne({ shopId, productId });
    return product;
  } catch (error) {
    console.error('❌ Error fetching product by ID:', error);
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
    
    console.log('📊 MongoDB indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating indexes:', error);
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