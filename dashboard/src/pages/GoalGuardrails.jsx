import { useState, useEffect } from 'react'
import { API_URL } from '../config'
import { getShop } from '../hooks/useApi'

const API_BASE = API_URL
const API_KEY = import.meta.env.VITE_DASHBOARD_API_KEY || ''

const GOALS = [
  { value: 'increase_aov', label: 'Increase AOV', desc: 'Maximise average order value through bundles and add-ons.' },
  { value: 'revenue_per_visitor', label: 'Revenue per Visitor', desc: 'Convert more visitors into buyers with targeted offers.' },
  { value: 'subscription_adoption', label: 'Subscription Adoption', desc: 'Grow recurring revenue by promoting subscription upgrades.' },
  { value: 'inventory_movement', label: 'Inventory Movement', desc: 'Clear slow-moving stock with intelligent discounting.' },
]

const RISKS = [
  { value: 'conservative', label: 'Conservative', desc: 'Fewer offers, lower discounts, minimal disruption.' },
  { value: 'balanced', label: 'Balanced', desc: 'Moderate offer frequency and incentives. Recommended for most stores.' },
  { value: 'aggressive', label: 'Aggressive', desc: 'High offer frequency and stronger incentives to maximise conversion.' },
]

const DISPLAY_MODES = [
  { value: 'bundle', label: 'Bundle & Save', desc: 'Show only bundle offers' },
  { value: 'volume_discount', label: 'Buy More, Save More', desc: 'Show only volume discount offers' },
]

function buildListText(ids = [], handles = []) {
  return [...ids.map(String), ...handles.map(String)].join(', ')
}

export default function GoalGuardrails() {
  const shop = getShop()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  const [selectedGoal, setSelectedGoal] = useState('increase_aov')
  const [selectedRisk, setSelectedRisk] = useState('balanced')
  const [offerDisplayMode, setOfferDisplayMode] = useState('bundle')
  const [maxDiscountCap, setMaxDiscountCap] = useState(20)
  const [inventoryMin, setInventoryMin] = useState(0)
  const [sessionLimit, setSessionLimit] = useState(4)
  const [premiumSkuProtection, setPremiumSkuProtection] = useState(false)
  const [subscriptionProtection, setSubscriptionProtection] = useState(false)
  const [excludedProducts, setExcludedProducts] = useState('')
  const [excludedCollections, setExcludedCollections] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState(null)

  useEffect(() => {
    if (!shop) { setLoading(false); return }
    fetch(`${API_BASE}/api/dashboard/goal-guardrails?shop=${encodeURIComponent(shop)}`, {
      headers: API_KEY ? { 'X-Dashboard-Key': API_KEY } : {},
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setSelectedGoal(data.goal || 'increase_aov')
        setSelectedRisk(data.riskTolerance || 'balanced')
        setOfferDisplayMode(data.offerDisplayMode || 'bundle')
        const g = data.guardrails || {}
        setMaxDiscountCap(g.maxDiscountCap ?? 20)
        setInventoryMin(g.inventoryMinThreshold ?? 0)
        setSessionLimit(g.sessionOfferLimit ?? 4)
        setPremiumSkuProtection(!!g.premiumSkuProtection)
        setSubscriptionProtection(!!g.subscriptionProtection)
        setExcludedProducts(buildListText(g.excludedProductIds, g.excludedProductHandles))
        setExcludedCollections(buildListText(g.excludedCollectionIds, g.excludedCollectionHandles))
        setLastSavedAt(data.savedAt)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [shop])

  async function handleSave() {
    if (!shop) return
    setError(null)
    setSuccessMsg(null)
    setSaving(true)

    try {
      const res = await fetch(`${API_BASE}/api/dashboard/goal-guardrails?shop=${encodeURIComponent(shop)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'X-Dashboard-Key': API_KEY } : {}),
        },
        body: JSON.stringify({
          goal: selectedGoal,
          riskTolerance: selectedRisk,
          offerDisplayMode,
          guardrails: {
            maxDiscountCap,
            inventoryMinThreshold: inventoryMin,
            sessionOfferLimit: sessionLimit,
            premiumSkuProtection,
            subscriptionProtection,
            excludedProductsRaw: excludedProducts,
            excludedCollectionsRaw: excludedCollections,
          },
        }),
      })
      const data = await res.json()
      if (data.success) {
        setLastSavedAt(new Date().toISOString())
        setSuccessMsg('Settings saved successfully.')
        setTimeout(() => setSuccessMsg(null), 4000)
      } else {
        setError((data.errors || [data.error || 'Save failed']).join(', '))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={s.loadingWrap}><p style={s.loadingText}>Loading settings...</p></div>
  }

  return (
    <div>
      <h1 style={s.title}>Goal &amp; Guardrails</h1>
      <p style={s.subtitle}>Configure AI optimisation goals and safety limits.</p>

      {!shop && (
        <div style={s.warnBanner}>
          Shop domain not configured. Set <code>VITE_SHOP_DOMAIN</code> in your Netlify environment variables.
        </div>
      )}
      {error && <div style={s.errorBanner}>{error}</div>}
      {successMsg && <div style={s.successBanner}>{successMsg}</div>}

      {/* ── Step 1: Business Goal ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>Step 1: Set Business Goal</h2>
          <span style={s.badgeRequired}>Required</span>
        </div>
        <hr style={s.divider} />
        <p style={s.sectionDesc}>
          Choose the primary outcome you want the AI to optimise for. This drives all offer
          generation and placement decisions.
        </p>
        <div style={s.goalGrid}>
          {GOALS.map(g => (
            <SelectionCard
              key={g.value}
              selected={selectedGoal === g.value}
              onClick={() => setSelectedGoal(g.value)}
              label={g.label}
              desc={g.desc}
            />
          ))}
        </div>
      </div>

      {/* ── Step 2: Risk Tolerance ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>Step 2: Set Risk Tolerance</h2>
          <span style={s.badgeRequired}>Required</span>
        </div>
        <hr style={s.divider} />
        <p style={s.sectionDesc}>
          Controls how frequently offers are shown and how aggressive the incentives are.
        </p>
        <div style={s.riskStack}>
          {RISKS.map(r => (
            <SelectionCard
              key={r.value}
              selected={selectedRisk === r.value}
              onClick={() => setSelectedRisk(r.value)}
              label={r.label}
              desc={r.desc}
            />
          ))}
        </div>
      </div>

      {/* ── Step 3: Guardrails ── */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>Step 3: Set Guardrails (Safety Limits)</h2>
          <span style={s.badgeRecommended}>Recommended</span>
        </div>
        <hr style={s.divider} />
        <p style={s.sectionDesc}>
          Hard limits the system will never violate, regardless of goal or risk setting.
        </p>

        <SliderField
          label="Maximum Discount Cap"
          value={maxDiscountCap}
          unit="%"
          min={0}
          max={90}
          onChange={setMaxDiscountCap}
          helpText="The highest discount % the system is allowed to offer. Max: 90%."
        />

        <SliderField
          label="Inventory Minimum"
          value={inventoryMin}
          unit=" units"
          min={0}
          max={10000}
          onChange={setInventoryMin}
          helpText="Never offer a product with stock below this level. Max: 10,000 units."
        />

        <SliderField
          label="Session Offer Limit"
          value={sessionLimit}
          unit=" offers"
          min={1}
          max={10}
          onChange={setSessionLimit}
          helpText="Maximum number of offers shown to a customer in a single session. Range: 1–10."
        />

        <hr style={s.divider} />

        <CheckboxField
          label="Premium SKU Protection"
          helpText="Prevent the system from discounting high-value items."
          checked={premiumSkuProtection}
          onChange={setPremiumSkuProtection}
        />
        <CheckboxField
          label="Subscription Product Protection"
          helpText="Never apply conflicting offers to subscription products."
          checked={subscriptionProtection}
          onChange={setSubscriptionProtection}
        />

        <hr style={s.divider} />

        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Excluded Products</label>
          <textarea
            value={excludedProducts}
            onChange={e => setExcludedProducts(e.target.value)}
            placeholder="e.g. 123456789, gift-card"
            style={s.textarea}
            rows={3}
          />
          <p style={s.helpText}>
            Comma-separated product IDs or handles to never include in offers. Example: 123456789, my-product-handle
          </p>
        </div>

        <div style={s.fieldGroup}>
          <label style={s.fieldLabel}>Excluded Collections</label>
          <textarea
            value={excludedCollections}
            onChange={e => setExcludedCollections(e.target.value)}
            placeholder="e.g. 987654321, clearance"
            style={s.textarea}
            rows={3}
          />
          <p style={s.helpText}>
            Comma-separated collection IDs or handles to never include in offers. Example: 987654321, summer-sale
          </p>
        </div>
      </div>

      {/* ── Offer Display Mode (AOV & Inventory only) ── */}
      {(selectedGoal === 'increase_aov' || selectedGoal === 'inventory_movement') && (
        <div style={s.card}>
          <h2 style={{ ...s.cardTitle, marginBottom: '8px' }}>Offer Display Mode</h2>
          <hr style={s.divider} />
          <p style={s.sectionDesc}>Choose which type of offer to show customers on the product page.</p>
          <div style={s.riskStack}>
            {DISPLAY_MODES.map(m => (
              <SelectionCard
                key={m.value}
                selected={offerDisplayMode === m.value}
                onClick={() => setOfferDisplayMode(m.value)}
                label={m.label}
                desc={m.desc}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Save bar ── */}
      <div style={s.saveBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={handleSave}
            disabled={saving || !shop}
            style={{ ...s.saveBtn, ...(saving || !shop ? s.saveBtnDisabled : {}) }}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {lastSavedAt && !saving && (
            <span style={s.lastSaved}>
              Last saved: {new Date(lastSavedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function SelectionCard({ selected, onClick, label, desc }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      style={{ ...s.selCard, ...(selected ? s.selCardActive : {}) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
        <div style={{ ...s.radio, ...(selected ? s.radioActive : {}) }} />
        <span style={s.cardLabel}>{label}</span>
      </div>
      <p style={s.cardDesc}>{desc}</p>
    </div>
  )
}

function SliderField({ label, value, unit, min, max, onChange, helpText }) {
  return (
    <div style={s.sliderGroup}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <label style={s.fieldLabel}>{label}:</label>
        <span style={s.badge}>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={s.slider}
      />
      <p style={s.helpText}>{helpText}</p>
    </div>
  )
}

function CheckboxField({ label, helpText, checked, onChange }) {
  return (
    <div style={s.checkGroup}>
      <label style={s.checkLabel}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={s.checkbox}
        />
        <div>
          <span style={s.checkTitle}>{label}</span>
          <p style={s.helpText}>{helpText}</p>
        </div>
      </label>
    </div>
  )
}

const s = {
  title: { fontSize: '24px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 6px' },
  subtitle: { fontSize: '14px', color: '#6b7280', margin: '0 0 24px' },
  loadingWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' },
  loadingText: { color: '#6b7280', fontSize: '14px' },
  errorBanner: { background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', color: '#dc2626', marginBottom: '16px', fontSize: '14px' },
  successBanner: { background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: '8px', padding: '12px 16px', color: '#065f46', marginBottom: '16px', fontSize: '14px' },
  warnBanner: { background: '#fff3cd', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginBottom: '16px', fontSize: '14px' },
  card: { background: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  cardTitle: { fontSize: '16px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  sectionDesc: { fontSize: '14px', color: '#6b7280', marginBottom: '16px', marginTop: 0 },
  divider: { border: 'none', borderTop: '1px solid #e1e3e5', margin: '0 0 16px' },
  badgeRequired: { padding: '3px 10px', background: '#fff3cd', color: '#856404', fontSize: '12px', fontWeight: '600', borderRadius: '6px' },
  badgeRecommended: { padding: '3px 10px', background: '#d1fae5', color: '#065f46', fontSize: '12px', fontWeight: '600', borderRadius: '6px' },
  badge: { padding: '2px 8px', background: '#d1fae5', color: '#065f46', fontSize: '12px', fontWeight: '600', borderRadius: '4px' },
  goalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' },
  riskStack: { display: 'flex', flexDirection: 'column', gap: '10px' },
  selCard: { border: '1px solid #e1e3e5', borderRadius: '10px', padding: '14px 16px', cursor: 'pointer', background: '#fff', transition: 'all 0.15s', outline: 'none' },
  selCardActive: { border: '2px solid #6c63ff', background: '#f0f0ff' },
  radio: { width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: '2px solid #8c9196', transition: 'border 0.15s' },
  radioActive: { border: '5px solid #6c63ff' },
  cardLabel: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e' },
  cardDesc: { fontSize: '13px', color: '#6b7280', margin: '0 0 0 26px' },
  sliderGroup: { marginBottom: '20px' },
  fieldLabel: { fontSize: '14px', fontWeight: '500', color: '#1a1a2e' },
  slider: { width: '100%', marginBottom: '4px', cursor: 'pointer' },
  helpText: { fontSize: '12px', color: '#9ca3af', margin: '4px 0 0' },
  checkGroup: { marginBottom: '14px' },
  checkLabel: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' },
  checkbox: { marginTop: '3px', width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 },
  checkTitle: { fontSize: '14px', fontWeight: '500', color: '#1a1a2e' },
  fieldGroup: { marginBottom: '16px' },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' },
  saveBar: { background: '#fff', borderRadius: '10px', padding: '16px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' },
  saveBtn: { padding: '10px 20px', background: '#6c63ff', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  saveBtnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  lastSaved: { fontSize: '13px', color: '#9ca3af' },
}
