import { useEffect, useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getMerchantConfig } = await import("../../backend/services/merchantConfig.js");
    const config = await getMerchantConfig(session.shop);

    const guardrails = config.guardrails || {
      maxDiscountCap: 25,
      inventoryMinThreshold: 5,
      sessionOfferLimit: 4,
      premiumSkuProtection: [],
      subscriptionProtection: false
    };

    return json({
      success: true,
      config,
      guardrails,
      shopId: session.shop
    });
  } catch (error) {
    console.error('Error loading guardrails:', error);
    return json({
      success: false,
      error: error.message,
      guardrails: {},
      shopId: ''
    });
  }
};

export const action = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { guardrails } = await request.json();

  try {
    const { updateMerchantConfig } = await import("../../backend/services/merchantConfig.js");
    await updateMerchantConfig(session.shop, {
      guardrails: {
        maxDiscountCap: Number(guardrails.maxDiscountCap) || 25,
        inventoryMinThreshold: Number(guardrails.inventoryMinThreshold) || 5,
        sessionOfferLimit: Number(guardrails.sessionOfferLimit) || 4,
        premiumSkuProtection: guardrails.premiumSkuProtection || [],
        subscriptionProtection: Boolean(guardrails.subscriptionProtection)
      },
      updatedAt: new Date()
    });

    return json({
      success: true,
      message: 'Guardrails saved'
    });
  } catch (error) {
    console.error('Error saving guardrails:', error);
    return json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
};

export default function GuardrailsPage() {
  const { guardrails, config } = useLoaderData();
  const fetcher = useFetcher();
  const [formData, setFormData] = useState(guardrails);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    fetcher.submit(
      { guardrails: formData },
      { method: 'POST', encType: 'application/json' }
    );
  };

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }, [fetcher.state, fetcher.data]);

  const handleInputChange = (field, value) => {
    setFormData({
      ...formData,
      [field]: value
    });
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '600', marginBottom: '8px' }}>🛡️ Guardrails</h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Define safety constraints and business rules to ensure offers align with your strategy and margin targets.
        </p>
      </div>

      {saved && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#dff2bf',
          border: '1px solid #9ccc65',
          borderRadius: '4px',
          marginBottom: '24px',
          fontSize: '14px',
          color: '#33691e'
        }}>
          ✓ Guardrails saved
        </div>
      )}

      <div style={{ maxWidth: '800px' }}>
        {/* Discount Cap */}
        <div style={{
          padding: '20px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
            💰 Maximum Discount Cap
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            The highest discount percentage the engine will apply to any offer. Protects margins.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'end' }}>
            <input
              type="number"
              min="0"
              max="100"
              value={formData.maxDiscountCap || 25}
              onChange={(e) => handleInputChange('maxDiscountCap', Number(e.target.value))}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '14px', color: '#666' }}>%</span>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
            Current: {formData.maxDiscountCap || 25}%
          </div>
        </div>

        {/* Inventory Threshold */}
        <div style={{
          padding: '20px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
            📦 Inventory Minimum Threshold
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            Only recommend products with at least this many units in stock. Prevents overselling.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'end' }}>
            <input
              type="number"
              min="0"
              value={formData.inventoryMinThreshold || 5}
              onChange={(e) => handleInputChange('inventoryMinThreshold', Number(e.target.value))}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '14px', color: '#666' }}>units</span>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
            Current: {formData.inventoryMinThreshold || 5} units
          </div>
        </div>

        {/* Session Offer Limit */}
        <div style={{
          padding: '20px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
            👁️ Session Offer Limit
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            Maximum number of offers to show a single user in one session. Prevents offer fatigue.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'end' }}>
            <input
              type="number"
              min="1"
              max="10"
              value={formData.sessionOfferLimit || 4}
              onChange={(e) => handleInputChange('sessionOfferLimit', Number(e.target.value))}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '14px', color: '#666' }}>offers</span>
          </div>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#999' }}>
            Current: {formData.sessionOfferLimit || 4} offers max per session
          </div>
        </div>

        {/* Premium SKU Protection */}
        <div style={{
          padding: '20px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
            ⭐ Premium SKU Protection
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            These products will never be offered at discounts. Protect high-margin items.
          </p>
          <textarea
            placeholder="Enter product handles or IDs, one per line"
            value={(formData.premiumSkuProtection || []).join('\n')}
            onChange={(e) => handleInputChange('premiumSkuProtection', e.target.value.split('\n').filter(Boolean))}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              minHeight: '100px',
              fontFamily: 'monospace'
            }}
          />
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
            {(formData.premiumSkuProtection || []).length} SKU(s) protected
          </div>
        </div>

        {/* Subscription Protection */}
        <div style={{
          padding: '20px',
          border: '1px solid #ddd',
          borderRadius: '8px',
          marginBottom: '24px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
            🔒 Subscription Protection
          </h3>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
            Never offer subscription products at discounts. Preserve subscription economics.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={formData.subscriptionProtection || false}
              onChange={(e) => handleInputChange('subscriptionProtection', e.target.checked)}
              style={{ marginRight: '8px', width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '14px' }}>
              {formData.subscriptionProtection ? '✓ Enabled' : 'Disabled'}
            </span>
          </label>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={fetcher.state !== 'idle'}
          style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: fetcher.state === 'idle' ? 'pointer' : 'not-allowed',
            opacity: fetcher.state === 'idle' ? 1 : 0.7
          }}
        >
          {fetcher.state === 'idle' ? '💾 Save Guardrails' : 'Saving...'}
        </button>
      </div>

      {/* Info Box */}
      <div style={{
        marginTop: '32px',
        padding: '16px',
        backgroundColor: '#e7f3ff',
        border: '1px solid #b3d9ff',
        borderRadius: '8px',
        fontSize: '13px',
        color: '#003d82'
      }}>
        <strong>💡 Tip:</strong> These guardrails are evaluated before every offer decision. Tighter constraints increase safety but may reduce offer frequency. Find the right balance for your business.
      </div>
    </div>
  );
}
