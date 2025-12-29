import fetch from 'node-fetch';

export function getShopifyClient(shopId, accessToken) {
  const baseUrl = `https://${shopId}/admin/api/2024-01`;
  
  const client = {
    product: {
      list: async () => {
        const response = await fetch(`${baseUrl}/products.json`, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.products || [];
      },
      
      get: async (productId) => {
        const response = await fetch(`${baseUrl}/products/${productId}.json`, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        return data.product;
      }
    }
  };
  
  return client;
}

/**
 * Fetch fresh product details from Shopify for upsell display
 * This is used when we have product IDs and need current price, image, availability
 */
export async function fetchShopifyProductDetails(shopId, accessToken, productIds) {
  const shopify = getShopifyClient(shopId, accessToken);
  const products = [];
  
  for (const productId of productIds) {
    try {
      const product = await shopify.product.get(productId);
      products.push({
        id: product.id,
        title: product.title,
        description: product.body_html,
        image: product.images?.[0]?.src || null,
        price: product.variants?.[0]?.price || '0',
        compareAtPrice: product.variants?.[0]?.compare_at_price || null,
        available: product.variants?.[0]?.available || false,
        vendor: product.vendor,
        productType: product.product_type,
        tags: product.tags,
        url: `https://${shopId}/products/${product.handle}`
      });
    } catch (error) {
      console.error(`Error fetching product ${productId}:`, error);
    }
  }
  
  return products;
}