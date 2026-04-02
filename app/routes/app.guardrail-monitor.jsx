import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";

const GUARDRAIL_LABELS = {
  safety_mode_active:  { label: 'Safety Mode Active',    color: '#dc2626', bg: '#fef2f2' },
  placement_blocked:   { label: 'Placement Blocked',      color: '#ea580c', bg: '#fff7ed' },
  placement_shifted:   { label: 'Placement Shifted',      color: '#d97706', bg: '#fffbeb' },
  session_offer_limit: { label: 'Session Offer Limit',    color: '#7c3aed', bg: '#f5f3ff' },
  paused_offer:        { label: 'Offer Paused',           color: '#0369a1', bg: '#f0f9ff' },
  low_confidence:      { label: 'Low Confidence',         color: '#0891b2', bg: '#ecfeff' },
  no_candidates:       { label: 'No Candidates',          color: '#4b5563', bg: '#f9fafb' },
  seen_in_session:     { label: 'Already Seen',           color: '#059669', bg: '#f0fdf4' },
};

function guardrailMeta(type) {
  return GUARDRAIL_LABELS[type] || { label: type, color: '#6b7280', bg: '#f9fafb' };
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const { analyzeGuardrailTriggers } = await import("../../backend/services/optimizationEngine.js");
    const db = await getDb();

    const [events, counts, guardrailAnalysis, autoTunings] = await Promise.all([
      db.collection(collections.guardrailEvents)
        .find({ shopId: session.shop })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray(),
      db.collection(collections.guardrailEvents)
        .aggregate([
          { $match: { shopId: session.shop } },
          { $group: { _id: '$guardrailType', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ])
        .toArray(),
      analyzeGuardrailTriggers(session.shop),
      db.collection(collections.optimizationLogs)
        .find({
          shopId: session.shop,
          type: 'learning_loop',
          'results.actions.tunings.sessionOfferLimit': { $exists: true }
        })
        .sort({ timestamp: -1 })
        .limit(10)
        .toArray()
    ]);

    return json({
      success: true,
      events: events.map(e => ({ ...e, _id: e._id.toString() })),
      counts,
      guardrailRate: guardrailAnalysis.success ? guardrailAnalysis.guardrailRate : null,
      totalDecisions: guardrailAnalysis.success ? guardrailAnalysis.totalDecisions : null,
      autoTunings: autoTunings.map(log => ({
        _id: log._id.toString(),
        timestamp: log.timestamp,
        tuning: log.results?.actions?.tunings?.sessionOfferLimit ?? null
      })).filter(t => t.tuning !== null)
    });
  } catch (error) {
    console.error('Error loading guardrail events:', error);
    return json({ success: false, error: error.message, events: [], counts: [], guardrailRate: null, totalDecisions: null, autoTunings: [] });
  }
};

export default function GuardrailMonitorPage() {
  const { events, counts, guardrailRate, totalDecisions, autoTunings } = useLoaderData();

  const totalFires = counts.reduce((sum, c) => sum + c.count, 0);
  const ratePercent = guardrailRate != null ? (guardrailRate * 100).toFixed(1) : null;
  const rateColor = guardrailRate > 0.35 ? '#dc2626' : guardrailRate > 0.15 ? '#d97706' : '#059669';

  return (
    <s-page heading="Guardrail Monitor">
      <style>{`
        * { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; }
        .gm-summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 4px; }
        .gm-stat { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 16px 20px; min-width: 160px; flex: 1; }
        .gm-stat-label { font-size: 12px; color: #6d7175; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .gm-stat-value { font-size: 28px; font-weight: 700; color: #1a1a1a; }
        .gm-stat-sub { font-size: 11px; color: #9ca3af; margin-top: 4px; }
        .gm-badge { display: inline-block; padding: 2px 10px; border-radius: 100px; font-size: 11px; font-weight: 600; }
        .gm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .gm-table thead tr { background: #f7f7f8; border-bottom: 1px solid #e1e3e5; text-align: left; }
        .gm-table th { padding: 10px 14px; font-weight: 600; color: #4a4a4a; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; }
        .gm-table td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
        .gm-table tr:last-child td { border-bottom: none; }
        .gm-table tr:hover td { background: #fafafa; }
        .gm-context { font-size: 11px; color: #9ca3af; margin-top: 2px; }
        .gm-empty { text-align: center; padding: 40px 0; color: #6d7175; background: #f9fafb; border-radius: 8px; border: 1px dashed #e1e3e5; }
        .gm-tuning-banner { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 14px 18px; margin-bottom: 4px; }
        .gm-tuning-row { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid #fef3c7; }
        .gm-tuning-row:last-child { border-bottom: none; padding-bottom: 0; }
        .gm-tuning-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
        .gm-tuning-text { font-size: 13px; color: #92400e; }
        .gm-tuning-time { font-size: 11px; color: #b45309; margin-top: 2px; }
      `}</style>

      {/* Summary stats */}
      <s-section heading="Overview (Last 7 Days)">
        <div className="gm-summary">
          <div className="gm-stat">
            <div className="gm-stat-label">Total Guardrail Fires</div>
            <div className="gm-stat-value">{totalFires}</div>
          </div>
          {ratePercent != null && (
            <div className="gm-stat">
              <div className="gm-stat-label">Guardrail Rate</div>
              <div className="gm-stat-value" style={{ color: rateColor }}>{ratePercent}%</div>
              <div className="gm-stat-sub">of {totalDecisions?.toLocaleString() ?? '—'} decisions</div>
            </div>
          )}
          {counts.map(c => {
            const meta = guardrailMeta(c._id);
            return (
              <div className="gm-stat" key={c._id}>
                <div className="gm-stat-label">{meta.label}</div>
                <div className="gm-stat-value" style={{ color: meta.color }}>{c.count}</div>
              </div>
            );
          })}
        </div>
      </s-section>

      {/* Auto-tuning feedback */}
      {autoTunings && autoTunings.length > 0 && (
        <s-section heading="Automated Adjustments">
          <div className="gm-tuning-banner">
            <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
              The learning loop automatically adjusted your settings based on guardrail activity:
            </div>
            {autoTunings.map(t => (
              <div className="gm-tuning-row" key={t._id}>
                <div className="gm-tuning-icon">⚙️</div>
                <div>
                  <div className="gm-tuning-text">
                    Session offer limit changed from <strong>{t.tuning.currentLimit}</strong> → <strong>{t.tuning.newLimit}</strong>
                    {t.tuning.reason ? ` — ${t.tuning.reason}` : ''}
                  </div>
                  <div className="gm-tuning-time">{formatDate(t.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      )}

      {/* Event log */}
      <s-section heading="Recent Events (last 100)">
        {events.length === 0 ? (
          <div className="gm-empty">
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>No guardrail events yet</div>
            <div style={{ fontSize: 13 }}>Events will appear here as the engine runs and guardrails fire.</div>
          </div>
        ) : (
          <div style={{ border: '1px solid #e1e3e5', borderRadius: 8, overflow: 'hidden' }}>
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Guardrail</th>
                  <th>Placement</th>
                  <th>Details</th>
                  <th style={{ textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => {
                  const meta = guardrailMeta(ev.guardrailType);
                  const details = buildDetails(ev);
                  return (
                    <tr key={ev._id}>
                      <td>
                        <span
                          className="gm-badge"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: '#374151' }}>{ev.placement || '—'}</span>
                      </td>
                      <td>
                        {details.map((d, i) => (
                          <div key={i} className={i === 0 ? '' : 'gm-context'}>{d}</div>
                        ))}
                      </td>
                      <td style={{ textAlign: 'right', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                        {formatDate(ev.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

function buildDetails(ev) {
  const lines = [];
  if (ev.productId) lines.push(`Product: ${ev.productId}`);
  if (ev.productTitle) lines.push(`"${ev.productTitle}"`);
  if (ev.cartProductCount != null) lines.push(`Cart items: ${ev.cartProductCount}`);
  if (ev.contextKey) lines.push(`Context: ${ev.contextKey}`);
  if (ev.sessionOfferLimit != null) lines.push(`Session limit: ${ev.sessionOfferLimit}`);
  if (ev.seenCount != null) lines.push(`Already seen: ${ev.seenCount}`);
  if (ev.confidence != null) lines.push(`Confidence: ${(ev.confidence * 100).toFixed(0)}% (min: ${(ev.minAcceptance * 100).toFixed(0)}%)`);
  if (ev.shiftFrom && ev.shiftTo) lines.push(`Shift: ${ev.shiftFrom} → ${ev.shiftTo}`);
  return lines.length > 0 ? lines : ['—'];
}
