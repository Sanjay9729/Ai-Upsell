import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, Loader, ErrorBox } from '../components/ui';

function GuardrailRow({ label, value, description, highlight }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '14px 0', borderBottom: '1px solid #f3f4f6',
    }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: '500', color: '#1a1a2e' }}>{label}</div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{description}</div>
      </div>
      <div style={{
        padding: '6px 16px', borderRadius: '20px', fontWeight: '700', fontSize: '14px',
        background: highlight ? '#f5f3ff' : '#f3f4f6',
        color: highlight ? '#6c63ff' : '#374151',
      }}>
        {value}
      </div>
    </div>
  );
}

export default function Guardrails() {
  const { data, loading, error } = useApi('guardrails');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const g = data.guardrails;

  return (
    <div>
      <PageHeader title="Guardrails" subtitle="Safety limits and rules protecting your upsell offers." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <Card title="Discount & Inventory Limits">
          <GuardrailRow
            label="Max Discount Cap"
            value={`${g.maxDiscountCap ?? 25}%`}
            description="Maximum discount percentage allowed on any upsell offer."
            highlight
          />
          <GuardrailRow
            label="Inventory Minimum Threshold"
            value={`${g.inventoryMinThreshold ?? 5} units`}
            description="Minimum stock required before showing an upsell offer."
          />
          <GuardrailRow
            label="Session Offer Limit"
            value={`${g.sessionOfferLimit ?? 4} offers`}
            description="Maximum number of upsell offers shown per session."
            highlight
          />
        </Card>

        <Card title="Protection Rules">
          <GuardrailRow
            label="Subscription Protection"
            value={g.subscriptionProtection ? 'Enabled' : 'Disabled'}
            description="Prevents upselling on subscription products."
            highlight={g.subscriptionProtection}
          />
          {g.premiumSkuProtection?.length > 0 && (
            <GuardrailRow
              label="Premium SKU Protection"
              value={`${g.premiumSkuProtection.length} SKUs`}
              description="These SKUs are excluded from upsell targeting."
            />
          )}
          {g.maxPriceRatio != null && (
            <GuardrailRow
              label="Max Price Ratio"
              value={`${g.maxPriceRatio}x`}
              description="Upsell product cannot cost more than this multiple of the source product."
              highlight
            />
          )}
        </Card>
      </div>

      {g.premiumSkuProtection?.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <Card title="Protected SKUs">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {g.premiumSkuProtection.map((sku, i) => (
                <span key={i} style={{
                  padding: '4px 12px', borderRadius: '20px',
                  background: '#fef2f2', color: '#dc2626',
                  fontSize: '12px', fontWeight: '500',
                }}>{sku}</span>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
