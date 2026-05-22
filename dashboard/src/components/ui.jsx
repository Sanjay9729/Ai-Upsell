export const s = {
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb' },
  td: { padding: '10px 12px', fontSize: '13px', color: '#374151', borderBottom: '1px solid #f3f4f6' },
  empty: { color: '#9ca3af', fontSize: '14px', textAlign: 'center', padding: '32px 0' },
};

const BADGE_STYLES = {
  success: { background: '#d1fae5', color: '#065f46' },
  info:    { background: '#dbeafe', color: '#1e40af' },
  warning: { background: '#fef3c7', color: '#92400e' },
  danger:  { background: '#fee2e2', color: '#991b1b' },
  default: { background: '#f3f4f6', color: '#374151' },
};

export function Badge({ type = 'default', children }) {
  const st = BADGE_STYLES[type] || BADGE_STYLES.default;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '20px',
      fontSize: '11px', fontWeight: '600', ...st,
    }}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, color, small }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '10px',
      padding: small ? '14px' : '20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: small ? '20px' : '28px', fontWeight: '700', color: '#1a1a2e', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

export function Card({ title, children }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '10px',
      padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {title && (
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#1a1a2e' }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 4px' }}>{title}</h1>
      {subtitle && <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>{subtitle}</p>}
    </div>
  );
}

export function TableRow({ children }) {
  return <tr style={{ borderBottom: '1px solid #f3f4f6' }}>{children}</tr>;
}

export function Loader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%',
        border: '3px solid #e5e7eb', borderTopColor: '#6c63ff',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function ErrorBox({ message }) {
  return (
    <div style={{
      padding: '16px', borderRadius: '8px', background: '#fef2f2',
      border: '1px solid #fecaca', color: '#dc2626', fontSize: '14px',
    }}>
      <strong>Error:</strong> {message}
    </div>
  );
}
