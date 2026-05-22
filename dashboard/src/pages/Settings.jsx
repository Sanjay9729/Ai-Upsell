import { useState, useEffect } from 'react';
import { getShop } from '../hooks/useApi';
import { API_URL } from '../config';
import { s, PageHeader, Card, StatCard, Badge } from '../components/ui';

export default function Settings() {
  const [shop, setShop] = useState(getShop());
  const [apiUrl, setApiUrl] = useState(localStorage.getItem('upsell_api_url') || API_URL);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    if (shop) fetchHealth();
  }, []);

  function save() {
    if (shop.trim()) localStorage.setItem('upsell_shop', shop.trim());
    if (apiUrl.trim()) localStorage.setItem('upsell_api_url', apiUrl.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function fetchHealth() {
    setHealthLoading(true);
    try {
      const r = await fetch(`${apiUrl}/api/dashboard/settings?shop=${shop}`);
      const d = await r.json();
      setHealth(d);
    } catch {
      setHealth({ error: 'Could not reach backend' });
    }
    setHealthLoading(false);
  }

  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: '6px',
    border: '1px solid #d1d5db', fontSize: '14px', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure shop connection and API endpoint." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <Card title="Connection">
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Shop Domain
            </label>
            <input
              style={inputStyle}
              value={shop}
              onChange={e => setShop(e.target.value)}
              placeholder="mystore.myshopify.com"
            />
            <p style={{ fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' }}>
              Auto-set when opened from Shopify admin.
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Backend API URL
            </label>
            <input
              style={inputStyle}
              value={apiUrl}
              onChange={e => setApiUrl(e.target.value)}
              placeholder="https://your-app.onrender.com"
            />
            <p style={{ fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' }}>
              Your Remix app URL on Render.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={save} style={{
              padding: '8px 20px', background: '#6c63ff', color: '#fff',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontWeight: '600', fontSize: '13px',
            }}>
              {saved ? 'Saved!' : 'Save'}
            </button>
            <button onClick={fetchHealth} style={{
              padding: '8px 20px', background: '#f3f4f6', color: '#374151',
              border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer',
              fontWeight: '600', fontSize: '13px',
            }}>
              Test Connection
            </button>
          </div>
        </Card>

        <Card title="System Health">
          {healthLoading && <p style={{ color: '#6b7280', fontSize: '14px' }}>Checking...</p>}
          {!healthLoading && !health && <p style={s.empty}>Click "Test Connection" to check.</p>}
          {!healthLoading && health?.error && (
            <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '8px', color: '#dc2626', fontSize: '13px' }}>
              {health.error}
            </div>
          )}
          {!healthLoading && health && !health.error && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                <StatCard label="Products" value={health.health?.products ?? '—'} color="#6c63ff" small />
                <StatCard label="Bundles" value={health.health?.bundles ?? '—'} color="#10b981" small />
                <StatCard label="Events (7d)" value={health.health?.events7d ?? '—'} color="#f59e0b" small />
              </div>
              {health.config && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Badge type="success">Connected</Badge>
                    <Badge type="info">{health.config.goal?.replace(/_/g, ' ') || 'No goal set'}</Badge>
                    <Badge type={health.config.riskTolerance === 'aggressive' ? 'danger' : health.config.riskTolerance === 'balanced' ? 'warning' : 'success'}>
                      {health.config.riskTolerance || 'No risk set'}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
