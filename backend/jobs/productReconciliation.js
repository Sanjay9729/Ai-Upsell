import shopify from "../../app/shopify.server.js";
import { connectToMongoDB, getDb } from "../database/connection.js";
import {
  pruneProductsNotInList,
  syncProductsWithGraphQL
} from "../database/collections.js";

let running = false;
let timer = null;

function getConfig() {
  return {
    intervalMinutes: Number(process.env.RECONCILE_INTERVAL_MINUTES || 60),
    startDelayMs: Number(process.env.RECONCILE_START_DELAY_MS || 15000),
    shopDelayMs: Number(process.env.RECONCILE_SHOP_DELAY_MS || 250),
    enabled: process.env.RECONCILE_ENABLED !== "false",
    runOnStart: process.env.RECONCILE_ON_START !== "false",
    shopLimit: Number(process.env.RECONCILE_SHOP_LIMIT || 0)
  };
}

function getIntervalMs() {
  const { intervalMinutes } = getConfig();
  const minutes = Number.isFinite(intervalMinutes)
    ? Math.max(intervalMinutes, 5)
    : 60;
  return minutes * 60 * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getShopsFromSessions() {
  await connectToMongoDB();
  const db = await getDb();
  const shops = await db.collection("shopify_sessions").distinct("shop");
  const filtered = shops.filter(Boolean);
  const { shopLimit } = getConfig();
  if (shopLimit > 0) return filtered.slice(0, shopLimit);
  return filtered;
}

async function getOfflineSession(shop) {
  const sessions = await shopify.sessionStorage.findSessionsByShop(shop);
  return sessions.find((s) => !s.isOnline && s.accessToken);
}

function makeAdminGraphQL(session) {
  const client = new shopify.api.clients.Graphql({ session });
  return async (query, options) => {
    const body = await client.request(query, options);
    return { json: async () => body };
  };
}

export async function runProductReconciliation(reason = "interval") {
  const { enabled, shopDelayMs } = getConfig();
  if (!enabled) return { skipped: true, reason: "disabled" };
  if (running) return { skipped: true, reason: "already_running" };

  running = true;
  const startedAt = Date.now();
  const result = { reason, shops: 0, synced: 0, pruned: 0, skipped: 0 };

  try {
    const shops = await getShopsFromSessions();
    result.shops = shops.length;

    if (shops.length === 0) {
      console.log("ℹ️ Reconcile: no shops found in session storage");
      return result;
    }

    console.log(`🔄 Reconcile started (${reason}) for ${shops.length} shops`);

    for (const shop of shops) {
      try {
        const session = await getOfflineSession(shop);
        if (!session) {
          result.skipped += 1;
          console.warn(`⚠️ Reconcile skipped for ${shop}: no offline session`);
          continue;
        }

        const adminGraphQL = makeAdminGraphQL(session);
        const syncResult = await syncProductsWithGraphQL(
          shop,
          adminGraphQL,
          { returnIds: true }
        );

        result.synced += syncResult.count || 0;

        const pruned = await pruneProductsNotInList(shop, syncResult.productIds);
        result.pruned += pruned || 0;
      } catch (error) {
        result.skipped += 1;
        console.error(`❌ Reconcile failed for ${shop}:`, error);
      }

      if (shopDelayMs > 0) {
        await sleep(shopDelayMs);
      }
    }

    console.log(
      `✅ Reconcile finished (${reason}) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
    );
  } finally {
    running = false;
  }

  return result;
}

export function startProductReconciliationJob() {
  const { enabled, runOnStart, startDelayMs } = getConfig();

  if (!enabled) {
    console.log("🟡 Reconcile job disabled (RECONCILE_ENABLED=false)");
    return;
  }

  if (timer) return;

  const intervalMs = getIntervalMs();
  console.log(
    `🧭 Reconcile job scheduled every ${Math.round(intervalMs / 60000)} minutes`
  );

  if (runOnStart) {
    setTimeout(() => {
      runProductReconciliation("startup").catch((error) => {
        console.error("❌ Reconcile startup run failed:", error);
      });
    }, startDelayMs);
  }

  timer = setInterval(() => {
    runProductReconciliation("interval").catch((error) => {
      console.error("❌ Reconcile interval run failed:", error);
    });
  }, intervalMs);
}
