import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Divider,
  InlineStack,
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
  const { recommendations, error } = useLoaderData();
  const [filter, setFilter] = useState("all");

  const filteredRecommendations = recommendations.filter((rec) => {
    if (filter === "all") return true;
    return rec.recommendationContext === filter;
  });

  const productDetailCount = recommendations.filter((r) => r.recommendationContext === "product_detail").length;
  const cartCount = recommendations.filter((r) => r.recommendationContext === "cart").length;

  return (
    <Page title="Upsell Recommendations">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">

            {error && (
              <Card>
                <Text as="p" variant="bodyMd" tone="critical">Error: {error}</Text>
              </Card>
            )}

            <Card>
              <ButtonGroup variant="segmented">
                <Button pressed={filter === "all"} onClick={() => setFilter("all")}>
                  All ({recommendations.length})
                </Button>
                <Button pressed={filter === "product_detail"} onClick={() => setFilter("product_detail")}>
                  Product Detail ({productDetailCount})
                </Button>
                <Button pressed={filter === "cart"} onClick={() => setFilter("cart")}>
                  Cart ({cartCount})
                </Button>
              </ButtonGroup>
            </Card>

            {filteredRecommendations.length === 0 ? (
              <Card>
                <Box padding="800">
                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">No recommendations found</Text>
                </Box>
              </Card>
            ) : (
              filteredRecommendations.map((rec) => (
                <Card key={rec._id}>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Customer was viewing</Text>
                        <Text as="h2" variant="headingMd">
                          {rec.sourceProductName || `Product ID: ${rec.sourceProductId}`}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {new Date(rec.timestamp).toLocaleString()}
                        </Text>
                      </BlockStack>
                      <Badge tone={rec.recommendationContext === "cart" ? "info" : "success"}>
                        {rec.recommendationContext === "cart" ? "Cart" : "Product Detail"}
                      </Badge>
                    </InlineStack>
                    <Divider />
                    <BlockStack gap="300">
                      {rec.recommendations.map((product, idx) => (
                        <Box key={idx} background="bg-surface-secondary" borderRadius="200" padding="400" borderColor="border" borderWidth="025">
                          <InlineStack gap="400" blockAlign="start">
                            {product.image && (
                              <img
                                src={product.image}
                                alt={product.productName}
                                style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e1e3e5", flexShrink: 0 }}
                              />
                            )}
                            <BlockStack gap="200">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{product.productName}</Text>
                              {product.price && (
                                <Text as="p" variant="headingSm">${parseFloat(product.price).toFixed(2)}</Text>
                              )}
                              {product.reason && (
                                <Text as="p" variant="bodySm" tone="subdued">{product.reason}</Text>
                              )}
                            </BlockStack>
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Card>
              ))
            )}

          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
