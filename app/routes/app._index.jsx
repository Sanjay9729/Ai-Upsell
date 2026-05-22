import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { ExternalIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    const storeHandle = session.shop.replace(".myshopify.com", "");
    const themeEditorUrl = storeHandle
      ? `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps`
      : null;

    const [totalConversions, productCount] = await Promise.all([
      db.collection(collections.upsellEvents)
        .countDocuments({ shopId: session.shop, isUpsellEvent: true, eventType: "cart_add" })
        .catch(() => 0),
      db.collection(collections.products)
        .countDocuments({ shopId: session.shop })
        .catch(() => 0),
    ]);

    if (admin?.graphql) {
      (async () => {
        try {
          const { syncProductsWithGraphQL } = await import("../../backend/database/collections.js");
          if (productCount === 0) {
            await syncProductsWithGraphQL(session.shop, admin.graphql);
          } else {
            const { ProductService } = await import("../../backend/services/productService.js");
            const needsBackfill = await new ProductService().needsVariantBackfill(session.shop);
            if (needsBackfill) await syncProductsWithGraphQL(session.shop, admin.graphql);
          }
        } catch (err) {
          console.error("Background product sync failed:", err.message);
        }
      })();
    }

    return Response.json({ totalConversions, productCount, themeEditorUrl });
  } catch (error) {
    console.error("Home page loader error:", error);
    return Response.json({ totalConversions: 0, productCount: 0, themeEditorUrl: null });
  }
};

export default function Index() {
  const { totalConversions, themeEditorUrl } = useLoaderData();

  return (
    <Page title="Setup Guide">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">

            {/* Step 1 */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 1: Open Theme Editor</Text>
                  <Badge tone="attention">Required</Badge>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Click the button below to open your theme editor directly on a product page
                  with the App embeds panel visible.
                </Text>
                <List type="number">
                  <List.Item>Theme editor will open in a new tab</List.Item>
                  <List.Item>Left sidebar will show <strong>App embeds</strong> automatically</List.Item>
                </List>
                <Box paddingBlockStart="100">
                  {themeEditorUrl ? (
                    <Button url={themeEditorUrl} target="_blank" icon={ExternalIcon} variant="primary">
                      Open Theme Editor
                    </Button>
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Theme editor link unavailable. Try refreshing the page.
                    </Text>
                  )}
                </Box>
              </BlockStack>
            </Card>

            {/* Step 2 */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 2: Enable AI Upsell Embed</Text>
                  <Badge tone="attention">Required</Badge>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Turn on the app embed once and it will show on both product detail and cart pages.
                </Text>
                <List type="number">
                  <List.Item>In the left sidebar, open <strong>App embeds</strong></List.Item>
                  <List.Item>Toggle <strong>AI Upsell Embed</strong> to ON</List.Item>
                  <List.Item>Click <strong>Save</strong></List.Item>
                </List>
              </BlockStack>
            </Card>

            {/* Step 3 */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 3: Customize Settings</Text>
                  <Badge>Optional</Badge>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Update text, colors, and layout from the App embeds settings panel.
                </Text>
                <List type="number">
                  <List.Item>Expand <strong>AI Upsell Embed</strong> in the left sidebar</List.Item>
                  <List.Item>Change heading, colors, and max products</List.Item>
                  <List.Item>These settings apply to both product and cart pages</List.Item>
                </List>
              </BlockStack>
            </Card>

            {/* Step 4 */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 4: Save and Test</Text>
                  <Badge tone="attention">Required</Badge>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Verify the embed is working across your store.
                </Text>
                <List type="number">
                  <List.Item>Click <strong>Save</strong> in the theme editor</List.Item>
                  <List.Item>Open any <strong>product page</strong> and confirm upsells appear</List.Item>
                  <List.Item>Open the <strong>cart page</strong> and confirm upsells appear</List.Item>
                </List>
              </BlockStack>
            </Card>

            {/* Step 5 */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 5: Track Results</Text>
                  <Badge tone={totalConversions > 0 ? "success" : "info"}>
                    {totalConversions > 0 ? "Live" : "Waiting"}
                  </Badge>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Once live, track performance inside the Analytics page and review events in Activity Logs.
                </Text>
                <List type="number">
                  <List.Item>
                    Click "Add to Cart" on a upsell product — it will be tracked
                  </List.Item>
                  <List.Item>
                    Open <Button url="/app/analytics" variant="plain">Analytics</Button> for performance metrics
                  </List.Item>
                  <List.Item>
                    Open <Button url="/app/activity-logs" variant="plain">Activity Logs</Button> for recent conversions
                  </List.Item>
                </List>
                <Box paddingBlockStart="100">
                  {totalConversions > 0 ? (
                    <Banner tone="success">
                      <Text as="p" variant="bodyMd">
                        {totalConversions} upsell conversion{totalConversions !== 1 ? "s" : ""} tracked so far!
                      </Text>
                    </Banner>
                  ) : (
                    <Banner tone="info">
                      <Text as="p" variant="bodyMd">
                        Waiting for your first upsell conversion...
                      </Text>
                    </Banner>
                  )}
                </Box>
              </BlockStack>
            </Card>

          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
