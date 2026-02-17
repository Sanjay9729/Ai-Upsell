import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectToMongoDB() {
  if (db) return db;
  
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db('ai-upsell');
    console.log('Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function getDb() {
  if (!db) {
    await connectToMongoDB();
  }
  return db;
}

export async function closeMongoDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

// Collections
export const collections = {
  products: 'products',
  stores: 'stores',
  upsells: 'upsells',
  upsellEvents: 'upsell_events',
  cartEvents: 'cart_events',
  upsellRecommendations: 'upsell_recommendations'
};

export async function initializeCollections() {
  const database = await getDb();

  // Create indexes for better performance
  await database.collection(collections.products).createIndex({ shopId: 1, productId: 1 }, { unique: true });
  await database.collection(collections.products).createIndex({ shopId: 1, tags: 1 });
  await database.collection(collections.products).createIndex({ shopId: 1, vendor: 1 });
  await database.collection(collections.products).createIndex({ shopId: 1, productType: 1 });
  await database.collection(collections.upsells).createIndex({ shopId: 1, sourceProductId: 1 });

  // Upsell events collection indexes
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, eventType: 1 });
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, sourceProductId: 1 });
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, upsellProductId: 1 });
  await database.collection(collections.upsellEvents).createIndex({ isUpsellEvent: 1 });

  // Upsell recommendations collection indexes
  await database.collection(collections.upsellRecommendations).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.upsellRecommendations).createIndex({ shopId: 1, sourceProductId: 1 });
  await database.collection(collections.upsellRecommendations).createIndex({ shopId: 1, recommendationType: 1 });

  console.log('MongoDB collections initialized');
}