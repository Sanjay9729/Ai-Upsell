import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, Badge, Loader, ErrorBox } from '../components/ui';

export default function Optimization() {
  const { data, loading, error } = useApi('optimization');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { history, scheduler } = data;

  return (
    <div>
      <PageHeader title="Optimization" subtitle="AI learning loop status and optimization history." />

      <Card title="Scheduler Status">
        {scheduler ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {[
              { label: 'Status', value: scheduler.isRunning ? 'Running' : 'Idle', type: scheduler.isRunning ? 'success' : 'default' },
              { label: 'Last Run', value: scheduler.lastRun ? new Date(scheduler.lastRun).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never' },
              { label: 'Next Run', value: scheduler.nextRun ? new Date(scheduler.nextRun).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
              { label: 'Iterations', value: scheduler.iterations ?? '—' },
              { label: 'Interval', value: scheduler.intervalHours ? `${scheduler.intervalHours}h` : '—' },
              { label: 'Mode', value: scheduler.mode || 'automatic' },
            ].map(({ label, value, type }) => (
              <div key={label} style={{ padding: '12px', background: '#f9fafb', borderRadius: '8px' }}>
                <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</div>
                {type ? <Badge type={type}>{value}</Badge> : <div style={{ fontWeight: '600', color: '#1a1a2e' }}>{value}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p style={s.empty}>Scheduler not yet initialised.</p>
        )}
      </Card>

      <div style={{ marginTop: '20px' }}>
        <Card title="Optimization History">
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Run</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Rules Evaluated</th>
                <th style={s.th}>Changes Applied</th>
                <th style={s.th}>Duration</th>
                <th style={s.th}>Time</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={6} style={s.empty}>No optimization runs yet</td></tr>}
              {history.map((h, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}>#{history.length - i}</td>
                  <td style={s.td}>
                    <Badge type={h.status === 'success' || h.status === 'completed' ? 'success' : h.status === 'failed' ? 'danger' : 'default'}>
                      {h.status || 'unknown'}
                    </Badge>
                  </td>
                  <td style={s.td}>{h.rulesEvaluated ?? h.totalRules ?? '—'}</td>
                  <td style={s.td}>{h.changesApplied ?? h.changes ?? '—'}</td>
                  <td style={s.td}>{h.durationMs != null ? `${(h.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td style={s.td}>{h.timestamp ? new Date(h.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
