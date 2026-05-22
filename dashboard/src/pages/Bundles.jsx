import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, StatCard, Badge, Loader, ErrorBox } from '../components/ui';

export default function Bundles() {
  const { data, loading, error } = useApi('bundles');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { bundles } = data;
  const activeCount = bundles.filter(b => b.active !== false).length;
  const totalViews = bundles.reduce((s, b) => s + (b.analytics?.views || b.views || 0), 0);
  const totalConversions = bundles.reduce((s, b) => s + (b.analytics?.conversions || b.conversions || 0), 0);

  return (
    <div>
      <PageHeader title="Bundles" subtitle="Product bundle upsell offers and performance." />

      <div style={s.grid4}>
        <StatCard label="Total Bundles" value={bundles.length} color="#6c63ff" />
        <StatCard label="Active" value={activeCount} color="#10b981" />
        <StatCard label="Total Views" value={totalViews.toLocaleString()} color="#f59e0b" />
        <StatCard label="Total Conversions" value={totalConversions.toLocaleString()} color="#3b82f6" />
      </div>

      <div style={{ marginTop: '20px' }}>
        <Card title="All Bundles">
          {bundles.length === 0 ? (
            <p style={s.empty}>No bundles created yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {bundles.map((b, i) => (
                <div key={i} style={{
                  padding: '16px', borderRadius: '8px',
                  border: '1px solid #e5e7eb', background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '14px', color: '#1a1a2e' }}>{b.name || `Bundle #${i + 1}`}</strong>
                    <Badge type={b.active !== false ? 'success' : 'default'}>
                      {b.active !== false ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  {b.displayNames?.length > 0 && (
                    <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px' }}>
                      {b.displayNames.join(' + ')}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '16px' }}>
                    {b.discountPercent != null && (
                      <span style={{ fontSize: '12px', color: '#6c63ff', fontWeight: '600' }}>
                        {b.discountPercent}% off
                      </span>
                    )}
                    {b.analytics?.views != null && (
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        {b.analytics.views} views · {b.analytics.conversions || 0} conversions
                      </span>
                    )}
                  </div>
                  {b.createdAt && (
                    <p style={{ fontSize: '11px', color: '#9ca3af', margin: '6px 0 0' }}>
                      Created {new Date(b.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
