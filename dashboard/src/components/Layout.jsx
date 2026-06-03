import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Sidebar from './Sidebar'

const IconMenu = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
)

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div style={styles.container}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <div style={styles.mainWrapper}>
        <div className="layout-mobile-header">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <IconMenu />
          </button>
          <img
            src="/AI Upsell icon with glowing microchip 1 (1).png"
            alt="logo"
            style={{ width: '28px', height: '28px', objectFit: 'cover', borderRadius: '6px' }}
          />
          <span className="layout-mobile-header-title">Upsell AI</span>
        </div>

        <main style={styles.main} className="layout-main">
          <div style={styles.content}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    background: '#f5f6fa',
  },
  mainWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  main: {
    flex: 1,
    padding: '32px',
  },
  content: {
    maxWidth: '998px',
    margin: '0 auto',
  },
}
