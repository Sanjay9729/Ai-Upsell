import { useEffect, useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Checkbox,
  Banner,
  Box,
  Divider,
  RangeSlider,
} from '@shopify/polaris';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getMerchantConfig } = await import("../../backend/services/merchantConfig.js");
    const config = await getMerchantConfig(session.shop);

    const guardrails = config.guardrails || {
      maxDiscountCap: 25,
      inventoryMinThreshold: 5,
      sessionOfferLimit: 4,
      premiumSkuProtection: [],
      subscriptionProtection: false
    };

    return json({
      success: true,
      config,
      guardrails,
      shopId: session.shop
    });
  } catch (error) {
    console.error('Error loading guardrails:', error);
    return json({
      success: false,
      error: error.message,
      guardrails: {},
      shopId: ''
    });
  }
};

export const action = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { guardrails } = await request.json();

  try {
    const { updateMerchantConfig } = await import("../../backend/services/merchantConfig.js");
    await updateMerchantConfig(session.shop, {
      guardrails: {
        maxDiscountCap: Number(guardrails.maxDiscountCap) || 25,
        inventoryMinThreshold: Number(guardrails.inventoryMinThreshold) || 5,
        sessionOfferLimit: Number(guardrails.sessionOfferLimit) || 4,
        premiumSkuProtection: guardrails.premiumSkuProtection || [],
        subscriptionProtection: Boolean(guardrails.subscriptionProtection)
      },
      updatedAt: new Date()
    });

    return json({ success: true, message: 'Guardrails saved' });
  } catch (error) {
    console.error('Error saving guardrails:', error);
    return json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
};

export default function GuardrailsPage() {
  const { guardrails } = useLoaderData();
  const fetcher = useFetcher();
  const [formData, setFormData] = useState(guardrails);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    fetcher.submit(
      { guardrails: formData },
      { method: 'POST', encType: 'application/json' }
    );
  };

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }, [fetcher.state, fetcher.data]);

  const set = (field, value) => setFormData({ ...formData, [field]: value });

  const isSaving = fetcher.state !== 'idle';

  return (
    <Page
      title="Guardrails"
      subtitle="Define safety constraints and business rules to ensure offers align with your strategy and margin targets."
    >
      <BlockStack gap="500">
        {saved && (
          <Banner tone="success" title="Guardrails saved successfully" />
        )}

        {/* Max Discount Cap */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Maximum Discount Cap</Text>
              <Text variant="bodySm" tone="subdued">
                The highest discount percentage the engine will apply to any offer. Protects margins.
              </Text>
            </BlockStack>
            <RangeSlider
              label={`Cap: ${formData.maxDiscountCap || 25}%`}
              min={0}
              max={100}
              step={1}
              value={formData.maxDiscountCap || 25}
              onChange={(v) => set('maxDiscountCap', v)}
              output
            />
          </BlockStack>
        </Card>

        {/* Inventory Threshold */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Inventory Minimum Threshold</Text>
              <Text variant="bodySm" tone="subdued">
                Only recommend products with at least this many units in stock. Prevents overselling.
              </Text>
            </BlockStack>
            <InlineStack gap="300" blockAlign="end">
              <div style={{ width: '120px' }}>
                <TextField
                  label="Minimum units"
                  type="number"
                  value={String(formData.inventoryMinThreshold || 5)}
                  onChange={(v) => set('inventoryMinThreshold', Number(v))}
                  min="0"
                  suffix="units"
                  autoComplete="off"
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Session Offer Limit */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Session Offer Limit</Text>
              <Text variant="bodySm" tone="subdued">
                Maximum number of offers to show a single user in one session. Prevents offer fatigue.
              </Text>
            </BlockStack>
            <RangeSlider
              label={`Limit: ${formData.sessionOfferLimit || 4} offers`}
              min={1}
              max={10}
              step={1}
              value={formData.sessionOfferLimit || 4}
              onChange={(v) => set('sessionOfferLimit', v)}
              output
            />
          </BlockStack>
        </Card>

        {/* Premium SKU Protection */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Premium SKU Protection</Text>
              <Text variant="bodySm" tone="subdued">
                These products will never be offered at discounts. Protect high-margin items.
              </Text>
            </BlockStack>
            <TextField
              label="Protected SKUs"
              multiline={4}
              placeholder="Enter product handles or IDs, one per line"
              value={(formData.premiumSkuProtection || []).join('\n')}
              onChange={(v) => set('premiumSkuProtection', v.split('\n').filter(Boolean))}
              helpText={`${(formData.premiumSkuProtection || []).length} SKU(s) protected`}
              autoComplete="off"
              monospaced
            />
          </BlockStack>
        </Card>

        {/* Subscription Protection */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Subscription Protection</Text>
              <Text variant="bodySm" tone="subdued">
                Never offer subscription products at discounts. Preserve subscription economics.
              </Text>
            </BlockStack>
            <Checkbox
              label="Never discount subscription products"
              checked={formData.subscriptionProtection || false}
              onChange={(v) => set('subscriptionProtection', v)}
            />
          </BlockStack>
        </Card>

        {/* Save */}
        <InlineStack>
          <Button variant="primary" loading={isSaving} disabled={isSaving} onClick={handleSave}>
            {isSaving ? 'Saving...' : 'Save Guardrails'}
          </Button>
        </InlineStack>

        {/* Info Banner */}
        <Banner title="How guardrails work">
          <p>
            These guardrails are evaluated before every offer decision. Tighter constraints increase safety but may reduce offer frequency. Find the right balance for your business.
          </p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
