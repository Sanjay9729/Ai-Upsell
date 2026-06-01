import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
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
  Badge,
  Banner,
  DataTable,
  Divider,
  Box,
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
  const { schedulerState, history, offerTypePerf, aovImpact, elasticity, segmentPerf, guardrails } = useLoaderData();
  const fetcher = useFetcher();
  const [banner, setBanner] = useState(null);

  const isRunning = fetcher.state !== "idle" || schedulerState?.isRunning;

  const handleRunOptimization = () => {
    fetcher.submit(
      { intent: "run_optimization" },
      { method: "POST" }
    );
  };

  // Show result banner after fetcher completes
  useState(() => {
    if (fetcher.state === "idle" && fetcher.data?.intent === "run_optimization") {
      setBanner(fetcher.data.success
        ? { tone: "success", title: `Optimization complete — ${fetcher.data.updatesMade} updates, ${fetcher.data.bundleRecommendations} bundle suggestions.` }
        : { tone: "critical", title: fetcher.data.reason || "Optimization failed." }
      );
    }
  });

  const historyRows = history.map((h) => [
    fmtDate(h.startedAt),
    h.triggeredBy || "—",
    resultBadge(h.success ? "success" : "error"),
    h.updatesMade ?? "—",
    fmtMs(h.durationMs),
  ]);

  const offerRows = offerTypePerf
    ? Object.entries(offerTypePerf).map(([type, data]) => [
        type,
        data.count ?? "—",
        data.conversionRate != null ? `${(data.conversionRate * 100).toFixed(1)}%` : "—",
        data.avgDiscount != null ? `${data.avgDiscount.toFixed(1)}%` : "—",
      ])
    : [];

  const segmentRows = (segmentPerf || []).map((s) => [
    s.segment || "—",
    s.count ?? "—",
    s.conversionRate != null ? `${(s.conversionRate * 100).toFixed(1)}%` : "—",
  ]);

  return (
    <Page
      title="Optimization"
      subtitle="AI learning loop performance and analytics."
      primaryAction={{
        content: isRunning ? "Running…" : "Run Optimization",
        onAction: handleRunOptimization,
        disabled: isRunning,
        loading: isRunning,
      }}
    >
      <BlockStack gap="500">
        {banner && <Banner tone={banner.tone} title={banner.title} onDismiss={() => setBanner(null)} />}

        {/* Scheduler status */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">Scheduler Status</Text>
              {schedulerState && (
                <Badge tone={schedulerState.isRunning ? "attention" : "success"}>
                  {schedulerState.isRunning ? "Running" : "Idle"}
                </Badge>
              )}
            </InlineStack>
            <Divider />
            {schedulerState ? (
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Last Run</Text>
                  <Text variant="bodyMd">{fmtDate(schedulerState.lastOptimizationAt)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Triggered By</Text>
                  <Text variant="bodyMd">{schedulerState.triggeredBy || "—"}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Duration</Text>
                  <Text variant="bodyMd">{fmtMs(schedulerState.durationMs)}</Text>
                </BlockStack>
              </InlineGrid>
            ) : (
              <Text variant="bodyMd" tone="subdued">No optimization has run yet.</Text>
            )}
            {schedulerState?.lastReason && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <Text variant="bodySm" tone="subdued">Last reason: {schedulerState.lastReason}</Text>
              </Box>
            )}
          </BlockStack>
        </Card>

        {/* Offer type performance */}
        {offerRows.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Performance by Offer Type</Text>
              <Divider />
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["Offer Type", "Count", "Conversion Rate", "Avg Discount"]}
                rows={offerRows}
              />
            </BlockStack>
          </Card>
        )}

        {/* Segment performance */}
        {segmentRows.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Performance by Segment</Text>
              <Divider />
              <DataTable
                columnContentTypes={["text", "numeric", "text"]}
                headings={["Segment", "Count", "Conversion Rate"]}
                rows={segmentRows}
              />
            </BlockStack>
          </Card>
        )}

        {/* AOV impact */}
        {aovImpact && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">AOV Impact</Text>
              <Divider />
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                {Object.entries(aovImpact).map(([key, val]) => (
                  <BlockStack key={key} gap="100">
                    <Text variant="bodySm" tone="subdued">{key}</Text>
                    <Text variant="bodyMd" fontWeight="semibold">
                      {typeof val === "number" ? val.toFixed(2) : String(val)}
                    </Text>
                  </BlockStack>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* Guardrail summary */}
        {guardrails && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Guardrail Summary</Text>
              <Divider />
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Total Decisions</Text>
                  <Text variant="headingMd" fontWeight="bold">{guardrails.totalDecisions ?? "—"}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Guardrail Rate</Text>
                  <Text variant="headingMd" fontWeight="bold">
                    {guardrails.guardrailRate != null ? `${(guardrails.guardrailRate * 100).toFixed(1)}%` : "—"}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Trigger Types</Text>
                  <Text variant="headingMd" fontWeight="bold">{guardrails.triggers?.length ?? "—"}</Text>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* Optimization history */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Optimization History</Text>
            <Divider />
            {history.length === 0 ? (
              <Box padding="600">
                <Text variant="bodyMd" tone="subdued" alignment="center">No optimization runs yet.</Text>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "text"]}
                headings={["Started", "Triggered By", "Result", "Updates", "Duration"]}
                rows={historyRows}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
