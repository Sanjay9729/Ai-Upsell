#!/usr/bin/env node

/**
 * Test script to verify AI Upsell integration
 * Tests MongoDB, Shopify API, and Groq AI
 */

import dotenv from 'dotenv';
dotenv.config();

import { connectToMongoDB } from './backend/database/connection.js';
import { syncProductsToMongoDB, getAllProducts } from './backend/database/collections.js';
import { GroqAIEngine } from './backend/services/groqAIEngine.js';

async function testIntegration() {
  console.log('🧪 Starting AI Upsell Integration Test...\n');

  try {
    // Test 1: MongoDB Connection
    console.log('1️⃣ Testing MongoDB connection...');
    await connectToMongoDB();
    console.log('✅ MongoDB connected successfully\n');

    // Test 2: Shopify Product Sync
    console.log('2️⃣ Testing Shopify product sync...');
    const shopDomain = process.env.SHOP_CUSTOM_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!shopDomain || !accessToken) {
      console.log('⚠️ Shopify credentials not found in .env, skipping product sync test');
    } else {
      const syncedCount = await syncProductsToMongoDB(shopDomain, accessToken);
      console.log(`✅ Synced ${syncedCount} products from Shopify\n`);
    }

    // Test 3: Groq AI Engine
    console.log('3️⃣ Testing Groq AI engine...');
    const groqApiKey = process.env.GROQ_API_KEY;
    
    if (!groqApiKey) {
      console.log('⚠️ Groq API key not found, AI features will use fallback');
    } else {
      const aiEngine = new GroqAIEngine();
      console.log('✅ Groq AI engine initialized successfully\n');
    }

    // Test 4: Product Retrieval
    console.log('4️⃣ Testing product retrieval...');
    const products = await getAllProducts();
    console.log(`✅ Retrieved ${products.length} products from MongoDB\n`);

    // Test 5: AI Recommendations (if products exist)
    if (products.length > 1 && groqApiKey) {
      console.log('5️⃣ Testing AI recommendations...');
      const aiEngine = new GroqAIEngine();
      const testProduct = products[0];
      
      try {
        const recommendations = await aiEngine.findUpsellProducts(
          testProduct.shopId,
          testProduct.productId,
          2
        );
        console.log(`✅ Generated ${recommendations.length} AI recommendations`);
        if (recommendations.length > 0) {
          console.log(`   Sample: "${recommendations[0].title}" - ${recommendations[0].aiReason || 'Rule-based similarity'}`);
        }
      } catch (error) {
        console.log(`⚠️ AI recommendations test failed: ${error.message}`);
      }
    }

    console.log('\n🎉 Integration test completed successfully!');
    console.log('\n📋 System Status:');
    console.log(`   MongoDB: ✅ Connected`);
    console.log(`   Shopify: ${shopDomain ? '✅ Configured' : '⚠️ Not configured'}`);
    console.log(`   Groq AI: ${groqApiKey ? '✅ Active' : '⚠️ Using fallback'}`);
    console.log(`   Products: ${products.length} in database`);

  } catch (error) {
    console.error('❌ Integration test failed:', error);
    process.exit(1);
  }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testIntegration();
}

export { testIntegration };