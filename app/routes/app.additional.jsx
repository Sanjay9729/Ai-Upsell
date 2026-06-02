import { useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return Response.json({
    shop: session.shop,
    dashboardUrl: process.env.DASHBOARD_URL || "http://localhost:5173",
  });
};

const FEATURES = [
  {
    title: "Goal & Guardrails",
    description:
      "Set your upsell strategy goals, configure risk tolerance, and define guardrails to keep AI recommendations within your preferred boundaries.",
    href: "/guardrails",
  },
  {
    title: "Analytics",
    description:
      "Track upsell performance, conversion rates, revenue impact, and average order value across your store.",
    href: "/analytics",
  },
  {
    title: "Activity Logs",
    description:
      "Review a real-time feed of upsell events, cart additions, and recent conversions driven by AI recommendations.",
    href: "/activity-logs",
  },
  {
    title: "Merchandising Intelligence",
    description:
      "Leverage AI-powered product insights to surface the most relevant upsells for each customer at the right moment.",
    href: "/intelligence",
  },
  {
    title: "Learning & Optimization",
    description:
      "Fine-tune AI learning schedules, manage bundle rules, and review optimization history to improve upsell performance over time.",
    href: "/optimization",
  },
  {
    title: "Safety Mode",
    description:
      "Enable safety constraints to prevent irrelevant or low-quality recommendations from being shown to your customers.",
    href: "/safety",
  },
  {
    title: "Guardrail Monitor",
    description:
      "Monitor active guardrail triggers, review override history, and ensure AI recommendations stay within your defined limits.",
    href: "/guardrail-monitor",
  },
];

export default function AdditionalFeaturesPage() {
  const { shop, dashboardUrl } = useLoaderData();

  return (
    <Page title="Additional Features">
      <BlockStack gap="500">
        <Text as="p" variant="bodyMd" tone="subdued">
          Explore and manage all features available in your AI Upsell app.
        </Text>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              App Overview
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
              <Card background="bg-surface-secondary">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    AI Recommendations
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Your AI upsell engine is active and generating personalized product recommendations.
                  </Text>
                  <Box paddingBlockStart="100">
                    <Button
                      onClick={() =>
                        window.open(
                          `${dashboardUrl}/analytics?shop=${encodeURIComponent(shop)}`,
                          "_blank"
                        )
                      }
                    >
                      View Analytics
                    </Button>
                  </Box>
                </BlockStack>
              </Card>
              <Card background="bg-surface-secondary">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Guardrails & Safety
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Configure guardrails and safety rules to ensure recommendations stay within your preferred boundaries.
                  </Text>
                  <Box paddingBlockStart="100">
                    <Button
                      onClick={() =>
                        window.open(
                          `${dashboardUrl}/guardrails?shop=${encodeURIComponent(shop)}`,
                          "_blank"
                        )
                      }
                    >
                      View Guardrails
                    </Button>
                  </Box>
                </BlockStack>
              </Card>
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Additional features
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {FEATURES.map((feature) => (
                <Card key={feature.title} background="bg-surface-secondary">
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        {feature.title}
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {feature.description}
                      </Text>
                    </BlockStack>
                    <Box paddingBlockStart="100">
                      <Button
                        onClick={() =>
                          window.open(
                            `${dashboardUrl}${feature.href}?shop=${encodeURIComponent(shop)}`,
                            "_blank"
                          )
                        }
                      >
                        Manage
                      </Button>
                    </Box>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
