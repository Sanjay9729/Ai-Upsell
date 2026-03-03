import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDb, collections } from "../../backend/database/mongodb.js";

function fmtTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Fetch all upsell events for this shop
    const events = await db.collection(collections.upsellEvents)
      .find({ shopId: session.shop, isUpsellEvent: true })
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    // Get analytics stats
    const totalEvents = await db.collection(collections.upsellEvents)
      .countDocuments({ shopId: session.shop, isUpsellEvent: true });

    // Event type breakdown
    const eventTypeStats = await db.collection(collections.upsellEvents)
      .aggregate([
        { $match: { shopId: session.shop, isUpsellEvent: true } },
        { $group: { _id: '$eventType', count: { $sum: 1 } } }
      ])
      .toArray();

    // Top upsell products (by cart_add events)
    const topUpsellProducts = await db.collection(collections.upsellEvents)
      .aggregate([
        { $match: { shopId: session.shop, isUpsellEvent: true, eventType: 'cart_add' } },
        {
          $group: {
            _id: '$upsellProductId',
            productName: { $first: '$upsellProductName' },
            count: { $sum: 1 },
            totalQuantity: { $sum: '$quantity' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ])
      .toArray();

    // Calculate conversion rates
    const views = eventTypeStats.find(e => e._id === 'view')?.count || 0;
    const clicks = eventTypeStats.find(e => e._id === 'click')?.count || 0;
    const cartAdds = eventTypeStats.find(e => e._id === 'cart_add')?.count || 0;

    // Top products by average time spent (last 30 days)
    const topTimeProducts = await db.collection(collections.productTimeEvents)
      .aggregate([
        { $match: { shop: session.shop, recordedAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: '$productId',
            productTitle: { $first: '$productTitle' },
            avgTimeSeconds: { $avg: '$timeSpentSeconds' },
            totalSessions: { $sum: 1 },
            totalTimeSeconds: { $sum: '$timeSpentSeconds' }
          }
        },
        { $sort: { avgTimeSeconds: -1 } },
        { $limit: 10 }
      ])
      .toArray();

    // Cart time analytics (last 30 days)
    const cartTimeStatsArr = await db.collection(collections.cartTimeEvents)
      .aggregate([
        { $match: { shop: session.shop, recordedAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: null,
            avgTimeSeconds: { $avg: '$timeSpentSeconds' },
            totalTimeSeconds: { $sum: '$timeSpentSeconds' },
            totalSessions: { $sum: 1 },
            avgItemCount: { $avg: '$cartItemCount' },
            avgCartTotalPrice: { $avg: '$cartTotalPrice' }
          }
        }
      ])
      .toArray();

    const cartTimeStats = cartTimeStatsArr[0] || {
      avgTimeSeconds: 0,
      totalTimeSeconds: 0,
      totalSessions: 0,
      avgItemCount: 0,
      avgCartTotalPrice: 0
    };

    const recentCartTime = await db.collection(collections.cartTimeEvents)
      .aggregate([
        { $match: { shop: session.shop } },
        {
          $group: {
            _id: '$userId',
            sessions: { $sum: 1 },
            totalTimeSeconds: { $sum: '$timeSpentSeconds' },
            avgTimeSeconds: { $avg: '$timeSpentSeconds' },
            avgCartTotalPrice: { $avg: '$cartTotalPrice' },
            avgCartItemCount: { $avg: '$cartItemCount' },
            customerName: { $first: '$customerName' },
            lastVisit: { $max: '$recordedAt' }
          }
        },
        { $sort: { lastVisit: -1 } },
        { $limit: 20 }
      ])
      .toArray();

    return json({
      success: true,
      events: events.map(event => ({
        ...event,
        _id: event._id.toString()
      })),
      stats: {
        total: totalEvents,
        recent: events.length,
        views,
        clicks,
        cartAdds,
        clickThroughRate: views > 0 ? ((clicks / views) * 100).toFixed(1) : 0,
        addToCartRate: clicks > 0 ? ((cartAdds / clicks) * 100).toFixed(1) : 0,
        overallConversionRate: views > 0 ? ((cartAdds / views) * 100).toFixed(1) : 0
      },
      topProducts: topUpsellProducts,
      eventTypeStats,
      topTimeProducts,
      cartTimeStats,
      recentCartTime: recentCartTime.map(row => ({
        ...row,
        _id: row._id.toString()
      }))
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return json({
      success: false,
      error: error.message,
      events: [],
      stats: { total: 0, recent: 0, views: 0, clicks: 0, cartAdds: 0 },
      topProducts: [],
      eventTypeStats: [],
      topTimeProducts: [],
      cartTimeStats: { avgTimeSeconds: 0, totalTimeSeconds: 0, totalSessions: 0, avgItemCount: 0, avgCartTotalPrice: 0 },
      recentCartTime: []
    });
  }
};

export default function AnalyticsPage() {
  const { topTimeProducts, cartTimeStats, recentCartTime } = useLoaderData();

  const formatMoney = (cents) => {
    if (cents == null || isNaN(cents)) return '—';
    const val = Number(cents) / 100;
    return `$${val.toFixed(2)}`;
  };

  return (
    <s-page heading="Upsell Analytics">
      <style>{`
        * {
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
      `}</style>

      {/* Product Page Time Spent */}
      <s-section>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#303030', marginBottom: '6px' }}>
          Product Page Analytics
        </div>
        <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '12px' }}>
          Time spent on product pages (last 30 days)
        </div>
        {topTimeProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6d7175', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px dashed #e1e3e5' }}>
            <div style={{ fontSize: '15px', fontWeight: '500', marginBottom: '4px' }}>No time data yet</div>
            <div style={{ fontSize: '13px' }}>Data will appear once customers visit product pages.</div>
          </div>
        ) : (
          <div style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead style={{ backgroundColor: '#f7f7f8' }}>
                <tr style={{ borderBottom: '1px solid #e1e3e5', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Product</th>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Sessions</th>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Avg Time</th>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Total Time</th>
                </tr>
              </thead>
              <tbody style={{ backgroundColor: '#ffffff' }}>
                {topTimeProducts.map((row, index) => (
                  <tr key={row._id} style={{ borderBottom: index === topTimeProducts.length - 1 ? 'none' : '1px solid #f1f2f3' }}>
                    <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: '600', color: '#303030', fontSize: '14px' }}>
                        {row.productTitle || `Product ${row._id}`}
                      </div>
                      <div style={{ fontSize: '11px', color: '#8c9196', marginTop: '2px' }}>ID: {row._id}</div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', backgroundColor: '#f1f2f4', fontWeight: '600', color: '#202223', fontSize: '12px' }}>
                        {row.totalSessions}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', verticalAlign: 'middle', fontWeight: '600', color: '#202223' }}>
                      {fmtTime(Math.round(row.avgTimeSeconds))}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', verticalAlign: 'middle', color: '#6d7175' }}>
                      {fmtTime(row.totalTimeSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Cart Page Time Spent */}
      <s-section>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#303030', marginTop: '14px', marginBottom: '6px' }}>
          Cart Page Analytics
        </div>
        <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '12px' }}>
          Time spent on cart pages (last 30 days)
        </div>
        {(!cartTimeStats || cartTimeStats.totalSessions === 0) ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6d7175', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px dashed #e1e3e5' }}>
            <div style={{ fontSize: '15px', fontWeight: '500', marginBottom: '4px' }}>No cart time data yet</div>
            <div style={{ fontSize: '13px' }}>Open the cart page to start collecting analytics.</div>
          </div>
        ) : (
          <div style={{
            border: '1px solid #e1e3e5',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
            backgroundColor: '#ffffff'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              padding: '16px'
            }}>
              <div style={{ padding: '12px 14px', border: '1px solid #f1f2f3', borderRadius: '8px', background: '#fafbfc' }}>
                <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '6px' }}>Avg Time</div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#202223' }}>{fmtTime(Math.round(cartTimeStats.avgTimeSeconds || 0))}</div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid #f1f2f3', borderRadius: '8px', background: '#fafbfc' }}>
                <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '6px' }}>Total Time</div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#202223' }}>{fmtTime(Math.round(cartTimeStats.totalTimeSeconds || 0))}</div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid #f1f2f3', borderRadius: '8px', background: '#fafbfc' }}>
                <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '6px' }}>Sessions</div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#202223' }}>{cartTimeStats.totalSessions || 0}</div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid #f1f2f3', borderRadius: '8px', background: '#fafbfc' }}>
                <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '6px' }}>Avg Items</div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#202223' }}>
                  {cartTimeStats.avgItemCount != null ? Math.round(cartTimeStats.avgItemCount) : '—'}
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1px solid #f1f2f3', borderRadius: '8px', background: '#fafbfc' }}>
                <div style={{ fontSize: '12px', color: '#6d7175', marginBottom: '6px' }}>Avg Cart Value</div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#202223' }}>
                  {formatMoney(cartTimeStats.avgCartTotalPrice)}
                </div>
              </div>
            </div>

            {recentCartTime && recentCartTime.length > 0 && (
              <div style={{ borderTop: '1px solid #e1e3e5' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead style={{ backgroundColor: '#f7f7f8' }}>
                    <tr style={{ borderBottom: '1px solid #e1e3e5', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>User</th>
                      <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Sessions</th>
                      <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Avg Items</th>
                      <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Avg Time</th>
                      <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Avg Cart Value</th>
                      <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Last Visit</th>
                    </tr>
                  </thead>
                  <tbody style={{ backgroundColor: '#ffffff' }}>
                    {recentCartTime.map((row, index) => {
                      const userId = row._id || '';
                      const isCustomer = userId.startsWith('customer_');
                      const customerId = isCustomer ? userId.replace('customer_', '') : null;
                      const userLabel = isCustomer
                        ? (row.customerName || `Customer #${customerId}`)
                        : userId
                          ? `Guest (${userId.slice(0, 10)}…)`
                          : 'Unknown';
                      const userSublabel = isCustomer
                        ? (row.customerName ? `Customer #${customerId}` : 'Logged in')
                        : 'Anonymous';
                      return (
                        <tr key={row._id || index} style={{ borderBottom: index === recentCartTime.length - 1 ? 'none' : '1px solid #f1f2f3' }}>
                          <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                            <div style={{ fontWeight: '600', color: '#303030', fontSize: '14px' }}>{userLabel}</div>
                            <div style={{ fontSize: '11px', color: '#8c9196', marginTop: '2px' }}>
                              {userSublabel}
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', backgroundColor: '#f1f2f4', fontWeight: '600', color: '#202223', fontSize: '12px' }}>
                              {row.sessions}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle', color: '#303030' }}>
                            {row.avgCartItemCount != null ? Math.round(row.avgCartItemCount) : '—'}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', verticalAlign: 'middle', fontWeight: '600', color: '#202223' }}>
                            {fmtTime(Math.round(row.avgTimeSeconds || 0))}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', verticalAlign: 'middle', fontWeight: '600', color: '#202223' }}>
                            {formatMoney(row.avgCartTotalPrice)}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: '#6d7175', verticalAlign: 'middle' }}>
                            {new Date(row.lastVisit).toLocaleDateString()}
                            <div style={{ fontSize: '11px', marginTop: '2px' }}>
                              {new Date(row.lastVisit).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </s-section>

    </s-page>
  );
}
