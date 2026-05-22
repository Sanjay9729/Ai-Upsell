import { useApi } from '../hooks/useApi';
import { s, StatCard, PageHeader, Card, TableRow, Badge, Loader, ErrorBox } from '../components/ui';

export default function Analytics() {
  const { data, loading, error } = useApi('analytics');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { stats, recentEvents, topProducts } = data;

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Upsell performance and revenue insights." />

      <div style={s.grid4}>
        <StatCard label="Views" value={stats.views.toLocaleString()} color="#6c63ff" />
        <StatCard label="Clicks" value={stats.clicks.toLocaleString()} color="#10b981" />
        <StatCard label="Cart Adds" value={stats.cartAdds.toLocaleString()} color="#f59e0b" />
        <StatCard label="Click-Through Rate" value={`${stats.ctr}%`} color="#3b82f6" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
        <Card title="Top Upsell Products">
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Product</th>
                <th style={s.th}>Cart Adds</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.length === 0 && <tr><td colSpan={2} style={s.empty}>No data yet</td></tr>}
              {topProducts.map((p, i) => (
                <TableRow key={i}>
                  <td style={s.td}>{p.name || p._id || '—'}</td>
                  <td style={s.td}><strong>{p.count}</strong></td>
                </TableRow>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Recent Events">
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Type</th>
                <th style={s.th}>Product</th>
                <th style={s.th}>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 && <tr><td colSpan={3} style={s.empty}>No events yet</td></tr>}
              {recentEvents.map((e, i) => (
                <TableRow key={i}>
                  <td style={s.td}><Badge type={e.eventType === 'cart_add' ? 'success' : e.eventType === 'click' ? 'info' : 'default'}>{e.eventType}</Badge></td>
                  <td style={s.td}>{e.upsellProductName || '—'}</td>
                  <td style={s.td}>{new Date(e.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                </TableRow>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
