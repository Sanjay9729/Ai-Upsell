import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [
    { getSchedulerState, getOptimizationHistory },
    { analyzePerformanceByOfferType, analyzeAOVImpact, analyzeDiscountElasticity, analyzeSegmentPerformance, analyzeGuardrailTriggers }
  ] = await Promise.all([
    import("../../backend/services/schedulerService.js"),
    import("../../backend/services/optimizationEngine.js")
  ]);

  const { getBundles, getBundleAnalytics } = await import("../../backend/services/bundleEngine.js");
  const { getDb, collections } = await import("../../backend/database/mongodb.js");
  const db = await getDb();

  const [
    schedulerState,
    history,
    offerTypePerf,
    aovImpact,
    elasticity,
    segmentPerf,
    guardrails,
    bundlesResult
  ] = await Promise.all([
    getSchedulerState(shopId),
    getOptimizationHistory(shopId, 10),
    analyzePerformanceByOfferType(shopId),
    analyzeAOVImpact(shopId),
    analyzeDiscountElasticity(shopId),
    analyzeSegmentPerformance(shopId),
    analyzeGuardrailTriggers(shopId),
    getBundles(shopId)
  ]);

  // Resolve product names and analytics for each bundle
  const bundleProducts = new Map();
  for (const bundle of bundlesResult.bundles || []) {
    for (const productId of bundle.productIds || []) {
      if (!bundleProducts.has(productId)) {
        const product = await db.collection(collections.products).findOne({ productId: productId.toString() });
        bundleProducts.set(productId, product?.title || `Product ${productId}`);
      }
    }
  }

  const bundles = await Promise.all(
    (bundlesResult.bundles || []).map(async (bundle) => {
      const analyticsResult = await getBundleAnalytics(shopId, bundle._id);
      return {
        ...bundle,
        _id: bundle._id.toString(),
        analytics: analyticsResult.analytics,
        displayNames: (bundle.productIds || []).map(pid => bundleProducts.get(pid) || `Product ${pid}`)
      };
    })
  );

  return json({
    shopId,
    schedulerState: schedulerState
      ? {
          lastOptimizationAt: schedulerState.lastOptimizationAt,
          lastResult: schedulerState.lastResult,
          lastReason: schedulerState.lastReason,
          isRunning: schedulerState.isRunning,
          triggeredBy: schedulerState.triggeredBy,
          durationMs: schedulerState.durationMs
        }
      : null,
    history: (history || []).map((h) => ({
      startedAt: h.startedAt,
      finishedAt: h.finishedAt,
      triggeredBy: h.triggeredBy,
      success: h.success,
      reason: h.reason,
      eventCount: h.eventCount,
      updatesMade: h.updatesMade,
      bundleRecommendations: h.bundleRecommendations,
      appliedUpdates: h.appliedUpdates,
      tuning: h.tuning,
      durationMs: h.durationMs
    })),
    offerTypePerf: offerTypePerf.success ? offerTypePerf.analysis : null,
    aovImpact: aovImpact.success ? aovImpact.analysis : null,
    elasticity: elasticity.success
      ? { data: elasticity.elasticity, optimalBucket: elasticity.optimalBucket, optimalRate: elasticity.optimalConversionRate }
      : null,
    segmentPerf: segmentPerf.success ? segmentPerf.segments : [],
    guardrails: guardrails.success
      ? {
          triggers: guardrails.triggers,
          totalDecisions: guardrails.totalDecisions,
          guardrailRate: guardrails.guardrailRate
        }
      : null,
    bundles
  });
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "run_optimization") {
    try {
      const { runScheduledOptimization } = await import(
        "../../backend/services/schedulerService.js"
      );
      const result = await runScheduledOptimization(shopId, "manual");
      return json({
        success: result.success,
        reason: result.reason,
        updatesMade: result.optimization?.updatesMade || 0,
        bundleRecommendations: result.optimization?.bundleRecommendations || 0,
        intent
      });
    } catch (error) {
      return json({ success: false, error: error.message, intent }, { status: 500 });
    }
  }

  if (intent === "pause_bundle" || intent === "resume_bundle") {
    const bundleId = formData.get("bundleId");
    const { pauseBundle } = await import("../../backend/services/bundleEngine.js");
    const result = await pauseBundle(shopId, bundleId, intent === "pause_bundle");
    return json({ success: result.success, intent });
  }

  if (intent === "create_bundle") {
    const name = formData.get("name");
    const productIds = formData.get("productIds")?.split(",").map(s => s.trim()).filter(Boolean) || [];
    const discountPercent = Number(formData.get("discountPercent")) || 10;
    const { createBundle } = await import("../../backend/services/bundleEngine.js");
    const result = await createBundle({ shopId, name, productIds, discountPercent, bundleType: "merchant", confidence: 0.9 });
    return json({ success: result.success, intent });
  }

  return json({ success: false, error: "Unknown intent" }, { status: 400 });
};

export default function OptimizationPage() {
  const {
    schedulerState,
    history,
    offerTypePerf,
    aovImpact,
    elasticity,
    segmentPerf,
    guardrails,
    bundles
  } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const isRunning = navigation.state === "submitting";

  const [expandedBundles, setExpandedBundles] = useState(new Set());
  const [showCreateBundle, setShowCreateBundle] = useState(false);
  const [bundleForm, setBundleForm] = useState({ name: "", productIds: "", discountPercent: 10 });

  const toggleDetails = (bundleId) => {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(bundleId)) next.delete(bundleId);
      else next.add(bundleId);
      return next;
    });
  };

  const handlePauseBundle = (bundleId, isPaused) => {
    fetcher.submit(
      { intent: isPaused ? "resume_bundle" : "pause_bundle", bundleId },
      { method: "POST" }
    );
  };

  const handleCreateBundle = () => {
    fetcher.submit(
      { intent: "create_bundle", ...bundleForm },
      { method: "POST" }
    );
    setShowCreateBundle(false);
    setBundleForm({ name: "", productIds: "", discountPercent: 10 });
  };

  const font = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const badge = (result) => {
    const colors = {
      success: { bg: "#e3f5e1", color: "#1a7f37", border: "#b7e4b0" },
      insufficient_data: { bg: "#fff3cd", color: "#856404", border: "#ffc107" },
      error: { bg: "#fde8e8", color: "#b42318", border: "#f3bebe" },
      never: { bg: "#f1f2f3", color: "#6d7175", border: "#d2d5d8" }
    };
    const c = colors[result] || colors.never;
    return (
      <span style={{
        display: "inline-block", padding: "3px 10px", borderRadius: "999px",
        fontSize: "11px", fontWeight: 700, textTransform: "uppercase",
        background: c.bg, color: c.color, border: `1px solid ${c.border}`
      }}>
        {result || "never"}
      </span>
    );
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString() : "—";
  const fmtMs = (ms) => ms ? `${(ms / 1000).toFixed(1)}s` : "—";

  const nextRunTime = schedulerState?.lastOptimizationAt
    ? new Date(new Date(schedulerState.lastOptimizationAt).getTime() + 24 * 60 * 60 * 1000)
    : null;

  return (
    <s-page heading="Learning & Optimization Loop">
      <style>{`* { font-family: ${font} !important; }`}</style>

      {/* ── Guardrail Alert Banner ── */}
      {guardrails && guardrails.guardrailRate > 30 && (
        <s-section>
          <div style={{
            padding: "14px 18px", borderRadius: "8px",
            background: "#fff8ee", border: "2px solid #f59e0b",
            display: "flex", gap: "12px", alignItems: "flex-start"
          }}>
            <span style={{ fontSize: "20px", lineHeight: 1 }}>⚠️</span>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e", marginBottom: "4px" }}>
                High Guardrail Activity — {guardrails.guardrailRate}% of decisions are being blocked or modified
              </div>
              <div style={{ fontSize: "13px", color: "#78350f" }}>
                Your guardrail settings may be too restrictive and are reducing offer effectiveness.
                Consider adjusting your <strong>Max Discount Cap</strong>, <strong>Session Offer Limit</strong>, or
                <strong> Inventory Threshold</strong> in Goal &amp; Guardrails.
                {guardrails.triggers?.[0] && (
                  <span> Most triggered: <strong>"{guardrails.triggers[0].guardrail}"</strong> ({guardrails.triggers[0].count} times, {guardrails.triggers[0].percentage}% of decisions).</span>
                )}
              </div>
            </div>
          </div>
        </s-section>
      )}

      {/* ── Status Bar ── */}
      <s-section heading="Optimization Status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "20px" }}>
          {[
            {
              label: "Last Run",
              value: fmtDate(schedulerState?.lastOptimizationAt),
              sub: schedulerState ? badge(schedulerState.lastResult) : badge("never")
            },
            {
              label: "Next Scheduled",
              value: nextRunTime ? fmtDate(nextRunTime) : "—",
              sub: <span style={{ fontSize: "12px", color: "#6d7175" }}>Every 24 hours</span>
            },
            {
              label: "Triggered By",
              value: schedulerState?.triggeredBy || "—",
              sub: <span style={{ fontSize: "12px", color: "#6d7175" }}>Duration: {fmtMs(schedulerState?.durationMs)}</span>
            },
            {
              label: "Auto-Schedule",
              value: "Active",
              sub: <span style={{ fontSize: "12px", color: "#6d7175" }}>Via proxy lazy-trigger + cron</span>
            }
          ].map(({ label, value, sub }) => (
            <div key={label} style={{ background: "#f9fafb", border: "1px solid #e1e3e5", borderRadius: "10px", padding: "16px" }}>
              <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "4px" }}>{label}</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#202223", marginBottom: "4px" }}>{value}</div>
              <div>{sub}</div>
            </div>
          ))}
        </div>

        <form method="post" onSubmit={(e) => {
          e.preventDefault();
          submit({ intent: "run_optimization" }, { method: "post" });
        }}>
          <input type="hidden" name="intent" value="run_optimization" />
          <button
            type="submit"
            disabled={isRunning}
            style={{
              appearance: "none", border: "none", background: "#008060",
              color: "#fff", borderRadius: "6px", padding: "10px 20px",
              fontSize: "13px", fontWeight: 700, cursor: isRunning ? "wait" : "pointer",
              opacity: isRunning ? 0.7 : 1
            }}
          >
            {isRunning ? "Running..." : "Run Optimization Now"}
          </button>
          {actionData?.intent === "run_optimization" && (
            <span style={{ marginLeft: "14px", fontSize: "13px", color: actionData.success ? "#008060" : "#b42318" }}>
              {actionData.success
                ? `Done — ${actionData.updatesMade} adjustments, ${actionData.bundleRecommendations} bundles recommended`
                : actionData.reason === "insufficient_data"
                  ? "Not enough data yet (need 20+ events in last 7 days)"
                  : `Error: ${actionData.error || actionData.reason}`}
            </span>
          )}
        </form>
      </s-section>

      {/* ── AOV Impact ── */}
      <s-section heading="AOV Impact (Last 7 Days)">
        {!aovImpact ? (
          <EmptyState msg="No AOV data yet." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
            {[
              { label: "Sessions with Upsell", value: aovImpact.totalCartsWithUpsell },
              { label: "Total Upsell Value", value: `$${aovImpact.totalUpsellValue?.toFixed(2)}` },
              { label: "Avg Upsell / Session", value: `$${aovImpact.avgUpsellValue?.toFixed(2)}` },
              { label: "Top Upsell Products", value: aovImpact.topUpsellProducts?.length || 0 }
            ].map(({ label, value }) => (
              <div key={label} style={{ background: "#f9fafb", border: "1px solid #e1e3e5", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "6px" }}>{label}</div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#008060" }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </s-section>

      {/* ── Offer Type Performance ── */}
      <s-section heading="Offer Type Performance">
        {!offerTypePerf || offerTypePerf.byOfferType?.length === 0 ? (
          <EmptyState msg="No offer type data yet." />
        ) : (
          <Table
            headers={["Offer Type", "Views", "Clicks", "Cart Adds", "CTR", "Conversion"]}
            rows={offerTypePerf.byOfferType.map((t) => [
              t._id || "—",
              t.views,
              t.clicks,
              t.cartAdds,
              t.views > 0 ? `${(t.ctr * 100).toFixed(1)}%` : "—",
              t.views > 0 ? `${(t.conversionRate * 100).toFixed(1)}%` : "—"
            ])}
          />
        )}
      </s-section>

      {/* ── Discount Elasticity ── */}
      <s-section heading="Discount Elasticity">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
          How discount % affects offer acceptance rate. The optimizer uses this to tune the discount cap.
          {elasticity?.optimalBucket && (
            <span style={{ marginLeft: "8px", color: "#008060", fontWeight: 600 }}>
              Optimal bucket: {elasticity.optimalBucket} ({elasticity.optimalRate?.toFixed(1)}% conversion)
            </span>
          )}
        </div>
        {!elasticity || elasticity.data?.length === 0 ? (
          <EmptyState msg="No discount data yet. Events need metadata.discountPercent to populate this." />
        ) : (
          <Table
            headers={["Discount Range", "Events", "Cart Adds", "Conversion Rate", "Avg Discount"]}
            rows={elasticity.data.map((b) => [
              b.bucket,
              b.total,
              b.cartAdds,
              `${b.conversionRate}%`,
              b.avgDiscount != null ? `${b.avgDiscount}%` : "—"
            ])}
            highlightRow={(row) => row[0] === elasticity.optimalBucket}
          />
        )}
      </s-section>

      {/* ── Segment Performance ── */}
      <s-section heading="Segment Performance (Learning View)">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
          The optimizer uses segment signals to weight offer priorities for different customer types.
        </div>
        {segmentPerf.length === 0 ? (
          <EmptyState msg="No segment data yet." />
        ) : (
          <Table
            headers={["Segment", "Views", "Clicks", "Cart Adds", "CTR", "Conversion"]}
            rows={segmentPerf.map((s) => [
              s.segment,
              s.views,
              s.clicks,
              s.cartAdds,
              `${s.ctr}%`,
              `${s.conversionRate}%`
            ])}
          />
        )}
      </s-section>

      {/* ── Guardrail Triggers ── */}
      <s-section heading="Guardrail Trigger Monitor (Last 7 Days)">
        {!guardrails ? (
          <EmptyState msg="No guardrail trigger data yet." />
        ) : (
          <>
            <div style={{ display: "flex", gap: "24px", fontSize: "13px", color: "#4a4a4a", marginBottom: "16px" }}>
              <div>Total decisions: <strong>{guardrails.totalDecisions}</strong></div>
              <div>Guardrail trigger rate: <strong>{guardrails.guardrailRate}%</strong></div>
            </div>
            {guardrails.triggers.length === 0 ? (
              <EmptyState msg="No guardrail triggers recorded yet. This is expected if decision logs don't include guardrailsApplied." />
            ) : (
              <Table
                headers={["Guardrail", "Triggers", "% of Decisions"]}
                rows={guardrails.triggers.map((t) => [t.guardrail, t.count, `${t.percentage}%`])}
              />
            )}
          </>
        )}
      </s-section>

      {/* ── Bundle Review ── */}
      <s-section heading="Bundle Review">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px" }}>
          Auto-generated and merchant bundles. The optimizer creates these from co-purchase patterns.
        </div>

        {/* Create Bundle */}
        <div style={{ marginBottom: "16px" }}>
          <button
            onClick={() => setShowCreateBundle(!showCreateBundle)}
            style={{
              appearance: "none", border: "1px solid #c9cccf", background: "#f6f6f7",
              color: "#202223", borderRadius: "6px", padding: "8px 16px",
              fontSize: "13px", fontWeight: 600, cursor: "pointer"
            }}
          >
            {showCreateBundle ? "Cancel" : "➕ Create Bundle"}
          </button>
        </div>

        {showCreateBundle && (
          <div style={{ padding: "16px", background: "#f9fafb", border: "1px solid #e1e3e5", borderRadius: "8px", marginBottom: "16px", display: "grid", gap: "10px", maxWidth: "480px" }}>
            <input
              type="text"
              placeholder="Bundle name"
              value={bundleForm.name}
              onChange={e => setBundleForm({ ...bundleForm, name: e.target.value })}
              style={{ padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "13px" }}
            />
            <input
              type="text"
              placeholder="Product IDs (comma separated)"
              value={bundleForm.productIds}
              onChange={e => setBundleForm({ ...bundleForm, productIds: e.target.value })}
              style={{ padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "13px" }}
            />
            <input
              type="number"
              placeholder="Discount %"
              min="0" max="90"
              value={bundleForm.discountPercent}
              onChange={e => setBundleForm({ ...bundleForm, discountPercent: Number(e.target.value) })}
              style={{ padding: "8px 10px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "13px" }}
            />
            <button
              onClick={handleCreateBundle}
              disabled={!bundleForm.name || !bundleForm.productIds}
              style={{
                appearance: "none", border: "none", background: "#008060",
                color: "#fff", borderRadius: "6px", padding: "8px 16px",
                fontSize: "13px", fontWeight: 600,
                cursor: !bundleForm.name || !bundleForm.productIds ? "not-allowed" : "pointer",
                opacity: !bundleForm.name || !bundleForm.productIds ? 0.6 : 1
              }}
            >
              Create
            </button>
          </div>
        )}

        {bundles.length === 0 ? (
          <EmptyState msg="No bundles yet. The optimizer will auto-generate bundles from co-purchase patterns after enough order data is available." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "14px" }}>
            {bundles.map(bundle => (
              <div
                key={bundle._id}
                style={{
                  border: "1px solid #e1e3e5", borderRadius: "10px", padding: "16px",
                  background: bundle.status === "paused" ? "#fafafa" : "#ffffff",
                  opacity: bundle.status === "paused" ? 0.75 : 1
                }}
              >
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#202223", marginBottom: "2px" }}>
                    {bundle.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "#6d7175" }}>
                    {bundle.displayNames.join(" + ")}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px", color: "#4a4a4a", paddingBottom: "10px", borderBottom: "1px solid #f1f2f3", marginBottom: "10px" }}>
                  <div>Discount: <strong>{bundle.discountPercent}%</strong></div>
                  <div>Type: <strong>{bundle.bundleType}</strong></div>
                  <div>Views: <strong>{bundle.analytics?.stats?.view || 0}</strong></div>
                  <div>Conversions: <strong>{bundle.analytics?.stats?.cart_add || 0}</strong></div>
                </div>

                {expandedBundles.has(bundle._id) && (
                  <div style={{ padding: "10px", background: "#f9fafb", borderRadius: "6px", border: "1px solid #e1e3e5", marginBottom: "10px", fontSize: "13px", display: "grid", gap: "6px", color: "#4a4a4a" }}>
                    <div><span style={{ color: "#6d7175" }}>Source:</span> {bundle.bundleType === "auto" ? "Auto-generated" : "Merchant-created"}</div>
                    <div><span style={{ color: "#6d7175" }}>Confidence:</span> {bundle.confidence != null ? `${(bundle.confidence * 100).toFixed(0)}%` : "—"}</div>
                    <div><span style={{ color: "#6d7175" }}>Products:</span> {bundle.displayNames.join(", ")}</div>
                    <div><span style={{ color: "#6d7175" }}>CTR:</span> {bundle.analytics?.stats?.view > 0 ? `${((bundle.analytics.stats.click || 0) / bundle.analytics.stats.view * 100).toFixed(1)}%` : "—"}</div>
                    <div><span style={{ color: "#6d7175" }}>Conversion:</span> {bundle.analytics?.stats?.view > 0 ? `${((bundle.analytics.stats.cart_add || 0) / bundle.analytics.stats.view * 100).toFixed(1)}%` : "—"}</div>
                    <div><span style={{ color: "#6d7175" }}>Status:</span> <span style={{ fontWeight: 600, color: bundle.status === "paused" ? "#b42318" : "#008060" }}>{bundle.status}</span></div>
                  </div>
                )}

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => handlePauseBundle(bundle._id, bundle.status === "paused")}
                    style={{
                      flex: 1, appearance: "none", border: "1px solid #c9cccf",
                      background: bundle.status === "paused" ? "#008060" : "#fde8e8",
                      color: bundle.status === "paused" ? "#fff" : "#b42318",
                      borderColor: bundle.status === "paused" ? "#007a5c" : "#f3bebe",
                      borderRadius: "6px", padding: "7px 10px", fontSize: "13px",
                      fontWeight: 600, cursor: "pointer"
                    }}
                  >
                    {bundle.status === "paused" ? "▶ Resume" : "⏸ Pause"}
                  </button>
                  <button
                    onClick={() => toggleDetails(bundle._id)}
                    style={{
                      flex: 1, appearance: "none",
                      border: "1px solid #c9cccf",
                      background: expandedBundles.has(bundle._id) ? "#202223" : "#f6f6f7",
                      color: expandedBundles.has(bundle._id) ? "#fff" : "#202223",
                      borderColor: expandedBundles.has(bundle._id) ? "#202223" : "#c9cccf",
                      borderRadius: "6px", padding: "7px 10px", fontSize: "13px",
                      fontWeight: 600, cursor: "pointer"
                    }}
                  >
                    {expandedBundles.has(bundle._id) ? "▲ Hide" : "📊 Details"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>

      {/* ── Optimization History ── */}
      <s-section heading="Optimization Run History">
        {history.length === 0 ? (
          <EmptyState msg="No optimization runs yet. Click 'Run Optimization Now' or wait for auto-trigger." />
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {history.map((run, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid #e1e3e5", borderRadius: "10px", padding: "16px",
                  background: "#ffffff"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#202223" }}>
                      {fmtDate(run.startedAt)}
                    </span>
                    <span style={{ marginLeft: "10px", fontSize: "12px", color: "#6d7175" }}>
                      via {run.triggeredBy} · {fmtMs(run.durationMs)}
                    </span>
                  </div>
                  {badge(run.success ? "success" : run.reason || "error")}
                </div>

                <div style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#4a4a4a" }}>
                  <div>
                    Events analyzed: <strong>{run.eventCount || 0}</strong> ·
                    Adjustments made: <strong>{run.updatesMade || 0}</strong> ·
                    Bundles recommended: <strong>{run.bundleRecommendations || 0}</strong>
                  </div>

                  {run.appliedUpdates && (
                    Object.keys(run.appliedUpdates.guardrails || {}).length > 0 ||
                    Object.keys(run.appliedUpdates.optimization || {}).length > 0
                  ) ? (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "#6d7175" }}>
                      Auto-adjusted: {[
                        ...Object.entries(run.appliedUpdates.guardrails || {}).map(
                          ([k, v]) => `${k} → ${typeof v === 'number' ? v.toFixed ? v.toFixed(2) : v : v}`
                        ),
                        ...Object.entries(run.appliedUpdates.optimization || {}).map(
                          ([k, v]) => `${k} → ${typeof v === 'number' ? v.toFixed ? v.toFixed(2) : v : v}`
                        )
                      ].join(" · ")}
                    </div>
                  ) : (
                    <div style={{ marginTop: "6px", fontSize: "12px", color: "#6d7175" }}>No parameter changes needed</div>
                  )}

                  {run.reason && (
                    <div style={{ fontSize: "12px", color: "#856404" }}>
                      Reason: {run.reason}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

function Table({ headers, rows, highlightRow }) {
  return (
    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead style={{ background: "#f7f7f8" }}>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e1e3e5" }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "10px 14px", fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #f1f2f3",
                background: highlightRow?.(row) ? "#e3f5e1" : "transparent"
              }}
            >
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "10px 14px" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{
      padding: "20px", color: "#6d7175", background: "#f9fafb",
      borderRadius: "8px", border: "1px dashed #e1e3e5", fontSize: "13px"
    }}>
      {msg}
    </div>
  );
}
