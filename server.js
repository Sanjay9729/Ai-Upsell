import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getAllProducts, syncProductsToMongoDB } from './backend/database/collections.js';
import { connectToMongoDB } from './backend/database/connection.js';

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

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╭─ info ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮');
  console.log('│                                                                                                                                                │');
  console.log('│  AI Upsell API Server Started Successfully                                                                                                   │');
  console.log('│                                                                                                                                                │');
  console.log('│   • Server URL:     http://localhost:' + PORT + '                                                                                                │');
  console.log('│   • MongoDB:        Ready to connect                                                                                                           │');
  console.log('│   • Groq AI:        Active with your API key                                                                                                    │');
  console.log('│   • Shopify:        Configured with your credentials                                                                                            │');
  console.log('│                                                                                                                                                │');
  console.log('╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯');
  console.log('');
  console.log('╭─ API Endpoints ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮');
  console.log('│                                                                                                                                                │');
  console.log('│   [GET]  Products API:                    http://localhost:' + PORT + '/api/products                                                             │');
  console.log('│   [POST] Product Sync API:                http://localhost:' + PORT + '/api/products/sync                                                        │');
  console.log('│   [GET]  Upsell Recommendations:          http://localhost:' + PORT + '/api/products/upsell/:productId                                          │');
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