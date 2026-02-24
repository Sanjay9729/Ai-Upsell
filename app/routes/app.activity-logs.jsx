import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDb, collections } from "../../backend/database/mongodb.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const db = await getDb();

    const recentConversions = await db.collection(collections.upsellEvents)
      .find({ shopId: session.shop, isUpsellEvent: true, eventType: 'cart_add' })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    return json({
      success: true,
      recentConversions: recentConversions.map(event => ({
        ...event,
        _id: event._id.toString()
      }))
    });
  } catch (error) {
    console.error("Error fetching activity logs:", error);
    return json({
      success: false,
      error: error.message,
      recentConversions: []
    });
  }
};

export default function ActivityLogsPage() {
  const { recentConversions } = useLoaderData();

  return (
    <s-page heading="Upsell Activity Logs">
      <style>{`
        * {
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
      `}</style>

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
                  let locationText = 'Unknown';
                  let locationTone = 'neutral';

                  if (conv.metadata?.location === 'product_detail_page') {
                    locationText = 'Product Detail Page';
                    locationTone = '#e4e5e7';
                  } else if (conv.metadata?.location === 'cart_page' || conv.metadata?.location === 'cart_page_secondary') {
                    locationText = 'Cart Page';
                    locationTone = '#e3f1df';
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
