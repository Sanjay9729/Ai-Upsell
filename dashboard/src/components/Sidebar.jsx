import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/guardrails', label: 'Goal & Guardrails' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/recommendations', label: 'Recommendations' },
  { to: '/bundles', label: 'Bundles' },
  { to: '/optimization', label: 'Optimization' },
  { to: '/activity-logs', label: 'Activity Logs' },
  { to: '/intelligence', label: 'Merchandising Intelligence' },
  { to: '/safety', label: 'Safety Mode' },
  { to: '/guardrail-monitor', label: 'Guardrail Monitor' },
  { to: '/settings', label: 'Settings' },
]

export default function Sidebar() {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.logo}>
        <img src="/AI Upsell icon with glowing microchip 1 (1).png" alt="logo" style={styles.logoImg} />
        <span style={styles.logoText}>Upsell</span>
      </div>
      <nav style={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              ...styles.navLink,
              ...(isActive ? styles.navLinkActive : {}),
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

const styles = {
  sidebar: {
    width: '240px',
    height: '100vh',
    position: 'sticky',
    top: 0,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    flexShrink: 0,
    overflowY: 'auto',
    borderRight: '1px solid #e5e7eb',
    fontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  logo: {
    padding: '16px 20px 14px',
    borderBottom: '1px solid #f3f4f6',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  logoImg: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    flexShrink: 0,
  },
  logoText: {
    color: '#111827',
    fontSize: '16px',
    fontWeight: '600',
    letterSpacing: '-0.3px',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 8px',
  },
  navLink: {
    display: 'block',
    padding: '9px 12px',
    margin: '1px 0',
    color: '#374151',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    borderRadius: '6px',
    transition: 'background 0.15s ease, color 0.15s ease',
  },
  navLinkActive: {
    color: '#ffffff',
    background: '#4f46e5',
    fontWeight: '600',
  },
}
