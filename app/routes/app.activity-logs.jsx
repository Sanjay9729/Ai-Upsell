import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  EmptyState,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    const recentConversions = await db.collection(collections.upsellEvents)
      .find({ shopId: session.shop, isUpsellEvent: true, eventType: "cart_add" })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    return Response.json({
      success: true,
      recentConversions: recentConversions.map((e) => ({ ...e, _id: e._id.toString() })),
    });
  } catch (error) {
    console.error("Error fetching activity logs:", error);
    return Response.json({ success: false, error: error.message, recentConversions: [] });
  }
};


export default function ActivityLogsPage() {
  const { recentConversions } = useLoaderData();

  const rows = recentConversions.map((e) => [
    e.upsellProductName || e.productTitle || "—",
    e.sourceProductName || "—",
    e.quantity ?? 1,
    e.discountPercent != null ? `${e.discountPercent}%` : "—",
    e.timestamp ? new Date(e.timestamp).toLocaleString() : "—",
  ]);

  return (
    <Page
      title="Activity Logs"
      subtitle="Recent upsell cart-add conversions."
    >
      <Card>
        {recentConversions.length === 0 ? (
          <EmptyState heading="No conversions yet" image="">
            <p>Upsell cart-add events will appear here once customers start interacting.</p>
          </EmptyState>
        ) : (
          <BlockStack gap="0">
            <Box paddingBlockEnd="300">
              <Text variant="bodySm" tone="subdued">
                {recentConversions.length} recent conversion{recentConversions.length !== 1 ? "s" : ""}
              </Text>
            </Box>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "text", "text"]}
              headings={["Upsell Product", "Source Product", "Qty", "Discount", "Time"]}
              rows={rows}
            />
          </BlockStack>
        )}
      </Card>
    </Page>
  );
}
