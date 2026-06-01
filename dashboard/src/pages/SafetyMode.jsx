import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, Badge, Loader, ErrorBox } from '../components/ui';

export default function SafetyMode() {
  const { data, loading, error } = useApi('safety');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { status } = data;
  const isActive = status?.active === true;

  const snapshots = status?.snapshots || [];
  const auditLog = status?.log || [];

  return (
    <div>
      <PageHeader
        title="Safety Mode"
        subtitle="Current safety status, config snapshots, and audit history."
      />

      {/* Status banner */}
      <div style={{
        padding: '16px 20px',
        borderRadius: '10px',
        marginBottom: '20px',
        background: isActive ? '#fef2f2' : '#f0fdf4',
        border: `1px solid ${isActive ? '#fecaca' : '#bbf7d0'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <div style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: isActive ? '#ef4444' : '#22c55e',
          flexShrink: 0,
        }} />
        <div>
          <div style={{ fontWeight: '700', color: isActive ? '#991b1b' : '#166534', fontSize: '15px' }}>
            {isActive ? 'Safety Mode is ACTIVE — All offers paused' : 'System Running Normally'}
          </div>
          {isActive && status?.reason && (
            <div style={{ fontSize: '13px', color: '#b91c1c', marginTop: '2px' }}>
              Reason: {status.reason}
            </div>
          )}
          {status?.updatedAt && (
            <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
              Last changed: {new Date(status.updatedAt).toLocaleString()}
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Badge type={isActive ? 'danger' : 'success'}>{isActive ? 'ACTIVE' : 'NORMAL'}</Badge>
        </div>
      </div>

      {/* Config Snapshots */}
      <Card title="Config Snapshots">
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Label</th>
              <th style={s.th}>Saved At</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 && (
              <tr><td colSpan={2} style={s.empty}>No snapshots saved yet</td></tr>
            )}
            {snapshots.map((snap, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                <td style={s.td}><strong>{snap.label}</strong></td>
                <td style={s.td}>{new Date(snap.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Audit Log */}
      <div style={{ marginTop: '20px' }}>
        <Card title="Safety Mode Audit Log">
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Action</th>
                <th style={s.th}>Reason</th>
                <th style={s.th}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 && (
                <tr><td colSpan={3} style={s.empty}>No safety mode events yet</td></tr>
              )}
              {auditLog.map((entry, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}>
                    <Badge type={entry.action === 'enabled' ? 'danger' : 'success'}>
                      {entry.action === 'enabled' ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </td>
                  <td style={s.td}>{entry.reason || '—'}</td>
                  <td style={s.td}>{new Date(entry.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
