import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { getAllProducts, syncProductsToMongoDB } from './backend/database/collections.js';
import { connectToMongoDB } from './backend/database/connection.js';
import { initializeCollections } from './backend/database/mongodb.js';
import analyticsRouter from './backend/routes/analytics.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (favicon, etc.)
app.use(express.static('public'));

// API Routes
app.use('/api/analytics', analyticsRouter);

// Get all products from MongoDB
app.get('/api/products', async (req, res) => {
  try {
    // Connect to MongoDB
    await connectToMongoDB();

    // Fetch all products
    const products = await getAllProducts();

    // Return JSON response
    res.json({
      success: true,
      count: products.length,
      products: products,
      timestamp: new Date().toISOString(),
      message: "Products retrieved successfully from MongoDB"
    });
  } catch (error) {
    console.error("Error in products API:", error);
    
    res.status(500).json({
      success: false,
      message: "Failed to fetch products from MongoDB",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});



// Sync products from Shopify to MongoDB (Step 1 of AI Upsell Flow)
app.post('/api/products/sync', async (req, res) => {
  try {
    const { shopId, accessToken } = req.body;
    
    if (!shopId || !accessToken) {
      return res.status(400).json({
        success: false,
        message: "shopId and accessToken are required"
      });
    }

    // Connect to MongoDB
    await connectToMongoDB();

    // Sync products from Shopify
    const syncedCount = await syncProductsToMongoDB(shopId, accessToken);

    res.json({
      success: true,
      count: syncedCount,
      message: `Successfully synced ${syncedCount} products from Shopify`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in products sync API:", error);
    
    res.status(500).json({
      success: false,
      message: "Failed to sync products from Shopify",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get upsell recommendations for a product (Step 3 & 4 of AI Upsell Flow)
app.get('/api/products/upsell/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { shopId } = req.query;
    
    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: "shopId query parameter is required"
      });
    }

    // Connect to MongoDB
    await connectToMongoDB();

    // Import Groq AI engine here to avoid circular dependencies
    const { GroqAIEngine } = await import('./backend/services/groqAIEngine.js');
    const aiEngine = new GroqAIEngine();
    
    // Get upsell recommendations from AI engine
    const upsellProducts = await aiEngine.findUpsellProducts(shopId, productId, 4);
    
    // Return product IDs (Step 4 of flow)
    res.json({
      success: true,
      upsellProductIds: upsellProducts.map(p => p.productId),
      recommendations: upsellProducts,
      timestamp: new Date().toISOString(),
      message: "Upsell recommendations retrieved successfully"
    });
  } catch (error) {
    console.error("Error in upsell API:", error);
    
    res.status(500).json({
      success: false,
      message: "Failed to get upsell recommendations",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    message: 'AI Upsell API server is running',
    version: '1.0.0'
  });
});

// Analytics Dashboard API
app.get('/api/analytics/dashboard/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { limit = 100 } = req.query;
    
    // Connect to MongoDB
    await connectToMongoDB();
    const { getDb } = await import('./backend/database/connection.js');
    const db = await getDb();
    
    // Get events from MongoDB
    const events = await db.collection('upsell_events')
      .find({ shopId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .toArray();
    
    res.json({
      success: true,
      analytics: {
        events,
        count: events.length
      },
      stats: null,
      period: {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      }
    });
  } catch (error) {
    console.error('Error in analytics dashboard endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      analytics: { events: [], count: 0 },
      stats: null
    });
  }
});

// Recent Analytics Events API
app.get('/api/analytics/recent/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { limit = 20 } = req.query;
    
    // Connect to MongoDB
    await connectToMongoDB();
    const { getDb } = await import('./backend/database/connection.js');
    const db = await getDb();
    
    // Get recent events from MongoDB
    const events = await db.collection('upsell_events')
      .find({ 
        shopId,
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .toArray();
    
    res.json({
      success: true,
      events,
      count: events.length
    });
  } catch (error) {
    console.error('Error in recent events endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      events: [],
      count: 0
    });
  }
});

// =============================================================================
// SHOPIFY WEBHOOK HANDLERS
// =============================================================================

/**
 * Verify Shopify webhook HMAC signature
 */
function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const shopifySecret = process.env.SHOPIFY_API_SECRET;
  
  if (!hmacHeader || !shopifySecret) {
    console.warn('❌ Missing HMAC or secret for webhook verification');
    return res.status(401).json({ error: 'Missing HMAC or secret' });
  }

  const body = JSON.stringify(req.body);
  const calculatedHmac = crypto
    .createHmac('sha256', shopifySecret)
    .update(body, 'utf8')
    .digest('base64');

  if (calculatedHmac !== hmacHeader) {
    console.warn('❌ Invalid HMAC signature for webhook');
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  console.log('✅ Webhook HMAC verified successfully');
  next();
}

// Product Create Webhook
app.post('/api/webhooks/products/create', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    const productId = req.body.id;
    const accessToken = req.get('X-Shopify-Access-Token');
    
    console.log(`📦 Received product create webhook for product ${productId} from shop ${shop_domain}`);
    
    if (!shop_id || !accessToken) {
      return res.status(400).json({ error: 'Missing shop_id or access token' });
    }

    // Sync the single product to MongoDB
    const syncedCount = await syncProductsToMongoDB(shop_domain, accessToken);
    
    console.log(`✅ Product ${productId} synced for shop ${shop_domain}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Product create webhook processed',
      syncedCount 
    });
    
  } catch (error) {
    console.error('❌ Product create webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process product create webhook',
      details: error.message 
    });
  }
});

// Product Update Webhook
app.post('/api/webhooks/products/update', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    const productId = req.body.id;
    const accessToken = req.get('X-Shopify-Access-Token');
    
    console.log(`📦 Received product update webhook for product ${productId} from shop ${shop_domain}`);
    
    if (!shop_id || !accessToken) {
      return res.status(400).json({ error: 'Missing shop_id or access token' });
    }

    // Sync the updated product to MongoDB
    const syncedCount = await syncProductsToMongoDB(shop_domain, accessToken);
    
    console.log(`✅ Product ${productId} updated for shop ${shop_domain}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Product update webhook processed',
      syncedCount 
    });
    
  } catch (error) {
    console.error('❌ Product update webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process product update webhook',
      details: error.message 
    });
  }
});

// Product Delete Webhook
app.post('/api/webhooks/products/delete', verifyShopifyWebhook, async (req, res) => {
  try {
    const { shop_id, shop_domain } = req.body;
    const productId = req.body.id;
    
    console.log(`📦 Received product delete webhook for product ${productId} from shop ${shop_domain}`);
    
    if (!shop_id) {
      return res.status(400).json({ error: 'Missing shop_id' });
    }

    // Remove product from MongoDB
    await connectToMongoDB();
    const { deleteProduct } = await import('./backend/database/collections.js');
    
    await deleteProduct(shop_domain, productId);
    
    console.log(`🗑️ Product ${productId} deleted for shop ${shop_domain}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'Product delete webhook processed' 
    });
    
  } catch (error) {
    console.error('❌ Product delete webhook error:', error);
    res.status(500).json({ 
      error: 'Failed to process product delete webhook',
      details: error.message 
    });
  }
});

// Initialize collections and indexes
async function startServer() {
  try {
    // Connect to MongoDB and initialize collections
    await connectToMongoDB();
    await initializeCollections();
    console.log('📊 All collections and indexes initialized successfully');
    
    // Start the Express server
    app.listen(PORT, () => {
      console.log('');
      console.log('╭─ info ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮');
      console.log('│                                                                                                                                                │');
      console.log('│  AI Upsell API Server Started Successfully                                                                                                   │');
      console.log('│                                                                                                                                                │');
      console.log('│   • Server URL:     http://localhost:' + PORT + '                                                                                                │');
      console.log('│   • MongoDB:        Connected and initialized                                                                                                   │');
      console.log('│   • Groq AI:        Active with your API key                                                                                                    │');
      console.log('│   • Shopify:        Configured with your credentials                                                                                            │');
      console.log('│                                                                                                                                                │');
      console.log('╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯');
      console.log('');
      console.log('╭─ API Endpoints ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮');
      console.log('│                                                                                                                                                │');
      console.log('│   [GET]  Products API:                    http://localhost:' + PORT + '/api/products                                                             │');
      console.log('│   [POST] Product Sync API:                http://localhost:' + PORT + '/api/products/sync                                                        │');
      console.log('│   [GET]  Upsell Recommendations:          http://localhost:' + PORT + '/api/products/upsell/1234567890?shopId=your-store.myshopify.com        │');
      console.log('│   [GET]  Health Check:                    http://localhost:' + PORT + '/api/health                                                              │');
      console.log('│                                                                                                                                                │');
      console.log('╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯');
      console.log('');
      console.log('╭─ Quick Commands ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮');
      console.log('│                                                                                                                                                │');
      console.log('│   🔄 Sync Shopify Products:              npm run sync                                                                                           │');
      console.log('│   🧪 Test AI Integration:                npm run test:ai                                                                                        │');
      console.log('│   ❤️  Health Check:                       curl http://localhost:' + PORT + '/api/health                                                           │');
      console.log('│                                                                                                                                                │');
      console.log('╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯');
      console.log('');
      console.log('✅ Ready, watching for changes in your AI Upsell system                                                                                           ');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();