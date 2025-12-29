import React, { useState, useEffect } from 'react';
import UpsellProducts from './UpsellProducts';
import './UpsellProducts.css';

const ProductDetailPage = ({ 
  productId, 
  shopDomain, 
  storefrontAccessToken 
}) => {
  const [currentProduct, setCurrentProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load current product details (this would come from your existing product data)
    loadCurrentProduct();
  }, [productId]);

  const loadCurrentProduct = async () => {
    try {
      setLoading(true);
      
      // In a real implementation, this would fetch from Shopify or your product API
      const mockProduct = {
        id: productId,
        title: "Sample Product",
        description: "This is a sample product for demonstration",
        price: "29.99",
        images: [{ url: "/placeholder-image.jpg", altText: "Product image" }]
      };
      
      setCurrentProduct(mockProduct);
    } catch (error) {
      console.error('Error loading product:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="product-detail-page loading">
        <div className="product-header-skeleton">
          <div className="skeleton-image-large"></div>
          <div className="skeleton-text-large"></div>
          <div className="skeleton-text-medium"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="product-detail-page">
      {/* Main Product Display */}
      <div className="main-product">
        <div className="product-images">
          {currentProduct.images.map((image, index) => (
            <img 
              key={index}
              src={image.url} 
              alt={image.altText || currentProduct.title}
            />
          ))}
        </div>
        
        <div className="product-info">
          <h1 className="product-title">{currentProduct.title}</h1>
          <p className="product-description">{currentProduct.description}</p>
          <div className="product-price">
            ${currentProduct.price}
          </div>
          
          <div className="product-actions">
            <button className="add-to-cart-btn">Add to Cart</button>
            <button className="buy-now-btn">Buy Now</button>
          </div>
        </div>
      </div>

      {/* Step 6: Show upsell products on the product page */}
      <UpsellProducts
        currentProductId={productId}
        shopDomain={shopDomain}
        storefrontAccessToken={storefrontAccessToken}
        title="You might also like"
        maxProducts={4}
        className="product-page-upsell"
      />
    </div>
  );
};

export default ProductDetailPage;

/**
 * USAGE EXAMPLE:
 * 
 * import ProductDetailPage from './components/ProductDetailPage';
 * 
 * function App() {
 *   return (
 *     <div className="app">
 *       <ProductDetailPage
 *         productId="123456789"
 *         shopDomain="mystore.myshopify.com"
 *         storefrontAccessToken="your_storefront_access_token"
 *       />
 *     </div>
 *   );
 * }
 * 
 * INTEGRATION STEPS:
 * 
 * 1. Get the current product ID from the URL or product context
 * 2. Pass the shop domain and storefront access token to the component
 * 3. The component will automatically:
 *    - Call backend AI engine to get upsell recommendations (Step 4)
 *    - Fetch fresh product details from Shopify (Step 5)
 *    - Display the upsell products (Step 6)
 * 
 * REQUIRED DATA:
 * - productId: Current product ID
 * - shopDomain: Shop domain (e.g., mystore.myshopify.com)
 * - storefrontAccessToken: Shopify Storefront API access token
 */