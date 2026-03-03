import { useEffect, useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const { getBundles, getBundleAnalytics } = await import("../../backend/services/bundleEngine.js");
    const db = await getDb();
    
    // Fetch bundles for the shop
    const bundlesResult = await getBundles(session.shop);
    
    // Fetch product details for bundle items
    const bundleProducts = new Map();
    for (const bundle of bundlesResult.bundles) {
      for (const productId of bundle.productIds) {
        if (!bundleProducts.has(productId)) {
          const product = await db.collection(collections.products)
            .findOne({ productId: productId.toString() });
          bundleProducts.set(productId, product?.title || `Product ${productId}`);
        }
      }
    }

    // Fetch analytics for each bundle
    const bundlesWithAnalytics = await Promise.all(
      bundlesResult.bundles.map(async (bundle) => {
        const analyticsResult = await getBundleAnalytics(session.shop, bundle._id);
        return {
          ...bundle,
          _id: bundle._id.toString(),
          analytics: analyticsResult.analytics,
          displayNames: bundle.productIds.map(pid => bundleProducts.get(pid) || `Product ${pid}`)
        };
      })
    );

    return json({
      success: true,
      bundles: bundlesWithAnalytics,
      shopId: session.shop
    });
  } catch (error) {
    console.error('Error loading bundles:', error);
    return json({
      success: false,
      error: error.message,
      bundles: [],
      shopId: ''
    });
  }
};

export const action = async ({ request }) => {
  if (request.method === 'POST') {
    const { session } = await authenticate.admin(request);
    const { actionType, bundleId, name, productIds, discountPercent } = await request.json();

    try {
      const { pauseBundle, createBundle } = await import("../../backend/services/bundleEngine.js");
      if (actionType === 'pause') {
        const result = await pauseBundle(session.shop, bundleId, true);
        return json({ success: result.success, message: 'Bundle paused' });
      }

      if (actionType === 'resume') {
        const result = await pauseBundle(session.shop, bundleId, false);
        return json({ success: result.success, message: 'Bundle resumed' });
      }

      if (actionType === 'create') {
        const result = await createBundle({
          shopId: session.shop,
          name,
          productIds,
          discountPercent: Number(discountPercent) || 10,
          bundleType: 'merchant',
          confidence: 0.9
        });
        return json({
          success: result.success,
          message: result.action === 'created' ? 'Bundle created' : 'Bundle updated',
          bundleId: result.bundleId
        });
      }

      return json({ success: false, error: 'Unknown action' }, { status: 400 });
    } catch (error) {
      console.error('Error in bundle action:', error);
      return json({ success: false, error: error.message }, { status: 500 });
    }
  }

  return json({ success: false, error: 'Method not allowed' }, { status: 405 });
};

export default function BundlesPage() {
  const { bundles, shopId } = useLoaderData();
  const fetcher = useFetcher();
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    productIds: [],
    discountPercent: 10
  });

  const handleCreateBundle = () => {
    fetcher.submit(
      {
        actionType: 'create',
        ...formData
      },
      { method: 'POST', encType: 'application/json' }
    );
    setShowCreate(false);
    setFormData({ name: '', productIds: [], discountPercent: 10 });
  };

  const handlePauseBundle = (bundleId, isPaused) => {
    fetcher.submit(
      {
        actionType: isPaused ? 'resume' : 'pause',
        bundleId
      },
      { method: 'POST', encType: 'application/json' }
    );
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto' }}>
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '600', marginBottom: '8px' }}>📦 Bundle Review</h1>
          <p style={{ color: '#666', fontSize: '14px' }}>
            Manage auto-generated and merchant bundles. View performance metrics and adjust configurations.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          ➕ Create Bundle
        </button>
      </div>

      {/* Create Bundle Form */}
      {showCreate && (
        <div style={{
          padding: '20px',
          backgroundColor: '#f9f9f9',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginBottom: '24px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Create New Bundle</h3>
          <div style={{ display: 'grid', gap: '12px' }}>
            <input
              type="text"
              placeholder="Bundle name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <input
              type="text"
              placeholder="Product IDs (comma separated)"
              value={formData.productIds.join(',')}
              onChange={(e) => setFormData({
                ...formData,
                productIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              })}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <input
              type="number"
              placeholder="Discount %"
              min="0"
              max="100"
              value={formData.discountPercent}
              onChange={(e) => setFormData({ ...formData, discountPercent: Number(e.target.value) })}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleCreateBundle}
                disabled={!formData.name || formData.productIds.length < 2}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: !formData.name || formData.productIds.length < 2 ? 'not-allowed' : 'pointer'
                }}
              >
                Create
              </button>
              <button
                onClick={() => setShowCreate(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bundle Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
        {bundles.map(bundle => (
          <div
            key={bundle._id}
            style={{
              padding: '16px',
              border: bundle.status === 'paused' ? '1px solid #ccc' : '1px solid #ddd',
              borderRadius: '8px',
              backgroundColor: bundle.status === 'paused' ? '#f5f5f5' : '#fff',
              opacity: bundle.status === 'paused' ? 0.6 : 1
            }}
          >
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>
                {bundle.name}
              </h3>
              <p style={{ fontSize: '13px', color: '#666' }}>
                {bundle.displayNames.join(' + ')}
              </p>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              padding: '12px 0',
              borderTop: '1px solid #eee',
              borderBottom: '1px solid #eee',
              marginBottom: '12px',
              fontSize: '13px'
            }}>
              <div>
                <span style={{ color: '#666' }}>Discount:</span>{' '}
                <span style={{ fontWeight: '600' }}>{bundle.discountPercent}%</span>
              </div>
              <div>
                <span style={{ color: '#666' }}>Type:</span>{' '}
                <span style={{ fontWeight: '600' }}>{bundle.bundleType}</span>
              </div>
              <div>
                <span style={{ color: '#666' }}>Views:</span>{' '}
                <span style={{ fontWeight: '600' }}>{bundle.analytics?.stats?.view || 0}</span>
              </div>
              <div>
                <span style={{ color: '#666' }}>Conversions:</span>{' '}
                <span style={{ fontWeight: '600' }}>{bundle.analytics?.stats?.cart_add || 0}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handlePauseBundle(bundle._id, bundle.status === 'paused')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: bundle.status === 'paused' ? '#28a745' : '#ffc107',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                {bundle.status === 'paused' ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: '#6c757d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                📊 Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {bundles.length === 0 && (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          backgroundColor: '#f9f9f9',
          borderRadius: '8px',
          color: '#666'
        }}>
          <p style={{ fontSize: '16px', marginBottom: '12px' }}>No bundles yet</p>
          <p style={{ fontSize: '13px', color: '#999' }}>
            Create your first bundle or wait for autonomous recommendations to appear.
          </p>
        </div>
      )}
    </div>
  );
}
