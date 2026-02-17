/**
 * Frontend API service for communicating with backend
 * Handles product upsell recommendations and Shopify data fetching
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

class ApiService {
  /**
   * Get upsell recommendations for a product
   * @param {string} productId - Current product ID
   * @param {string} shopId - Shop domain
   * @returns {Promise<Object>} Upsell recommendations
   */
  async getUpsellRecommendations(productId, shopId) {
    try {
      const response = await fetch(`${API_BASE_URL}/products/upsell/${productId}?shopId=${encodeURIComponent(shopId)}`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching upsell recommendations:', error);
      throw error;
    }
  }

  /**
   * Get fresh product details from Shopify
   * This fetches current price, image, availability
   * @param {string} productId - Product ID to fetch
   * @param {string} shopDomain - Shop domain (e.g., mystore.myshopify.com)
   * @param {string} storefrontAccessToken - Storefront API token
   * @returns {Promise<Object>} Fresh product data from Shopify
   */
  async getShopifyProductDetails(productId, shopDomain, storefrontAccessToken) {
    try {
      const query = `
        query getProduct($id: ID!) {
          node(id: $id) {
            ... on Product {
              id
              title
              description
              handle
              vendor
              productType
              tags
              availableForSale
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
                maxVariantPrice {
                  amount
                  currencyCode
                }
              }
              compareAtPriceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
                maxVariantPrice {
                  amount
                  currencyCode
                }
              }
              images(first: 3) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    availableForSale
                    quantityAvailable
                    price {
                      amount
                      currencyCode
                    }
                    compareAtPrice {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await fetch(`https://${shopDomain}/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': storefrontAccessToken
        },
        body: JSON.stringify({
          query,
          variables: { id: `gid://shopify/Product/${productId}` }
        })
      });

      if (!response.ok) {
        throw new Error(`Shopify Storefront API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        throw new Error(`Shopify GraphQL error: ${data.errors[0].message}`);
      }

      const product = data.data.node;
      
      return {
        id: product.id,
        title: product.title,
        description: product.description,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        availableForSale: product.availableForSale,
        price: product.priceRange?.minVariantPrice?.amount || '0',
        priceCurrency: product.priceRange?.minVariantPrice?.currencyCode || 'USD',
        compareAtPrice: product.compareAtPriceRange?.minVariantPrice?.amount || null,
        compareAtCurrency: product.compareAtPriceRange?.minVariantPrice?.currencyCode || 'USD',
        images: product.images?.edges?.map(edge => ({
          id: edge.node.id,
          url: edge.node.url,
          altText: edge.node.altText
        })) || [],
        url: `https://${shopDomain}/products/${product.handle}`,
        variant: product.variants?.edges?.[0]?.node || null
      };
    } catch (error) {
      console.error('Error fetching Shopify product details:', error);
      throw error;
    }
  }

  /**
   * Get upsell products with fresh Shopify data
   * Combines backend recommendations with fresh Shopify data
   * @param {string} productId - Current product ID
   * @param {string} shopId - Shop domain
   * @param {string} storefrontAccessToken - Storefront API token
   * @returns {Promise<Array>} Upsell products with fresh Shopify data
   */
  async getUpsellProductsWithFreshData(productId, shopId, storefrontAccessToken) {
    try {
      // Get upsell recommendations from backend
      const recommendations = await this.getUpsellRecommendations(productId, shopId);
      
      if (!recommendations.upsellProductIds || recommendations.upsellProductIds.length === 0) {
        return [];
      }

      // Fetch fresh Shopify data for each upsell product
      const upsellProducts = [];
      
      for (const upsellProductId of recommendations.upsellProductIds) {
        try {
          const shopifyProduct = await this.getShopifyProductDetails(
            upsellProductId, 
            shopId, 
            storefrontAccessToken
          );
          
          // Find matching recommendation data
          const recommendationData = recommendations.recommendations.find(
            rec => rec.productId === upsellProductId
          );
          
          upsellProducts.push({
            ...shopifyProduct,
            similarityScore: recommendationData?.similarityScore || 0,
            reason: recommendationData?.reason || 'Recommended for you'
          });
        } catch (error) {
          console.error(`Error fetching upsell product ${upsellProductId}:`, error);
          // Continue with other products even if one fails
        }
      }

      return upsellProducts;
    } catch (error) {
      console.error('Error getting upsell products with fresh data:', error);
      throw error;
    }
  }

  /**
   * Track upsell product views/clicks for analytics
   * @param {string} productId - Current product ID
   * @param {string} shopId - Shop domain
   * @param {Array} upsellProductIds - Array of upsell product IDs that were shown
   * @param {Array} clickedProductIds - Array of upsell product IDs that were clicked
   */
  async trackUpsellAnalytics(productId, shopId, upsellProductIds, clickedProductIds = []) {
    try {
      // Track views for all displayed upsell products
      for (const upsellProductId of upsellProductIds) {
        await this.trackSingleEvent('view', shopId, productId, upsellProductId);
      }
      
      // Track clicks for clicked products
      for (const clickedProductId of clickedProductIds) {
        await this.trackSingleEvent('click', shopId, productId, clickedProductId);
      }
      
      console.log('✅ Upsell analytics tracked:', {
        views: upsellProductIds.length,
        clicks: clickedProductIds.length,
        sourceProductId: productId
      });
    } catch (error) {
      console.error('Error tracking upsell analytics:', error);
      // Don't throw - analytics failure shouldn't break the user experience
    }
  }

  /**
   * Track a single upsell event directly
   */
  async trackSingleEvent(eventType, shopId, sourceProductId, upsellProductId) {
    try {
      // Use the working /api/analytics/track endpoint
      const response = await fetch(`${API_BASE_URL}/analytics/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventType,
          shopId,
          sourceProductId,
          upsellProductId
        })
      });
      
      if (response.ok) {
        console.log(`✅ ${eventType} tracked: ${sourceProductId} → ${upsellProductId}`);
      } else {
        console.warn(`Analytics endpoint returned ${response.status}`);
        this.storeAnalyticsLocally(eventType, shopId, sourceProductId, upsellProductId);
      }
    } catch (error) {
      console.warn('Analytics API unavailable, storing locally:', error.message);
      this.storeAnalyticsLocally(eventType, shopId, sourceProductId, upsellProductId);
    }
  }

  /**
   * Store analytics data locally as fallback
   */
  storeAnalyticsLocally(eventType, shopId, sourceProductId, upsellProductId) {
    // Store in localStorage for manual sync later
    const key = 'upsell_analytics';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    
    existing.push({
      eventType,
      shopId,
      sourceProductId,
      upsellProductId,
      timestamp: new Date().toISOString()
    });
    
    localStorage.setItem(key, JSON.stringify(existing));
    console.log('📊 Analytics stored locally:', { eventType, sourceProductId, upsellProductId });
  }
}

export const apiService = new ApiService();