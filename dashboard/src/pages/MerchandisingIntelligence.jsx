import { useState, useEffect } from 'react'
import { API_URL } from '../config'
import { getShop } from '../hooks/useApi'

const API_BASE = API_URL

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'No special priority' },
  { value: 'push_new_collection', label: 'Push new collection' },
  { value: 'clear_overstock', label: 'Clear overstock' },
  { value: 'grow_subscriptions', label: 'Grow subscriptions' },
  { value: 'maximize_margin', label: 'Maximize margin' },
  { value: 'custom', label: 'Custom focus' },
]

const OFFER_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'bundle', label: 'Bundles' },
  { value: 'volume_discount', label: 'Volume' },
  { value: 'subscription_upgrade', label: 'Subscription' },
  { value: 'addon_upsell', label: 'Add-ons' },
]

function buildListText(ids = [], handles = []) {
  return [...ids.map(String), ...handles.map(String)].join(', ')
}

function StatusBadge({ status }) {
  const styles = {
    approved: { background: '#d1fae5', color: '#065f46' },
    paused: { background: '#fee2e2', color: '#991b1b' },
    guided: { background: '#dbeafe', color: '#1e40af' },
  }
  const st = styles[status] || { background: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600', ...st }}>
      {status ? status.toUpperCase() : 'AUTO'}
    </span>
  )
}

export default function MerchandisingIntelligence() {
  const shop = getShop()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actioning, setActioning] = useState(null)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  const [offers, setOffers] = useState([])
  const [controlMap, setControlMap] = useState({})
  const [performanceMap, setPerformanceMap] = useState({})
  const [bundles, setBundles] = useState([])
  const [explainability, setExplainability] = useState([])
  const [segments, setSegments] = useState([])
  const [lastSavedAt, setLastSavedAt] = useState(null)

  const [priority, setPriority] = useState('none')
  const [focusProducts, setFocusProducts] = useState('')
  const [focusCollections, setFocusCollections] = useState('')
  const [notes, setNotes] = useState('')
  const [preferBundles, setPreferBundles] = useState(false)

  const [tab, setTab] = useState('intelligence')
  const [filter, setFilter] = useState('all')

  function loadData() {
    if (!shop) { setLoading(false); return }
    setLoading(true)
    fetch(`${API_BASE}/api/dashboard/intelligence?shop=${encodeURIComponent(shop)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        const ctx = data.context || {}
        setPriority(ctx.priority || 'none')
        setFocusProducts(buildListText(ctx.focusProductIds, ctx.focusProductHandles))
        setFocusCollections(buildListText(ctx.focusCollectionIds, ctx.focusCollectionHandles))
        setNotes(ctx.notes || '')
        setPreferBundles(ctx.preferBundles || false)
        setOffers(data.offers || [])
        setControlMap(data.controlMap || {})
        setPerformanceMap(data.performanceMap || {})
        setBundles(data.bundles || [])
        setExplainability(data.explainability || [])
        setSegments(data.segments || [])
        setLastSavedAt(data.lastSavedAt)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [shop])

  async function saveContext() {
    if (!shop) return
    setError(null); setSuccessMsg(null); setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/intelligence?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'save_context', priority, notes, preferBundles, focusProductsRaw: focusProducts, focusCollectionsRaw: focusCollections }),
      })
      const data = await res.json()
      if (data.success) {
        setLastSavedAt(new Date().toISOString())
        setSuccessMsg('Context saved successfully.')
        setTimeout(() => setSuccessMsg(null), 4000)
      } else {
        setError(data.error || 'Save failed')
      }
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  async function doOfferAction(offer, status) {
    if (!shop) return
    setActioning(offer.offerKey)
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/intelligence?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'offer_action',
          offerKey: offer.offerKey, status,
          sourceProductId: offer.sourceProductId || '',
          upsellProductId: offer.upsellProductId || '',
          contextKey: offer.contextKey || 'product',
        }),
      })
      const data = await res.json()
      if (data.success) {
        setControlMap(prev => ({ ...prev, [offer.offerKey]: { status } }))
      } else { setError(data.error || 'Action failed') }
    } catch (err) { setError(err.message) }
    finally { setActioning(null) }
  }

  async function doBundleAction(bundle, status) {
    if (!shop) return
    setActioning(bundle.offerKey)
    try {
      const res = await fetch(`${API_BASE}/api/dashboard/intelligence?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'offer_action',
          offerKey: bundle.offerKey, status,
          sourceProductId: bundle.sourceProductId || '',
          upsellProductId: bundle.upsellProductId || '',
          contextKey: bundle.contextKey || 'product',
        }),
      })
      const data = await res.json()
      if (data.success) {
        setBundles(prev => prev.map(b => b.offerKey === bundle.offerKey ? { ...b, controlStatus: status } : b))
      } else { setError(data.error || 'Action failed') }
    } catch (err) { setError(err.message) }
    finally { setActioning(null) }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
        <p style={{ color: '#6b7280', fontSize: '14px' }}>Loading intelligence data...</p>
      </div>
    )
  }

  const filteredOffers = filter === 'all' ? offers : offers.filter(o => o.offerType === filter)

  return (
    <div>
      <h1 style={s.title}>Merchandising Intelligence</h1>
      <p style={s.subtitle}>AI offer decisions, customer segments, and merchant context.</p>

      {shop && (
        <div style={{ ...s.card, padding: '12px 16px', marginBottom: '16px', background: '#f0f5ff', border: '1px solid #c7d2fe' }}>
          <span style={{ fontSize: '13px', color: '#4338ca', fontWeight: 500 }}>Active shop: <strong>{shop}</strong></span>
        </div>
      )}
      {!shop && <div style={s.warnBanner}>Shop domain not configured. Pass <code>?shop=yourstore.myshopify.com</code> in the URL.</div>}
      {error && <div style={s.errorBanner}>{error}</div>}
      {successMsg && <div style={s.successBanner}>{successMsg}</div>}

      {/* Context Injection */}
      <div style={s.card}>
        <h2 style={s.cardTitle}>Context Injection</h2>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 16px' }}>
          Provide strategic guidance. The AI treats this as a soft preference and never violates guardrails.
        </p>
        <hr style={s.divider} />

        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={s.select}>
            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Focus products (IDs or handles)</label>
          <textarea value={focusProducts} onChange={e => setFocusProducts(e.target.value)}
            placeholder="e.g. 7708018999350, premium-bracelet" style={s.textarea} rows={3} />
        </div>

        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Focus collections (IDs or handles)</label>
          <textarea value={focusCollections} onChange={e => setFocusCollections(e.target.value)}
            placeholder="e.g. summer-collection, 123456789" style={s.textarea} rows={3} />
        </div>

        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder='e.g. Push "New Arrivals" and avoid discounting premium bundles.' style={s.textarea} rows={3} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#374151' }}>
            <input type="checkbox" checked={preferBundles} onChange={e => setPreferBundles(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
            Prefer bundle-style offers when possible
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={saveContext} disabled={saving || !shop}
            style={{ ...s.btn, ...(saving || !shop ? s.btnDisabled : {}) }}>
            {saving ? 'Saving…' : 'Save Context'}
          </button>
          {lastSavedAt && !saving && (
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              Last saved: {new Date(lastSavedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
        {[['intelligence', 'Intelligence'], ['segments', 'Segments'], ['why', 'Why']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '10px 20px', border: 'none', background: 'none',
            fontSize: '14px', fontWeight: '500', cursor: 'pointer',
            color: tab === key ? '#6c63ff' : '#6b7280',
            borderBottom: tab === key ? '2px solid #6c63ff' : '2px solid transparent',
            marginBottom: '-1px',
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Intelligence Tab */}
      {tab === 'intelligence' && (
        <div>
          {bundles.length > 0 && (
            <div style={{ padding: '12px 16px', background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '8px', marginBottom: '16px', fontSize: '14px', color: '#065f46', fontWeight: '500' }}>
              ✓ {bundles.length} Bundles | Avg Conv:{' '}
              {(bundles.reduce((acc, b) => acc + (b.performance?.conversion || 0), 0) / bundles.length).toFixed(1)}%
            </div>
          )}

          {bundles.map(bundle => {
            const bStatus = bundle.controlStatus || 'auto'
            const recommendedText =
              bundle.recommendedAction === 'pause' ? 'Pause — low conversion' :
              bundle.recommendedAction === 'approve' ? 'Approve — high conversion' :
              'Monitor — gathering data'
            const isBusy = actioning === bundle.offerKey
            return (
              <div key={bundle.bundleId || bundle.offerKey} style={{ ...s.card, marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e' }}>
                      {bundle.sourceProductName || bundle.sourceProductId || 'Cart'} → {bundle.upsellProductName || bundle.upsellProductId}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                      Views: {bundle.performance?.views ?? 0} · Conv: {(bundle.performance?.conversion ?? 0).toFixed(1)}%
                      {bundle.discountPercent ? ` · Discount: ${bundle.discountPercent}%` : ''}
                      {bundle.goal ? ` · Goal: ${bundle.goal}` : ''}
                    </div>
                    {bundle.decisionReason && <div style={{ fontSize: '12px', color: '#6b7280' }}>Why: {bundle.decisionReason}</div>}
                  </div>
                  <StatusBadge status={bStatus} />
                </div>
                <div style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px', color: '#374151', marginBottom: '12px' }}>
                  <strong>Recommended:</strong> {recommendedText}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => doBundleAction(bundle, 'approved')} disabled={isBusy}
                    style={{ ...s.btnSmall, background: '#16a34a', ...(isBusy ? s.btnDisabled : {}) }}>Approve</button>
                  <button onClick={() => doBundleAction(bundle, 'paused')} disabled={isBusy}
                    style={{ ...s.btnSmall, background: '#dc2626', ...(isBusy ? s.btnDisabled : {}) }}>Pause</button>
                </div>
              </div>
            )
          })}

          {bundles.length === 0 && (
            <div style={{ ...s.card, textAlign: 'center', color: '#9ca3af', padding: '40px', marginBottom: '16px' }}>
              No bundle intelligence yet. Data will appear once the AI engine processes enough offer interactions.
            </div>
          )}

          {/* Offer Review */}
          <div style={s.card}>
            <h3 style={{ ...s.cardTitle, marginBottom: '14px' }}>Bundle &amp; Offer Review</h3>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {OFFER_FILTERS.map(f => {
                const count = f.value === 'all' ? offers.length : offers.filter(o => o.offerType === f.value).length
                return (
                  <button key={f.value} onClick={() => setFilter(f.value)} style={{
                    padding: '5px 12px', borderRadius: '6px', border: '1px solid',
                    borderColor: filter === f.value ? '#6c63ff' : '#d1d5db',
                    background: filter === f.value ? '#6c63ff' : '#fff',
                    color: filter === f.value ? '#fff' : '#374151',
                    cursor: 'pointer', fontSize: '12px', fontWeight: '500',
                  }}>
                    {f.label} ({count})
                  </button>
                )
              })}
            </div>

            {filteredOffers.length === 0 ? (
              <p style={s.empty}>No offers logged yet. Offers will appear after the decision engine runs.</p>
            ) : (
              filteredOffers.map((offer, i) => {
                const perfKey = `${offer.sourceProductId || 'cart'}:${offer.upsellProductId}`
                const perf = performanceMap[perfKey] || { views: 0, cart_adds: 0 }
                const status = controlMap[offer.offerKey]?.status || 'auto'
                const conv = perf.views > 0 ? `${((perf.cart_adds / perf.views) * 100).toFixed(1)}%` : '—'
                const isBusy = actioning === offer.offerKey
                return (
                  <div key={offer.offerId || i} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '2px' }}>Source → Offer</div>
                        <div style={{ fontWeight: '600', fontSize: '13px', color: '#1a1a2e' }}>
                          {offer.sourceProductName || offer.sourceProductId || 'Cart'} → {offer.upsellProductName || offer.upsellProductId}
                        </div>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
                      Type: <strong>{offer.offerType || 'addon_upsell'}</strong> · Placement: {offer.placement || '—'} ·
                      Goal: {offer.goal || '—'} · Discount: {offer.discountPercent != null ? `${offer.discountPercent}%` : '—'} ·
                      Views: {perf.views} · Conv: {conv}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => doOfferAction(offer, 'approved')} disabled={isBusy}
                        style={{ ...s.btnSmall, background: '#16a34a', ...(isBusy ? s.btnDisabled : {}) }}>Approve</button>
                      <button onClick={() => doOfferAction(offer, 'paused')} disabled={isBusy}
                        style={{ ...s.btnSmall, background: '#dc2626', ...(isBusy ? s.btnDisabled : {}) }}>Pause</button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Segments Tab */}
      {tab === 'segments' && (
        <div style={s.card}>
          <h3 style={s.cardTitle}>Segment Performance (Last 30 Days)</h3>
          <hr style={s.divider} />
          {segments.length === 0 ? (
            <p style={s.empty}>No segment data yet. Data will appear once customers interact with upsell offers.</p>
          ) : (
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
          )}
        </div>
      )}

      {/* Why Tab */}
      {tab === 'why' && (
        <div>
          {explainability.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', color: '#9ca3af', padding: '40px' }}>
              No offer explanations yet. Once the AI engine generates offers, you'll see exactly why each was created.
            </div>
          ) : (
            explainability.slice(0, 8).map((offer, i) => (
              <div key={i} style={{ ...s.card, marginBottom: '12px' }}>
                <div style={{ fontWeight: '600', fontSize: '14px', color: '#1a1a2e', marginBottom: '4px' }}>
                  {offer.sourceProduct} → {offer.upsellProduct}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
                  Score: {offer.decisionScore?.toFixed(2)} | Confidence: {(offer.confidence * 100).toFixed(0)}% | {offer.offerType}
                </div>
                <div style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: '6px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>Data Signals:</div>
                  {(offer.dataSignals || []).slice(0, 3).map((sig, j) => (
                    <div key={j} style={{ fontSize: '12px', color: '#6b7280' }}>
                      • {sig.signal}: {typeof sig.value === 'number' ? sig.value.toFixed(1) : sig.value}
                    </div>
                  ))}
                </div>
                {offer.whyCreated?.[0] && (
                  <div style={{ padding: '10px 14px', background: '#dbeafe', borderRadius: '6px', fontSize: '13px', color: '#1e40af' }}>
                    Why: {offer.whyCreated[0]}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
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
  cardTitle: { fontSize: '16px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 8px' },
  divider: { border: 'none', borderTop: '1px solid #e1e3e5', margin: '0 0 16px' },
  btn: { padding: '9px 18px', background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnSmall: { padding: '6px 14px', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  fieldGroup: { marginBottom: '16px' },
  fieldLabel: { display: 'block', fontSize: '14px', fontWeight: '500', color: '#1a1a2e', marginBottom: '6px' },
  select: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', background: '#fff', fontFamily: 'inherit' },
  textarea: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' },
  empty: { color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '24px 0', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb' },
  td: { padding: '10px 12px', fontSize: '13px', color: '#374151', borderBottom: '1px solid #f3f4f6' },
}
