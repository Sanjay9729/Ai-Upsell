import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, StatCard, Badge, Loader, ErrorBox } from '../components/ui';

const GUARDRAIL_BADGE = {
  safety_mode_active: 'danger',
  placement_blocked: 'warning',
  placement_shifted: 'warning',
  session_offer_limit: 'info',
  paused_offer: 'info',
  low_confidence: 'info',
  no_candidates: 'default',
  seen_in_session: 'success',
};

const GUARDRAIL_LABELS = {
  safety_mode_active: 'Safety Mode Active',
  placement_blocked: 'Placement Blocked',
  placement_shifted: 'Placement Shifted',
  session_offer_limit: 'Session Offer Limit',
  paused_offer: 'Offer Paused',
  low_confidence: 'Low Confidence',
  no_candidates: 'No Candidates',
  seen_in_session: 'Already Seen',
};

function guardrailLabel(type) {
  return GUARDRAIL_LABELS[type] || type;
}

function guardrailBadge(type) {
  return GUARDRAIL_BADGE[type] || 'default';
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function buildDetails(ev) {
  const parts = [];
  if (ev.productTitle) parts.push(`"${ev.productTitle}"`);
  else if (ev.productId) parts.push(`Product: ${ev.productId}`);
  if (ev.contextKey) parts.push(`Context: ${ev.contextKey}`);
  if (ev.sessionOfferLimit != null) parts.push(`Session limit: ${ev.sessionOfferLimit}`);
  if (ev.confidence != null) parts.push(`Confidence: ${(ev.confidence * 100).toFixed(0)}%`);
  if (ev.shiftFrom && ev.shiftTo) parts.push(`Shift: ${ev.shiftFrom} → ${ev.shiftTo}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export default function GuardrailMonitor() {
  const { data, loading, error } = useApi('guardrail-monitor');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { events, counts, guardrailRate, totalDecisions, autoTunings } = data;

  return (
    <div>
      <PageHeader
        title="Guardrail Monitor"
        subtitle="Live guardrail trigger log and auto-tuning history."
      />

      <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <StatCard label="Total Decisions" value={totalDecisions != null ? totalDecisions.toLocaleString() : '—'} color="#6c63ff" />
        <StatCard label="Guardrail Rate" value={guardrailRate != null ? `${(guardrailRate * 100).toFixed(1)}%` : '—'} color="#f59e0b" />
        <StatCard label="Unique Trigger Types" value={counts.length.toString()} color="#3b82f6" />
      </div>

      {counts.length > 0 && (
        <Card title="Triggers by Type">
          <div className="table-scroll">
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Guardrail Type</th>
                  <th style={s.th}>Count</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c, i) => (
                  <tr key={c._id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                    <td style={s.td}>
                      <Badge type={guardrailBadge(c._id)}>{guardrailLabel(c._id)}</Badge>
                    </td>
                    <td style={s.td}><strong>{c.count}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div style={{ marginTop: '20px' }}>
        <Card title="Recent Guardrail Events">
          <div className="table-scroll">
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>Details</th>
                  <th style={s.th}>Time</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 && (
                  <tr><td colSpan={3} style={s.empty}>No guardrail events recorded yet</td></tr>
                )}
                {events.slice(0, 50).map((ev, i) => (
                  <tr key={ev._id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                    <td style={s.td}>
                      <Badge type={guardrailBadge(ev.guardrailType)}>{guardrailLabel(ev.guardrailType)}</Badge>
                    </td>
                    <td style={s.td}>{buildDetails(ev)}</td>
                    <td style={s.td}>{formatDate(ev.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {autoTunings.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <Card title="Session Offer Limit Auto-Tunings">
            <div className="table-scroll">
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Time</th>
                    <th style={s.th}>New Limit</th>
                  </tr>
                </thead>
                <tbody>
                  {autoTunings.map((t, i) => (
                    <tr key={t._id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                      <td style={s.td}>{formatDate(t.timestamp)}</td>
                      <td style={s.td}><strong>{t.tuning}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
