import { json } from "@remix-run/node";

/**
 * POST /api/cron/optimize
 *
 * Auto-optimization cron endpoint for Pillar 5: Learning & Optimization Loop.
 *
 * Called by an external scheduler (cron job, Vercel cron, etc.) to run
 * optimization for all shops that haven't been optimized in the last 24 hours.
 *
 * Protected by CRON_SECRET environment variable.
 * Set CRON_SECRET in your .env and configure your cron to send:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * GET /api/cron/optimize → returns status & scheduler state for all shops
 */

function isAuthorized(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // No secret configured → open (dev mode)
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${cronSecret}`;
}

export const loader = async ({ request }) => {
  if (!isAuthorized(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { getAllActiveShopIds, getSchedulerState } = await import(
      "../../backend/services/schedulerService.js"
    );

    const shopIds = await getAllActiveShopIds();
    const states = await Promise.all(
      shopIds.map(async (shopId) => {
        const state = await getSchedulerState(shopId);
        return {
          shopId,
          lastOptimizationAt: state?.lastOptimizationAt || null,
          lastResult: state?.lastResult || "never",
          isRunning: state?.isRunning || false,
          triggeredBy: state?.triggeredBy || null
        };
      })
    );

    return json({ success: true, shops: states });
  } catch (error) {
    return json({ success: false, error: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isAuthorized(request)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const {
      getAllActiveShopIds,
      shouldRunOptimization,
      runScheduledOptimization
    } = await import("../../backend/services/schedulerService.js");

    const shopIds = await getAllActiveShopIds();

    const results = [];
    for (const shopId of shopIds) {
      const overdue = await shouldRunOptimization(shopId);
      if (!overdue) {
        results.push({ shopId, skipped: true, reason: "not_due" });
        continue;
      }

      console.log(`[Cron] Running optimization for shop: ${shopId}`);
      const result = await runScheduledOptimization(shopId, "cron");
      results.push({
        shopId,
        skipped: false,
        success: result.success,
        reason: result.reason || null,
        updatesMade: result.optimization?.updatesMade || 0,
        bundleRecommendations: result.optimization?.bundleRecommendations || 0
      });
    }

    const optimized = results.filter((r) => !r.skipped && r.success).length;
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.skipped && !r.success).length;

    console.log(`[Cron] Optimization complete: ${optimized} optimized, ${skipped} skipped, ${failed} failed`);

    return json({
      success: true,
      summary: { total: shopIds.length, optimized, skipped, failed },
      results
    });
  } catch (error) {
    console.error("[Cron] Optimization failed:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};
