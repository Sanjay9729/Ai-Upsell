import React, { useState, useEffect } from 'react';
import { apiService } from '../services/apiService';
import UpsellProductCard from './UpsellProductCard';

const UpsellProducts = ({ 
  currentProductId, 
  shopDomain, 
  storefrontAccessToken,
  title = "You might also like",
  maxProducts = 4,
  className = ""
}) => {
  const [upsellProducts, setUpsellProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clickedProducts, setClickedProducts] = useState(new Set());

  useEffect(() => {
    if (!currentProductId || !shopDomain || !storefrontAccessToken) {
      setError('Missing required props');
      setLoading(false);
      return;
    }

    loadUpsellProducts();
  }, [currentProductId, shopDomain, storefrontAccessToken]);

  // Track views when upsell products are loaded
  useEffect(() => {
    if (upsellProducts.length > 0 && currentProductId && shopDomain) {
      // Track views for all displayed upsell products
      const upsellProductIds = upsellProducts.map(p => p.id);
      
      apiService.trackUpsellAnalytics(
        currentProductId,
        shopDomain,
        upsellProductIds, // All products that were shown
        [] // No clicks yet
      ).catch(error => {
        console.error('Error tracking upsell views:', error);
      });
    }
  }, [upsellProducts, currentProductId, shopDomain]);

  const loadUpsellProducts = async () => {
    try {
      setLoading(true);
      setError(null);

      // Step 5: Get fresh product details from Shopify (as per flow)
      const products = await apiService.getUpsellProductsWithFreshData(
        currentProductId,
        shopDomain,
        storefrontAccessToken
      );

      setUpsellProducts(products.slice(0, maxProducts));
    } catch (err) {
      console.error('Error loading upsell products:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProductClick = (productId) => {
    const newClickedProducts = new Set(clickedProducts);
    newClickedProducts.add(productId);
    setClickedProducts(newClickedProducts);

    // Track clicks (already tracked views from useEffect above)
    const upsellProductIds = upsellProducts.map(p => p.id);
    apiService.trackUpsellAnalytics(
      currentProductId,
      shopDomain,
      upsellProductIds, // All products that were shown
      [productId] // Only the clicked product
    ).catch(error => {
      console.error('Error tracking upsell clicks:', error);
    });
  };

  if (loading) {
    return (
      <div className={`upsell-products loading ${className}`}>
        <h3 className="upsell-title">{title}</h3>
        <div className="upsell-grid">
          {[...Array(maxProducts)].map((_, index) => (
            <div key={index} className="upsell-product-skeleton">
              <div className="skeleton-image"></div>
              <div className="skeleton-text"></div>
              <div className="skeleton-price"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`upsell-products error ${className}`}>
        <h3 className="upsell-title">{title}</h3>
        <div className="upsell-error">
          <p>Unable to load recommendations at this time.</p>
          <button onClick={loadUpsellProducts} className="retry-button">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (upsellProducts.length === 0) {
    return null; // Don't show anything if no products found
  }

  return (
    <div className={`upsell-products ${className}`}>
      <h3 className="upsell-title">{title}</h3>
      <div className="upsell-grid">
        {upsellProducts.map((product) => (
          <UpsellProductCard
            key={product.id}
            product={product}
            isClicked={clickedProducts.has(product.id)}
            onClick={() => handleProductClick(product.id)}
          />
        ))}
      </div>
    </div>
  );
};

export default UpsellProducts;
