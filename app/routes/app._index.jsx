import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    // Build theme editor URL directly — no GraphQL call needed
    const storeHandle = session.shop.replace(".myshopify.com", "");
    const themeEditorUrl = storeHandle
      ? `https://admin.shopify.com/store/${storeHandle}/themes/current/editor?context=apps`
      : null;

    // Run DB queries in parallel
    const [totalConversions, productCount] = await Promise.all([
      db.collection(collections.upsellEvents)
        .countDocuments({ shopId: session.shop, isUpsellEvent: true, eventType: 'cart_add' })
        .catch(() => 0),

      db.collection(collections.products)
        .countDocuments({ shopId: session.shop })
        .catch(() => 0),
    ]);

    // Product sync / backfill — run in background, never block the page render
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
            Once live, track performance inside the Analytics page and review events in Activity Logs.
          </div>
          <ol style={olStyle}>
            <li>Click "Add to Cart" on a upsell product — it will be tracked</li>
            <li>Open <a href="/app/analytics" style={{ color: '#005bd3', textDecoration: 'none', fontWeight: '500' }}>Analytics</a> for performance metrics</li>
            <li>Open <a href="/app/activity-logs" style={{ color: '#005bd3', textDecoration: 'none', fontWeight: '500' }}>Activity Logs</a> for recent conversions</li>
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
