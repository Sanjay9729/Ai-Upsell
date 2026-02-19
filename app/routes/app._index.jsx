import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDb, collections } from "../../backend/database/mongodb.js";
import { getProductsByShop, syncProductsWithGraphQL } from "../../backend/database/collections.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const db = await getDb();

    // Auto-sync products on first load
    let products = await getProductsByShop(session.shop);
    if (products.length === 0) {
      await syncProductsWithGraphQL(session.shop, admin.graphql);
      products = await getProductsByShop(session.shop);
    }

    const settings = await db.collection(collections.settings).findOne({ shopId: session.shop });
    const totalConversions = await db.collection(collections.upsellEvents)
      .countDocuments({ shopId: session.shop, isUpsellEvent: true, eventType: 'cart_add' });

    return json({
      productCount: products.length,
      aiEnabled: settings?.aiEnabled ?? true,
      totalConversions,
    });
  } catch (error) {
    console.error("Home page loader error:", error);
    return json({ productCount: 0, aiEnabled: true, totalConversions: 0 });
  }
};

export default function Index() {
  const { productCount, aiEnabled, totalConversions } = useLoaderData();

  const cardStyle = {
    border: '1px solid #e1e3e5',
    borderRadius: '12px',
    padding: '24px',
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
    marginBottom: '0',
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
  };

  const stepDescStyle = {
    fontSize: '14px',
    color: '#303030',
    lineHeight: '1.6',
    marginBottom: '12px',
  };

  const olStyle = {
    paddingLeft: '20px',
    margin: '0',
    fontSize: '14px',
    color: '#303030',
    lineHeight: '1.8',
  };

  const statusDot = (active) => ({
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: active ? '#008060' : '#d72c0d',
    marginRight: '8px',
  });

  const metricCardStyle = {
    textAlign: 'center',
    flex: '1',
    minWidth: '120px',
    border: '1px solid #e1e3e5',
    borderRadius: '12px',
    padding: '16px',
    backgroundColor: '#ffffff',
  };

  const progressPercent = [
    productCount > 0,
    aiEnabled,
    totalConversions > 0,
  ].filter(Boolean).length * 33;

  return (
    <s-page heading="Setup Guide">
      <style>{`
        * { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }
        .progress-bar { width: 100%; height: 8px; background-color: #e1e3e5; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
        .progress-fill { height: 100%; background-color: #008060; border-radius: 4px; transition: width 0.3s ease; }
      `}</style>

      {/* Progress Bar */}
      <s-section>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#303030' }}>Setup Progress</span>
            <span style={{ fontSize: '13px', color: '#6d7175' }}>{progressPercent}% complete</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={statusDot(productCount > 0)}></span>
              <span style={{ fontSize: '13px', color: '#6d7175' }}>Products: {productCount} synced</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={statusDot(aiEnabled)}></span>
              <span style={{ fontSize: '13px', color: '#6d7175' }}>AI: {aiEnabled ? 'Active' : 'Disabled'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={statusDot(totalConversions > 0)}></span>
              <span style={{ fontSize: '13px', color: '#6d7175' }}>Conversions: {totalConversions}</span>
            </div>
          </div>
        </div>
      </s-section>

      {/* Quick Stats */}
      <s-section heading="Overview">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#303030' }}>{productCount}</div>
            <div style={{ fontSize: '12px', color: '#6d7175', marginTop: '2px' }}>Products Synced</div>
          </div>
          <div style={metricCardStyle}>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#303030' }}>{totalConversions}</div>
            <div style={{ fontSize: '12px', color: '#6d7175', marginTop: '2px' }}>Conversions</div>
          </div>
        </div>
      </s-section>

      <s-section heading="Step-by-Step Setup">
        {/* Step 1 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 1: Add the AI Upsell Block to Product Pages</div>
          <div style={stepDescStyle}>
            Add the AI-powered upsell widget to your product detail pages to show personalized recommendations:
          </div>
          <ol style={olStyle}>
            <li>Go to <strong>Online Store → Themes → Customize</strong></li>
            <li>In the theme editor, navigate to a <strong>Product page</strong> template</li>
            <li>In the left sidebar, find the <strong>Product information</strong> section</li>
            <li>Click the <strong>Add block</strong> button (+ icon) within that section</li>
            <li>In the block selection menu, switch to the <strong>Apps</strong> tab</li>
            <li>Find and click on <strong>"AI Upsell Products"</strong> (it should show "AI Upsell" underneath)</li>
            <li>The upsell block will be added to your product page</li>
          </ol>
        </div>

        {/* Step 2 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 2: Add the AI Upsell Block to Cart Page</div>
          <div style={stepDescStyle}>
            Show cart-aware recommendations on your cart page that complement the entire cart:
          </div>
          <ol style={olStyle}>
            <li>In the theme editor, navigate to the <strong>Cart page</strong> template</li>
            <li>Click <strong>Add section</strong> or <strong>Add block</strong> in the cart template</li>
            <li>Switch to the <strong>Apps</strong> tab</li>
            <li>Find and click on <strong>"AI Cart Upsell"</strong> (it should show "AI Upsell" underneath)</li>
            <li>The cart upsell block will analyze all items in the cart and suggest complementary products</li>
          </ol>
        </div>

        {/* Step 3 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 3: Configure Block Settings</div>
          <div style={stepDescStyle}>
            Customize how the upsell widgets appear on your store:
          </div>
          <ol style={olStyle}>
            <li>Click on the newly added <strong>AI Upsell Products</strong> or <strong>AI Cart Upsell</strong> block in the sidebar</li>
            <li>You'll see customization options:
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginTop: '4px' }}>
                <li><strong>Heading</strong> — Change the section title (e.g., "You May Also Like")</li>
                <li><strong>Max Products</strong> — Number of recommendations to show (2-6)</li>
                <li><strong>Show Reason</strong> — Toggle AI recommendation reasons on/off</li>
                <li><strong>Colors</strong> — Customize background, text, and button colors</li>
                <li><strong>Button Style</strong> — Match your theme's button styling</li>
              </ul>
            </li>
            <li>Adjust these settings to match your store's design</li>
          </ol>
        </div>

        {/* Step 4 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 4: Position the Blocks</div>
          <div style={stepDescStyle}>
            Drag and drop the upsell blocks to the perfect position:
          </div>
          <ol style={olStyle}>
            <li>Click and hold the <strong>drag handle</strong> (⋮⋮) next to the block name</li>
            <li>Drag it up or down within the section</li>
            <li>Common placements:
              <ul style={{ listStyleType: 'disc', paddingLeft: '20px', marginTop: '4px' }}>
                <li>Product page — below the Add to Cart button or after the description</li>
                <li>Cart page — below the cart items or above the checkout button</li>
              </ul>
            </li>
          </ol>
        </div>

        {/* Step 5 */}
        <div style={stepCardStyle}>
          <div style={stepHeaderStyle}>Step 5: Save and Test</div>
          <div style={stepDescStyle}>
            Verify everything is working correctly:
          </div>
          <ol style={olStyle}>
            <li>Click the <strong>Save</strong> button in the top right corner of the Theme Editor</li>
            <li>Visit a product page on your store — you should see AI-powered upsell recommendations</li>
            <li>Add a product to cart and visit the cart page — you should see cart-aware suggestions</li>
            <li>Click "Add to Cart" on a upsell product — it should be tracked in the <strong>Analytics</strong> page</li>
            <li>Check the <a href="/app/analytics" style={{ color: '#005bd3', textDecoration: 'none', fontWeight: '500' }}>Analytics</a> page to see your upsell activity logs</li>
          </ol>
          <div style={{ marginTop: '12px', padding: '10px 14px', backgroundColor: totalConversions > 0 ? '#f0fdf4' : '#f7f7f8', borderRadius: '8px', fontSize: '13px', color: totalConversions > 0 ? '#166534' : '#6d7175' }}>
            {totalConversions > 0
              ? `✓ ${totalConversions} upsell conversions tracked so far!`
              : 'Waiting for your first upsell conversion...'}
          </div>
        </div>
      </s-section>

      {/* App Settings Note */}
      <s-section heading="Quick Links">
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <a href="/app/settings" style={{ display: 'inline-block', padding: '10px 20px', backgroundColor: '#f7f7f8', border: '1px solid #e1e3e5', borderRadius: '8px', color: '#303030', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
              Settings
            </a>
            <a href="/app/analytics" style={{ display: 'inline-block', padding: '10px 20px', backgroundColor: '#f7f7f8', border: '1px solid #e1e3e5', borderRadius: '8px', color: '#303030', textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
              Analytics
            </a>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}
