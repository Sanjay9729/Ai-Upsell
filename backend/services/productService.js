import { getDb, collections } from '../database/mongodb.js';

export class ProductService {
  /**
   * Sync products from Shopify to MongoDB
   * Stores light product data + AI data only
   */
  async syncProducts(shopId, shopifyProducts) {
    const mappedProducts = shopifyProducts.map(product =>
      this.mapProductFromRest(shopId, product)
    );

    return await this.upsertProducts(mappedProducts);
  }

  /**
   * Sync products from Shopify Admin GraphQL (product nodes)
   */
  async syncProductsFromGraphQL(shopId, productNodes, options = {}) {
    const mappedProducts = productNodes.map(product =>
      this.mapProductFromGraphQL(shopId, product)
    );

    return await this.upsertProducts(mappedProducts, options);
  }

  /**
   * Upsert mapped products into MongoDB.
   * Returns count or { count, productIds } if options.returnIds is true.
   */
  async upsertProducts(products, options = {}) {
    const db = await getDb();
    const productsCollection = db.collection(collections.products);

    if (!Array.isArray(products) || products.length === 0) {
      return options.returnIds ? { count: 0, productIds: [] } : 0;
    }

    const operations = products.map(product => ({
      updateOne: {
        filter: { shopId: product.shopId, productId: product.productId },
        update: { $set: product },
        upsert: true
      }
    }));

    await productsCollection.bulkWrite(operations);

    if (options.returnIds) {
      return { count: products.length, productIds: products.map(p => p.productId) };
    }

    return products.length;
  }

  /**
   * Get products by shop ID for AI engine
   */
  async getProductsByShop(shopId) {
    const db = await getDb();
    const productsCollection = db.collection(collections.products);
    
    return await productsCollection.find({ shopId }).toArray();
  }

  /**
   * Update product AI data
   */
  async updateProductAIData(shopId, productId, aiData) {
    const db = await getDb();
    const productsCollection = db.collection(collections.products);
    
    await productsCollection.updateOne(
      { shopId, productId },
      { 
        $set: { 
          'aiData': aiData,
          updatedAt: new Date()
        }
      }
    );
  }

  /**
   * Update inventory for a variant using inventoryItemId.
   * Only updates variants.$[].inventoryQuantity.
   */
  async updateInventoryByInventoryItemId(shopId, inventoryItemId, inventoryQuantity) {
    const db = await getDb();
    const productsCollection = db.collection(collections.products);

    const normalizedItemId = this.toNumber(inventoryItemId, null);
    if (normalizedItemId == null) {
      throw new Error('Invalid inventoryItemId');
    }

    const normalizedQuantity = this.toNumber(inventoryQuantity, 0);

    return await productsCollection.updateOne(
      { shopId, 'variants.inventoryItemId': normalizedItemId },
      { $set: { 'variants.$[variant].inventoryQuantity': normalizedQuantity } },
      { arrayFilters: [{ 'variant.inventoryItemId': normalizedItemId }] }
    );
  }

  /**
   * Check if products are missing variant inventory mirror fields.
   * Used to trigger a one-time backfill sync.
   */
  async needsVariantBackfill(shopId) {
    const db = await getDb();
    const productsCollection = db.collection(collections.products);

    const missing = await productsCollection.findOne(
      {
        shopId,
        $or: [
          { variants: { $exists: false } },
          { variants: { $size: 0 } },
          { 'variants.inventoryItemId': { $exists: false } },
          { 'variants.inventoryQuantity': { $exists: false } },
          { collectionIds: { $exists: false } },
          { collectionHandles: { $exists: false } }
        ]
      },
      { projection: { _id: 1 } }
    );

    return Boolean(missing);
  }

  /**
   * Map a REST product payload to the MongoDB product document.
   * Keeps aiData schema untouched.
   */
  mapProductFromRest(shopId, product) {
    return {
      shopId,
      productId: product.id,
      title: product.title,
      description: product.body_html || '',
      tags: product.tags ? product.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [],
      vendor: product.vendor || '',
      productType: product.product_type || '',
      handle: product.handle,
      status: product.status,
      collectionIds: [],
      collectionHandles: [],
      collectionTitles: [],
      sellingPlanGroupIds: [],
      sellingPlanIds: [],
      sellingPlanId: null,
      sellingPlanIdNumeric: null,
      images: product.images || [],
      image: product.image || null,
      variants: this.mapVariantsFromRest(product.variants || []),
      aiData: {
        // Store AI-relevant features for similarity matching
        keywords: this.extractKeywords(product.title + ' ' + (product.body_html || '')),
        category: product.product_type || '',
        price: product.variants?.[0]?.price || '0',
        compareAtPrice: product.variants?.[0]?.compare_at_price || null,
        color: this.extractColor(product),
        style: this.extractStyle(product),
        brand: product.vendor || '',
        features: this.extractFeatures(product),
        embedding: null // Will be generated by AI engine
      },
      createdAt: new Date(product.created_at || Date.now()),
      updatedAt: new Date(product.updated_at || Date.now())
    };
  }

  /**
   * Map a GraphQL product node to the MongoDB product document.
   * Keeps aiData schema untouched.
   */
  mapProductFromGraphQL(shopId, product) {
    const images = product.images?.edges?.map(({ node: img }) => ({
      id: img.id,
      src: img.url,
      alt: img.altText || product.title,
      width: img.width,
      height: img.height
    })) || [];

    const collections = product.collections?.nodes || [];
    const collectionIds = collections
      .map((c) => this.extractNumericId(c?.id))
      .filter(Boolean);
    const collectionHandles = collections
      .map((c) => String(c?.handle || '').toLowerCase())
      .filter(Boolean);
    const collectionTitles = collections
      .map((c) => String(c?.title || '').trim())
      .filter(Boolean);

    const unique = (arr) => Array.from(new Set(arr));

    const sellingPlanGroups = product.sellingPlanGroups?.edges
      ? product.sellingPlanGroups.edges.map((edge) => edge.node)
      : (product.sellingPlanGroups?.nodes || []);

    const sellingPlanGroupIds = unique(
      (sellingPlanGroups || [])
        .map((g) => g?.id)
        .filter(Boolean)
    );

    const sellingPlanIds = unique(
      (sellingPlanGroups || [])
        .flatMap((g) => (g?.sellingPlans?.edges || []).map((e) => e.node?.id))
        .filter(Boolean)
    );
    const sellingPlanId = sellingPlanIds[0] || null;
    const sellingPlanIdNumeric = this.extractNumericId(sellingPlanId);

    return {
      shopId,
      productId: this.toNumber(product.legacyResourceId, null),
      title: product.title,
      description: product.description || '',
      tags: Array.isArray(product.tags) ? product.tags : [],
      vendor: product.vendor || '',
      productType: product.productType || '',
      handle: product.handle,
      status: product.status,
      collectionIds: unique(collectionIds),
      collectionHandles: unique(collectionHandles),
      collectionTitles: unique(collectionTitles),
      sellingPlanGroupIds,
      sellingPlanIds,
      sellingPlanId,
      sellingPlanIdNumeric,
      createdAt: new Date(product.createdAt),
      updatedAt: new Date(product.updatedAt),
      images,
      image: images.length > 0 ? {
        id: images[0].id,
        src: images[0].src,
        alt: images[0].alt
      } : null,
      variants: this.mapVariantsFromGraphQL(product.variants?.edges || []),
      aiData: {
        keywords: this.extractKeywords(product.title + ' ' + (product.description || '')),
        category: product.productType || '',
        price: product.variants?.edges?.[0]?.node?.price || '0',
        compareAtPrice: product.variants?.edges?.[0]?.node?.compareAtPrice || null,
        color: this.extractColor({ title: product.title, body_html: product.description, tags: (product.tags || []).join(',') }),
        style: this.extractStyle({ title: product.title, body_html: product.description, tags: (product.tags || []).join(',') }),
        brand: product.vendor || '',
        features: this.extractFeatures({ title: product.title, body_html: product.description, tags: (product.tags || []).join(',') })
      }
    };
  }

  mapVariantsFromRest(variants) {
    return variants.map(variant => ({
      variantId: this.toNumber(variant.id, null),
      price: this.toNumber(variant.price, 0),
      compareAtPrice: this.toNumber(variant.compare_at_price, null),
      inventoryQuantity: this.toNumber(variant.inventory_quantity, null),
      inventoryItemId: this.toNumber(variant.inventory_item_id, null),
      inventoryPolicy: variant.inventory_policy ? String(variant.inventory_policy).toUpperCase() : null
    }));
  }

  mapVariantsFromGraphQL(variantEdges) {
    return variantEdges.map(({ node }) => ({
      variantId: this.toNumber(this.extractNumericId(node?.id), null),
      price: this.toNumber(node?.price, 0),
      compareAtPrice: this.toNumber(node?.compareAtPrice, null),
      inventoryQuantity: this.toNumber(node?.inventoryQuantity, null),
      inventoryItemId: this.toNumber(this.extractNumericId(node?.inventoryItem?.id), null),
      inventoryPolicy: node?.inventoryPolicy ? String(node.inventoryPolicy).toUpperCase() : null
    }));
  }

  extractNumericId(gid) {
    if (!gid || typeof gid !== 'string') return null;
    const match = gid.match(/\/(\d+)$/);
    return match ? match[1] : null;
  }

  toNumber(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  /**
   * Extract keywords from product title and description
   */
  extractKeywords(text) {
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
  extractColor(product) {
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
  extractStyle(product) {
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
  extractFeatures(product) {
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
}
