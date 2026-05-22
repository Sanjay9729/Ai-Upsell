import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, Badge, Loader, ErrorBox } from '../components/ui';

function locationLabel(ev) {
  const loc = ev.metadata?.location || '';
  if (loc.includes('product')) return { label: 'Product Page', type: 'info' };
  if (loc.includes('cart')) return { label: 'Cart Page', type: 'success' };
  if (loc.includes('checkout')) return { label: 'Checkout', type: 'warning' };
  return { label: 'Unknown', type: 'default' };
}

export default function ActivityLogs() {
  const { data, loading, error } = useApi('activity-logs');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { events } = data;

  return (
    <div>
      <PageHeader title="Activity Logs" subtitle="Recent upsell cart-add conversions." />

      <Card title={`${events.length} Recent Conversions`}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Product</th>
              <th style={s.th}>Qty</th>
              <th style={s.th}>Location</th>
              <th style={s.th}>Offer Type</th>
              <th style={s.th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={5} style={s.empty}>No conversions yet</td></tr>
            )}
            {events.map((ev, i) => {
              const loc = locationLabel(ev);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}><strong>{ev.upsellProductName || '—'}</strong></td>
                  <td style={s.td}>{ev.quantity || 1}</td>
                  <td style={s.td}><Badge type={loc.type}>{loc.label}</Badge></td>
                  <td style={s.td}>{ev.offerType || ev.metadata?.offerType || '—'}</td>
                  <td style={s.td} title={new Date(ev.timestamp).toISOString()}>
                    {new Date(ev.timestamp).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
