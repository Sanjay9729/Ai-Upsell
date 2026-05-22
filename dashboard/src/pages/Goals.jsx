import { useApi } from '../hooks/useApi';
import { s, PageHeader, Card, Badge, Loader, ErrorBox } from '../components/ui';

const GOAL_LABELS = {
  increase_aov: 'Increase AOV',
  revenue_per_visitor: 'Revenue per Visitor',
  subscription_adoption: 'Subscription Adoption',
  inventory_movement: 'Inventory Movement',
};

const RISK_COLORS = { conservative: '#10b981', balanced: '#f59e0b', aggressive: '#ef4444' };

export default function Goals() {
  const { data, loading, error } = useApi('goals');

  if (loading) return <Loader />;
  if (error) return <ErrorBox message={error} />;

  const { current, goals, risks } = data;

  return (
    <div>
      <PageHeader title="Goals" subtitle="Current upsell strategy and risk tolerance settings." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
        <Card title="Current Goal">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a2e' }}>
              {GOAL_LABELS[current.goal] || current.goal}
            </span>
          </div>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>
            {goals.find(g => g.id === current.goal)?.description || '—'}
          </p>
        </Card>

        <Card title="Risk Tolerance">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{
              fontSize: '28px', fontWeight: '700', textTransform: 'capitalize',
              color: RISK_COLORS[current.riskTolerance] || '#1a1a2e',
            }}>
              {current.riskTolerance}
            </span>
          </div>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>
            {risks.find(r => r.id === current.riskTolerance)?.description || '—'}
          </p>
        </Card>
      </div>

      <Card title="All Goal Options">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {goals.map(g => (
            <div key={g.id} style={{
              padding: '16px', borderRadius: '8px', border: '2px solid',
              borderColor: current.goal === g.id ? '#6c63ff' : '#e5e7eb',
              background: current.goal === g.id ? '#f5f3ff' : '#fafafa',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <strong style={{ fontSize: '13px', color: '#1a1a2e' }}>{GOAL_LABELS[g.id] || g.id}</strong>
                {current.goal === g.id && <Badge type="success">Active</Badge>}
              </div>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>{g.description}</p>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ marginTop: '20px' }}>
        <Card title="Risk Levels">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {risks.map(r => (
              <div key={r.id} style={{
                padding: '16px', borderRadius: '8px', border: '2px solid',
                borderColor: current.riskTolerance === r.id ? RISK_COLORS[r.id] : '#e5e7eb',
                background: current.riskTolerance === r.id ? '#f0fdf4' : '#fafafa',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '13px', textTransform: 'capitalize', color: RISK_COLORS[r.id] }}>{r.id}</strong>
                  {current.riskTolerance === r.id && <Badge type="success">Active</Badge>}
                </div>
                <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>{r.description}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
