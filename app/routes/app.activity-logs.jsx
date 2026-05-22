import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  Layout,
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

  const rows = recentConversions.map((conv) => {
    let locationLabel = "Unknown";
    let locationTone = "subdued";
    if (conv.metadata?.location === "product_detail_page") {
      locationLabel = "Product Detail Page";
      locationTone = "info";
    } else if (conv.metadata?.location === "cart_page" || conv.metadata?.location === "cart_page_secondary") {
      locationLabel = "Cart Page";
      locationTone = "success";
    }
    return [
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {conv.upsellProductName || "Unknown Product"}
      </Text>,
      conv.quantity,
      <Badge tone={locationTone}>{locationLabel}</Badge>,
      <BlockStack gap="0">
        <Text as="span" variant="bodySm">{new Date(conv.timestamp).toLocaleDateString()}</Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {new Date(conv.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </BlockStack>,
    ];
  });

  return (
    <Page title="Activity Logs">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Recent Upsell Conversions</Text>
              <Divider />
              {recentConversions.length === 0 ? (
                <Box padding="800" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" tone="subdued" alignment="center">No conversions yet</Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">Upsell products to see them appear here!</Text>
                  </BlockStack>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "text", "text"]}
                  headings={["Upsell Product", "Qty", "Location", "Date Added"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
