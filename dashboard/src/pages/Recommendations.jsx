import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, StatCard, Badge, Loader, ErrorBox } from '../components/ui';

export default function Recommendations() {
  const { data, loading, error } = useApi('recommendations');
  const [filter, setFilter] = useState('all');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { recommendations, stats } = data;
  const filtered = filter === 'all' ? recommendations
    : recommendations.filter(r => r.recommendationContext === filter);

  const pdpCount = recommendations.filter(r => r.recommendationContext === 'product_detail').length;
  const cartCount = recommendations.filter(r => r.recommendationContext === 'cart').length;

  return (
    <div>
      <PageHeader title="Recommendations" subtitle="AI-generated upsell recommendation pairs." />

      <div style={s.grid4}>
        <StatCard label="Total Recommendations" value={stats.total.toLocaleString()} color="#6c63ff" />
        <StatCard label="Unique Source Products" value={stats.uniqueProducts.toLocaleString()} color="#10b981" />
        <StatCard label="Product Page" value={pdpCount.toLocaleString()} color="#f59e0b" />
        <StatCard label="Cart Page" value={cartCount.toLocaleString()} color="#3b82f6" />
      </div>

      <div style={{ marginTop: '20px' }}>
        <Card>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {[['all', 'All'], ['product_detail', 'Product Detail'], ['cart', 'Cart']].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)} style={{
                padding: '6px 14px', borderRadius: '6px', border: '1px solid',
                borderColor: filter === val ? '#6c63ff' : '#d1d5db',
                background: filter === val ? '#6c63ff' : '#fff',
                color: filter === val ? '#fff' : '#374151',
                cursor: 'pointer', fontSize: '13px', fontWeight: '500',
              }}>
                {label} ({val === 'all' ? recommendations.length : val === 'product_detail' ? pdpCount : cartCount})
              </button>
            ))}
          </div>

          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Source Product</th>
                <th style={s.th}>Recommended Product</th>
                <th style={s.th}>Context</th>
                <th style={s.th}>Score</th>
                <th style={s.th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={5} style={s.empty}>No recommendations</td></tr>}
              {filtered.map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}>{r.sourceProductTitle || r.sourceProductId || '—'}</td>
                  <td style={s.td}><strong>{r.recommendedProductTitle || r.recommendedProductId || '—'}</strong></td>
                  <td style={s.td}><Badge type={r.recommendationContext === 'cart' ? 'success' : 'info'}>{r.recommendationContext || '—'}</Badge></td>
                  <td style={s.td}>{r.score != null ? (r.score * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={s.td}>{r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
