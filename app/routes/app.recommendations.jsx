import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  EmptyState,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    const recommendations = await db.collection(collections.upsellRecommendations)
      .find({ shopId: session.shop })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    const totalRecommendations = await db.collection(collections.upsellRecommendations)
      .countDocuments({ shopId: session.shop });
    const uniqueProducts = await db.collection(collections.upsellRecommendations)
      .distinct("sourceProductId", { shopId: session.shop });
    return Response.json({
      success: true,
      recommendations: recommendations.map((r) => ({ ...r, _id: r._id.toString() })),
      stats: { total: totalRecommendations, uniqueProducts: uniqueProducts.length, recent: recommendations.length },
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return Response.json({ success: false, error: error.message, recommendations: [], stats: { total: 0, uniqueProducts: 0, recent: 0 } });
  }
};


export default function RecommendationsPage() {
  const { recommendations, stats } = useLoaderData();

  const rows = recommendations.map((r) => [
    r.sourceProductTitle || r.sourceProductId || "—",
    r.upsellProductTitle || r.upsellProductId || "—",
    r.offerType || "—",
    r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : "—",
    r.timestamp ? new Date(r.timestamp).toLocaleString() : "—",
  ]);

  return (
    <Page
      title="Recommendations"
      subtitle="AI-generated upsell recommendations for your products."
    >
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          {[
            { label: "Total Recommendations", value: stats.total },
            { label: "Unique Source Products", value: stats.uniqueProducts },
            { label: "Recent (last 50)", value: stats.recent },
          ].map(({ label, value }) => (
            <Card key={label}>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">{label}</Text>
                <Text variant="headingLg" fontWeight="bold">{value}</Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        <Card>
          {recommendations.length === 0 ? (
            <EmptyState heading="No recommendations yet" image="">
              <p>AI recommendations will appear once the engine has enough event data.</p>
            </EmptyState>
          ) : (
            <BlockStack gap="0">
              <Box paddingBlockEnd="300">
                <Text variant="bodySm" tone="subdued">
                  Showing {recommendations.length} of {stats.total} recommendations
                </Text>
              </Box>
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Source Product", "Upsell Product", "Offer Type", "Confidence", "Generated"]}
                rows={rows}
              />
            </BlockStack>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
