import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { getShop } from '../hooks/useApi'
import { API_URL } from '../config'

const IconHome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
)

const IconBarChart = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
)

const IconLightbulb = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6H8.3A7 7 0 0 1 5 9a7 7 0 0 1 7-7z"/>
  </svg>
)

const IconPackage = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)

const IconSliders = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
  </svg>
)

const IconActivity = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
)

const IconBrain = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.44-4.14z"/>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.44-4.14z"/>
  </svg>
)

const IconShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)

const IconMonitor = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
)

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IconChevronsUpDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 15 5 5 5-5"/>
    <path d="m7 9 5-5 5 5"/>
  </svg>
)

const IconHelpCircle = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)

const IconShopifyBag = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
)

const navItems = [
  { to: '/guardrails', label: 'Goal & Guardrails', Icon: IconHome, hasSubmenu: false },
  { to: '/analytics', label: 'Analytics', Icon: IconBarChart, hasSubmenu: false },
  { to: '/recommendations', label: 'Recommendations', Icon: IconLightbulb, hasSubmenu: true },
  { to: '/bundles', label: 'Bundles', Icon: IconPackage, hasSubmenu: true },
  { to: '/optimization', label: 'Optimization', Icon: IconSliders, hasSubmenu: true },
  { to: '/activity-logs', label: 'Activity Logs', Icon: IconActivity, hasSubmenu: false },
  { to: '/intelligence', label: 'Merchandising Intelligence', Icon: IconBrain, hasSubmenu: true },
  { to: '/safety', label: 'Safety Mode', Icon: IconShield, hasSubmenu: false },
  { to: '/guardrail-monitor', label: 'Guardrail Monitor', Icon: IconMonitor, hasSubmenu: false },
  { to: '/settings', label: 'Settings', Icon: IconSettings, hasSubmenu: true },
]

export default function Sidebar() {
  const [testMode, setTestMode] = useState(false)
  const [shopInfo, setShopInfo] = useState({ name: '', email: '' })

  useEffect(() => {
    const shop = getShop()
    if (!shop) return
    fetch(`${API_URL}/api/shop-info?shop=${shop}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.name) setShopInfo({ name: d.name, email: d.email || '' }) })
      .catch(() => {})
  }, [])

  const initials = shopInfo.name
    ? shopInfo.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    : ''

  return (
    <aside style={styles.sidebar}>
      {/* Store selector */}
      <div style={styles.storeSelector}>
        <div style={styles.storeLogoWrap}>
          <img
            src="/AI Upsell icon with glowing microchip 1 (1).png"
            alt="logo"
            style={styles.storeLogoImg}
          />
        </div>
        <div style={styles.storeInfo}>
          <div style={styles.storeName}>Upsell AI</div>
        </div>
        <span style={styles.caret}><IconChevronsUpDown /></span>
      </div>

      {/* Main navigation */}
      <nav style={styles.nav}>
        {navItems.map(({ to, label, Icon, hasSubmenu }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              ...styles.navLink,
              ...(isActive ? styles.navLinkActive : {}),
            })}
          >
            {({ isActive }) => (
              <>
                <span style={{ color: isActive ? '#7c3aed' : '#6b7280', display: 'flex', flexShrink: 0 }}>
                  <Icon />
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Divider */}
      <div style={styles.divider} />

      {initials && (
        <div style={styles.userProfile}>
          <div style={styles.userAvatar}>{initials}</div>
          <div style={styles.userInfo}>
            <div style={styles.userName}>{shopInfo.name}</div>
            <div style={styles.userEmail}>{shopInfo.email}</div>
          </div>
          <span style={styles.caret}><IconChevronsUpDown /></span>
        </div>
      )}
    </aside>
  )
}

const styles = {
  sidebar: {
    width: '255px',
    height: '100vh',
    position: 'sticky',
    top: 0,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflowY: 'auto',
    borderRight: '1px solid #e5e7eb',
    fontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  storeSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
  },
  storeLogoWrap: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    overflow: 'hidden',
    flexShrink: 0,
    background: '#f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeLogoImg: {
    width: '36px',
    height: '36px',
    objectFit: 'cover',
  },
  storeInfo: {
    flex: 1,
    minWidth: 0,
  },
  storeName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#111827',
    lineHeight: '1.3',
  },
  storeId: {
    fontSize: '12px',
    color: '#9ca3af',
    lineHeight: '1.3',
  },
  caret: {
    color: '#9ca3af',
    display: 'flex',
    flexShrink: 0,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 8px',
    gap: '2px',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 10px',
    color: '#374151',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '6px',
    transition: 'background 0.15s ease, color 0.15s ease',
    cursor: 'pointer',
  },
  navLinkActive: {
    color: '#7c3aed',
    background: '#f5f3ff',
    fontWeight: '600',
  },
  divider: {
    height: '1px',
    background: '#f3f4f6',
    flexShrink: 0,
  },
  bottomNav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '6px 8px',
    gap: '1px',
  },
  bottomNavLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    color: '#374151',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  testModeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 18px',
  },
  toggle: {
    width: '36px',
    height: '20px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    transition: 'background 0.2s ease',
    padding: 0,
  },
  toggleThumb: {
    width: '16px',
    height: '16px',
    background: '#ffffff',
    borderRadius: '50%',
    position: 'absolute',
    transition: 'transform 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  testModeLabel: {
    fontSize: '14px',
    color: '#374151',
    fontWeight: '500',
  },
  userProfile: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    cursor: 'pointer',
  },
  userAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#7c3aed',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '700',
    flexShrink: 0,
    letterSpacing: '0.5px',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#111827',
    lineHeight: '1.3',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userEmail: {
    fontSize: '11px',
    color: '#9ca3af',
    lineHeight: '1.3',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
}
