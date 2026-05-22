import { useEffect, useState } from 'react';
import { json } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  TextField,
  Badge,
  Banner,
  EmptyState,
  Box,
  Divider,
  ChoiceList,
} from '@shopify/polaris';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const { getBundles, getBundleAnalytics } = await import("../../backend/services/bundleEngine.js");
    const db = await getDb();

    const config = await db.collection(collections.merchantConfig).findOne({ shopId: session.shop });
    const offerDisplayMode = config?.offerDisplayMode || 'both';

    const bundlesResult = await getBundles(session.shop);

    const bundleProducts = new Map();
    for (const bundle of bundlesResult.bundles) {
      for (const productId of bundle.productIds) {
        if (!bundleProducts.has(productId)) {
          const product = await db.collection(collections.products)
            .findOne({ productId: productId.toString() });
          bundleProducts.set(productId, product?.title || `Product ${productId}`);
        }
      }
    }

    const bundlesWithAnalytics = await Promise.all(
      bundlesResult.bundles.map(async (bundle) => {
        const analyticsResult = await getBundleAnalytics(session.shop, bundle._id);
        return {
          ...bundle,
          _id: bundle._id.toString(),
          analytics: analyticsResult.analytics,
          displayNames: bundle.productIds.map(pid => bundleProducts.get(pid) || `Product ${pid}`)
        };
      })
    );

    return json({
      success: true,
      bundles: bundlesWithAnalytics,
      shopId: session.shop,
      offerDisplayMode
    });
  } catch (error) {
    console.error('Error loading bundles:', error);
    return json({
      success: false,
      error: error.message,
      bundles: [],
      shopId: ''
    });
  }
};

export const action = async ({ request }) => {
  if (request.method === 'POST') {
    const { session } = await authenticate.admin(request);
    const { actionType, bundleId, name, productIds, discountPercent, offerDisplayMode } = await request.json();

    try {
      const { getDb, collections } = await import("../../backend/database/mongodb.js");

      if (actionType === 'save_offer_mode') {
        const db = await getDb();
        await db.collection(collections.merchantConfig).updateOne(
          { shopId: session.shop },
          { $set: { offerDisplayMode, updatedAt: new Date() } },
          { upsert: true }
        );
        return json({ success: true, message: 'Offer display mode saved' });
      }

      const { pauseBundle, createBundle } = await import("../../backend/services/bundleEngine.js");
      if (actionType === 'pause') {
        const result = await pauseBundle(session.shop, bundleId, true);
        return json({ success: result.success, message: 'Bundle paused' });
      }

      if (actionType === 'resume') {
        const result = await pauseBundle(session.shop, bundleId, false);
        return json({ success: result.success, message: 'Bundle resumed' });
      }

      if (actionType === 'create') {
        const result = await createBundle({
          shopId: session.shop,
          name,
          productIds,
          discountPercent: Number(discountPercent) || 10,
          bundleType: 'merchant',
          confidence: 0.9
        });
        return json({
          success: result.success,
          message: result.action === 'created' ? 'Bundle created' : 'Bundle updated',
          bundleId: result.bundleId
        });
      }

      return json({ success: false, error: 'Unknown action' }, { status: 400 });
    } catch (error) {
      console.error('Error in bundle action:', error);
      return json({ success: false, error: error.message }, { status: 500 });
    }
  }

  return json({ success: false, error: 'Method not allowed' }, { status: 405 });
};

export default function BundlesPage() {
  const { bundles, offerDisplayMode: initialOfferMode } = useLoaderData();
  const fetcher = useFetcher();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedBundles, setExpandedBundles] = useState(new Set());
  const [offerMode, setOfferMode] = useState([initialOfferMode || 'both']);
  const [modeSaved, setModeSaved] = useState(false);
  const [formData, setFormData] = useState({ name: '', productIds: '', discountPercent: '10' });

  const handleSaveOfferMode = () => {
    fetcher.submit(
      { actionType: 'save_offer_mode', offerDisplayMode: offerMode[0] },
      { method: 'POST', encType: 'application/json' }
    );
    setModeSaved(true);
    setTimeout(() => setModeSaved(false), 3000);
  };

  const toggleDetails = (bundleId) => {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(bundleId)) next.delete(bundleId);
      else next.add(bundleId);
      return next;
    });
  };

  const handleCreateBundle = () => {
    const productIds = formData.productIds.split(',').map(s => s.trim()).filter(Boolean);
    fetcher.submit(
      { actionType: 'create', name: formData.name, productIds, discountPercent: formData.discountPercent },
      { method: 'POST', encType: 'application/json' }
    );
    setShowCreate(false);
    setFormData({ name: '', productIds: '', discountPercent: '10' });
  };

  const handlePauseBundle = (bundleId, isPaused) => {
    fetcher.submit(
      { actionType: isPaused ? 'resume' : 'pause', bundleId },
      { method: 'POST', encType: 'application/json' }
    );
  };

  const offerModeChoices = [
    { value: 'bundle', label: 'Bundle & Save', helpText: 'Show only bundle offers' },
    { value: 'volume_discount', label: 'Buy More, Save More', helpText: 'Show only volume discount offers' },
    { value: 'both', label: 'Both', helpText: 'Show both types together' },
  ];

  const productIdsArray = formData.productIds.split(',').map(s => s.trim()).filter(Boolean);

  return (
    <Page
      title="Bundle Review"
      subtitle="Manage auto-generated and merchant bundles. View performance metrics and adjust configurations."
      primaryAction={{ content: showCreate ? 'Cancel' : 'Create Bundle', onAction: () => setShowCreate(!showCreate) }}
    >
      <BlockStack gap="500">
        {/* Offer Display Mode */}
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">Offer Display Mode</Text>
              <Text variant="bodySm" tone="subdued">
                Choose which type of offer to show customers on the product page.
              </Text>
            </BlockStack>
            <ChoiceList
              title="Display mode"
              titleHidden
              choices={offerModeChoices}
              selected={offerMode}
              onChange={setOfferMode}
            />
            <InlineStack gap="300" blockAlign="center">
              <Button variant="primary" onClick={handleSaveOfferMode}>Save Setting</Button>
              {modeSaved && <Text tone="success" variant="bodySm">Saved!</Text>}
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Create Bundle Form */}
        {showCreate && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Create New Bundle</Text>
              <TextField
                label="Bundle name"
                value={formData.name}
                onChange={(v) => setFormData({ ...formData, name: v })}
                autoComplete="off"
              />
              <TextField
                label="Product IDs (comma separated)"
                value={formData.productIds}
                onChange={(v) => setFormData({ ...formData, productIds: v })}
                helpText="Enter at least 2 product IDs"
                autoComplete="off"
              />
              <TextField
                label="Discount %"
                type="number"
                value={formData.discountPercent}
                onChange={(v) => setFormData({ ...formData, discountPercent: v })}
                min="0"
                max="100"
                autoComplete="off"
              />
              <InlineStack gap="200">
                <Button
                  variant="primary"
                  disabled={!formData.name || productIdsArray.length < 2}
                  onClick={handleCreateBundle}
                >
                  Create
                </Button>
                <Button onClick={() => setShowCreate(false)}>Cancel</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Bundle Cards */}
        {bundles.length === 0 ? (
          <EmptyState heading="No bundles yet" image="">
            <p>Create your first bundle or wait for autonomous recommendations to appear.</p>
          </EmptyState>
        ) : (
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
            {bundles.map(bundle => (
              <Card key={bundle._id}>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text variant="bodyMd" fontWeight="bold">{bundle.name}</Text>
                      <Badge tone={bundle.status === 'paused' ? 'critical' : 'success'}>
                        {bundle.status}
                      </Badge>
                    </InlineStack>
                    <Text variant="bodySm" tone="subdued">{bundle.displayNames.join(' + ')}</Text>
                  </BlockStack>

                  <Divider />

                  <InlineGrid columns={2} gap="200">
                    <Text variant="bodySm">Discount: <strong>{bundle.discountPercent}%</strong></Text>
                    <Text variant="bodySm">Type: <strong>{bundle.bundleType}</strong></Text>
                    <Text variant="bodySm">Views: <strong>{bundle.analytics?.stats?.view || 0}</strong></Text>
                    <Text variant="bodySm">Conversions: <strong>{bundle.analytics?.stats?.cart_add || 0}</strong></Text>
                  </InlineGrid>

                  {expandedBundles.has(bundle._id) && (
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="100">
                        <Text variant="bodySm" fontWeight="bold">Bundle Details</Text>
                        <Text variant="bodySm">Source: {bundle.bundleType === 'auto' ? 'Auto-generated' : 'Merchant-created'}</Text>
                        <Text variant="bodySm">Confidence: {bundle.confidence != null ? `${(bundle.confidence * 100).toFixed(0)}%` : '—'}</Text>
                        <Text variant="bodySm">Products ({bundle.productIds?.length || 0}): {bundle.displayNames.join(', ')}</Text>
                        <Text variant="bodySm">Click-through: {bundle.analytics?.stats?.view > 0 ? `${((bundle.analytics.stats.click || 0) / bundle.analytics.stats.view * 100).toFixed(1)}%` : '—'}</Text>
                        <Text variant="bodySm">Conversion: {bundle.analytics?.stats?.view > 0 ? `${((bundle.analytics.stats.cart_add || 0) / bundle.analytics.stats.view * 100).toFixed(1)}%` : '—'}</Text>
                      </BlockStack>
                    </Box>
                  )}

                  <InlineStack gap="200">
                    <Button
                      tone={bundle.status === 'paused' ? 'success' : 'critical'}
                      onClick={() => handlePauseBundle(bundle._id, bundle.status === 'paused')}
                    >
                      {bundle.status === 'paused' ? 'Resume' : 'Pause'}
                    </Button>
                    <Button
                      variant={expandedBundles.has(bundle._id) ? 'primary' : undefined}
                      onClick={() => toggleDetails(bundle._id)}
                    >
                      {expandedBundles.has(bundle._id) ? 'Hide Details' : 'Details'}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        )}
      </BlockStack>
    </Page>
  );
}
