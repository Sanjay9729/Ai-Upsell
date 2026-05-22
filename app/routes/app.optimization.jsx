import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
    Page,
    Card,
    BlockStack,
    InlineStack,
    InlineGrid,
    Text,
    Button,
    TextField,
    Badge,
    DataTable,
    EmptyState,
    Banner,
    Box,
    Divider,
} from "@shopify/polaris";

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

function resultBadge(result) {
    const toneMap = { success: "success", insufficient_data: "warning", error: "critical" };
    return <Badge tone={toneMap[result]}>{result || "never"}</Badge>;
}

const fmtDate = (d) => d ? new Date(d).toLocaleString() : "—";
const fmtMs = (ms) => ms ? `${(ms / 1000).toFixed(1)}s` : "—";

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
  const [bundleForm, setBundleForm] = useState({ name: "", productIds: "", discountPercent: "10" });

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
    setBundleForm({ name: "", productIds: "", discountPercent: "10" });
  };

  const nextRunTime = schedulerState?.lastOptimizationAt
    ? new Date(new Date(schedulerState.lastOptimizationAt).getTime() + 24 * 60 * 60 * 1000)
    : null;

  const offerTypeRows = (offerTypePerf?.byOfferType || []).map((t) => [
    t._id || "—",
    t.views,
    t.clicks,
    t.cartAdds,
    t.views > 0 ? `${(t.ctr * 100).toFixed(1)}%` : "—",
    t.views > 0 ? `${(t.conversionRate * 100).toFixed(1)}%` : "—",
  ]);

  const elasticityRows = (elasticity?.data || []).map((b) => [
    b.bucket === elasticity?.optimalBucket
      ? <InlineStack gap="100" key={b.bucket}><Text>{b.bucket}</Text><Badge tone="success">Optimal</Badge></InlineStack>
      : b.bucket,
    b.total,
    b.cartAdds,
    `${b.conversionRate}%`,
    b.avgDiscount != null ? `${b.avgDiscount}%` : "—",
  ]);

  const segmentRows = segmentPerf.map((s) => [
    s.segment,
    s.views,
    s.clicks,
    s.cartAdds,
    `${s.ctr}%`,
    `${s.conversionRate}%`,
  ]);

  const guardrailRows = (guardrails?.triggers || []).map((t) => [
    t.guardrail,
    t.count,
    `${t.percentage}%`,
  ]);

  return (
    <Page title="Learning & Optimization Loop">
        <BlockStack gap="500">
            {/* High Guardrail Alert */}
            {guardrails && guardrails.guardrailRate > 30 && (
                <Banner tone="warning" title={`High Guardrail Activity — ${guardrails.guardrailRate}% of decisions are being blocked or modified`}>
                    <p>
                        Your guardrail settings may be too restrictive and are reducing offer effectiveness.
                        Consider adjusting your Max Discount Cap, Session Offer Limit, or Inventory Threshold in Goal &amp; Guardrails.
                        {guardrails.triggers?.[0] && (
                            <> Most triggered: <strong>"{guardrails.triggers[0].guardrail}"</strong> ({guardrails.triggers[0].count} times, {guardrails.triggers[0].percentage}% of decisions).</>
                        )}
                    </p>
                </Banner>
            )}

            {/* Optimization Status */}
            <Card>
                <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Optimization Status</Text>
                    <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                        {[
                            {
                                label: "Last Run",
                                value: fmtDate(schedulerState?.lastOptimizationAt),
                                sub: schedulerState ? resultBadge(schedulerState.lastResult) : resultBadge("never")
                            },
                            {
                                label: "Next Scheduled",
                                value: nextRunTime ? fmtDate(nextRunTime) : "—",
                                sub: <Text variant="bodySm" tone="subdued">Every 24 hours</Text>
                            },
                            {
                                label: "Triggered By",
                                value: schedulerState?.triggeredBy || "—",
                                sub: <Text variant="bodySm" tone="subdued">Duration: {fmtMs(schedulerState?.durationMs)}</Text>
                            },
                            {
                                label: "Auto-Schedule",
                                value: "Active",
                                sub: <Text variant="bodySm" tone="subdued">Via proxy lazy-trigger + cron</Text>
                            }
                        ].map(({ label, value, sub }) => (
                            <Box key={label} background="bg-surface-secondary" padding="400" borderRadius="200">
                                <BlockStack gap="100">
                                    <Text variant="bodySm" tone="subdued">{label}</Text>
                                    <Text variant="bodyMd" fontWeight="bold">{value}</Text>
                                    <div>{sub}</div>
                                </BlockStack>
                            </Box>
                        ))}
                    </InlineGrid>

                    <InlineStack gap="300" blockAlign="center">
                        <Button
                            variant="primary"
                            loading={isRunning}
                            disabled={isRunning}
                            onClick={() => submit({ intent: "run_optimization" }, { method: "post" })}
                        >
                            {isRunning ? "Running..." : "Run Optimization Now"}
                        </Button>
                        {actionData?.intent === "run_optimization" && (
                            <Text tone={actionData.success ? "success" : "critical"} variant="bodySm">
                                {actionData.success
                                    ? `Done — ${actionData.updatesMade} adjustments, ${actionData.bundleRecommendations} bundles recommended`
                                    : actionData.reason === "insufficient_data"
                                        ? "Not enough data yet (need 20+ events in last 7 days)"
                                        : `Error: ${actionData.error || actionData.reason}`}
                            </Text>
                        )}
                    </InlineStack>
                </BlockStack>
            </Card>

            {/* AOV Impact */}
            <Card>
                <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">AOV Impact (Last 7 Days)</Text>
                    {!aovImpact ? (
                        <Banner>No AOV data yet.</Banner>
                    ) : (
                        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                            {[
                                { label: "Sessions with Upsell", value: aovImpact.totalCartsWithUpsell },
                                { label: "Total Upsell Value", value: `$${aovImpact.totalUpsellValue?.toFixed(2)}` },
                                { label: "Avg Upsell / Session", value: `$${aovImpact.avgUpsellValue?.toFixed(2)}` },
                                { label: "Top Upsell Products", value: aovImpact.topUpsellProducts?.length || 0 }
                            ].map(({ label, value }) => (
                                <Box key={label} background="bg-surface-secondary" padding="400" borderRadius="200">
                                    <BlockStack gap="100">
                                        <Text variant="bodySm" tone="subdued">{label}</Text>
                                        <Text variant="headingLg" tone="success">{value}</Text>
                                    </BlockStack>
                                </Box>
                            ))}
                        </InlineGrid>
                    )}
                </BlockStack>
            </Card>

            {/* Offer Type Performance */}
            <Card>
                <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Offer Type Performance</Text>
                    {!offerTypePerf || offerTypePerf.byOfferType?.length === 0 ? (
                        <Banner>No offer type data yet.</Banner>
                    ) : (
                        <DataTable
                            columnContentTypes={["text", "numeric", "numeric", "numeric", "text", "text"]}
                            headings={["Offer Type", "Views", "Clicks", "Cart Adds", "CTR", "Conversion"]}
                            rows={offerTypeRows}
                        />
                    )}
                </BlockStack>
            </Card>

            {/* Discount Elasticity */}
            <Card>
                <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                        <Text variant="headingMd" as="h2">Discount Elasticity</Text>
                        {elasticity?.optimalBucket && (
                            <Badge tone="success">
                                Optimal: {elasticity.optimalBucket} ({elasticity.optimalRate?.toFixed(1)}% conversion)
                            </Badge>
                        )}
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">
                        How discount % affects offer acceptance rate. The optimizer uses this to tune the discount cap.
                    </Text>
                    {!elasticity || elasticity.data?.length === 0 ? (
                        <Banner>No discount data yet. Events need metadata.discountPercent to populate this.</Banner>
                    ) : (
                        <DataTable
                            columnContentTypes={["text", "numeric", "numeric", "text", "text"]}
                            headings={["Discount Range", "Events", "Cart Adds", "Conversion Rate", "Avg Discount"]}
                            rows={elasticityRows}
                        />
                    )}
                </BlockStack>
            </Card>

            {/* Segment Performance */}
            <Card>
                <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Segment Performance (Learning View)</Text>
                    <Text variant="bodySm" tone="subdued">
                        The optimizer uses segment signals to weight offer priorities for different customer types.
                    </Text>
                    {segmentPerf.length === 0 ? (
                        <Banner>No segment data yet.</Banner>
                    ) : (
                        <DataTable
                            columnContentTypes={["text", "numeric", "numeric", "numeric", "text", "text"]}
                            headings={["Segment", "Views", "Clicks", "Cart Adds", "CTR", "Conversion"]}
                            rows={segmentRows}
                        />
                    )}
                </BlockStack>
            </Card>

            {/* Guardrail Triggers */}
            <Card>
                <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Guardrail Trigger Monitor (Last 7 Days)</Text>
                    {!guardrails ? (
                        <Banner>No guardrail trigger data yet.</Banner>
                    ) : (
                        <>
                            <InlineStack gap="500">
                                <Text variant="bodySm">Total decisions: <strong>{guardrails.totalDecisions}</strong></Text>
                                <Text variant="bodySm">Guardrail trigger rate: <strong>{guardrails.guardrailRate}%</strong></Text>
                            </InlineStack>
                            {guardrails.triggers.length === 0 ? (
                                <Banner>No guardrail triggers recorded yet.</Banner>
                            ) : (
                                <DataTable
                                    columnContentTypes={["text", "numeric", "text"]}
                                    headings={["Guardrail", "Triggers", "% of Decisions"]}
                                    rows={guardrailRows}
                                />
                            )}
                        </>
                    )}
                </BlockStack>
            </Card>

            {/* Bundle Review */}
            <Card>
                <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                            <Text variant="headingMd" as="h2">Bundle Review</Text>
                            <Text variant="bodySm" tone="subdued">
                                Auto-generated and merchant bundles. The optimizer creates these from co-purchase patterns.
                            </Text>
                        </BlockStack>
                        <Button onClick={() => setShowCreateBundle(!showCreateBundle)}>
                            {showCreateBundle ? "Cancel" : "Create Bundle"}
                        </Button>
                    </InlineStack>

                    {showCreateBundle && (
                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                            <BlockStack gap="300">
                                <Text variant="headingSm" as="h3">New Bundle</Text>
                                <TextField
                                    label="Bundle name"
                                    value={bundleForm.name}
                                    onChange={(v) => setBundleForm({ ...bundleForm, name: v })}
                                    autoComplete="off"
                                />
                                <TextField
                                    label="Product IDs (comma separated)"
                                    value={bundleForm.productIds}
                                    onChange={(v) => setBundleForm({ ...bundleForm, productIds: v })}
                                    autoComplete="off"
                                />
                                <TextField
                                    label="Discount %"
                                    type="number"
                                    value={bundleForm.discountPercent}
                                    onChange={(v) => setBundleForm({ ...bundleForm, discountPercent: v })}
                                    min="0"
                                    max="90"
                                    autoComplete="off"
                                />
                                <InlineStack gap="200">
                                    <Button
                                        variant="primary"
                                        disabled={!bundleForm.name || !bundleForm.productIds}
                                        onClick={handleCreateBundle}
                                    >
                                        Create
                                    </Button>
                                    <Button onClick={() => setShowCreateBundle(false)}>Cancel</Button>
                                </InlineStack>
                            </BlockStack>
                        </Box>
                    )}

                    {bundles.length === 0 ? (
                        <EmptyState heading="No bundles yet" image="">
                            <p>The optimizer will auto-generate bundles from co-purchase patterns after enough order data is available.</p>
                        </EmptyState>
                    ) : (
                        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                            {bundles.map(bundle => (
                                <Card key={bundle._id}>
                                    <BlockStack gap="300">
                                        <BlockStack gap="100">
                                            <Text variant="bodyMd" fontWeight="bold">{bundle.name}</Text>
                                            <Text variant="bodySm" tone="subdued">{bundle.displayNames.join(" + ")}</Text>
                                        </BlockStack>

                                        <Divider />

                                        <InlineGrid columns={2} gap="200">
                                            <Text variant="bodySm">Discount: <strong>{bundle.discountPercent}%</strong></Text>
                                            <Text variant="bodySm">Type: <strong>{bundle.bundleType}</strong></Text>
                                            <Text variant="bodySm">Views: <strong>{bundle.analytics?.stats?.view || 0}</strong></Text>
                                            <Text variant="bodySm">Conversions: <strong>{bundle.analytics?.stats?.cart_add || 0}</strong></Text>
                                        </InlineGrid>

                                        {expandedBundles.has(bundle._id) && (
                                            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                                <BlockStack gap="100">
                                                    <Text variant="bodySm">Source: {bundle.bundleType === "auto" ? "Auto-generated" : "Merchant-created"}</Text>
                                                    <Text variant="bodySm">Confidence: {bundle.confidence != null ? `${(bundle.confidence * 100).toFixed(0)}%` : "—"}</Text>
                                                    <Text variant="bodySm">Products: {bundle.displayNames.join(", ")}</Text>
                                                    <Text variant="bodySm">CTR: {bundle.analytics?.stats?.view > 0 ? `${((bundle.analytics.stats.click || 0) / bundle.analytics.stats.view * 100).toFixed(1)}%` : "—"}</Text>
                                                    <Text variant="bodySm">Conversion: {bundle.analytics?.stats?.view > 0 ? `${((bundle.analytics.stats.cart_add || 0) / bundle.analytics.stats.view * 100).toFixed(1)}%` : "—"}</Text>
                                                    <Text variant="bodySm">Status: <Badge tone={bundle.status === "paused" ? "critical" : "success"}>{bundle.status}</Badge></Text>
                                                </BlockStack>
                                            </Box>
                                        )}

                                        <InlineStack gap="200">
                                            <Button
                                                tone={bundle.status === "paused" ? "success" : "critical"}
                                                onClick={() => handlePauseBundle(bundle._id, bundle.status === "paused")}
                                            >
                                                {bundle.status === "paused" ? "Resume" : "Pause"}
                                            </Button>
                                            <Button
                                                variant={expandedBundles.has(bundle._id) ? "primary" : undefined}
                                                onClick={() => toggleDetails(bundle._id)}
                                            >
                                                {expandedBundles.has(bundle._id) ? "Hide Details" : "Details"}
                                            </Button>
                                        </InlineStack>
                                    </BlockStack>
                                </Card>
                            ))}
                        </InlineGrid>
                    )}
                </BlockStack>
            </Card>

            {/* Optimization Run History */}
            <Card>
                <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">Optimization Run History</Text>
                    {history.length === 0 ? (
                        <EmptyState heading="No optimization runs yet" image="">
                            <p>Click 'Run Optimization Now' or wait for auto-trigger.</p>
                        </EmptyState>
                    ) : (
                        <BlockStack gap="300">
                            {history.map((run, i) => (
                                <Card key={i}>
                                    <BlockStack gap="200">
                                        <InlineStack align="space-between" blockAlign="center">
                                            <BlockStack gap="100">
                                                <Text variant="bodyMd" fontWeight="bold">{fmtDate(run.startedAt)}</Text>
                                                <Text variant="bodySm" tone="subdued">via {run.triggeredBy} · {fmtMs(run.durationMs)}</Text>
                                            </BlockStack>
                                            {resultBadge(run.success ? "success" : run.reason || "error")}
                                        </InlineStack>

                                        <Text variant="bodySm">
                                            Events analyzed: <strong>{run.eventCount || 0}</strong> ·
                                            Adjustments made: <strong>{run.updatesMade || 0}</strong> ·
                                            Bundles recommended: <strong>{run.bundleRecommendations || 0}</strong>
                                        </Text>

                                        {run.appliedUpdates && (
                                            Object.keys(run.appliedUpdates.guardrails || {}).length > 0 ||
                                            Object.keys(run.appliedUpdates.optimization || {}).length > 0
                                        ) ? (
                                            <Text variant="bodySm" tone="subdued">
                                                Auto-adjusted: {[
                                                    ...Object.entries(run.appliedUpdates.guardrails || {}).map(
                                                        ([k, v]) => `${k} → ${typeof v === "number" && v.toFixed ? v.toFixed(2) : v}`
                                                    ),
                                                    ...Object.entries(run.appliedUpdates.optimization || {}).map(
                                                        ([k, v]) => `${k} → ${typeof v === "number" && v.toFixed ? v.toFixed(2) : v}`
                                                    )
                                                ].join(" · ")}
                                            </Text>
                                        ) : (
                                            <Text variant="bodySm" tone="subdued">No parameter changes needed</Text>
                                        )}

                                        {run.reason && (
                                            <Text variant="bodySm" tone="caution">{run.reason}</Text>
                                        )}
                                    </BlockStack>
                                </Card>
                            ))}
                        </BlockStack>
                    )}
                </BlockStack>
            </Card>
        </BlockStack>
    </Page>
  );
}
