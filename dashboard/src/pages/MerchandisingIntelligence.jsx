import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, Badge, Loader, ErrorBox } from '../components/ui';

const OFFER_TYPE_BADGE = {
  bundle: 'info',
  volume_discount: 'success',
  subscription_upgrade: 'warning',
  addon_upsell: 'default',
};

const PRIORITY_LABELS = {
  none: 'No special priority',
  push_new_collection: 'Push new collection',
  clear_overstock: 'Clear overstock',
  grow_subscriptions: 'Grow subscriptions',
  maximize_margin: 'Maximize margin',
  custom: 'Custom focus',
};

export default function MerchandisingIntelligence() {
  const { data, loading, error } = useApi('intelligence');
  const [tab, setTab] = useState('offers');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { context, offers, segments } = data;

  return (
    <div>
      <PageHeader
        title="Merchandising Intelligence"
        subtitle="AI offer decisions, customer segments, and merchant context."
      />

      {/* Context summary */}
      <Card title="Merchant Context">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {[
            { label: 'Priority', value: PRIORITY_LABELS[context.priority] || context.priority || 'None' },
            { label: 'Prefer Bundles', value: context.preferBundles ? 'Yes' : 'No' },
            { label: 'Notes', value: context.notes || '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: '12px', background: '#f9fafb', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</div>
              <div style={{ fontWeight: '600', color: '#1a1a2e', fontSize: '13px' }}>{value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', margin: '20px 0 16px' }}>
        {[['offers', 'Offers'], ['segments', 'Segments']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '7px 16px', borderRadius: '6px', border: '1px solid',
              borderColor: tab === key ? '#6c63ff' : '#d1d5db',
              background: tab === key ? '#6c63ff' : '#fff',
              color: tab === key ? '#fff' : '#374151',
              cursor: 'pointer', fontSize: '13px', fontWeight: '500',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'offers' && (
        <Card title={`Recent Offers (${offers.length})`}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Source → Upsell</th>
                <th style={s.th}>Type</th>
                <th style={s.th}>Confidence</th>
                <th style={s.th}>Reason</th>
                <th style={s.th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {offers.length === 0 && (
                <tr><td colSpan={5} style={s.empty}>No offers logged yet</td></tr>
              )}
              {offers.map((o, i) => (
                <tr key={o.offerId || i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}>
                    <strong>{o.sourceProductName}</strong>{' → '}{o.upsellProductName}
                  </td>
                  <td style={s.td}>
                    <Badge type={OFFER_TYPE_BADGE[o.offerType] || 'default'}>{o.offerType}</Badge>
                  </td>
                  <td style={s.td}>
                    {o.confidence != null ? `${(o.confidence * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={s.td}>{o.decisionReason}</td>
                  <td style={s.td}>
                    {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'segments' && (
        <Card title="Segment Performance (Last 30 Days)">
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Segment</th>
                <th style={s.th}>Views</th>
                <th style={s.th}>Cart Adds</th>
                <th style={s.th}>Conversion Rate</th>
              </tr>
            </thead>
            <tbody>
              {segments.length === 0 && (
                <tr><td colSpan={4} style={s.empty}>No segment data yet</td></tr>
              )}
              {segments.map((seg, i) => (
                <tr key={seg.segment} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}><strong>{seg.segment}</strong></td>
                  <td style={s.td}>{seg.views.toLocaleString()}</td>
                  <td style={s.td}>{seg.cartAdds.toLocaleString()}</td>
                  <td style={s.td}>{seg.conversionRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
