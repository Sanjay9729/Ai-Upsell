import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const { getSafetyStatus } = await import("../../backend/services/safetyMode.js");
  const status = await getSafetyStatus(shopId);
  return Response.json({ shopId, status });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const { setSafetyMode, snapshotConfig, restoreConfig } = await import("../../backend/services/safetyMode.js");

  if (intent === "enable_safety") {
    const reason = formData.get("reason") || "Manually enabled by merchant";
    const result = await setSafetyMode(shopId, true, reason);
    return Response.json({ success: result.success, error: result.error || null, intent });
  }
  if (intent === "disable_safety") {
    const result = await setSafetyMode(shopId, false, "Manually disabled by merchant");
    return Response.json({ success: result.success, error: result.error || null, intent });
  }
  if (intent === "snapshot") {
    const result = await snapshotConfig(shopId, "manual");
    return Response.json({ success: result.success, error: result.error || null, intent });
  }
  if (intent === "restore") {
    const result = await restoreConfig(shopId);
    return Response.json({ success: result.success, error: result.error || null, restoredFrom: result.restoredFrom || null, intent });
  }
  return Response.json({ success: false, error: "Unknown intent", intent }, { status: 400 });
};

export default function SafetyPage() {
  const { status } = useLoaderData();
  const fetcher = useFetcher();
  const [reason, setReason] = useState("");
  const isActive = status?.active === true;

  const snapshotRows = (status?.snapshots || []).map((snap) => [
    <Text as="span" variant="bodyMd" fontWeight="semibold">{snap.label}</Text>,
    new Date(snap.createdAt).toLocaleString(),
  ]);

  const auditRows = (status?.log || []).map((entry) => [
    <Badge tone={entry.action === "enabled" ? "critical" : "success"}>
      {entry.action === "enabled" ? "Enabled" : "Disabled"}
    </Badge>,
    entry.reason || "—",
    new Date(entry.timestamp).toLocaleString(),
  ]);

  return (
    <Page title="Safety Mode & Rollback">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">

            {/* Status & Controls */}
            <Card>
              <BlockStack gap="400">
                <Banner tone={isActive ? "critical" : "success"}>
                  <Text as="p" variant="bodyMd">
                    <strong>{isActive ? "Safety Mode is ACTIVE" : "System is Running Normally"}</strong>
                    <br />
                    {isActive
                      ? `All upsell offers are paused. Reason: ${status?.reason || "No reason specified"}`
                      : "The AI decision engine is active and serving offers normally."}
                    {status?.updatedAt && (
                      <><br /><Text as="span" variant="bodySm" tone="subdued">Last changed: {new Date(status.updatedAt).toLocaleString()}</Text></>
                    )}
                  </Text>
                </Banner>

                {fetcher.data?.error && (
                  <Banner tone="critical">
                    <Text as="p" variant="bodyMd">Error: {fetcher.data.error}</Text>
                  </Banner>
                )}
                {fetcher.data?.success && fetcher.data.intent === "restore" && fetcher.data.restoredFrom && (
                  <Banner tone="success">
                    <Text as="p" variant="bodyMd">
                      Config restored from snapshot: {fetcher.data.restoredFrom.label} ({new Date(fetcher.data.restoredFrom.createdAt).toLocaleString()})
                    </Text>
                  </Banner>
                )}

                <Divider />

                {/* Snapshot button (shown before safety toggle when system is running) */}
                {!isActive && (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Save a snapshot of your current config before making changes. You can restore to any snapshot if something goes wrong.
                    </Text>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="snapshot" />
                      <InlineStack gap="300" blockAlign="center">
                        <Button submit>Save Current Config Snapshot</Button>
                        {fetcher.data?.success && fetcher.data.intent === "snapshot" && (
                          <Text as="span" variant="bodySm" tone="success">Snapshot saved</Text>
                        )}
                      </InlineStack>
                    </fetcher.Form>
                  </BlockStack>
                )}

                {/* Toggle controls */}
                {isActive ? (
                  <InlineStack gap="300">
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="disable_safety" />
                      <Button tone="success" submit>Resume Offers</Button>
                    </fetcher.Form>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="restore" />
                      <Button submit>Restore Last Config Snapshot</Button>
                    </fetcher.Form>
                  </InlineStack>
                ) : (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="enable_safety" />
                    <BlockStack gap="300">
                      <TextField
                        label="Reason (optional)"
                        value={reason}
                        onChange={setReason}
                        name="reason"
                        placeholder="e.g. High discount rate detected, reviewing offers"
                        autoComplete="off"
                      />
                      <Box>
                        <Button tone="critical" submit>Enable Safety Mode (Pause All Offers)</Button>
                      </Box>
                    </BlockStack>
                  </fetcher.Form>
                )}

                {/* Snapshot button (shown when safety is active) */}
                {isActive && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="snapshot" />
                    <InlineStack gap="300" blockAlign="center">
                      <Button submit>Save Current Config Snapshot</Button>
                      {fetcher.data?.success && fetcher.data.intent === "snapshot" && (
                        <Text as="span" variant="bodySm" tone="success">Snapshot saved</Text>
                      )}
                    </InlineStack>
                  </fetcher.Form>
                )}
              </BlockStack>
            </Card>

            {/* Config Snapshots */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Config Snapshots</Text>
                <Divider />
                {(status?.snapshots || []).length === 0 ? (
                  <Box padding="600" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      No snapshots yet. Save your first snapshot above.
                    </Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Label", "Saved At"]}
                    rows={snapshotRows}
                  />
                )}
              </BlockStack>
            </Card>

            {/* Audit Log */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Safety Mode Audit Log</Text>
                <Divider />
                {(status?.log || []).length === 0 ? (
                  <Box padding="600" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                      No safety mode events yet.
                    </Text>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Action", "Reason", "Timestamp"]}
                    rows={auditRows}
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
