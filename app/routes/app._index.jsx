import { RedirectToDashboard } from "../components/RedirectToDashboard";
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
  return <RedirectToDashboard path="/" />;
}
