import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';

async function checkProducts() {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('ai-upsell');
    const productsCollection = db.collection('products');

    const shop = process.env.SHOP_CUSTOM_DOMAIN || 'shreyatestdemo.myshopify.com';

    // Get all products
    const products = await productsCollection.find({ shopId: shop }).limit(5).toArray();

    console.log(`\n📦 Found ${products.length} products for shop: ${shop}\n`);

    if (products.length > 0) {
      console.log('Sample product IDs:');
      products.forEach((p, i) => {
        console.log(`${i + 1}. Product ID: ${p.productId}`);
        console.log(`   Title: ${p.title}`);
        console.log(`   Handle: ${p.handle}`);
        console.log(`   Type: ${typeof p.productId}`);
        console.log(`   Images: ${p.images ? `${p.images.length} images` : 'NO IMAGES'}`);
        if (p.images && p.images.length > 0) {
          console.log(`   First Image: ${p.images[0].src?.substring(0, 60)}...`);
        }
        console.log('');
      });
    } else {
      console.log('❌ No products found! Run: npm run sync');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkProducts();
