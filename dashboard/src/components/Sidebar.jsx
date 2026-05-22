import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/goals', label: 'Goals' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/recommendations', label: 'Recommendations' },
  { to: '/bundles', label: 'Bundles' },
  { to: '/optimization', label: 'Optimization' },
  { to: '/guardrails', label: 'Guardrails' },
  { to: '/activity-logs', label: 'Activity Logs' },
  { to: '/settings', label: 'Settings' },
]

export default function Sidebar() {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.logo}>
        <span style={styles.logoText}>AI Upsell</span>
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
    minHeight: '100vh',
    background: '#1a1a2e',
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    flexShrink: 0,
  },
  logo: {
    padding: '24px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
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
