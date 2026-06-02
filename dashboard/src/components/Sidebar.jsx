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
    width: '220px',
    height: '100vh',
    position: 'sticky',
    top: 0,
    background: '#1a1a2e',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    flexShrink: 0,
    overflowY: 'auto',
  },
  logo: {
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
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
    color: '#fff',
    fontSize: '20px',
    fontWeight: '700',
    letterSpacing: '-0.5px',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 0',
  },
  navLink: {
    display: 'block',
    padding: '10px 20px',
    color: 'rgba(255,255,255,0.6)',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '500',
    borderLeft: '3px solid transparent',
    transition: 'all 0.15s ease',
  },
  navLinkActive: {
    color: '#fff',
    background: 'rgba(255,255,255,0.08)',
    borderLeft: '3px solid #6c63ff',
  },
}
