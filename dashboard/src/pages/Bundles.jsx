export default function Bundles() {
  return (
    <div>
      <h1 style={styles.title}>Bundles</h1>
      <p style={styles.subtitle}>Manage product bundle upsell offers.</p>
      <div style={styles.card}>
        <p style={styles.placeholder}>Bundle management coming soon. This page will connect to your Remix backend.</p>
      </div>
    </div>
  )
}

const styles = {
  title: { fontSize: '24px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 6px' },
  subtitle: { fontSize: '14px', color: '#6b7280', margin: '0 0 24px' },
  card: { background: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  placeholder: { color: '#9ca3af', fontSize: '14px', margin: 0 },
}
