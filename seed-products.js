/**
 * Seed 50 diverse dummy products into the connected Shopify store via the
 * Admin REST API. Once created, the `products/create` webhook will sync them
 * into MongoDB automatically.
 *
 * Usage:
 *   node seed-products.js            # creates 50 products
 *   node seed-products.js 25         # creates N products (capped at templates * cycles)
 *   node seed-products.js --dry-run  # prints what would be created
 *   node seed-products.js --cleanup  # deletes products tagged "ai-upsell-seed"
 *
 * Requires in .env:
 *   SHOP_CUSTOM_DOMAIN=your-store.myshopify.com
 *   SHOPIFY_ACCESS_TOKEN=shpat_xxx (scopes: write_products)
 */

import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { MongoClient } from 'mongodb';

dotenv.config();

const SHOP = process.env.SHOP_CUSTOM_DOMAIN;
let TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';
const API_VERSION = '2024-10';
const SEED_TAG = 'ai-upsell-seed';

// ---- CLI args ----
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isCleanup = args.includes('--cleanup');
const countArg = args.find((a) => /^\d+$/.test(a));
const TOTAL = countArg ? parseInt(countArg, 10) : 50;

if (!SHOP) {
  console.error('❌ Missing SHOP_CUSTOM_DOMAIN in .env');
  process.exit(1);
}

/**
 * Resolve the Shopify Admin API access token.
 * Prefers SHOPIFY_ACCESS_TOKEN from .env; falls back to the offline session
 * stored in MongoDB (`shopify_sessions`) by @shopify/shopify-app-session-storage-mongodb.
 */
async function resolveAccessToken() {
  if (TOKEN && TOKEN.trim().length > 0) return TOKEN;

  console.log('🔑 SHOPIFY_ACCESS_TOKEN missing in .env — falling back to MongoDB session storage...');
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db('ai-upsell');
    const session = await db.collection('shopify_sessions').findOne({
      shop: SHOP,
      isOnline: false,
      accessToken: { $exists: true, $ne: null }
    });
    if (!session?.accessToken) {
      throw new Error(`No offline session found for ${SHOP} in shopify_sessions collection`);
    }
    console.log(`✅ Loaded offline token from session: ${session.id}`);
    return session.accessToken;
  } finally {
    await client.close();
  }
}

// ---- Product templates (diverse categories for realistic upsell testing) ----
const TEMPLATES = [
  // Electronics
  { type: 'Electronics', vendor: 'TechNova', title: 'Wireless Bluetooth Earbuds', price: 49.99, compare: 79.99, tags: ['audio', 'wireless', 'bluetooth'], img: 'https://picsum.photos/seed/earbuds/800/800' },
  { type: 'Electronics', vendor: 'TechNova', title: 'Noise Cancelling Headphones', price: 129.99, compare: 199.99, tags: ['audio', 'premium', 'headphones'], img: 'https://picsum.photos/seed/headphones/800/800' },
  { type: 'Electronics', vendor: 'ChargePro', title: 'Fast Charging Power Bank 20000mAh', price: 39.99, compare: 59.99, tags: ['charger', 'portable', 'travel'], img: 'https://picsum.photos/seed/powerbank/800/800' },
  { type: 'Electronics', vendor: 'ChargePro', title: 'USB-C Charging Cable 6ft', price: 12.99, compare: 19.99, tags: ['cable', 'accessory', 'usb-c'], img: 'https://picsum.photos/seed/cable/800/800' },
  { type: 'Electronics', vendor: 'TechNova', title: 'Smart Watch Fitness Tracker', price: 89.99, compare: 129.99, tags: ['wearable', 'fitness', 'smart'], img: 'https://picsum.photos/seed/smartwatch/800/800' },
  { type: 'Electronics', vendor: 'SoundWave', title: 'Portable Bluetooth Speaker', price: 59.99, compare: 89.99, tags: ['audio', 'speaker', 'portable'], img: 'https://picsum.photos/seed/speaker/800/800' },
  { type: 'Electronics', vendor: 'ViewMax', title: '4K Webcam for Streaming', price: 79.99, compare: 119.99, tags: ['camera', 'streaming', 'work'], img: 'https://picsum.photos/seed/webcam/800/800' },
  { type: 'Electronics', vendor: 'ChargePro', title: 'Wireless Charging Pad', price: 24.99, compare: 39.99, tags: ['charger', 'wireless', 'accessory'], img: 'https://picsum.photos/seed/wirelesspad/800/800' },

  // Apparel
  { type: 'Apparel', vendor: 'UrbanThread', title: 'Classic Cotton T-Shirt', price: 19.99, compare: 29.99, tags: ['clothing', 'casual', 'cotton'], img: 'https://picsum.photos/seed/tshirt/800/800' },
  { type: 'Apparel', vendor: 'UrbanThread', title: 'Slim Fit Denim Jeans', price: 49.99, compare: 79.99, tags: ['clothing', 'denim', 'casual'], img: 'https://picsum.photos/seed/jeans/800/800' },
  { type: 'Apparel', vendor: 'NorthPeak', title: 'Waterproof Rain Jacket', price: 89.99, compare: 139.99, tags: ['clothing', 'outdoor', 'waterproof'], img: 'https://picsum.photos/seed/jacket/800/800' },
  { type: 'Apparel', vendor: 'UrbanThread', title: 'Cozy Hooded Sweatshirt', price: 44.99, compare: 64.99, tags: ['clothing', 'casual', 'hoodie'], img: 'https://picsum.photos/seed/hoodie/800/800' },
  { type: 'Apparel', vendor: 'FitZone', title: 'Performance Running Shorts', price: 29.99, compare: 44.99, tags: ['clothing', 'fitness', 'active'], img: 'https://picsum.photos/seed/shorts/800/800' },

  // Footwear
  { type: 'Footwear', vendor: 'StrideCo', title: 'Athletic Running Shoes', price: 79.99, compare: 119.99, tags: ['shoes', 'fitness', 'running'], img: 'https://picsum.photos/seed/runningshoes/800/800' },
  { type: 'Footwear', vendor: 'StrideCo', title: 'Casual Canvas Sneakers', price: 49.99, compare: 69.99, tags: ['shoes', 'casual', 'canvas'], img: 'https://picsum.photos/seed/sneakers/800/800' },
  { type: 'Footwear', vendor: 'TrailKing', title: 'Leather Hiking Boots', price: 139.99, compare: 199.99, tags: ['shoes', 'outdoor', 'hiking'], img: 'https://picsum.photos/seed/boots/800/800' },

  // Accessories
  { type: 'Accessories', vendor: 'LuxeLeather', title: 'Genuine Leather Wallet', price: 34.99, compare: 54.99, tags: ['accessory', 'leather', 'wallet'], img: 'https://picsum.photos/seed/wallet/800/800' },
  { type: 'Accessories', vendor: 'TimeLux', title: 'Stainless Steel Wristwatch', price: 99.99, compare: 149.99, tags: ['accessory', 'watch', 'classic'], img: 'https://picsum.photos/seed/watch/800/800' },
  { type: 'Accessories', vendor: 'SunShade', title: 'Polarized Sunglasses', price: 29.99, compare: 49.99, tags: ['accessory', 'sunglasses', 'summer'], img: 'https://picsum.photos/seed/sunglasses/800/800' },
  { type: 'Accessories', vendor: 'UrbanBag', title: 'Canvas Backpack', price: 54.99, compare: 79.99, tags: ['accessory', 'backpack', 'travel'], img: 'https://picsum.photos/seed/backpack/800/800' },
  { type: 'Accessories', vendor: 'UrbanBag', title: 'Leather Crossbody Bag', price: 69.99, compare: 109.99, tags: ['accessory', 'bag', 'leather'], img: 'https://picsum.photos/seed/crossbody/800/800' },
  { type: 'Accessories', vendor: 'CapCity', title: 'Classic Baseball Cap', price: 19.99, compare: 29.99, tags: ['accessory', 'hat', 'casual'], img: 'https://picsum.photos/seed/cap/800/800' },

  // Home & Kitchen
  { type: 'Home & Kitchen', vendor: 'BrewMaster', title: 'Stainless Steel Coffee Maker', price: 89.99, compare: 139.99, tags: ['home', 'kitchen', 'coffee'], img: 'https://picsum.photos/seed/coffeemaker/800/800' },
  { type: 'Home & Kitchen', vendor: 'BrewMaster', title: 'Insulated Travel Mug 16oz', price: 24.99, compare: 34.99, tags: ['home', 'kitchen', 'travel'], img: 'https://picsum.photos/seed/mug/800/800' },
  { type: 'Home & Kitchen', vendor: 'ChefEdge', title: 'Professional Chef Knife Set', price: 119.99, compare: 179.99, tags: ['home', 'kitchen', 'cookware'], img: 'https://picsum.photos/seed/knifeset/800/800' },
  { type: 'Home & Kitchen', vendor: 'ChefEdge', title: 'Bamboo Cutting Board Set', price: 29.99, compare: 49.99, tags: ['home', 'kitchen', 'bamboo'], img: 'https://picsum.photos/seed/cuttingboard/800/800' },
  { type: 'Home & Kitchen', vendor: 'GlowLamp', title: 'LED Desk Lamp with USB Port', price: 39.99, compare: 59.99, tags: ['home', 'lamp', 'office'], img: 'https://picsum.photos/seed/desklamp/800/800' },
  { type: 'Home & Kitchen', vendor: 'CozyHome', title: 'Memory Foam Throw Pillow', price: 22.99, compare: 34.99, tags: ['home', 'decor', 'pillow'], img: 'https://picsum.photos/seed/pillow/800/800' },
  { type: 'Home & Kitchen', vendor: 'CozyHome', title: 'Soft Cotton Throw Blanket', price: 44.99, compare: 69.99, tags: ['home', 'decor', 'blanket'], img: 'https://picsum.photos/seed/blanket/800/800' },
  { type: 'Home & Kitchen', vendor: 'ScentCo', title: 'Aromatherapy Essential Oil Diffuser', price: 34.99, compare: 54.99, tags: ['home', 'wellness', 'aromatherapy'], img: 'https://picsum.photos/seed/diffuser/800/800' },

  // Beauty & Personal Care
  { type: 'Beauty', vendor: 'PureGlow', title: 'Hydrating Face Moisturizer', price: 24.99, compare: 39.99, tags: ['beauty', 'skincare', 'face'], img: 'https://picsum.photos/seed/moisturizer/800/800' },
  { type: 'Beauty', vendor: 'PureGlow', title: 'Vitamin C Serum', price: 29.99, compare: 49.99, tags: ['beauty', 'skincare', 'serum'], img: 'https://picsum.photos/seed/serum/800/800' },
  { type: 'Beauty', vendor: 'LushLocks', title: 'Argan Oil Hair Treatment', price: 19.99, compare: 29.99, tags: ['beauty', 'haircare', 'oil'], img: 'https://picsum.photos/seed/hairoil/800/800' },
  { type: 'Beauty', vendor: 'FreshScent', title: 'Eau de Parfum 50ml', price: 49.99, compare: 79.99, tags: ['beauty', 'fragrance', 'perfume'], img: 'https://picsum.photos/seed/perfume/800/800' },

  // Fitness & Sports
  { type: 'Fitness', vendor: 'FitZone', title: 'Premium Yoga Mat', price: 39.99, compare: 59.99, tags: ['fitness', 'yoga', 'mat'], img: 'https://picsum.photos/seed/yogamat/800/800' },
  { type: 'Fitness', vendor: 'FitZone', title: 'Resistance Band Set', price: 24.99, compare: 39.99, tags: ['fitness', 'exercise', 'strength'], img: 'https://picsum.photos/seed/bands/800/800' },
  { type: 'Fitness', vendor: 'HydroFit', title: 'Insulated Stainless Steel Water Bottle', price: 19.99, compare: 29.99, tags: ['fitness', 'hydration', 'bottle'], img: 'https://picsum.photos/seed/bottle/800/800' },
  { type: 'Fitness', vendor: 'FitZone', title: 'Adjustable Dumbbell Set', price: 149.99, compare: 229.99, tags: ['fitness', 'strength', 'home-gym'], img: 'https://picsum.photos/seed/dumbbells/800/800' },

  // Office & Stationery
  { type: 'Office', vendor: 'WriteRight', title: 'Leather-Bound Journal Notebook', price: 18.99, compare: 29.99, tags: ['office', 'stationery', 'journal'], img: 'https://picsum.photos/seed/journal/800/800' },
  { type: 'Office', vendor: 'WriteRight', title: 'Premium Ballpoint Pen Set', price: 14.99, compare: 24.99, tags: ['office', 'stationery', 'pen'], img: 'https://picsum.photos/seed/pens/800/800' },
  { type: 'Office', vendor: 'DeskPro', title: 'Ergonomic Mouse Pad', price: 16.99, compare: 24.99, tags: ['office', 'desk', 'ergonomic'], img: 'https://picsum.photos/seed/mousepad/800/800' },

  // Toys & Games
  { type: 'Toys', vendor: 'PlayCo', title: 'Wooden Puzzle for Kids', price: 22.99, compare: 34.99, tags: ['toys', 'kids', 'educational'], img: 'https://picsum.photos/seed/puzzle/800/800' },
  { type: 'Toys', vendor: 'PlayCo', title: 'Classic Board Game', price: 29.99, compare: 44.99, tags: ['toys', 'family', 'games'], img: 'https://picsum.photos/seed/boardgame/800/800' },

  // Pet Supplies
  { type: 'Pet Supplies', vendor: 'PawPal', title: 'Durable Dog Chew Toy', price: 12.99, compare: 19.99, tags: ['pet', 'dog', 'toy'], img: 'https://picsum.photos/seed/dogtoy/800/800' },
  { type: 'Pet Supplies', vendor: 'PawPal', title: 'Reflective Dog Collar', price: 14.99, compare: 22.99, tags: ['pet', 'dog', 'collar'], img: 'https://picsum.photos/seed/dogcollar/800/800' },
  { type: 'Pet Supplies', vendor: 'WhiskerWorld', title: 'Interactive Cat Toy', price: 16.99, compare: 24.99, tags: ['pet', 'cat', 'toy'], img: 'https://picsum.photos/seed/cattoy/800/800' },

  // Outdoor
  { type: 'Outdoor', vendor: 'TrailKing', title: 'Compact Camping Tent 2-Person', price: 89.99, compare: 139.99, tags: ['outdoor', 'camping', 'tent'], img: 'https://picsum.photos/seed/tent/800/800' },
  { type: 'Outdoor', vendor: 'TrailKing', title: 'Sleeping Bag All Season', price: 59.99, compare: 89.99, tags: ['outdoor', 'camping', 'sleeping'], img: 'https://picsum.photos/seed/sleepingbag/800/800' },
  { type: 'Outdoor', vendor: 'TrailKing', title: 'Portable Camping Stove', price: 44.99, compare: 69.99, tags: ['outdoor', 'camping', 'cooking'], img: 'https://picsum.photos/seed/stove/800/800' },
  { type: 'Outdoor', vendor: 'TrailKing', title: 'LED Headlamp Flashlight', price: 19.99, compare: 29.99, tags: ['outdoor', 'camping', 'light'], img: 'https://picsum.photos/seed/headlamp/800/800' },
];

// ---- Helpers ----
const BASE = `https://${SHOP}/admin/api/${API_VERSION}`;

function buildHeaders() {
  return {
    'X-Shopify-Access-Token': TOKEN,
    'Content-Type': 'application/json',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildDescription(t) {
  return `<p><strong>${t.title}</strong> by ${t.vendor}.</p>
<p>Experience premium quality with our ${t.title.toLowerCase()}. Perfect for ${t.tags.slice(0, 2).join(' and ')} enthusiasts.</p>
<ul>
  <li>High-quality materials</li>
  <li>Durable and long-lasting</li>
  <li>Backed by 30-day satisfaction guarantee</li>
  <li>Free shipping on orders over $50</li>
</ul>`;
}

function buildProductPayload(t, suffix) {
  const title = suffix ? `${t.title} ${suffix}` : t.title;
  return {
    product: {
      title,
      body_html: buildDescription({ ...t, title }),
      vendor: t.vendor,
      product_type: t.type,
      status: 'active',
      tags: [...t.tags, SEED_TAG].join(', '),
      variants: [
        {
          price: t.price.toFixed(2),
          compare_at_price: t.compare.toFixed(2),
          sku: `SEED-${t.vendor.toUpperCase().replace(/\s+/g, '')}-${Math.floor(Math.random() * 1e6)}`,
          inventory_management: 'shopify',
          inventory_quantity: 100,
          requires_shipping: true,
          taxable: true,
          weight: 0.5,
          weight_unit: 'kg',
        },
      ],
      images: [{ src: t.img, alt: title }],
    },
  };
}

async function createProduct(payload) {
  const res = await fetch(`${BASE}/products.json`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body.product;
}

async function cleanupSeedProducts() {
  console.log(`🧹 Cleaning up products tagged "${SEED_TAG}"...`);
  let deleted = 0;
  let pageInfo = null;

  // Paginate through all seed-tagged products
  // Shopify REST supports ?tag= filter for products
  let url = `${BASE}/products.json?limit=250&fields=id,title,tags`;

  while (url) {
    const res = await fetch(url, { headers: buildHeaders() });
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);

    const matches = (body.products || []).filter((p) =>
      (p.tags || '').split(',').map((s) => s.trim()).includes(SEED_TAG)
    );

    for (const p of matches) {
      const delRes = await fetch(`${BASE}/products/${p.id}.json`, {
        method: 'DELETE',
        headers: buildHeaders(),
      });
      if (delRes.ok) {
        deleted++;
        console.log(`  🗑  Deleted ${p.id} — ${p.title}`);
      } else {
        const errText = await delRes.text();
        console.warn(`  ⚠️  Failed to delete ${p.id}: ${delRes.status} ${errText}`);
      }
      await sleep(350); // respect 2 req/sec REST limit
    }

    // Parse Link header for pagination
    const link = res.headers.get('link');
    const next = link && link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  console.log(`✅ Cleanup complete. Removed ${deleted} seed products.`);
}

async function seed() {
  console.log(`🌱 Seeding ${TOTAL} dummy products into ${SHOP}${isDryRun ? ' [DRY RUN]' : ''}`);

  const results = { created: 0, failed: 0, errors: [] };

  for (let i = 0; i < TOTAL; i++) {
    const template = TEMPLATES[i % TEMPLATES.length];
    // Append suffix on repeats to keep titles unique
    const cycle = Math.floor(i / TEMPLATES.length);
    const suffix = cycle > 0 ? `- Variant ${cycle + 1}` : '';
    const payload = buildProductPayload(template, suffix);

    if (isDryRun) {
      console.log(`  [${i + 1}/${TOTAL}] ${payload.product.title} — $${template.price}`);
      results.created++;
      continue;
    }

    try {
      const product = await createProduct(payload);
      results.created++;
      console.log(`  ✅ [${i + 1}/${TOTAL}] Created #${product.id} — ${product.title}`);
    } catch (err) {
      results.failed++;
      results.errors.push({ title: payload.product.title, error: err.message });
      console.error(`  ❌ [${i + 1}/${TOTAL}] Failed: ${payload.product.title} — ${err.message}`);
    }

    // Shopify REST Admin API: 2 req/sec for standard plans
    await sleep(550);
  }

  console.log(`\n📊 Summary: ${results.created} created, ${results.failed} failed`);
  if (results.failed > 0) {
    console.log('\nErrors:');
    results.errors.forEach((e) => console.log(`  - ${e.title}: ${e.error}`));
  }
}

(async () => {
  try {
    // Dry run doesn't need a real token
    if (!isDryRun) {
      TOKEN = await resolveAccessToken();
    }

    if (isCleanup) {
      await cleanupSeedProducts();
    } else {
      await seed();
    }
  } catch (err) {
    console.error('❌ Fatal:', err.message || err);
    process.exit(1);
  }
})();
