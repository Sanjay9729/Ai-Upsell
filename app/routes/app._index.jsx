import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDb, collections } from "../../backend/database/mongodb.js";
import { syncProductsWithGraphQL } from "../../backend/database/collections.js";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  try {
    const db = await getDb();
    const totalConversions = await db.collection(collections.upsellEvents)
      .countDocuments({ shopId: session.shop, isUpsellEvent: true, eventType: 'cart_add' });

    // Auto-sync products on first load if store has none in MongoDB
    let productCount = await db.collection(collections.products)
      .countDocuments({ shopId: session.shop });

    if (productCount === 0) {
      if (admin?.graphql) {
        try {
          const syncedCount = await syncProductsWithGraphQL(session.shop, admin.graphql);
          productCount = syncedCount;
        } catch (syncError) {
          console.error("Auto product sync failed:", syncError);
        }
      } else {
        console.warn("Admin GraphQL client not available for auto-sync.");
      }
    }

    // Build theme editor deep link (opens App embeds panel on a product page)
    let themeEditorUrl = null;
    try {
      let productHandle = null;
      if (admin?.graphql) {
        const productRes = await admin.graphql(
          `#graphql
          query getPreviewProduct {
            products(first: 1, sortKey: CREATED_AT, reverse: true) {
              nodes { handle }
            }
          }`
        );
        const productData = await productRes.json();
        productHandle = productData?.data?.products?.nodes?.[0]?.handle || null;
      }

      const storeHandle = session.shop.replace(".myshopify.com", "");
      const previewPath = productHandle ? `/products/${productHandle}` : "/products";

      if (storeHandle) {
        themeEditorUrl =
          `https://admin.shopify.com/store/${storeHandle}/themes/current/editor` +
          `?context=apps&previewPath=${encodeURIComponent(previewPath)}`;
      }
    } catch (err) {
      console.error("Theme editor URL error:", err);
    }

    return json({ totalConversions, productCount, themeEditorUrl });
  } catch (error) {
    console.error("Home page loader error:", error);
    return json({ totalConversions: 0, productCount: 0, themeEditorUrl: null });
  }
};

export default function Index() {
  const { totalConversions, themeEditorUrl } = useLoaderData();

  const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const cardStyle = {
    border: '1px solid #e1e3e5',
    borderRadius: '12px',
    padding: '24px',
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
    marginBottom: '0',
    fontFamily,
  };

  const stepCardStyle = {
    ...cardStyle,
    marginBottom: '16px',
  };

  const stepHeaderStyle = {
    fontSize: '16px',
    fontWeight: '650',
    color: '#303030',
    marginBottom: '12px',
    fontFamily,
  };

  const stepDescStyle = {
    fontSize: '14px',
    color: '#303030',
    lineHeight: '1.6',
    marginBottom: '12px',
    fontFamily,
  };

  const buttonStyle = {
    display: 'inline-block',
    backgroundColor: '#111111',
    color: '#ffffff',
    padding: '8px 12px',
    borderRadius: '6px',
    textDecoration: 'none',
    fontSize: '13px',
    fontWeight: '600',
    marginTop: '8px',
  };

  const hintStyle = {
    fontSize: '13px',
    color: '#6d7175',
    marginBottom: '12px',
  };

  const olStyle = {
    paddingLeft: '20px',
    margin: '0',
    fontSize: '14px',
    color: '#303030',
    lineHeight: '1.8',
    fontFamily,
  };

  return (
    <s-page heading="Setup Guide">
      <style>{`
        * {
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
      `}</style>

      <s-section heading="Step-by-Step Setup">
        {/* Step 1 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 1: Open Theme Editor</div>
          <div style={stepDescStyle}>
            Click the button below to open your theme editor directly on a product page with the App embeds panel visible.
          </div>
          <ol style={olStyle}>
            <li>Theme editor will open in a new tab</li>
            <li>Left sidebar will show <strong>App embeds</strong> automatically</li>
          </ol>
          {themeEditorUrl ? (
            <a href={themeEditorUrl} target="_blank" rel="noreferrer" style={buttonStyle}>
              Open Theme Editor
            </a>
          ) : (
            <div style={hintStyle}>
              Theme editor link unavailable right now. Try refreshing the page.
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 2: Enable AI Upsell Embed</div>
          <div style={stepDescStyle}>
            Turn on the app embed once and it will show on both product detail and cart pages.
          </div>
          <ol style={olStyle}>
            <li>In the left sidebar, open <strong>App embeds</strong></li>
            <li>Toggle <strong>AI Upsell Embed</strong> to ON</li>
            <li>Click <strong>Save</strong></li>
          </ol>
        </div>

        {/* Step 3 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 3: Customize Settings</div>
          <div style={stepDescStyle}>
            Update text, colors, and layout from the App embeds settings panel.
          </div>
          <ol style={olStyle}>
            <li>Expand <strong>AI Upsell Embed</strong> in the left sidebar</li>
            <li>Change heading, colors, and max products</li>
            <li>These settings apply to both product and cart pages</li>
          </ol>
        </div>

        {/* Step 4 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 4: Save and Test</div>
          <div style={stepDescStyle}>
            Verify the embed is working across your store.
          </div>
          <ol style={olStyle}>
            <li>Click <strong>Save</strong> in the theme editor</li>
            <li>Open any <strong>product page</strong> and confirm upsells appear</li>
            <li>Open the <strong>cart page</strong> and confirm upsells appear</li>
          </ol>
        </div>

        {/* Step 5 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 5: Track Results</div>
          <div style={stepDescStyle}>
            Once live, track performance inside the Analytics page.
          </div>
          <ol style={olStyle}>
            <li>Click "Add to Cart" on a upsell product — it will be tracked</li>
            <li>Open the <a href="/app/analytics" style={{ color: '#005bd3', textDecoration: 'none', fontWeight: '500' }}>Analytics</a> page to see activity logs</li>
          </ol>
          <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: totalConversions > 0 ? '#f0fdf4' : '#f7f7f8', borderRadius: '8px', fontSize: '13px', color: totalConversions > 0 ? '#166534' : '#6d7175' }}>
            {totalConversions > 0
              ? `✓ ${totalConversions} upsell conversions tracked so far!`
              : 'Waiting for your first upsell conversion...'}
          </div>
        </div>
      </s-section>

    </s-page>
  );
}
