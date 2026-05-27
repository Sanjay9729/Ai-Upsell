/**
 * Lightweight API server for the dashboard.
 * Runs alongside the dashboard Vite dev server to handle goal/guardrails saves
 * directly to MongoDB — bypasses Remix route issues in Vite dev mode.
 *
 * Usage: node dashboard/api-server.mjs
 * Listens on port 3900 by default.
 */
import { createServer } from 'http';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from the root directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const PORT = process.env.DASHBOARD_API_PORT || 3900;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';
const DB_NAME = 'ai-upsell';
const API_KEY = process.env.DASHBOARD_API_KEY || '';

let db;

async function getDb() {
  if (!db) {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB');
  }
  return db;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Key');
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  });
}

const VALID_GOALS = new Set(['increase_aov', 'revenue_per_visitor', 'subscription_adoption', 'inventory_movement']);
const VALID_RISKS = new Set(['conservative', 'balanced', 'aggressive']);

const server = createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // Only handle /api/dashboard/goal-guardrails
  if (!url.pathname.startsWith('/api/dashboard/goal-guardrails')) {
    return json(res, { error: 'Not found' }, 404);
  }

  const shop = url.searchParams.get('shop');
  if (!shop) return json(res, { error: 'Missing shop parameter' }, 400);

  if (API_KEY && req.headers['x-dashboard-key'] !== API_KEY) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  {
    const database = await getDb();
    const col = database.collection('merchant_config');

    // GET — load config
    if (req.method === 'GET') {
      const config = await col.findOne({ shopId: shop });
      return json(res, {
        goal: config?.goal || 'increase_aov',
        riskTolerance: config?.riskTolerance || 'balanced',
        offerDisplayMode: config?.offerDisplayMode || 'both',
        guardrails: config?.guardrails || {},
        savedAt: config?.updatedAt || null,
      });
    }

    // POST — save config
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const { goal, riskTolerance, offerDisplayMode, guardrails } = body;

      if (!VALID_GOALS.has(goal)) return json(res, { success: false, errors: [`Invalid goal: ${goal}`] }, 400);
      if (!VALID_RISKS.has(riskTolerance)) return json(res, { success: false, errors: [`Invalid risk: ${riskTolerance}`] }, 400);

      const now = new Date();
      await col.updateOne(
        { shopId: shop },
        {
          $set: {
            shopId: shop,
            goal,
            riskTolerance,
            offerDisplayMode: offerDisplayMode || 'both',
            guardrails: {
              maxDiscountCap: guardrails?.maxDiscountCap ?? 20,
              inventoryMinThreshold: guardrails?.inventoryMinThreshold ?? 0,
              sessionOfferLimit: guardrails?.sessionOfferLimit ?? 4,
              premiumSkuProtection: !!guardrails?.premiumSkuProtection,
              subscriptionProtection: !!guardrails?.subscriptionProtection,
              excludedProductIds: guardrails?.excludedProductIds || [],
              excludedProductHandles: guardrails?.excludedProductHandles || [],
              excludedCollectionIds: guardrails?.excludedCollectionIds || [],
              excludedCollectionHandles: guardrails?.excludedCollectionHandles || [],
            },
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );

      // Clear response cache so storefront picks up changes immediately
      await database.collection('upsell_response_cache').deleteMany({ shopId: shop });

      console.log(`✅ Saved config for ${shop}: goal=${goal} displayMode=${offerDisplayMode}`);
      return json(res, { success: true });
    }

    return json(res, { error: 'Method not allowed' }, 405);
  }
  } catch (err) {
    console.error('❌ API error:', err.message);
    if (!res.headersSent) {
      return json(res, { error: err.message }, 500);
    }
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Dashboard API server running on http://localhost:${PORT}`);
  console.log(`   Test: http://localhost:${PORT}/api/dashboard/goal-guardrails?shop=shreyatestdemo.myshopify.com`);
});
