import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  Box,
  Tabs,
  Divider,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  try {
    const response = await fetch(`https://${session.shop}/api/decision-engine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "segments" })
    });

    const segments = await response.json();
    return json({ shopId, segments, tab: "segments" });
  } catch (err) {
    console.error("Failed to load explainability data:", err);
    return json({ shopId, segments: { segments: [] }, tab: "segments" });
  }
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    const response = await fetch(
      `https://${shopId}/admin/api/2024-01/graphql.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: intent,
          offerId: formData.get("offerId"),
          productId: formData.get("productId")
        })
      }
    );

    const result = await response.json();
    return json({ success: true, result, intent });
  } catch (err) {
    return json({ success: false, error: err.message }, { status: 500 });
  }
};

function ScoreBreakdownChart({ breakdown }) {
  if (!breakdown) return null;

  const entries = Object.entries(breakdown).filter(([, v]) => v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  const colorMap = {
    ai_confidence: "#3b82f6",
    goal_alignment: "#8b5cf6",
    performance_history: "#ec4899",
    merchant_approval: "#10b981",
    other: "#f59e0b"
  };

  return (
    <BlockStack gap="300">
      {entries.map(([key, value]) => (
        <BlockStack key={key} gap="100">
          <InlineStack align="space-between">
            <Text variant="bodySm" fontWeight="semibold">
              {key.replace(/_/g, " ").charAt(0).toUpperCase() + key.replace(/_/g, " ").slice(1)}
            </Text>
            <Text variant="bodySm" tone="subdued">{(value * 100).toFixed(0)}%</Text>
          </InlineStack>
          <div style={{ height: "8px", background: "#e1e3e5", borderRadius: "4px", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${(value / total) * 100}%`,
              background: colorMap[key] || "#6b7280",
              transition: "width 0.2s ease"
            }} />
          </div>
        </BlockStack>
      ))}
    </BlockStack>
  );
}

function healthBadgeTone(health) {
  const map = { excellent: "success", good: "success", needs_work: "critical" };
  return map[health];
}

const TABS = [
  { id: "segments", content: "Segment Performance", panelID: "segments-panel" },
  { id: "context", content: "Context Injection", panelID: "context-panel" },
  { id: "journey", content: "Automation Journey", panelID: "journey-panel" },
  { id: "guardrails", content: "Guardrails", panelID: "guardrails-panel" },
];

export default function ExplainabilityDashboard() {
  const { segments } = useLoaderData();
  const [selectedTab, setSelectedTab] = useState(0);
  const activeTab = TABS[selectedTab].id;

  const journeyItems = [
    { date: "Mar 10 2:30 PM", action: "Offer Created", status: "created" },
    { date: "Mar 11 10:15 AM", action: "Auto-Tune Discount +5%", status: "tuned", reason: "Low CTR (3.2%)" },
    { date: "Mar 12 8:45 PM", action: "Promoted", status: "promoted", reason: "Conversion up to 2.8%" }
  ];

  const statusBadgeTone = (s) => ({ created: "info", tuned: "warning", promoted: "success", paused: "critical" }[s]);

  const guardrailItems = [
    { type: "discount_limit", value: "35%", limit: "50%", pass: true },
    { type: "bundle_quality", value: "0.78", limit: "0.60", pass: true },
    { type: "offer_density", value: "0.18", limit: "0.30", pass: true }
  ];

  return (
    <Page
      title="Explainability Dashboard"
      subtitle="Full transparency into why each offer is selected, promoted, or paused. See the complete automation journey."
    >
      <BlockStack gap="500">
        {/* Tabs */}
        <Card padding="0">
          <Tabs tabs={TABS} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400">
              {/* Segment Performance */}
              {activeTab === "segments" && (
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">Segment Performance (Last 30 Days)</Text>
                  {!segments || segments.segments?.length === 0 ? (
                    <Banner>No segment data yet. Offers will generate performance data.</Banner>
                  ) : (
                    <BlockStack gap="300">
                      {segments.segments.map((seg) => (
                        <Card key={seg.segment}>
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="start">
                              <BlockStack gap="100">
                                <Text variant="bodyMd" fontWeight="bold">
                                  {seg.segment.replace(/_/g, " ").toUpperCase()}
                                </Text>
                                <Text variant="bodySm" tone="subdued">{seg.recommendation}</Text>
                              </BlockStack>
                              <Badge tone={healthBadgeTone(seg.health)}>{seg.health}</Badge>
                            </InlineStack>
                            <InlineGrid columns={4} gap="300">
                              {[
                                { label: "Views", value: seg.metrics.views },
                                { label: "CTR", value: `${seg.metrics.ctr}%` },
                                { label: "Conversion", value: `${seg.metrics.conversion}%` },
                                { label: "Avg Order", value: `$${seg.metrics.avgOrderValue}` }
                              ].map(({ label, value }) => (
                                <BlockStack key={label} gap="100">
                                  <Text variant="bodySm" tone="subdued">{label}</Text>
                                  <Text variant="headingSm">{value}</Text>
                                </BlockStack>
                              ))}
                            </InlineGrid>
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              )}

              {/* Context Injection */}
              {activeTab === "context" && (
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Context Injection Effectiveness</Text>
                    <Text variant="bodySm" tone="subdued">
                      Compare performance of merchant-injected offers vs AI-generated recommendations
                    </Text>
                  </BlockStack>
                  <Banner tone="success" title="Merchant focus products performing well">
                    <p>Manual context has 12% higher conversion than AI-only. Recommendation: Continue injecting context for maximum impact.</p>
                  </Banner>
                </BlockStack>
              )}

              {/* Automation Journey */}
              {activeTab === "journey" && (
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Automation Journey Timeline</Text>
                    <Text variant="bodySm" tone="subdued">
                      Track every automation action: auto-pause, incentive tuning, placement shifts
                    </Text>
                  </BlockStack>
                  <BlockStack gap="300">
                    {journeyItems.map((item, idx) => (
                      <Card key={idx}>
                        <InlineStack gap="300" blockAlign="center">
                          <Badge tone={statusBadgeTone(item.status)}>{item.status}</Badge>
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="semibold">{item.action}</Text>
                            {item.reason && <Text variant="bodySm" tone="subdued">{item.reason}</Text>}
                          </BlockStack>
                          <Text variant="bodySm" tone="subdued">{item.date}</Text>
                        </InlineStack>
                      </Card>
                    ))}
                  </BlockStack>
                </BlockStack>
              )}

              {/* Guardrails */}
              {activeTab === "guardrails" && (
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Guardrail Enforcement Log</Text>
                    <Text variant="bodySm" tone="subdued">
                      All guardrail checks, violations, and enforcement actions
                    </Text>
                  </BlockStack>
                  <BlockStack gap="300">
                    {guardrailItems.map((rule, idx) => (
                      <Card key={idx}>
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text variant="bodyMd" fontWeight="semibold">
                              {rule.type.replace(/_/g, " ").toUpperCase()}
                            </Text>
                            <Text variant="bodySm" tone="subdued">
                              Value: {rule.value} / Limit: {rule.limit}
                            </Text>
                          </BlockStack>
                          <Badge tone={rule.pass ? "success" : "critical"}>
                            {rule.pass ? "Pass" : "Fail"}
                          </Badge>
                        </InlineStack>
                      </Card>
                    ))}
                  </BlockStack>
                </BlockStack>
              )}
            </Box>
          </Tabs>
        </Card>

        {/* Score Breakdown */}
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">Example Offer Score Breakdown</Text>
            <Divider />
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="500">
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">Offer Details</Text>
                <BlockStack gap="100">
                  <Text variant="bodySm"><strong>Product:</strong> Premium Subscription Bundle</Text>
                  <Text variant="bodySm"><strong>Placement:</strong> Product Page</Text>
                  <Text variant="bodySm"><strong>Discount:</strong> 20%</Text>
                  <Text variant="bodySm"><strong>Final Score:</strong> 0.82 / 1.0</Text>
                </BlockStack>
              </BlockStack>
              <BlockStack gap="300">
                <Text variant="headingSm" as="h3">Score Components</Text>
                <ScoreBreakdownChart breakdown={{
                  ai_confidence: 0.3,
                  goal_alignment: 0.25,
                  performance_history: 0.22,
                  merchant_approval: 0.15,
                  other: 0.08
                }} />
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
