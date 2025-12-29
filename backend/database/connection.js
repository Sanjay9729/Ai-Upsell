import { MongoClient } from 'mongodb';

let client;
let db;

/**
 * Connect to MongoDB
 * This function establishes a connection to MongoDB and returns the database instance
 */
export async function connectToMongoDB() {
  if (db) return db;
  
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db('ai-upsell');
    console.log('✅ Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Get database instance
 * Returns the existing database connection or creates a new one
 */
export async function getDb() {
  if (!db) {
    await connectToMongoDB();
  }
  return db;
}

/**
 * Close MongoDB connection
 * Clean up the connection when shutting down
 */
export async function closeMongoDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('🔌 MongoDB connection closed');
  }
}