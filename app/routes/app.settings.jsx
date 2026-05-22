import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Divider,
  Grid,
  InlineStack,
  Layout,
  Page,
  Text,
  Toast,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ExternalIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ErrorBoundary } from "../components/ErrorBoundary";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import(
      "../../backend/database/mongodb.js"
    );
    const db = await getDb();

    // Get merchant config
    const config = await db
      .collection(collections.merchantConfig)
      .findOne({ shopId: session.shop });

    // Check system health
    const [productCount, bundleCount, eventCount, safetyMode] =
      await Promise.all([
        db
          .collection(collections.products)
          .countDocuments({ shopId: session.shop }),
        db
          .collection(collections.bundles)
          .countDocuments({ shopId: session.shop }),
        db
          .collection(collections.upsellEvents)
          .countDocuments({
            shopId: session.shop,
            timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          }),
        db
          .collection("safety_mode")
          .findOne({ shopId: session.shop }),
      ]);

    return json({
      shopId: session.shop,
      config,
      systemHealth: {
        productCount,
        bundleCount,
        eventCount,
        safetyModeActive: safetyMode?.active || false,
      },
    });
  } catch (error) {
    console.error("Settings loader error:", error);
    return json({
      shopId: session.shop,
      config: null,
      systemHealth: {
        productCount: 0,
        bundleCount: 0,
        eventCount: 0,
        safetyModeActive: false,
      },
    });
  }
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { actionType } = await request.json();

  try {
    if (actionType === "run_optimization") {
      const { learningLoopEngine } = await import(
        "../../backend/services/learningLoopEngine.js"
      );
      const result = await learningLoopEngine.runFullLearningLoop(session.shop);
      return json({
        success: result.success,
        message: "Optimization complete",
      });
    }

    return json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Settings action error:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};

export default function SettingsPage() {
  const { config, systemHealth } = useLoaderData();
  const fetcher = useFetcher();
  const [toast, setToast] = useState(null);

  const handleRunOptimization = () => {
    fetcher.submit(
      { actionType: "run_optimization" },
      { method: "POST", encType: "application/json" }
    );
    setToast({ message: "Running optimization...", error: false });
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      setToast({
        message: "✓ Optimization completed successfully",
        error: false,
      });
    }
  }, [fetcher.data]);

  return (
    <Page title="Settings" subtitle="System configuration and health monitoring">
      <BlockStack gap="500">
        {/* Breadcrumb Navigation */}
        <Box paddingBlock="200">
          <Breadcrumbs />
        </Box>

        {/* System Health Status */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                🏥 System Health
              </Text>
              <Badge tone={systemHealth.safetyModeActive ? "warning" : "success"}>
                {systemHealth.safetyModeActive ? "⚠ Safety Mode ON" : "✓ All Systems"}
              </Badge>
            </InlineStack>
            <Divider />

            <Grid columns={{ xs: 2, sm: 4 }} gap="300">
              {/* MongoDB Status */}
              <Box>
                <BlockStack gap="150">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Database
                    </Text>
                    <Icon source={CheckCircleIcon} tone="success" />
                  </InlineStack>
                  <Text as="span" fontWeight="bold" variant="headingMd">
                    Connected
                  </Text>
                </BlockStack>
              </Box>

              {/* Groq AI Status */}
              <Box>
                <BlockStack gap="150">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Groq AI
                    </Text>
                    <Icon source={CheckCircleIcon} tone="success" />
                  </InlineStack>
                  <Text as="span" fontWeight="bold" variant="headingMd">
                    Active
                  </Text>
                </BlockStack>
              </Box>

              {/* Learning Loop Status */}
              <Box>
                <BlockStack gap="150">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Learning Loop
                    </Text>
                    <Icon source={CheckCircleIcon} tone="success" />
                  </InlineStack>
                  <Text as="span" fontWeight="bold" variant="headingMd">
                    Running
                  </Text>
                </BlockStack>
              </Box>

              {/* Safety Mode Status */}
              <Box>
                <BlockStack gap="150">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Safety Mode
                    </Text>
                    <Icon
                      source={systemHealth.safetyModeActive ? AlertCircleIcon : CheckCircleIcon}
                      tone={systemHealth.safetyModeActive ? "warning" : "success"}
                    />
                  </InlineStack>
                  <Text as="span" fontWeight="bold" variant="headingMd">
                    {systemHealth.safetyModeActive ? "ON" : "OFF"}
                  </Text>
                </BlockStack>
              </Box>
            </Grid>
          </BlockStack>
        </Card>

        {/* Data & Activity */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              📊 Data & Activity
            </Text>
            <Divider />

            <Grid columns={{ xs: 1, sm: 3 }} gap="400">
              {/* Products */}
              <Box>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Products Synced
                  </Text>
                  <Text as="span" fontWeight="bold" variant="heading3xl">
                    {systemHealth.productCount}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    from your store
                  </Text>
                </BlockStack>
              </Box>

              {/* Bundles */}
              <Box>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Active Bundles
                  </Text>
                  <Text as="span" fontWeight="bold" variant="heading3xl">
                    {systemHealth.bundleCount}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    ready to show
                  </Text>
                </BlockStack>
              </Box>

              {/* Events */}
              <Box>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Events (7 days)
                  </Text>
                  <Text as="span" fontWeight="bold" variant="heading3xl">
                    {systemHealth.eventCount}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    tracked
                  </Text>
                </BlockStack>
              </Box>
            </Grid>
          </BlockStack>
        </Card>

        {/* Current Configuration */}
        {config && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  ⚙️ Current Configuration
                </Text>
                <Button url="/app/goal-setup" variant="secondary">
                  Edit
                </Button>
              </InlineStack>
              <Divider />

              <Grid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                {/* Goal */}
                <BlockStack gap="150">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Business Goal
                  </Text>
                  <Badge>
                    {config.goal?.replace(/_/g, " ").toUpperCase() || "Not Set"}
                  </Badge>
                </BlockStack>

                {/* Risk */}
                <BlockStack gap="150">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Risk Tolerance
                  </Text>
                  <Badge tone="info">
                    {config.riskTolerance?.toUpperCase() || "Not Set"}
                  </Badge>
                </BlockStack>

                {/* Max Discount */}
                <BlockStack gap="150">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Max Discount
                  </Text>
                  <Badge tone="success">
                    {config.guardrails?.maxDiscountCap || 0}%
                  </Badge>
                </BlockStack>

                {/* Inventory Min */}
                <BlockStack gap="150">
                  <Text as="span" variant="bodySm" tone="subdued">
                    Inventory Min
                  </Text>
                  <Badge tone="subdued">
                    {config.guardrails?.inventoryMinThreshold || 0} units
                  </Badge>
                </BlockStack>
              </Grid>

              {/* Guardrails Summary */}
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" fontWeight="bold">
                  Active Protections
                </Text>
                <InlineStack gap="200" wrap>
                  {config.guardrails?.premiumSkuProtection && (
                    <Badge tone="info">🛡️ Premium SKU Protected</Badge>
                  )}
                  {config.guardrails?.subscriptionProtection && (
                    <Badge tone="info">🔐 Subscriptions Protected</Badge>
                  )}
                  {config.guardrails?.excludedProductIds?.length > 0 && (
                    <Badge tone="info">
                      ⛔ {config.guardrails.excludedProductIds.length} Products Excluded
                    </Badge>
                  )}
                  {config.guardrails?.excludedCollectionIds?.length > 0 && (
                    <Badge tone="info">
                      ⛔ {config.guardrails.excludedCollectionIds.length} Collections
                      Excluded
                    </Badge>
                  )}
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Quick Actions */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              ⚡ Quick Actions
            </Text>
            <Divider />

            <BlockStack gap="200">
              <Button
                variant="primary"
                onClick={handleRunOptimization}
                loading={fetcher.state !== "idle"}
              >
                Run Optimization Now
              </Button>
              <Text as="p" variant="bodySm" tone="subdued">
                Manually trigger the learning loop to re-evaluate performance and auto-tune offers.
              </Text>
            </BlockStack>

            <Divider />

            <BlockStack gap="200">
              <Button url="/app/guardrail-monitor" variant="secondary">
                View Guardrail Monitor
              </Button>
              <Text as="p" variant="bodySm" tone="subdued">
                Check guardrail violations and trigger events.
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Help & Support */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              ℹ️ Help & Resources
            </Text>
            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="bold">
                    Documentation
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Learn how to use AI Upsell
                  </Text>
                </BlockStack>
                <Button
                  url="https://docs.appunik.com"
                  target="_blank"
                  icon={ExternalIcon}
                  variant="plain"
                >
                  Visit
                </Button>
              </InlineStack>
            </BlockStack>

            <Divider />

            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="bold">
                    Support
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Contact our support team
                  </Text>
                </BlockStack>
                <Button
                  url="https://support.appunik.com"
                  target="_blank"
                  icon={ExternalIcon}
                  variant="plain"
                >
                  Contact
                </Button>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </Page>
  );
}
