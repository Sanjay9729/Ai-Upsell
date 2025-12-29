import express from 'express';
import { ProductService } from '../services/productService.js';
import { AIEngine } from '../services/aiEngine.js';
import { getShopifyClient } from '../services/shopifyService.js';

const router = express.Router();
const productService = new ProductService();
const aiEngine = new AIEngine();

/**
 * POST /api/products/sync
 * Sync products from Shopify to MongoDB
 * Called when app is installed
 */
router.post('/sync', async (req, res) => {
  try {
    const { shopId, accessToken } = req.body;
    
    if (!shopId || !accessToken) {
      return res.status(400).json({ error: 'shopId and accessToken are required' });
    }

    // Get Shopify client
    const shopify = getShopifyClient(shopId, accessToken);
    
    // Fetch all products from Shopify
    const products = await shopify.product.list();
    
    // Sync to MongoDB
    const syncedCount = await productService.syncProducts(shopId, products);
    
    res.json({
      success: true,
      message: `Successfully synced ${syncedCount} products`,
      syncedCount
    });
    
  } catch (error) {
    console.error('Product sync error:', error);
    res.status(500).json({ 
      error: 'Failed to sync products',
      details: error.message 
    });
  }
});

/**
 * GET /api/products/upsell/:productId
 * Get upsell recommendations for a product
 * Returns product IDs that will be used to fetch fresh data from Shopify
 */
router.get('/upsell/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { shopId } = req.query;
    
    if (!shopId) {
      return res.status(400).json({ error: 'shopId query parameter is required' });
    }

    // Get upsell recommendations from AI engine
    const upsellProducts = await aiEngine.findUpsellProducts(shopId, productId, 4);
    
    // Return product IDs for frontend to fetch fresh data from Shopify
    res.json({
      success: true,
      upsellProductIds: upsellProducts.map(p => p.productId),
      recommendations: upsellProducts
    });
    
  } catch (error) {
    console.error('Upsell recommendation error:', error);
    res.status(500).json({ 
      error: 'Failed to get upsell recommendations',
      details: error.message 
    });
  }
});

/**
 * POST /api/products/bulk-upsell
 * Get upsell recommendations for multiple products
 */
router.post('/bulk-upsell', async (req, res) => {
  try {
    const { shopId, productIds } = req.body;
    
    if (!shopId || !productIds || !Array.isArray(productIds)) {
      return res.status(400).json({ error: 'shopId and productIds array are required' });
    }

    const allUpsells = {};
    
    for (const productId of productIds) {
      try {
        const upsellProducts = await aiEngine.findUpsellProducts(shopId, productId, 3);
        allUpsells[productId] = upsellProducts.map(p => p.productId);
      } catch (error) {
        console.error(`Error getting upsells for product ${productId}:`, error);
        allUpsells[productId] = [];
      }
    }
    
    res.json({
      success: true,
      upsells: allUpsells
    });
    
  } catch (error) {
    console.error('Bulk upsell error:', error);
    res.status(500).json({ 
      error: 'Failed to get bulk upsell recommendations',
      details: error.message 
    });
  }
});

/**
 * GET /api/products/store/:shopId
 * Get all products for a store (for admin/debugging)
 */
router.get('/store/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const products = await productService.getProductsByShop(shopId);
    
    res.json({
      success: true,
      products: products.map(p => ({
        productId: p.productId,
        title: p.title,
        category: p.aiData.category,
        brand: p.aiData.brand,
        color: p.aiData.color,
        style: p.aiData.style,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    });
    
  } catch (error) {
    console.error('Get store products error:', error);
    res.status(500).json({ 
      error: 'Failed to get store products',
      details: error.message 
    });
  }
});

export default router;