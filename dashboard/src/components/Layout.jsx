import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div style={styles.container}>
      <Sidebar />
      <main style={styles.main}>
        <div style={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    background: '#f5f6fa',
  },
  main: {
    flex: 1,
    padding: '32px',
    overflowY: 'auto',
    minWidth: 0,
  },
  content: {
    maxWidth: '998px',
    margin: '0 auto',
  },
}
