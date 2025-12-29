import express from 'express';
import crypto from 'crypto';
import { ProductService } from '../services/productService.js';
import { getShopifyClient } from '../services/shopifyService.js';
import { getDb, collections } from '../database/mongodb.js';

const router = express.Router();
const productService = new ProductService();

/**
 * Verify Shopify webhook HMAC signature
 */
function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const shopifySecret = process.env.SHOPIFY_APP_SECRET;
  
  if (!hmacHeader || !shopifySecret) {
    return res.status(401).json({ error: 'Missing HMAC or secret' });
  }

  const body = JSON.stringify(req.body);
  const calculatedHmac = crypto
    .createHmac('sha256', shopifySecret)
    .update(body, 'utf8')
    .digest('base64');

  if (calculatedHmac !== hmacHeader) {
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  next();
}

/**
 * POST /api/webhooks/products/create
 * Handle new product creation webhook
 */
router.post('/products/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    const productId = req.body.id;
    const accessToken = req.get('X-Shopify-Access-Token');
    
    if (!shop_id || !accessToken) {
      return res.status(400).json({ error: 'Missing shop_id or access token' });
    }

    // Get the updated product from Shopify
    const shopify = getShopifyClient(shop_domain, accessToken);
    const product = await shopify.product.get(productId);
    
    // Sync the single product to MongoDB
    const syncedCount = await productService.syncProducts(shop_domain, [product]);
    
    console.log(`Product ${productId} synced for shop ${shop_domain}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Product created webhook processed',
      syncedCount 
    });
    
  } catch (error) {
    console.error('Product create webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process product create webhook',
      details: error.message 
    });
  }
});

/**
 * POST /api/webhooks/products/update
 * Handle product update webhook
 */
router.post('/products/update', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    const productId = req.body.id;
    const accessToken = req.get('X-Shopify-Access-Token');
    
    if (!shop_id || !accessToken) {
      return res.status(400).json({ error: 'Missing shop_id or access token' });
    }

    // Get the updated product from Shopify
    const shopify = getShopifyClient(shop_domain, accessToken);
    const product = await shopify.product.get(productId);
    
    // Sync the updated product to MongoDB
    const syncedCount = await productService.syncProducts(shop_domain, [product]);
    
    console.log(`Product ${productId} updated for shop ${shop_domain}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Product update webhook processed',
      syncedCount 
    });
    
  } catch (error) {
    console.error('Product update webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process product update webhook',
      details: error.message 
    });
  }
});

/**
 * POST /api/webhooks/products/delete
 * Handle product deletion webhook
 */
router.post('/products/delete', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    const productId = req.body.id;
    
    if (!shop_id) {
      return res.status(400).json({ error: 'Missing shop_id' });
    }

    // Remove product from MongoDB
    const db = await getDb();
    const productsCollection = db.collection(collections.products);
    
    await productsCollection.deleteOne({ 
      shopId: shop_domain, 
      productId: productId 
    });
    
    console.log(`Product ${productId} deleted for shop ${shop_domain}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Product delete webhook processed' 
    });
    
  } catch (error) {
    console.error('Product delete webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process product delete webhook',
      details: error.message 
    });
  }
});

/**
 * POST /api/webhooks/app/uninstalled
 * Handle app uninstall webhook
 */
router.post('/app/uninstalled', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    
    if (!shop_id) {
      return res.status(400).json({ error: 'Missing shop_id' });
    }

    // Clean up shop data from MongoDB
    const db = await getDb();
    
    await db.collection(collections.products).deleteMany({ shopId: shop_domain });
    await db.collection(collections.stores).deleteOne({ shopId: shop_domain });
    await db.collection(collections.upsells).deleteMany({ shopId: shop_domain });
    
    console.log(`Shop ${shop_domain} data cleaned up after uninstall`);
    
    res.status(200).json({ 
      success: true, 
      message: 'App uninstall webhook processed' 
    });
    
  } catch (error) {
    console.error('App uninstall webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process app uninstall webhook',
      details: error.message 
    });
  }
});

export default router;