import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";

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
  const { shopId, config, systemHealth } = useLoaderData();
  const fetcher = useFetcher();
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setBanner(fetcher.data.success
        ? { tone: "success", title: "Optimization complete." }
        : { tone: "critical", title: fetcher.data.error || "Optimization failed." }
      );
      const t = setTimeout(() => setBanner(null), 4000);
      return () => clearTimeout(t);
    }
  }, [fetcher.state, fetcher.data]);

  const handleOptimize = () => {
    fetcher.submit(
      JSON.stringify({ actionType: "run_optimization" }),
      { method: "POST", encType: "application/json" }
    );
  };

  const healthItems = [
    { label: "Products synced", value: systemHealth.productCount },
    { label: "Active bundles", value: systemHealth.bundleCount },
    { label: "Events (7 days)", value: systemHealth.eventCount },
  ];

  return (
    <Page title="Settings" subtitle="System configuration and health overview.">
      <BlockStack gap="500">
        {banner && <Banner tone={banner.tone} title={banner.title} />}

        {/* System Health */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">System Health</Text>
              <Badge tone={systemHealth.safetyModeActive ? "critical" : "success"}>
                {systemHealth.safetyModeActive ? "Safety Mode ON" : "Operational"}
              </Badge>
            </InlineStack>
            <Divider />
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              {healthItems.map(({ label, value }) => (
                <BlockStack key={label} gap="100">
                  <Text variant="bodySm" tone="subdued">{label}</Text>
                  <Text variant="headingMd" fontWeight="bold">{value}</Text>
                </BlockStack>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Store */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Store</Text>
            <Divider />
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued">Shop ID</Text>
              <Text variant="bodyMd">{shopId}</Text>
            </BlockStack>
            {config?.goal && (
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Active Goal</Text>
                <Text variant="bodyMd">{config.goal}</Text>
              </BlockStack>
            )}
            {config?.riskTolerance && (
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Risk Tolerance</Text>
                <Text variant="bodyMd">{config.riskTolerance}</Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Manual Optimization */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Manual Optimization</Text>
            <Divider />
            <Text variant="bodyMd" tone="subdued">
              Trigger a full learning loop run manually. This updates offer weights based on recent event data.
            </Text>
            <InlineStack>
              <Button
                variant="primary"
                loading={fetcher.state !== "idle"}
                disabled={fetcher.state !== "idle"}
                onClick={handleOptimize}
              >
                Run Optimization
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
