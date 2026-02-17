import { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getDb, collections } from "../../backend/database/mongodb.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const db = await getDb();

    // Fetch all upsell recommendations for this shop
    const recommendations = await db.collection(collections.upsellRecommendations)
      .find({ shopId: session.shop })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    // Get analytics
    const totalRecommendations = await db.collection(collections.upsellRecommendations)
      .countDocuments({ shopId: session.shop });

    const uniqueProducts = await db.collection(collections.upsellRecommendations)
      .distinct('sourceProductId', { shopId: session.shop });

    return json({
      success: true,
      recommendations: recommendations.map(rec => ({
        ...rec,
        _id: rec._id.toString()
      })),
      stats: {
        total: totalRecommendations,
        uniqueProducts: uniqueProducts.length,
        recent: recommendations.length
      }
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return json({
      success: false,
      error: error.message,
      recommendations: [],
      stats: { total: 0, uniqueProducts: 0, recent: 0 }
    });
  }
};

export default function RecommendationsPage() {
  const { recommendations, error } = useLoaderData();
  const [filter, setFilter] = useState('all');

  const filteredRecommendations = recommendations.filter(rec => {
    if (filter === 'all') return true;
    return rec.recommendationContext === filter;
  });

  const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  return (
    <s-page heading="Upsell Recommendations">
      <style>{`
        * {
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        }
      `}</style>

      {/* Recommendations List Section */}
      <s-section>
        <s-stack direction="block" gap="base">
          {/* Filter Buttons */}
          <div style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            paddingBottom: '16px',
            borderBottom: '1px solid #e3e3e3'
          }}>
            <s-button
              variant={filter === 'all' ? 'primary' : 'tertiary'}
              onClick={() => setFilter('all')}
            >
              All ({recommendations.length})
            </s-button>
            <s-button
              variant={filter === 'product_detail' ? 'primary' : 'tertiary'}
              onClick={() => setFilter('product_detail')}
            >
              Product Detail ({recommendations.filter(r => r.recommendationContext === 'product_detail').length})
            </s-button>
            <s-button
              variant={filter === 'cart' ? 'primary' : 'tertiary'}
              onClick={() => setFilter('cart')}
            >
              Cart ({recommendations.filter(r => r.recommendationContext === 'cart').length})
            </s-button>
          </div>

          {/* Error Message */}
          {error && (
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="critical"
            >
              <s-text>Error: {error}</s-text>
            </s-box>
          )}

          {/* Recommendations List */}
          {filteredRecommendations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#6d7175' }}>
              No recommendations found
            </div>
          ) : (
            <s-stack direction="block" gap="base">
              {filteredRecommendations.map((rec) => (
                <div
                  key={rec._id}
                  style={{
                    backgroundColor: '#ffffff',
                    padding: '20px',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    border: '1px solid #e1e3e5',
                    boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
                  }}
                >
                  {/* Header */}
                  <div style={{
                    marginBottom: '20px',
                    paddingBottom: '16px',
                    borderBottom: '1px solid #f1f2f3'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '8px'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '10px', color: '#202223', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px', fontFamily, fontWeight: '600' }}>
                          Customer was viewing
                        </div>
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#202223', fontFamily, lineHeight: '1.4' }}>
                          {rec.sourceProductName || `Product ID: ${rec.sourceProductId}`}
                        </div>
                      </div>
                      <s-badge tone={rec.recommendationContext === 'cart' ? 'info' : 'success'}>
                        {rec.recommendationContext === 'cart' ? 'Cart' : 'Product Detail'}
                      </s-badge>
                    </div>
                    <div style={{ fontSize: '12px', color: '#8c9196', fontFamily }}>
                      {new Date(rec.timestamp).toLocaleString()}
                    </div>
                  </div>

                  {/* Recommended Products */}
                  <div style={{ display: 'grid', gap: '12px' }}>
                    {rec.recommendations.map((product, idx) => (
                      <div
                        key={idx}
                        style={{
                          backgroundColor: '#f9fafb',
                          padding: '16px',
                          borderRadius: '6px',
                          border: '1px solid #e1e3e5'
                        }}
                      >
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                          {/* Product Image */}
                          {product.image && (
                            <div style={{ flexShrink: 0 }}>
                              <img
                                src={product.image}
                                alt={product.productName}
                                style={{
                                  width: '80px',
                                  height: '80px',
                                  objectFit: 'cover',
                                  borderRadius: '6px',
                                  display: 'block',
                                  border: '1px solid #e1e3e5'
                                }}
                              />
                            </div>
                          )}

                          {/* Product Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px', fontFamily, color: '#202223' }}>
                              {product.productName}
                            </div>

                            {product.price && (
                              <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', fontFamily, color: '#202223' }}>
                                ${parseFloat(product.price).toFixed(2)}
                              </div>
                            )}

                            {product.reason && (
                              <div style={{
                                fontSize: '13px',
                                color: '#6d7175',
                                lineHeight: '1.5',
                                fontFamily
                              }}>
                                {product.reason}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
