import { RedirectToDashboard } from "../components/RedirectToDashboard";
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
  return <RedirectToDashboard path="/optimization" />;
}
