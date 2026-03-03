import { useState, useEffect } from 'react';
import {
  Card,
  Layout,
  Page,
  Text,
  Box,
  Button,
  Icon,
} from '@shopify/polaris';
import { RefreshIcon } from '@shopify/polaris-icons';

/**
 * Purchase Analytics Dashboard
 *
 * Shows:
 * - AOV lift from upsells
 * - Revenue attribution by product
 * - Revenue attribution by offer type
 * - Cart-add to purchase conversion rate
 */

export default function PurchaseAnalytics() {
  const [loading, setLoading] = useState(true);
  const [aovLift, setAovLift] = useState(null);
  const [revenueByProduct, setRevenueByProduct] = useState(null);
  const [revenueByType, setRevenueByType] = useState(null);
  const [conversionRate, setConversionRate] = useState(null);
  const [purchaseEvents, setPurchaseEvents] = useState([]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // Fetch all analytics in parallel
      const [aov, product, type, conversion, events] = await Promise.all([
        fetch('/api/purchase-events?action=aov-lift').then(r => r.json()),
        fetch('/api/purchase-events?action=revenue-by-product').then(r => r.json()),
        fetch('/api/purchase-events?action=revenue-by-type').then(r => r.json()),
        fetch('/api/purchase-events?action=conversion-rate').then(r => r.json()),
        fetch('/api/purchase-events').then(r => r.json()),
      ]);

      setAovLift(aov);
      setRevenueByProduct(product);
      setRevenueByType(type);
      setConversionRate(conversion);
      setPurchaseEvents(events.events || []);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  return (
    <Page
      title="Purchase Analytics"
      subtitle="Track upsell conversions and revenue impact"
      primaryAction={{
        content: 'Refresh',
        icon: RefreshIcon,
        onAction: fetchAnalytics,
        loading,
      }}
    >
      <Layout>
        {/* AOV Lift Card */}
        <Layout.Section oneHalf>
          <Card>
            <Box padding="400">
              <Text variant="headingMd">📈 AOV Lift</Text>
              {aovLift ? (
                <Box paddingBlockStart="300">
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#008000' }}>
                    +{aovLift.liftPercent}%
                  </div>
                  <Text as="p">Average upsell revenue: ${aovLift.averageUpsellRevenue}</Text>
                  <Text as="p">Analyzed {aovLift.ordersAnalyzed} orders</Text>
                </Box>
              ) : (
                <Text as="p">Loading...</Text>
              )}
            </Box>
          </Card>
        </Layout.Section>

        {/* Conversion Rate Card */}
        <Layout.Section oneHalf>
          <Card>
            <Box padding="400">
              <Text variant="headingMd">🎯 Cart → Purchase Conversion</Text>
              {conversionRate ? (
                <Box paddingBlockStart="300">
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0052CC' }}>
                    {conversionRate.conversionRate}%
                  </div>
                  <Text as="p">{conversionRate.purchases} purchases from {conversionRate.cartAdds} cart adds</Text>
                </Box>
              ) : (
                <Text as="p">Loading...</Text>
              )}
            </Box>
          </Card>
        </Layout.Section>

        {/* Revenue by Offer Type */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingMd">💰 Revenue by Offer Type</Text>
              {revenueByType && revenueByType.attribution ? (
                <Box paddingBlockStart="300">
                  {revenueByType.attribution.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #eee' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Offer Type</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Purchases</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Avg Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueByType.attribution.map((row) => (
                          <tr key={row._id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px', textTransform: 'capitalize' }}>{row._id}</td>
                            <td style={{ textAlign: 'right', padding: '8px' }}>
                              ${Math.round(row.totalRevenue * 100) / 100}
                            </td>
                            <td style={{ textAlign: 'right', padding: '8px' }}>{row.purchaseCount}</td>
                            <td style={{ textAlign: 'right', padding: '8px' }}>
                              ${Math.round(row.avgPrice * 100) / 100}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Text as="p">No data yet. Place a test order to see revenue breakdown.</Text>
                  )}
                </Box>
              ) : (
                <Text as="p">Loading...</Text>
              )}
            </Box>
          </Card>
        </Layout.Section>

        {/* Top Revenue Products */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingMd">🏆 Top Revenue Products</Text>
              {revenueByProduct && revenueByProduct.attribution ? (
                <Box paddingBlockStart="300">
                  {revenueByProduct.attribution.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #eee' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Product</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Qty Sold</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Purchases</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revenueByProduct.attribution.map((row) => (
                          <tr key={row._id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px' }}>{row.productName}</td>
                            <td style={{ textAlign: 'right', padding: '8px' }}>
                              ${Math.round(row.totalRevenue * 100) / 100}
                            </td>
                            <td style={{ textAlign: 'right', padding: '8px' }}>{row.totalQuantity}</td>
                            <td style={{ textAlign: 'right', padding: '8px' }}>{row.purchaseCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Text as="p">No products purchased yet.</Text>
                  )}
                </Box>
              ) : (
                <Text as="p">Loading...</Text>
              )}
            </Box>
          </Card>
        </Layout.Section>

        {/* Recent Purchase Events */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingMd">📋 Recent Purchase Events</Text>
              {purchaseEvents.length > 0 ? (
                <Box paddingBlockStart="300">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #eee' }}>
                        <th style={{ textAlign: 'left', padding: '8px' }}>Order</th>
                        <th style={{ textAlign: 'left', padding: '8px' }}>Product</th>
                        <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                        <th style={{ textAlign: 'right', padding: '8px' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '8px' }}>Time to Purchase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseEvents.map((event) => (
                        <tr key={event._id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px' }}>
                            {event.orderId?.substring(0, 8)}...
                          </td>
                          <td style={{ padding: '8px' }}>{event.upsellProductName}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>
                            ${Math.round(event.lineTotal * 100) / 100}
                          </td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>{event.quantity}</td>
                          <td style={{ textAlign: 'right', padding: '8px' }}>
                            {event.timeToPurchase
                              ? `${Math.floor(event.timeToPurchase / 1000 / 60)} min`
                              : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              ) : (
                <Text as="p">
                  No purchase events yet. Place a test order with an upsell product to see data here.
                </Text>
              )}
            </Box>
          </Card>
        </Layout.Section>

        {/* Setup Instructions */}
        <Layout.Section>
          <Card>
            <Box padding="400">
              <Text variant="headingMd">🚀 How to Test</Text>
              <Box paddingBlockStart="300">
                <Text as="p">
                  <strong>1. Place a test order:</strong> Go to your Shopify store and add any product to cart.
                  An upsell offer will be shown (based on your product recommendations).
                </Text>
                <Text as="p">
                  <strong>2. Click the upsell offer</strong> and add it to your cart.
                </Text>
                <Text as="p">
                  <strong>3. Complete checkout</strong> with both the original product and upsell.
                </Text>
                <Text as="p">
                  <strong>4. Refresh this dashboard</strong> to see the purchase event, AOV lift, and revenue
                  attribution.
                </Text>
              </Box>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
