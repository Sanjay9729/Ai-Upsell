import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDb, collections } from "../../backend/database/mongodb.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const db = await getDb();

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

    // NEW: Fetch recent conversions (specifically cart_add events)
    const recentConversions = await db.collection(collections.upsellEvents)
      .find({ shopId: session.shop, isUpsellEvent: true, eventType: 'cart_add' })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray();

    // Calculate conversion rates
    const views = eventTypeStats.find(e => e._id === 'view')?.count || 0;
    const clicks = eventTypeStats.find(e => e._id === 'click')?.count || 0;
    const cartAdds = eventTypeStats.find(e => e._id === 'cart_add')?.count || 0;

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
      recentConversions: recentConversions.map(event => ({
        ...event,
        _id: event._id.toString()
      })),
      eventTypeStats
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return json({
      success: false,
      error: error.message,
      events: [],
      stats: { total: 0, recent: 0, views: 0, clicks: 0, cartAdds: 0 },
      topProducts: [],
      recentConversions: [],
      eventTypeStats: []
    });
  }
};

export default function AnalyticsPage() {
  const { recentConversions } = useLoaderData();

  return (
    <s-page heading="Upsell Activity Logs">
      <style>{`
        * {
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
      `}</style>

      {/* Recent Conversions (Cart Adds) */}
      <s-section heading="Recent Upsell Conversions">
        {recentConversions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6d7175', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px dashed #e1e3e5' }}>
            <div style={{ fontSize: '15px', fontWeight: '500', marginBottom: '4px' }}>No conversions yet</div>
            <div style={{ fontSize: '13px' }}>Upsell products to see them appear here!</div>
          </div>
        ) : (
          <div style={{
            border: '1px solid #e1e3e5',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead style={{ backgroundColor: '#f7f7f8' }}>
                <tr style={{ borderBottom: '1px solid #e1e3e5', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Upsell Product</th>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>Qty</th>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Location</th>
                  <th style={{ padding: '12px 16px', fontWeight: '600', color: '#4a4a4a', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>Date Added</th>
                </tr>
              </thead>
              <tbody style={{ backgroundColor: '#ffffff' }}>
                {recentConversions.map((conv, index) => {
                  // Determine location text
                  let locationText = 'Unknown';
                  let locationTone = 'neutral';

                  if (conv.metadata?.location === 'product_detail_page') {
                    locationText = 'Product Detail Page';
                    locationTone = '#e4e5e7'; // light gray
                  } else if (conv.metadata?.location === 'cart_page' || conv.metadata?.location === 'cart_page_secondary') {
                    locationText = 'Cart Page';
                    locationTone = '#e3f1df'; // light green
                  }

                  return (
                    <tr key={conv._id} style={{ borderBottom: index === recentConversions.length - 1 ? 'none' : '1px solid #f1f2f3' }}>
                      <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: '600', color: '#303030', fontSize: '14px' }}>
                          {conv.upsellProductName || 'Unknown Product'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: '#f1f2f4',
                          fontWeight: '600',
                          color: '#202223',
                          fontSize: '12px'
                        }}>
                          {conv.quantity}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          backgroundColor: locationTone,
                          color: '#202223',
                          fontSize: '12px',
                          fontWeight: '500',
                          border: '1px solid rgba(0,0,0,0.05)'
                        }}>
                          {locationText}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#6d7175', verticalAlign: 'middle' }}>
                        {new Date(conv.timestamp).toLocaleDateString()}
                        <div style={{ fontSize: '11px', marginTop: '2px' }}>
                          {new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>


    </s-page>
  );
}
