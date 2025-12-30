import React from 'react';

const UpsellProductCard = ({ product, isClicked, onClick }) => {
  const formatPrice = (price, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(price);
  };

  const handleCardClick = () => {
    if (onClick) {
      onClick();
    }

    // Open product in new tab
    window.open(product.url, '_blank');
  };

  const handleAddToCart = (e) => {
    e.stopPropagation(); // Prevent card click

    if (!product.availableForSale) return;

    // Get variant ID (assuming first variant if available)
    const variantId = product.variantId || product.id;

    // Add to cart using Shopify's cart API
    fetch('/cart/add.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: variantId,
        quantity: 1
      })
    })
    .then(response => response.json())
    .then(result => {
      // Use Shopify's publish/subscribe system to update the cart
      // This is the recommended way to update cart in Dawn theme
      fetch(`${window.Shopify.routes.root}cart.js`)
        .then(res => res.json())
        .then(cart => {
          // Publish cart update event (Dawn theme standard)
          if (window.Shopify && window.Shopify.designMode) {
            document.dispatchEvent(new CustomEvent('shopify:section:load'));
          }

          // Trigger theme-specific cart updates
          document.documentElement.dispatchEvent(
            new CustomEvent('cart:updated', {
              bubbles: true,
              detail: { cart: cart }
            })
          );

          // Force reload cart drawer sections
          fetch(`/?sections=cart-drawer,cart-icon-bubble`)
            .then(res => res.json())
            .then(sections => {
              // Update cart drawer by replacing the entire element
              if (sections['cart-drawer']) {
                const cartDrawerElement = document.querySelector('cart-drawer');
                if (cartDrawerElement) {
                  const fragment = document.createElement('div');
                  fragment.innerHTML = sections['cart-drawer'];
                  const newDrawer = fragment.querySelector('cart-drawer');

                  if (newDrawer) {
                    // Replace the entire cart drawer element
                    cartDrawerElement.replaceWith(newDrawer);
                  }
                }
              }

              // Update cart icon bubble
              if (sections['cart-icon-bubble']) {
                const cartBubble = document.getElementById('cart-icon-bubble');
                if (cartBubble) {
                  const fragment = document.createElement('div');
                  fragment.innerHTML = sections['cart-icon-bubble'];
                  const newBubble = fragment.querySelector('#cart-icon-bubble');
                  if (newBubble) {
                    cartBubble.replaceWith(newBubble);
                  }
                }
              }

              // Now open the cart drawer
              setTimeout(() => {
                const cartIcon = document.querySelector('#cart-icon-bubble, summary[aria-controls="cart-drawer"]');
                if (cartIcon) {
                  cartIcon.click();
                }
              }, 100);
            });
        });

      // Show success feedback
      alert('Product added to cart!');
    })
    .catch(error => {
      console.error('Error adding to cart:', error);
      alert('Failed to add product to cart. Please try again.');
    });
  };

  const hasDiscount = product.compareAtPrice && parseFloat(product.compareAtPrice) > parseFloat(product.price);
  const discountPercentage = hasDiscount ? 
    Math.round(((parseFloat(product.compareAtPrice) - parseFloat(product.price)) / parseFloat(product.compareAtPrice)) * 100) : 0;

  return (
    <div
      className={`upsell-product-card ${isClicked ? 'clicked' : ''}`}
      onClick={handleCardClick}
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
            className="add-to-cart-btn"
            onClick={handleAddToCart}
            disabled={!product.availableForSale}
          >
            {product.availableForSale ? 'Add to Cart' : 'Out of Stock'}
          </button>
          <button
            className="view-product-btn"
            disabled={!product.availableForSale}
          >
            View Product
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpsellProductCard;