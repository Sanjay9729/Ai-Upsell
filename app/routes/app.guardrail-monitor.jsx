import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

const GUARDRAIL_LABELS = {
  safety_mode_active:  { label: "Safety Mode Active",  tone: "critical" },
  placement_blocked:   { label: "Placement Blocked",   tone: "warning" },
  placement_shifted:   { label: "Placement Shifted",   tone: "attention" },
  session_offer_limit: { label: "Session Offer Limit", tone: "info" },
  paused_offer:        { label: "Offer Paused",        tone: "info" },
  low_confidence:      { label: "Low Confidence",      tone: "info" },
  no_candidates:       { label: "No Candidates",       tone: undefined },
  seen_in_session:     { label: "Already Seen",        tone: "success" },
};

function guardrailMeta(type) {
  return GUARDRAIL_LABELS[type] || { label: type, tone: undefined };
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

function buildDetails(ev) {
  const lines = [];
  if (ev.productId) lines.push(`Product: ${ev.productId}`);
  if (ev.productTitle) lines.push(`"${ev.productTitle}"`);
  if (ev.cartProductCount != null) lines.push(`Cart items: ${ev.cartProductCount}`);
  if (ev.contextKey) lines.push(`Context: ${ev.contextKey}`);
  if (ev.sessionOfferLimit != null) lines.push(`Session limit: ${ev.sessionOfferLimit}`);
  if (ev.seenCount != null) lines.push(`Already seen: ${ev.seenCount}`);
  if (ev.confidence != null) lines.push(`Confidence: ${(ev.confidence * 100).toFixed(0)}% (min: ${(ev.minAcceptance * 100).toFixed(0)}%)`);
  if (ev.shiftFrom && ev.shiftTo) lines.push(`Shift: ${ev.shiftFrom} → ${ev.shiftTo}`);
  return lines.length > 0 ? lines : ["—"];
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const { analyzeGuardrailTriggers } = await import("../../backend/services/optimizationEngine.js");
    const db = await getDb();

    const [events, counts, guardrailAnalysis, autoTunings] = await Promise.all([
      db.collection(collections.guardrailEvents).find({ shopId: session.shop }).sort({ timestamp: -1 }).limit(100).toArray(),
      db.collection(collections.guardrailEvents).aggregate([
        { $match: { shopId: session.shop } },
        { $group: { _id: "$guardrailType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      analyzeGuardrailTriggers(session.shop),
      db.collection(collections.optimizationLogs).find({
        shopId: session.shop, type: "learning_loop",
        "results.actions.tunings.sessionOfferLimit": { $exists: true },
      }).sort({ timestamp: -1 }).limit(10).toArray(),
    ]);

    return Response.json({
      success: true,
      events: events.map((e) => ({ ...e, _id: e._id.toString() })),
      counts,
      guardrailRate: guardrailAnalysis.success ? guardrailAnalysis.guardrailRate : null,
      totalDecisions: guardrailAnalysis.success ? guardrailAnalysis.totalDecisions : null,
      autoTunings: autoTunings.map((log) => ({ _id: log._id.toString(), timestamp: log.timestamp, tuning: log.results?.actions?.tunings?.sessionOfferLimit ?? null })).filter((t) => t.tuning !== null),
    });
  } catch (error) {
    console.error("Error loading guardrail events:", error);
    return Response.json({ success: false, error: error.message, events: [], counts: [], guardrailRate: null, totalDecisions: null, autoTunings: [] });
  }
};

export default function GuardrailMonitorPage() {
  const { events, counts, guardrailRate, totalDecisions, autoTunings } = useLoaderData();

  const totalFires = counts.reduce((sum, c) => sum + c.count, 0);
  const ratePercent = guardrailRate != null ? (guardrailRate * 100).toFixed(1) : null;
  const rateTone = guardrailRate > 0.35 ? "critical" : guardrailRate > 0.15 ? "caution" : "success";

  const eventRows = events.map((ev) => {
    const meta = guardrailMeta(ev.guardrailType);
    const details = buildDetails(ev);
    return [
      <Badge tone={meta.tone}>{meta.label}</Badge>,
      ev.placement || "—",
      <BlockStack gap="0">
        {details.map((d, i) => (
          <Text key={i} as="span" variant={i === 0 ? "bodySm" : "bodySm"} tone={i === 0 ? undefined : "subdued"}>{d}</Text>
        ))}
      </BlockStack>,
      formatDate(ev.timestamp),
    ];
  });

  return (
    <Page title="Guardrail Monitor">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">

            {/* Overview Stats */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Overview (Last 7 Days)</Text>
                <Divider />
                <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                  <Box background="bg-surface-secondary" borderRadius="200" padding="400" borderColor="border" borderWidth="025">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Total Guardrail Fires</Text>
                      <Text as="p" variant="headingXl" fontWeight="bold">{totalFires}</Text>
                    </BlockStack>
                  </Box>
                  {ratePercent != null && (
                    <Box background="bg-surface-secondary" borderRadius="200" padding="400" borderColor="border" borderWidth="025">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Guardrail Rate</Text>
                        <Text as="p" variant="headingXl" fontWeight="bold" tone={rateTone}>{ratePercent}%</Text>
                        <Text as="p" variant="bodySm" tone="subdued">of {totalDecisions?.toLocaleString() ?? "—"} decisions</Text>
                      </BlockStack>
                    </Box>
                  )}
                  {counts.map((c) => {
                    const meta = guardrailMeta(c._id);
                    return (
                      <Box key={c._id} background="bg-surface-secondary" borderRadius="200" padding="400" borderColor="border" borderWidth="025">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" tone="subdued">{meta.label}</Text>
                          <Text as="p" variant="headingXl" fontWeight="bold">{c.count}</Text>
                        </BlockStack>
                      </Box>
                    );
                  })}
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* Auto-tuning feedback */}
            {autoTunings && autoTunings.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Automated Adjustments</Text>
                  <Divider />
                  <Banner tone="warning">
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        The learning loop automatically adjusted your settings based on guardrail activity:
                      </Text>
                      {autoTunings.map((t) => (
                        <InlineStack key={t._id} gap="200" blockAlign="start">
                          <Text as="span" variant="bodyMd">⚙️</Text>
                          <BlockStack gap="0">
                            <Text as="p" variant="bodyMd">
                              Session offer limit changed from <strong>{t.tuning.currentLimit}</strong> → <strong>{t.tuning.newLimit}</strong>
                              {t.tuning.reason ? ` — ${t.tuning.reason}` : ""}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">{formatDate(t.timestamp)}</Text>
                          </BlockStack>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </Banner>
                </BlockStack>
              </Card>
            )}

            {/* Event log */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Recent Events (last 100)</Text>
                <Divider />
                {events.length === 0 ? (
                  <Box padding="800" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">No guardrail events yet</Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">Events will appear here as the engine runs and guardrails fire.</Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Guardrail", "Placement", "Details", "Time"]}
                    rows={eventRows}
                  />
                )}
              </BlockStack>
            </Card>

          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
