import { useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Grid,
  Page,
  Text,
  Banner,
  Badge,
  InlineStack,
  Divider,
  DataTable,
} from "@shopify/polaris";
import {
  ChartLineIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ErrorBoundary } from "../components/ErrorBoundary";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import(
      "../../backend/database/mongodb.js"
    );
    const db = await getDb();
    const shopId = session.shop;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get merchant config
    const config = await db
      .collection(collections.merchantConfig)
      .findOne({ shopId });

    // Analyze bundle performance for recommendations
    const bundlePerformance = await db
      .collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: thirtyDaysAgo },
            bundleId: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$bundleId",
            views: { $sum: 1 },
            conversions: {
              $sum: {
                $cond: [{ $eq: ["$eventType", "conversion"] }, 1, 0],
              },
            },
            revenue: { $sum: "$revenueLifted" },
          },
        },
        {
          $project: {
            bundleId: "$_id",
            views: 1,
            conversions: 1,
            revenue: 1,
            conversionRate: {
              $multiply: [
                { $divide: ["$conversions", "$views"] },
                100,
              ],
            },
          },
        },
        { $sort: { conversions: -1 } },
      ])
      .toArray()
      .catch(() => []);

    // Generate recommendations based on performance
    const recommendations = [];

    // Check for underperforming bundles
    const coldBundles = bundlePerformance.filter(
      (b) => b.conversionRate < 1 && b.views >= 10
    );
    if (coldBundles.length > 0) {
      recommendations.push({
        type: "warning",
        priority: "high",
        title: "⏸️ Pause Underperforming Bundles",
        message: `${coldBundles.length} bundle(s) with <1% conversion rate. Consider pausing to test new combinations.`,
        action: "View bundles",
        bundles: coldBundles.map((b) => b.bundleId),
      });
    }

    // Check for hot bundles
    const hotBundles = bundlePerformance.filter(
      (b) => b.conversionRate > 3 && b.views >= 20
    );
    if (hotBundles.length > 0) {
      recommendations.push({
        type: "success",
        priority: "high",
        title: "🚀 Scale High-Performing Bundles",
        message: `${hotBundles.length} bundle(s) with >3% conversion rate. Consider increasing discount slightly to boost volume.`,
        action: "Increase discount",
        bundles: hotBundles.map((b) => b.bundleId),
      });
    }

    // Check guardrail utilization
    if (config?.guardrails?.maxDiscountCap) {
      const avgDiscount = 
        bundlePerformance.length > 0
          ? (bundlePerformance.reduce((sum, b) => sum + b.revenue / b.conversions, 0) / bundlePerformance.length) * 100
          : 0;

      if (avgDiscount < config.guardrails.maxDiscountCap * 0.5) {
        recommendations.push({
          type: "info",
          priority: "medium",
          title: "💡 You Have Discount Headroom",
          message: `Using only ${(avgDiscount / config.guardrails.maxDiscountCap * 100).toFixed(0)}% of max discount. Try increasing discounts to boost conversions.`,
          action: "Adjust guardrails",
        });
      }
    }

    // Offer type recommendations
    const offerTypePerf = await db
      .collection(collections.upsellEvents)
      .aggregate([
        {
          $match: {
            shopId,
            timestamp: { $gte: thirtyDaysAgo },
            offerType: { $exists: true },
          },
        },
        {
          $group: {
            _id: "$offerType",
            views: { $sum: 1 },
            conversions: {
              $sum: {
                $cond: [{ $eq: ["$eventType", "conversion"] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            offerType: "$_id",
            conversionRate: {
              $multiply: [
                { $divide: ["$conversions", "$views"] },
                100,
              ],
            },
          },
        },
        { $sort: { conversionRate: -1 } },
      ])
      .toArray()
      .catch(() => []);

    if (offerTypePerf.length > 1) {
      const best = offerTypePerf[0];
      const worst = offerTypePerf[offerTypePerf.length - 1];
      if (best.conversionRate > worst.conversionRate * 2) {
        recommendations.push({
          type: "success",
          priority: "medium",
          title: "🎯 Best Performing Offer Type",
          message: `${best.offerType} outperforms by ${(best.conversionRate - worst.conversionRate).toFixed(1)}%. Consider using it more.`,
          action: "View analytics",
        });
      }
    }

    return json({
      shopId,
      config,
      bundlePerformance: bundlePerformance.map((b) => ({
        bundleId: b.bundleId,
        views: b.views,
        conversions: b.conversions,
        revenue: parseFloat(b.revenue.toFixed(2)),
        conversionRate: parseFloat(b.conversionRate.toFixed(2)),
        status: b.conversionRate > 3 ? "hot" : b.conversionRate < 1 && b.views >= 10 ? "cold" : "warm",
      })),
      offerTypePerformance: offerTypePerf.map((o) => ({
        offerType: o.offerType,
        conversionRate: parseFloat(o.conversionRate.toFixed(2)),
      })),
      recommendations,
    });
  } catch (error) {
    console.error("Optimize loader error:", error);
    return json({
      shopId: session.shop,
      config: null,
      bundlePerformance: [],
      offerTypePerformance: [],
      recommendations: [],
    });
  }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { actionType, bundleIds, discountAdjustment } = await request.json();

  try {
    const { getDb } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    if (actionType === "pause_bundles") {
      // Pause underperforming bundles
      await db
        .collection("bundles")
        .updateMany(
          { _id: { $in: bundleIds }, shopId: session.shop },
          { $set: { active: false, pausedAt: new Date() } }
        );
      return json({ success: true, message: "Bundles paused" });
    }

    if (actionType === "apply_recommendation") {
      // Log recommendation applied
      await db
        .collection("optimization_actions")
        .insertOne({
          shopId: session.shop,
          action: actionType,
          timestamp: new Date(),
          details: { discountAdjustment },
        });
      return json({ success: true, message: "Recommendation applied" });
    }

    return json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Optimize action error:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};

export default function OptimizePage() {
  const { bundlePerformance, recommendations } = useLoaderData();
  const fetcher = useFetcher();

  // Categorize bundles by performance
  const hotBundles = bundlePerformance.filter((b) => b.status === "hot");
  const warmBundles = bundlePerformance.filter((b) => b.status === "warm");
  const coldBundles = bundlePerformance.filter((b) => b.status === "cold");

  return (
    <Page
      title="Optimize"
      subtitle="AI-powered recommendations to improve your results"
    >
      <BlockStack gap="500">
        {/* Breadcrumb Navigation */}
        <Box paddingBlock="200">
          <Breadcrumbs />
        </Box>

        {/* AI Recommendations */}
        {recommendations.length > 0 && (
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              🤖 Smart Recommendations
            </Text>
            {recommendations.map((rec, idx) => (
              <Banner
                key={idx}
                tone={
                  rec.type === "success"
                    ? "success"
                    : rec.type === "warning"
                    ? "warning"
                    : "info"
                }
              >
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {rec.title}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {rec.message}
                  </Text>
                  <Button
                    variant="secondary"
                    size="slim"
                    onClick={() => {
                      if (rec.bundles) {
                        fetcher.submit(
                          {
                            actionType: "pause_bundles",
                            bundleIds: rec.bundles,
                          },
                          { method: "POST", encType: "application/json" }
                        );
                      }
                    }}
                  >
                    {rec.action}
                  </Button>
                </BlockStack>
              </Banner>
            ))}
          </BlockStack>
        )}

        {/* Bundle Performance Overview */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              🔥 Bundle Performance Status
            </Text>
            <Divider />
            <Grid columns={{ xs: 1, sm: 3 }} gap="300">
              <Box>
                <BlockStack gap="150">
                  <Badge tone="success">🔥 Hot Bundles</Badge>
                  <Text as="span" variant="heading3xl" fontWeight="bold">
                    {hotBundles.length}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    &gt;3% conversion rate
                  </Text>
                </BlockStack>
              </Box>
              <Box>
                <BlockStack gap="150">
                  <Badge tone="info">🌡️ Warm Bundles</Badge>
                  <Text as="span" variant="heading3xl" fontWeight="bold">
                    {warmBundles.length}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    1-3% conversion rate
                  </Text>
                </BlockStack>
              </Box>
              <Box>
                <BlockStack gap="150">
                  <Badge tone="critical">❄️ Cold Bundles</Badge>
                  <Text as="span" variant="heading3xl" fontWeight="bold">
                    {coldBundles.length}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {"<1% conversion rate"}
                  </Text>
                </BlockStack>
              </Box>
            </Grid>
          </BlockStack>
        </Card>

        {/* Hot Bundles - Scale */}
        {hotBundles.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🚀 Scale These Bundles
                </Text>
                <Badge tone="success">Performing Well</Badge>
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                ]}
                headings={[
                  "Bundle ID",
                  "Views",
                  "Conversions",
                  "Conv. Rate",
                ]}
                rows={hotBundles.map((b) => [
                  b.bundleId,
                  b.views.toString(),
                  b.conversions.toString(),
                  `${b.conversionRate.toFixed(2)}%`,
                ])}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                These bundles are your top performers. Consider increasing visibility or discount slightly to boost volume.
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* Warm Bundles - Monitor */}
        {warmBundles.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  🌡️ Monitor These Bundles
                </Text>
                <Badge tone="info">Moderate Performance</Badge>
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                ]}
                headings={[
                  "Bundle ID",
                  "Views",
                  "Conversions",
                  "Conv. Rate",
                ]}
                rows={warmBundles.map((b) => [
                  b.bundleId,
                  b.views.toString(),
                  b.conversions.toString(),
                  `${b.conversionRate.toFixed(2)}%`,
                ])}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                These are performing adequately. Keep testing variations to push them to "hot" status.
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* Cold Bundles - Pause */}
        {coldBundles.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  ❄️ Consider Pausing
                </Text>
                <Badge tone="critical">Low Performance</Badge>
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={[
                  "text",
                  "numeric",
                  "numeric",
                  "numeric",
                ]}
                headings={[
                  "Bundle ID",
                  "Views",
                  "Conversions",
                  "Conv. Rate",
                ]}
                rows={coldBundles.map((b) => [
                  b.bundleId,
                  b.views.toString(),
                  b.conversions.toString(),
                  `${b.conversionRate.toFixed(2)}%`,
                ])}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                These bundles have low conversion rates. Consider pausing them and testing new product combinations.
              </Text>
              <Button
                variant="primary"
                tone="critical"
                onClick={() =>
                  fetcher.submit(
                    {
                      actionType: "pause_bundles",
                      bundleIds: coldBundles.map((b) => b.bundleId),
                    },
                    { method: "POST", encType: "application/json" }
                  )
                }
              >
                Pause Cold Bundles
              </Button>
            </BlockStack>
          </Card>
        )}

        {/* Auto-Tuning Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              ⚙️ How Optimization Works
            </Text>
            <Divider />
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="start">
                <Badge tone="success">1</Badge>
                <BlockStack gap="100">
                  <Text as="span" fontWeight="bold">
                    Data Collection
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    We track every offer view, click, and conversion
                  </Text>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <Badge tone="success">2</Badge>
                <BlockStack gap="100">
                  <Text as="span" fontWeight="bold">
                    Performance Analysis
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {"Categorize bundles as Hot (>3%), Warm (1-3%), or Cold (<1%)"}
                  </Text>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <Badge tone="success">3</Badge>
                <BlockStack gap="100">
                  <Text as="span" fontWeight="bold">
                    Actionable Recommendations
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    We suggest which to scale, monitor, or pause
                  </Text>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <Badge tone="success">4</Badge>
                <BlockStack gap="100">
                  <Text as="span" fontWeight="bold">
                    One-Click Actions
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Apply recommendations instantly from here
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
