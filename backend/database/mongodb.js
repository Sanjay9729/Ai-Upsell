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
   upsellRecommendations: 'upsell_recommendations',
   cartEvents: 'cart_events',
   productTimeEvents: 'product_time_events',
   cartTimeEvents: 'cart_time_events',
   merchantConfig: 'merchant_config',
   offerLogs: 'offer_logs',
   offerControls: 'offer_controls',
   merchantIntelligence: 'merchant_intelligence',
   // V1 Autonomous Engine Collections
   bundles: 'bundles',
   bundleEvents: 'bundle_events',
   optimizationLogs: 'optimization_logs',
   decisionLogs: 'decision_logs',
   // Purchase & AOV tracking — Pillar 5
   orders: 'orders',
   purchaseEvents: 'purchase_events',
   aovImpact: 'aov_impact',
   // Learning & Optimization Loop scheduler — Pillar 5
   schedulerState: 'scheduler_state',
   optimizationHistory: 'optimization_history',
   // Response cache — instant upsell loads
   upsellResponseCache: 'upsell_response_cache',
   // Guardrail trigger audit log — Pillar 2
   guardrailEvents: 'guardrail_events'
 };

export async function initializeCollections() {
  const database = await getDb();

  // Response cache index — fast lookup by shop + product
  await database.collection(collections.upsellResponseCache).createIndex({ shopId: 1, productId: 1 }, { unique: true });

  // Create indexes for better performance
  await database.collection(collections.products).createIndex({ shopId: 1, productId: 1 }, { unique: true });
  await database.collection(collections.products).createIndex({ shopId: 1, tags: 1 });
  await database.collection(collections.products).createIndex({ shopId: 1, vendor: 1 });
  await database.collection(collections.products).createIndex({ shopId: 1, productType: 1 });
  await database.collection(collections.products).createIndex({ shopId: 1, collectionIds: 1 });
  await database.collection(collections.products).createIndex({ shopId: 1, collectionHandles: 1 });
  await database.collection(collections.upsells).createIndex({ shopId: 1, sourceProductId: 1 });

  // Upsell events collection indexes
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, eventType: 1 });
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, sourceProductId: 1 });
  await database.collection(collections.upsellEvents).createIndex({ shopId: 1, upsellProductId: 1 });
  await database.collection(collections.upsellEvents).createIndex({ isUpsellEvent: 1 });
  // Adaptive placement analytics index — Pillar 4
  await database.collection(collections.upsellEvents).createIndex(
    { shopId: 1, 'metadata.location': 1, eventType: 1, timestamp: -1 },
    { background: true }
  );

  // Upsell recommendations (optional archival)
  await database.collection(collections.upsellRecommendations).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.upsellRecommendations).createIndex({ shopId: 1, sourceProductId: 1 });

  // Product time events indexes
  await database.collection(collections.productTimeEvents).createIndex({ shop: 1, productId: 1 });
  await database.collection(collections.productTimeEvents).createIndex({ shop: 1, recordedAt: -1 });
  await database.collection(collections.productTimeEvents).createIndex({ userId: 1, shop: 1 });

  // Cart time events indexes (analytics-only)
  await database.collection(collections.cartTimeEvents).createIndex({ shop: 1, recordedAt: -1 });
  await database.collection(collections.cartTimeEvents).createIndex({ userId: 1, shop: 1 });

  // Merchant config index
  await database.collection(collections.merchantConfig).createIndex({ shopId: 1 }, { unique: true });

  // Merchandising intelligence (Pillar 6)
  await database.collection(collections.offerLogs).createIndex({ shopId: 1, createdAt: -1 });
  await database.collection(collections.offerLogs).createIndex({ shopId: 1, offerKey: 1 });
  await database.collection(collections.offerLogs).createIndex({ shopId: 1, upsellProductId: 1 });
  await database.collection(collections.offerLogs).createIndex({ shopId: 1, offerType: 1 });

  await database.collection(collections.offerControls).createIndex(
    { shopId: 1, offerKey: 1 },
    { unique: true }
  );
  await database.collection(collections.merchantIntelligence).createIndex({ shopId: 1 }, { unique: true });

  // Orders — Pillar 5 AOV tracking
  await database.collection(collections.orders).createIndex({ shopId: 1, createdAt: -1 });
  await database.collection(collections.orders).createIndex({ shopId: 1, orderId: 1 }, { unique: true });
  await database.collection(collections.orders).createIndex({ shopId: 1, hasUpsell: 1 });

  // Purchase events — Pillar 5
  await database.collection(collections.purchaseEvents).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.purchaseEvents).createIndex({ shopId: 1, upsellProductId: 1 });
  await database.collection(collections.purchaseEvents).createIndex({ shopId: 1, sourceProductId: 1 });
  await database.collection(collections.purchaseEvents).createIndex({ shopId: 1, orderId: 1 });
  await database.collection(collections.purchaseEvents).createIndex(
    { shopId: 1, sourceProductId: 1, upsellProductId: 1, timestamp: -1 }
  );

  // AOV impact tracking
  await database.collection(collections.aovImpact).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.aovImpact).createIndex({ shopId: 1, orderId: 1 });

  // Pillar 5 — Scheduler & optimization history
  await database.collection(collections.schedulerState).createIndex({ shopId: 1 }, { unique: true });
  await database.collection(collections.optimizationHistory).createIndex({ shopId: 1, startedAt: -1 });

  // Safety Mode — Pillar rollback & emergency stop
  await database.collection('safety_mode').createIndex({ shopId: 1 }, { unique: true });
  await database.collection('config_snapshots').createIndex({ shopId: 1, createdAt: -1 });

  // Guardrail Events — Pillar 2 audit log
  await database.collection(collections.guardrailEvents).createIndex({ shopId: 1, timestamp: -1 });
  await database.collection(collections.guardrailEvents).createIndex({ shopId: 1, guardrailType: 1 });

  console.log('MongoDB collections initialized');
  }
