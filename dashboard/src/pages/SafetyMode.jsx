import { useState, useEffect } from 'react'
import { API_URL } from '../config'
import { getShop } from '../hooks/useApi'

const API_BASE = API_URL

export default function SafetyMode() {
  const shop = getShop()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)
  const [status, setStatus] = useState(null)
  const [reason, setReason] = useState('')

  const isActive = status?.active === true
  const snapshots = status?.snapshots || []
  const auditLog = status?.log || []

  function loadStatus() {
    if (!shop) { setLoading(false); return }
    setLoading(true)
    fetch(`${API_BASE}/api/dashboard/safety?shop=${encodeURIComponent(shop)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setStatus(data.status)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadStatus() }, [shop])

  async function doAction(intent, extra = {}) {
    if (!shop) return
    setError(null)
    setSuccessMsg(null)
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/safety?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, ...extra }),
      })
      const data = await res.json()
      if (data.success) {
        const messages = {
          enable_safety: 'Safety mode enabled. All offers paused.',
          disable_safety: 'Safety mode disabled. Offers resumed.',
          snapshot: 'Config snapshot saved.',
          restore: data.restoredFrom
            ? `Config restored from snapshot: ${data.restoredFrom.label}`
            : 'Config restored.',
        }
        setSuccessMsg(messages[intent] || 'Action completed.')
        setTimeout(() => setSuccessMsg(null), 5000)
        if (intent === 'enable_safety') setReason('')
        loadStatus()
      } else {
        setError(data.error || 'Action failed.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
        <p style={{ color: '#6b7280', fontSize: '14px' }}>Loading safety status...</p>
      </div>
    )
  }

  return (
    <div>
      <h1 style={s.title}>Safety Mode &amp; Rollback</h1>
      <p style={s.subtitle}>Pause all offers instantly and restore configurations if needed.</p>

      {shop && (
        <div style={{ ...s.card, padding: '12px 16px', marginBottom: '16px', background: '#f0f5ff', border: '1px solid #c7d2fe' }}>
          <span style={{ fontSize: '13px', color: '#4338ca', fontWeight: 500 }}>Active shop: <strong>{shop}</strong></span>
        </div>
      )}

      {!shop && (
        <div style={s.warnBanner}>
          Shop domain not configured. Pass <code>?shop=yourstore.myshopify.com</code> in the URL.
        </div>
      )}
      {error && <div style={s.errorBanner}>{error}</div>}
      {successMsg && <div style={s.successBanner}>{successMsg}</div>}

      {/* Status & Controls */}
      <div style={s.card}>
        {/* Status banner */}
        <div style={{
          padding: '14px 16px', borderRadius: '8px', marginBottom: '20px',
          background: isActive ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${isActive ? '#fecaca' : '#bbf7d0'}`,
          display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}>
          <span style={{ fontSize: '16px', marginTop: '1px' }}>{isActive ? '⚠️' : '✅'}</span>
          <div>
            <div style={{ fontWeight: '700', color: isActive ? '#991b1b' : '#166534', fontSize: '14px' }}>
              {isActive ? 'Safety Mode is ACTIVE' : 'System is Running Normally'}
            </div>
            <div style={{ fontSize: '13px', color: isActive ? '#b91c1c' : '#15803d', marginTop: '2px' }}>
              {isActive
                ? `All upsell offers are paused. Reason: ${status?.reason || 'No reason specified'}`
                : 'The AI decision engine is active and serving offers normally.'}
            </div>
            {status?.updatedAt && (
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Last changed: {new Date(status.updatedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        <hr style={s.divider} />

        {/* Snapshot — always visible */}
        {!isActive && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 10px' }}>
              Save a snapshot of your current config before making changes. You can restore to any snapshot if something goes wrong.
            </p>
            <button
              onClick={() => doAction('snapshot')}
              disabled={saving || !shop}
              style={{ ...s.btn, ...(saving || !shop ? s.btnDisabled : {}) }}
            >
              Save Current Config Snapshot
            </button>
          </div>
        )}

        {/* Toggle controls */}
        {isActive ? (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => doAction('disable_safety')}
              disabled={saving || !shop}
              style={{ ...s.btn, background: '#16a34a', ...(saving || !shop ? s.btnDisabled : {}) }}
            >
              Resume Offers
            </button>
            <button
              onClick={() => doAction('restore')}
              disabled={saving || !shop}
              style={{ ...s.btn, ...(saving || !shop ? s.btnDisabled : {}) }}
            >
              Restore Last Config Snapshot
            </button>
            <button
              onClick={() => doAction('snapshot')}
              disabled={saving || !shop}
              style={{ ...s.btn, ...(saving || !shop ? s.btnDisabled : {}) }}
            >
              Save Current Config Snapshot
            </button>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '12px' }}>
              <label style={s.fieldLabel}>Reason (optional)</label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. High discount rate detected, reviewing offers"
                style={s.input}
              />
            </div>
            <button
              onClick={() => doAction('enable_safety', { reason })}
              disabled={saving || !shop}
              style={{ ...s.btn, background: '#dc2626', ...(saving || !shop ? s.btnDisabled : {}) }}
            >
              Enable Safety Mode (Pause All Offers)
            </button>
          </div>
        )}
      </div>

      {/* Config Snapshots */}
      <div style={s.card}>
        <h2 style={s.cardTitle}>Config Snapshots</h2>
        <hr style={s.divider} />
        {snapshots.length === 0 ? (
          <p style={s.empty}>No snapshots yet. Save your first snapshot above.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Label</th>
                <th style={s.th}>Saved At</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}><strong>{snap.label}</strong></td>
                  <td style={s.td}>{new Date(snap.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit Log */}
      <div style={s.card}>
        <h2 style={s.cardTitle}>Safety Mode Audit Log</h2>
        <hr style={s.divider} />
        {auditLog.length === 0 ? (
          <p style={s.empty}>No safety mode events yet.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Action</th>
                <th style={s.th}>Reason</th>
                <th style={s.th}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((entry, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  <td style={s.td}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: '20px',
                      fontSize: '11px', fontWeight: '600',
                      background: entry.action === 'enabled' ? '#fee2e2' : '#d1fae5',
                      color: entry.action === 'enabled' ? '#991b1b' : '#065f46',
                    }}>
                      {entry.action === 'enabled' ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td style={s.td}>{entry.reason || '—'}</td>
                  <td style={s.td}>{new Date(entry.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const s = {
  title: { fontSize: '24px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 6px' },
  subtitle: { fontSize: '14px', color: '#6b7280', margin: '0 0 24px' },
  errorBanner: { background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', color: '#dc2626', marginBottom: '16px', fontSize: '14px' },
  successBanner: { background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '8px', padding: '12px 16px', color: '#065f46', marginBottom: '16px', fontSize: '14px' },
  warnBanner: { background: '#fff3cd', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginBottom: '16px', fontSize: '14px' },
  card: { background: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' },
  cardTitle: { fontSize: '16px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px' },
  divider: { border: 'none', borderTop: '1px solid #e1e3e5', margin: '0 0 16px' },
  btn: { padding: '9px 18px', background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  fieldLabel: { display: 'block', fontSize: '14px', fontWeight: '500', color: '#1a1a2e', marginBottom: '6px' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'inherit' },
  empty: { color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '24px 0', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb' },
  td: { padding: '10px 12px', fontSize: '13px', color: '#374151', borderBottom: '1px solid #f3f4f6' },
}
