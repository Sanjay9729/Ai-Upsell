import { useEffect, useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import { GOAL_MAPPING, RISK_MAPPING } from '../shared/merchantConfig.shared.js';
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Banner,
  Box,
  Divider,
  Badge,
} from '@shopify/polaris';

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
  const isSaving = fetcher.state !== 'idle';

  return (
    <Page
      title="Goals & Risk"
      subtitle="Define your primary objective and risk tolerance. The engine will adjust offer prioritization accordingly."
    >
      <BlockStack gap="500">
        {saved && (
          <Banner tone="success" title="Settings saved successfully" />
        )}

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="500">
          {/* Goal Selection */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Primary Goal</Text>
              <BlockStack gap="300">
                {goals.map(goal => (
                  <Box
                    key={goal.id}
                    as="button"
                    onClick={() => setSelectedGoal(goal.id)}
                    padding="400"
                    borderWidth="025"
                    borderColor={selectedGoal === goal.id ? "border-focus" : "border"}
                    borderRadius="200"
                    background={selectedGoal === goal.id ? "bg-surface-selected" : "bg-surface"}
                    style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">{goal.label}</Text>
                        {selectedGoal === goal.id && <Badge tone="success">Selected</Badge>}
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">{goal.description}</Text>
                      {goal.metrics?.length > 0 && (
                        <Text variant="bodySm" tone="subdued">
                          Metrics: {goal.metrics.join(', ')}
                        </Text>
                      )}
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Risk Selection */}
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Risk Tolerance</Text>
              <BlockStack gap="300">
                {risks.map(risk => (
                  <Box
                    key={risk.id}
                    as="button"
                    onClick={() => setSelectedRisk(risk.id)}
                    padding="400"
                    borderWidth="025"
                    borderColor={selectedRisk === risk.id ? "border-focus" : "border"}
                    borderRadius="200"
                    background={selectedRisk === risk.id ? "bg-surface-selected" : "bg-surface"}
                    style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    <BlockStack gap="100">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text variant="bodyMd" fontWeight="semibold">{risk.label}</Text>
                        {selectedRisk === risk.id && <Badge tone="success">Selected</Badge>}
                      </InlineStack>
                      <Text variant="bodySm" tone="subdued">{risk.description}</Text>
                    </BlockStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Current Configuration Summary */}
        {currentGoal && currentRisk && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Current Configuration</Text>
              <Divider />
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Goal</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{currentGoal.label}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Risk Tolerance</Text>
                  <Text variant="bodyMd" fontWeight="semibold">{currentRisk.label}</Text>
                </BlockStack>
              </InlineGrid>
            </BlockStack>
          </Card>
        )}

        {/* Save */}
        <InlineStack>
          <Button
            variant="primary"
            loading={isSaving}
            disabled={isSaving}
            onClick={handleSave}
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
