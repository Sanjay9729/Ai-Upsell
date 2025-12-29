import React from 'react';

const UpsellProductCard = ({ product, isClicked, onClick }) => {
  const formatPrice = (price, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(price);
  };

  const handleClick = () => {
    if (onClick) {
      onClick();
    }
    
    // Open product in new tab
    window.open(product.url, '_blank');
  };

  const hasDiscount = product.compareAtPrice && parseFloat(product.compareAtPrice) > parseFloat(product.price);
  const discountPercentage = hasDiscount ? 
    Math.round(((parseFloat(product.compareAtPrice) - parseFloat(product.price)) / parseFloat(product.compareAtPrice)) * 100) : 0;

  return (
    <div 
      className={`upsell-product-card ${isClicked ? 'clicked' : ''}`}
      onClick={handleClick}
    >
      <div className="upsell-product-image">
        {product.images && product.images.length > 0 ? (
          <img 
            src={product.images[0].url} 
            alt={product.images[0].altText || product.title}
            loading="lazy"
          />
        ) : (
          <div className="no-image-placeholder">
            <span>No Image</span>
          </div>
        )}
        
        {hasDiscount && (
          <div className="discount-badge">
            -{discountPercentage}%
          </div>
        )}
        
        {!product.availableForSale && (
          <div className="sold-out-overlay">
            <span>Sold Out</span>
          </div>
        )}
      </div>
      
      <div className="upsell-product-info">
        <h4 className="upsell-product-title">{product.title}</h4>
        
        {product.vendor && (
          <p className="upsell-product-vendor">{product.vendor}</p>
        )}
        
        <div className="upsell-product-reason">
          <span className="reason-badge">{product.reason}</span>
          {product.similarityScore > 0 && (
            <span className="similarity-score">
              {Math.round(product.similarityScore)}% match
            </span>
          )}
        </div>
        
        <div className="upsell-product-pricing">
          <div className="price-container">
            <span className="current-price">
              {formatPrice(product.price, product.priceCurrency)}
            </span>
            {hasDiscount && (
              <span className="compare-price">
                {formatPrice(product.compareAtPrice, product.compareAtCurrency)}
              </span>
            )}
          </div>
        </div>
        
        <div className="upsell-product-actions">
          <button 
            className="view-product-btn"
            disabled={!product.availableForSale}
          >
            {product.availableForSale ? 'View Product' : 'Out of Stock'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpsellProductCard;