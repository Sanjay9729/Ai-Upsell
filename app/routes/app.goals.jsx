import { useEffect, useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import { GOAL_MAPPING, RISK_MAPPING } from '../shared/merchantConfig.shared.js';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getMerchantConfig } = await import("../../backend/services/merchantConfig.js");
    const config = await getMerchantConfig(session.shop);

    const goals = Object.entries(GOAL_MAPPING).map(([key, value]) => ({
      id: key,
      label: value.label,
      description: value.description,
      metrics: value.metrics || []
    }));

    const risks = Object.entries(RISK_MAPPING).map(([key, value]) => ({
      id: key,
      label: value.label,
      description: value.description
    }));

    return json({
      success: true,
      config: {
        goal: config.goal,
        riskTolerance: config.riskTolerance
      },
      goals,
      risks,
      shopId: session.shop
    });
  } catch (error) {
    console.error('Error loading goals:', error);
    return json({
      success: false,
      error: error.message,
      config: { goal: 'revenue_per_visitor', riskTolerance: 'moderate' },
      goals: [],
      risks: []
    });
  }
};

export const action = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { goal, riskTolerance } = await request.json();

  try {
    const { updateMerchantConfig } = await import("../../backend/services/merchantConfig.js");
    await updateMerchantConfig(session.shop, {
      goal: goal || 'revenue_per_visitor',
      riskTolerance: riskTolerance || 'moderate',
      optimization: { topOfferType: null },
      updatedAt: new Date()
    });

    return json({
      success: true,
      message: 'Configuration saved',
      goal,
      riskTolerance
    });
  } catch (error) {
    console.error('Error saving goals:', error);
    return json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
};

export default function GoalsPage() {
  const { config, goals, risks } = useLoaderData();
  const fetcher = useFetcher();
  const [selectedGoal, setSelectedGoal] = useState(config.goal);
  const [selectedRisk, setSelectedRisk] = useState(config.riskTolerance);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    fetcher.submit(
      { goal: selectedGoal, riskTolerance: selectedRisk },
      { method: 'POST', encType: 'application/json' }
    );
  };

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }, [fetcher.state, fetcher.data]);

  const currentGoal = goals.find(g => g.id === selectedGoal);
  const currentRisk = risks.find(r => r.id === selectedRisk);

  return (
    <div style={{ padding: '24px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '600', marginBottom: '8px' }}>🎯 Goals & Risk</h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Define your primary objective and risk tolerance. The engine will adjust offer prioritization accordingly.
        </p>
      </div>

      {saved && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#dff2bf',
          border: '1px solid #9ccc65',
          borderRadius: '4px',
          marginBottom: '24px',
          fontSize: '14px',
          color: '#33691e'
        }}>
          ✓ Settings saved
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', maxWidth: '1200px' }}>
        {/* Goal Selection */}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Primary Goal</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {goals.map(goal => (
              <button
                key={goal.id}
                onClick={() => setSelectedGoal(goal.id)}
                style={{
                  padding: '16px',
                  border: selectedGoal === goal.id ? '2px solid #007bff' : '1px solid #ddd',
                  borderRadius: '8px',
                  backgroundColor: selectedGoal === goal.id ? '#f0f7ff' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>
                  {goal.label}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {goal.description}
                </div>
                {goal.metrics?.length > 0 && (
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                    📊 {goal.metrics.join(', ')}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Risk Selection */}
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Risk Tolerance</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {risks.map(risk => (
              <button
                key={risk.id}
                onClick={() => setSelectedRisk(risk.id)}
                style={{
                  padding: '16px',
                  border: selectedRisk === risk.id ? '2px solid #007bff' : '1px solid #ddd',
                  borderRadius: '8px',
                  backgroundColor: selectedRisk === risk.id ? '#f0f7ff' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>
                  {risk.label}
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {risk.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary */}
      {currentGoal && currentRisk && (
        <div style={{
          marginTop: '32px',
          padding: '16px',
          backgroundColor: '#f5f5f5',
          borderRadius: '8px',
          maxWidth: '1200px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Current Configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', fontSize: '14px' }}>
            <div>
              <span style={{ color: '#666' }}>Goal:</span>{' '}
              <span style={{ fontWeight: '600' }}>{currentGoal.label}</span>
            </div>
            <div>
              <span style={{ color: '#666' }}>Risk Tolerance:</span>{' '}
              <span style={{ fontWeight: '600' }}>{currentRisk.label}</span>
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div style={{ marginTop: '32px' }}>
        <button
          onClick={handleSave}
          disabled={fetcher.state !== 'idle'}
          style={{
            padding: '12px 24px',
            backgroundColor: '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: fetcher.state === 'idle' ? 'pointer' : 'not-allowed',
            opacity: fetcher.state === 'idle' ? 1 : 0.7
          }}
        >
          {fetcher.state === 'idle' ? '💾 Save Configuration' : 'Saving...'}
        </button>
      </div>
    </div>
  );
}
