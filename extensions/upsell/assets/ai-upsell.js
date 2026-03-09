(function () {
  'use strict';
  var _C = window.__AI_UPSELL_CONFIG__ || {};

  // ── Fetch interceptor (must run ASAP) ──────────────────────────────────────
  if (!window.__AI_UPSELL_FETCH_HOOK__) {
    window.__AI_UPSELL_FETCH_HOOK__ = true;

    document.addEventListener('click', function (e) {
      var code = window.__AI_UPSELL_DISCOUNT_CODE__;
      if (!code) return;
      var target = e.target.closest('a[href*="/checkout"], button[name="checkout"], input[name="checkout"]');
      if (!target) return;
      if (target.tagName === 'A' && target.href) {
        var sep = target.href.includes('?') ? '&' : '?';
        target.href = target.href + sep + 'discount=' + encodeURIComponent(code);
      } else if (target.form) {
        var inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = 'discount'; inp.value = code;
        target.form.appendChild(inp);
      }
    }, true);

    var _originalFetch = window.fetch;
    window.fetch = function (url, options) {
      var result = _originalFetch.apply(this, arguments);
      if (typeof url === 'string' && url.includes('/cart/add.js') && options && options.method === 'POST') {
        result.then(function (response) {
          if (response.ok) {
            response.clone().json().then(function (data) {
              var addedProductId = data.product_id;
              if (addedProductId) {
                try { sessionStorage.setItem('lastAiUpsellProduct', addedProductId.toString()); } catch (_) {}
                if (window.__AI_UPSELL_SKIP_NEXT_CART_ADD__) {
                  window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = false;
                  return;
                }
                var _isCartPage = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
                setTimeout(function () {
                  if (_isCartPage && typeof window.__AI_UPSELL_REFRESH_SECONDARY__ === 'function') {
                    window.__AI_UPSELL_REFRESH_SECONDARY__();
                  }
                }, 500);
              }
            }).catch(function () {});
          }
        }).catch(function () {});
      }
      return result;
    };
  }

  // ── User ID helper ─────────────────────────────────────────────────────────
  function resolveUserId() {
    var uid = window.__AI_UPSELL_USER_ID__ || null;
    if (!uid) {
      if (_C.customerId) {
        uid = _C.customerId;
      } else {
        try { uid = localStorage.getItem('__ai_uid__') || null; } catch (_) {}
        if (!uid) {
          uid = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          try { localStorage.setItem('__ai_uid__', uid); } catch (_) {}
        }
      }
      window.__AI_UPSELL_USER_ID__ = uid;
    }
    return uid;
  }
  resolveUserId();

  // ── Product page time tracker ──────────────────────────────────────────────
  if (!_C.isCartPage && _C.productId && !window.__AI_TIME_TRACKER__) {
    window.__AI_TIME_TRACKER__ = true;
    (function () {
      var _productId = _C.productId;
      var _productTitle = _C.productTitle;
      var _shop = _C.shopDomain;
      var _userId = resolveUserId();
      var _totalMs = 0, _startMs = Date.now(), _active = !document.hidden, _sent = false;

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { if (_active) { _totalMs += Date.now() - _startMs; _active = false; } }
        else { _startMs = Date.now(); _active = true; }
      });

      function sendTime() {
        if (_sent) return; _sent = true;
        if (_active) _totalMs += Date.now() - _startMs;
        var seconds = Math.round(_totalMs / 1000);
        if (seconds < 1) return;
        var payload = JSON.stringify({ productId: _productId, productTitle: _productTitle, shop: _shop, timeSpentSeconds: seconds, userId: _userId });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/apps/ai-upsell/time', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/apps/ai-upsell/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        }
      }
      window.addEventListener('pagehide', sendTime);
      window.addEventListener('beforeunload', sendTime);
    })();
  }

  // ── Source product ─────────────────────────────────────────────────────────
  if (!_C.isCartPage && _C.productId) {
    window.__AI_SOURCE_PRODUCT__ = {
      id: _C.productId, title: _C.productTitle, image: _C.productImage,
      price: _C.productPrice, variantId: _C.productVariantId, url: _C.productUrl
    };
  }

  // ── Cart page time tracker ─────────────────────────────────────────────────
  if (_C.isCartPage && !window.__AI_CART_TIME_TRACKER__) {
    window.__AI_CART_TIME_TRACKER__ = true;
    (function () {
      var _shop = _C.shopDomain;
      var _userId = resolveUserId();
      var _totalMs = 0, _startMs = Date.now(), _active = !document.hidden, _sent = false;
      var _cartSnapshot = null;

      fetch('/cart.js').then(function (r) { return r.json(); }).then(function (c) { _cartSnapshot = c; }).catch(function () {});

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { if (_active) { _totalMs += Date.now() - _startMs; _active = false; } }
        else { _startMs = Date.now(); _active = true; }
      });

      function sendTime() {
        if (_sent) return; _sent = true;
        if (_active) _totalMs += Date.now() - _startMs;
        var seconds = Math.round(_totalMs / 1000);
        if (seconds < 1) return;
        var cart = _cartSnapshot || {};
        var payload = JSON.stringify({
          context: 'cart', shop: _shop, timeSpentSeconds: seconds, userId: _userId,
          customerName: _C.customerName || null,
          cartItemCount: cart.item_count || 0,
          cartTotalPrice: cart.total_price || 0,
          cartProductIds: (cart.items || []).map(function (i) { return i.product_id; })
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/apps/ai-upsell/time', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/apps/ai-upsell/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
        }
      }
      window.addEventListener('pagehide', sendTime);
      window.addEventListener('beforeunload', sendTime);
    })();
  }

  // ── Main widget logic ──────────────────────────────────────────────────────
  try {
    window.__AI_UPSELL_SCRIPT_LOADED__ = true;
    var widget = null;
    var secondaryWidget = null;

    function pickWidgets() {
      var widgets = Array.from(document.querySelectorAll('.ai-upsell-widget'));
      var secondaryWidgets = Array.from(document.querySelectorAll('.ai-secondary-widget'));
      var embedWidget = widgets.find(function (w) { return w.dataset.source === 'embed'; });
      var embedSecondary = secondaryWidgets.find(function (w) { return w.dataset.source === 'embed'; });
      if (embedWidget) { widgets.forEach(function (w) { if (w !== embedWidget) w.remove(); }); widget = embedWidget; }
      else { widget = widgets[0] || null; }
      if (embedSecondary) { secondaryWidgets.forEach(function (w) { if (w !== embedSecondary) w.remove(); }); secondaryWidget = embedSecondary; }
      else { secondaryWidget = secondaryWidgets[0] || null; }
      if (widget) window.__AI_UPSELL_WIDGET__ = widget;
      if (secondaryWidget) window.__AI_UPSELL_SECONDARY__ = secondaryWidget;
      if (!widget && window.__AI_UPSELL_WIDGET__) widget = window.__AI_UPSELL_WIDGET__;
      if (!secondaryWidget && window.__AI_UPSELL_SECONDARY__) secondaryWidget = window.__AI_UPSELL_SECONDARY__;
    }

    function insertAfter(target, node) {
      if (!target || !target.parentNode || !node) return;
      if (target.nextSibling) target.parentNode.insertBefore(node, target.nextSibling);
      else target.parentNode.appendChild(node);
    }

    function getWidgetWrapper(node) {
      if (!node) return null;
      var existing = node.closest('.ai-upsell-wrapper');
      if (existing) return existing;
      var wrapper = document.createElement('div');
      wrapper.className = 'ai-upsell-wrapper';
      if (document.querySelector('.page-width')) wrapper.classList.add('page-width');
      wrapper.appendChild(node);
      return wrapper;
    }

    function startLoadingFallback(targetWidget, loadingEl, timeoutMs) {
      if (!targetWidget) return;
      if (targetWidget.__aiUpsellLoadingTimer) clearTimeout(targetWidget.__aiUpsellLoadingTimer);
      if (loadingEl) loadingEl.style.display = 'block';
      targetWidget.__aiUpsellLoadingTimer = setTimeout(function () {
        var contentEl = targetWidget.querySelector('.ai-upsell-content, .ai-secondary-content');
        if (!contentEl || contentEl.innerHTML.trim() === '') targetWidget.style.display = 'none';
      }, timeoutMs || 6000);
    }

    function clearLoadingFallback(targetWidget) {
      if (!targetWidget || !targetWidget.__aiUpsellLoadingTimer) return;
      clearTimeout(targetWidget.__aiUpsellLoadingTimer);
      targetWidget.__aiUpsellLoadingTimer = null;
    }

    var productPlaced = false, productPlacementTimer = null, productObserver = null;

    function placeInProductPage() {
      if (!widget) return false;
      if (!window.location.pathname.includes('/products/')) return false;
      var mainProductSection =
        document.querySelector('[id^="MainProduct-"]') ||
        document.querySelector('[id*="MainProduct"]') ||
        document.querySelector('[data-section-type*="main-product"]') ||
        document.querySelector('[data-section-id*="main-product"]') ||
        document.querySelector('main-product') ||
        document.querySelector('product-info');
      if (mainProductSection) { insertAfter(mainProductSection, getWidgetWrapper(widget)); return true; }
      var productForm = document.querySelector('form[action*="/cart/add"]') || document.querySelector('product-form') || document.querySelector('.product__info-container') || document.querySelector('.product__info-wrapper');
      var sectionFromForm = productForm ? productForm.closest('section, .shopify-section') : null;
      if (sectionFromForm) { insertAfter(sectionFromForm, getWidgetWrapper(widget)); return true; }
      var knownAnchors = ['.product__info-wrapper', '.product__info-container', '.product__media-wrapper', '.product__media', 'product-info', 'product-form'];
      for (var i = 0; i < knownAnchors.length; i++) {
        var el = document.querySelector(knownAnchors[i]);
        if (el) { insertAfter(el.closest('section, .shopify-section') || el, getWidgetWrapper(widget)); return true; }
      }
      var mainEl = document.querySelector('main');
      if (mainEl) {
        var sectionWithForm = Array.from(mainEl.querySelectorAll('section, .shopify-section')).find(function (el) { return el.querySelector('form[action*="/cart/add"], product-form'); });
        if (sectionWithForm) { insertAfter(sectionWithForm, getWidgetWrapper(widget)); return true; }
      }
      if (productForm && productForm.parentNode) { insertAfter(productForm, getWidgetWrapper(widget)); return true; }
      return false;
    }

    function isPlacedInMainContent(node) {
      if (!node) return false;
      return Boolean(node.closest('#MainContent, main, .content-for-layout')) && !node.closest('footer, .footer, .site-footer');
    }

    function ensureProductPlacement() {
      pickWidgets();
      if (!window.location.pathname.includes('/products/') || !widget) return false;
      if (productPlaced && isPlacedInMainContent(widget)) return true;
      var placed = placeInProductPage();
      if (placed) { productPlaced = true; return true; }
      return isPlacedInMainContent(widget);
    }

    function startProductPlacement() {
      if (productPlacementTimer) return;
      var tries = 0;
      productPlacementTimer = setInterval(function () {
        tries += 1;
        if (ensureProductPlacement() || tries > 20) {
          clearInterval(productPlacementTimer); productPlacementTimer = null;
          if (productObserver) { productObserver.disconnect(); productObserver = null; }
        }
      }, 300);
      if (!productObserver && document.body) {
        productObserver = new MutationObserver(function () {
          if (ensureProductPlacement()) { productObserver.disconnect(); productObserver = null; }
        });
        productObserver.observe(document.body, { childList: true, subtree: true });
      }
    }

    function isInsideCartDrawer(el) {
      return el && el.closest && !!el.closest('cart-drawer');
    }

    function placeInCartPage() {
      var targetWidget = secondaryWidget || widget;
      if (!targetWidget) return;
      var mainCartItems = document.getElementById('main-cart-items');
      if (mainCartItems && mainCartItems.parentNode && !isInsideCartDrawer(mainCartItems)) { insertAfter(mainCartItems, targetWidget); return; }
      var cartRoot = document.querySelector('.cart');
      var cartItems = cartRoot && cartRoot.querySelector('.cart__items');
      if (cartRoot && cartItems && cartItems.parentNode === cartRoot && !isInsideCartDrawer(cartItems)) { insertAfter(cartItems, targetWidget); return; }
      var cartCtas = document.querySelector('.cart__ctas');
      if (cartCtas && cartCtas.parentNode && !isInsideCartDrawer(cartCtas)) { cartCtas.parentNode.insertBefore(targetWidget, cartCtas); return; }
      var checkoutButton = document.querySelector('button[name="checkout"], #checkout, .cart__checkout-button button');
      if (checkoutButton && !isInsideCartDrawer(checkoutButton)) {
        var ctaWrapper = checkoutButton.closest('.cart__ctas, .cart__checkout-button') || checkoutButton.parentElement;
        if (ctaWrapper && ctaWrapper.parentNode) { ctaWrapper.parentNode.insertBefore(targetWidget, ctaWrapper); return; }
        if (checkoutButton.parentNode) { checkoutButton.parentNode.insertBefore(targetWidget, checkoutButton); return; }
      }
      var cartFooter = document.querySelector('#main-cart-footer, .cart__footer, cart-footer');
      if (cartFooter && cartFooter.parentNode && !isInsideCartDrawer(cartFooter)) { cartFooter.parentNode.insertBefore(targetWidget, cartFooter); return; }
      // Fallback: attach to main content if theme selectors don't match
      var fallbackHost = document.querySelector('#MainContent, main, .content-for-layout') || document.body;
      if (fallbackHost && targetWidget.parentNode !== fallbackHost) {
        fallbackHost.appendChild(targetWidget);
      }
    }

    var PRODUCT_ID = _C.productId || '';
    var MAX_PRODUCTS = _C.maxProducts || 4;
    var SHOPIFY_ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ? window.Shopify.routes.root : '/';
    var secondarySourceProductId = null;
    var secondaryAllProducts = [];

    function applyAiDiscount(price, compareAtPrice, discountPercent) {
      var base = parseFloat(price);
      var pct = parseFloat(discountPercent);
      if (!isFinite(base) || base <= 0) return { price: price, compareAt: compareAtPrice, applied: false };
      if (!isFinite(pct) || pct <= 0) return { price: price, compareAt: compareAtPrice, applied: false };
      var discounted = Math.max(0, base * (1 - pct / 100));
      // Use Shopify compare-at if it's higher (shows max savings), otherwise use base price
      var existingCompare = parseFloat(compareAtPrice);
      var compareAt = (isFinite(existingCompare) && existingCompare > base)
        ? existingCompare.toFixed(2)
        : base.toFixed(2);
      return { price: discounted.toFixed(2), compareAt: compareAt, applied: true };
    }

    function formatDiscountPercent(value) {
      var num = parseFloat(value);
      if (!isFinite(num)) return '';
      return (Math.round(num * 100) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    function placeInCartDrawer() {
      var drawer = document.querySelector('cart-drawer');
      if (!drawer) return;
      if (drawer.querySelector('.ai-drawer-upsell')) return;
      var products = secondaryAllProducts.length > 0 ? secondaryAllProducts.slice(0, 2) : [];
      if (products.length === 0) return;
      var cardsHtml = products.map(function (p) {
        var vid = p.variantId || p.id;
        if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
        var img = p.image ? '<img src="' + p.image + '" alt="' + p.title + '" style="width:50px;height:50px;object-fit:cover;border-radius:6px;" />' : '';
        var offerType = p.offerType || 'addon_upsell';
        var discountPct = offerType === 'volume_discount' ? 0 : parseFloat(p.discountPercent || 0);
        var priceInfo = applyAiDiscount(p.price, p.compareAtPrice, discountPct);
        var basePrice = parseFloat(p.price || 0).toFixed(2);
        var priceHtml = priceInfo.applied
          ? '<div style="font-size:11px;color:#9ca3af;text-decoration:line-through;">$' + priceInfo.compareAt + '</div>' +
            '<div style="font-size:13px;color:#008060;font-weight:600;">$' + priceInfo.price +
            ' <span style="font-size:10px;background:#e5f6ed;color:#137c4b;border-radius:999px;padding:2px 6px;margin-left:6px;">-' + formatDiscountPercent(discountPct) + '%</span></div>'
          : '<div style="font-size:13px;color:#008060;font-weight:600;">$' + basePrice + '</div>';
        var tiersHtml = '';
        if (offerType === 'volume_discount' && Array.isArray(p.tiers) && p.tiers.length > 0) {
          tiersHtml = '<div style="font-size:11px;color:#6b7280;margin-top:2px;">' +
            p.tiers.map(function (t) {
              return 'Buy ' + t.quantity + '+ — ' + t.discountPercent + '% off';
            }).join(' · ') +
            '</div>';
        }
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;">' + img +
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + p.title + '</div>' +
          priceHtml + tiersHtml + '</div>' +
          '<button class="ai-drawer-add-btn" data-variant-id="' + vid + '" data-product-id="' + (p.id || '') + '" data-offer-type="' + offerType + '" data-discount-percent="' + discountPct + '" style="padding:6px 12px;font-size:12px;background:#008060;color:#fff;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;">Add</button></div>';
      }).join('');
      var wrapper = document.createElement('div');
      wrapper.className = 'ai-drawer-upsell';
      wrapper.innerHTML = '<div style="padding:12px 16px;"><div style="font-size:14px;font-weight:700;margin-bottom:8px;">You may also like</div>' + cardsHtml + '</div>';
      // Build a map of drawer products for volume discount lookups
      var drawerProductMap = new Map(products.map(function (p) { return [String(p.id), p]; }));
      wrapper.querySelectorAll('.ai-drawer-add-btn').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.preventDefault();
          var varId = btn.getAttribute('data-variant-id');
          var productId = btn.getAttribute('data-product-id');
          var productData = drawerProductMap.get(String(productId)) || {};
          var offerType = productData.offerType || 'addon_upsell';
          var discountPct = parseFloat(btn.getAttribute('data-discount-percent') || '0');
          // For volume discounts, calculate the correct tier based on current cart size
          var allDiscountProductIds = [productId];
          if (offerType === 'volume_discount') {
            try {
              var cartRes = await fetch('/cart.js'); var cartData = await cartRes.json();
              var cartProductIds = new Set((cartData.items || []).map(function (item) { return item.product_id; }));
              var totalItems = cartProductIds.size + (cartProductIds.has(Number(productId)) ? 0 : 1);
              discountPct = getVolumeDiscountPercent(productData, totalItems);
              // Include all cart products in the discount code so discount applies to all
              cartProductIds.forEach(function (cpid) { allDiscountProductIds.push(String(cpid)); });
            } catch (_) {}
          }
          btn.textContent = '...'; btn.disabled = true;
          try {
            var discountCode = discountPct > 0 ? await createDiscountCode(allDiscountProductIds, discountPct) : null;
            var cartPayload = { id: varId, quantity: 1 };
            if (discountPct > 0) cartPayload.properties = { 'Offer': (offerType === 'volume_discount' ? 'Volume ' : 'AI ') + Math.round(discountPct) + '% off' };
            await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cartPayload) });
            if (discountCode) {
              try { await fetch(SHOPIFY_ROOT + 'cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discount: discountCode }) }); window.__AI_UPSELL_DISCOUNT_CODE__ = discountCode; } catch (_) {}
            }
            btn.textContent = '✓'; btn.style.background = '#333';
            // Remove this product from future "You may also like" suggestions
            secondaryAllProducts = secondaryAllProducts.filter(function (p) { return String(p.id) !== String(productId); });
            // Refresh cart drawer HTML so the new item appears immediately
            try {
              var sectionsRes = await fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble,main-cart-items');
              var sections = await sectionsRes.json();
              var drawerEl = document.querySelector('cart-drawer');
              if (drawerEl && sections['cart-drawer']) {
                var tmp = document.createElement('div');
                tmp.innerHTML = sections['cart-drawer'];
                var newDrawer = tmp.querySelector('cart-drawer');
                if (newDrawer) {
                  // Replace only the items container to keep the drawer open/state intact
                  var selectors = ['cart-drawer-items', '#CartDrawer-CartItems', '.drawer__contents', '.js-contents'];
                  var replaced = false;
                  for (var s = 0; s < selectors.length; s++) {
                    var newItems = newDrawer.querySelector(selectors[s]);
                    var oldItems = drawerEl.querySelector(selectors[s]);
                    if (newItems && oldItems) { oldItems.replaceWith(newItems); replaced = true; break; }
                  }
                  // Fallback: replace whole drawer
                  if (!replaced) drawerEl.replaceWith(newDrawer);
                }
              }
              if (sections['cart-icon-bubble']) {
                var iconEl = document.getElementById('cart-icon-bubble');
                if (iconEl) { var tmp2 = document.createElement('div'); tmp2.innerHTML = sections['cart-icon-bubble']; var newIcon = tmp2.querySelector('#cart-icon-bubble'); if (newIcon) iconEl.replaceWith(newIcon); }
              }
            } catch (_) {
              // Section rendering failed — fall back to event-based refresh
              fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
                document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart } }));
                updateCartCountBubble(cart.item_count);
              }).catch(function () {});
            }
            // Re-inject upsell widget into the (possibly new) drawer
            setTimeout(function () { placeInCartDrawer(); }, 50);
            setTimeout(function () { btn.textContent = 'Add'; btn.disabled = false; btn.style.background = '#008060'; }, 2000);
          } catch (_) { btn.textContent = 'Add'; btn.disabled = false; }
        });
      });
      var footer = drawer.querySelector('.drawer__footer');
      if (footer && footer.parentNode) footer.parentNode.insertBefore(wrapper, footer);
      else { var contents = drawer.querySelector('.drawer__inner, .drawer__contents, cart-drawer-items'); if (contents) contents.appendChild(wrapper); }
    }

    function handleCartUpdated(event) {
      if (event && event.detail && event.detail.source === 'ai-upsell') return;
      var cartFromEvent = event && event.detail && event.detail.cart;
      var isCart = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
      setTimeout(function () {
        if (isCart) {
          placeInCartPage();
          refreshSecondaryFromCart(cartFromEvent);
        }
        loadDrawerUpsellsFromCart(cartFromEvent);
      }, 150);
    }

    function resolveProductId() {
      if (PRODUCT_ID && PRODUCT_ID !== '') return PRODUCT_ID;
      var fromAnalytics = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product && window.ShopifyAnalytics.meta.product.id;
      var fromMeta = window.meta && window.meta.product && window.meta.product.id;
      var fromForm = document.querySelector('product-form') && document.querySelector('product-form').dataset.productId;
      var fromData = document.querySelector('[data-product-id]') && document.querySelector('[data-product-id]').dataset.productId;
      PRODUCT_ID = fromAnalytics || fromMeta || fromForm || fromData || '';
      return PRODUCT_ID;
    }

    function uniqueSecondaryById(list) {
      var seen = new Set();
      return (Array.isArray(list) ? list : []).filter(function (product) {
        var id = product && (product.id !== undefined ? product.id : product.productId);
        if (!id) return false;
        var key = String(id);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    }

    async function filterSecondaryAgainstCart(list, cartOverride) {
      try {
        var cart = cartOverride;
        if (!cart || !cart.items) {
          var cartResponse = await fetch('/cart.js');
          if (!cartResponse.ok) return list;
          cart = await cartResponse.json();
        }
        var cartIds = new Set((cart.items || []).map(function (item) { return String(item.product_id); }));
        return list.filter(function (product) { return !cartIds.has(String(product.id)); });
      } catch (_) { return list; }
    }

    function trackViewEvents(products, opts) {
      var location = opts && opts.location;
      var sourceProductId = opts && opts.sourceProductId;
      var sourceProductName = opts && opts.sourceProductName;
      try {
        if (!Array.isArray(products) || products.length === 0 || !location) return;
        var userId = window.__AI_UPSELL_USER_ID__ || null;
        var seen = window.__AI_UPSELL_VIEWED__ || new Set();
        window.__AI_UPSELL_VIEWED__ = seen;
        products.forEach(function (p) {
          var pid = p && (p.id !== undefined ? p.id : p.productId);
          if (!pid) return;
          var key = location + ':' + String(pid);
          if (seen.has(key)) return;
          seen.add(key);
          fetch('/apps/ai-upsell/analytics/track', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventType: 'view', shopId: _C.shopDomain, sessionId: userId, userId: userId, sourceProductId: sourceProductId ? sourceProductId.toString() : null, sourceProductName: sourceProductName, upsellProductId: pid, upsellProductName: p.title || p.productTitle || null, recommendationType: p.type || p.recommendationType || null, confidence: parseFloat(p.confidence || 0), quantity: 1, metadata: { location: location } })
          }).catch(function () {});
        });
      } catch (_) {}
    }

    function normalizeSellingPlanId(raw) {
      if (!raw) return null;
      var str = String(raw), match = str.match(/\/(\d+)$/);
      return match ? match[1] : str;
    }

    function getVolumeDiscountPercent(product, quantity) {
      var qty = Number(quantity || 1), tiers = Array.isArray(product && product.tiers) ? product.tiers : [], best = 0;
      tiers.forEach(function (t) { var tq = Number(t && t.quantity || 0), td = Number(t && t.discountPercent || 0); if (qty >= tq && td > best) best = td; });
      return best;
    }

    async function createDiscountCode(productIds, discountPercent) {
      if (!productIds || productIds.length === 0 || !discountPercent || Number(discountPercent) <= 0) return null;
      try {
        var discRes = await fetch('/apps/ai-upsell/discount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productIds: productIds.filter(Boolean), discountPercent: discountPercent }) });
        if (!discRes.ok) return null;
        var discData = await discRes.json();
        return discData.code || null;
      } catch (_) { return null; }
    }

    function getOfferTypeBadge(product) {
      var type = product.offerType || 'addon_upsell';
      if (type === 'bundle') return '<div class="ai-offer-type-badge ai-offer-type-bundle">Bundle &amp; Save</div>';
      if (type === 'volume_discount') {
        var tiersHtml = '';
        if (Array.isArray(product.tiers) && product.tiers.length > 0) {
          tiersHtml = '<div class="ai-volume-tiers">' + product.tiers.map(function (t) { return '<span class="ai-volume-tier">Buy ' + t.quantity + '+ items &mdash; ' + t.discountPercent + '% off</span>'; }).join('') + '</div>';
        }
        return '<div class="ai-offer-type-badge ai-offer-type-volume">Buy More, Save More' + tiersHtml + '</div>';
      }
      if (type === 'subscription_upgrade') return '<div class="ai-offer-type-badge ai-offer-type-subscription">Subscribe &amp; Save</div>';
      return '';
    }

    function buildCartBundleCardHTML(product) {
      var vid = product.variantId || product.id;
      if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
      var hasV = Array.isArray(product.variants) && product.variants.length > 0 && !(product.variants.length === 1 && product.variants[0].title === 'Default Title');
      var first = hasV ? (product.variants.find(function (v) { return v.available; }) || product.variants[0]) : null;
      var eVid = hasV ? (first && first.id) : vid;
      var dp = hasV && first && first.price ? first.price : product.price;
      var dc = hasV && first && first.compareAtPrice ? first.compareAtPrice : product.compareAtPrice;
      var priceInfo = applyAiDiscount(dp, dc, product.discountPercent);
      dp = priceInfo.price; dc = priceInfo.compareAt;
      var discountLabel = isFinite(parseFloat(product.discountPercent)) && parseFloat(product.discountPercent) > 0 ? '<span class="ai-upsell-discount-pill">-' + formatDiscountPercent(product.discountPercent) + '%</span>' : '';
      var savingsLine = '';
      if (isFinite(parseFloat(product.discountPercent)) && parseFloat(product.discountPercent) > 0 && isFinite(parseFloat(dc))) {
        var saved = (parseFloat(dc) - parseFloat(dp)).toFixed(2);
        if (parseFloat(saved) > 0) savingsLine = '<p class="ai-cart-bundle-savings">You save $' + saved + '</p>';
      }
      var variantSelectHtml = hasV ? ('<div class="ai-variant-wrapper"><select class="ai-variant-select">' + product.variants.map(function (v) { var vInfo = applyAiDiscount(v.price, v.compareAtPrice || '', product.discountPercent); return '<option value="' + v.id + '" data-price="' + vInfo.price + '" data-compare="' + (vInfo.compareAt || '') + '"' + (!v.available ? ' disabled' : '') + (v.id === (first && first.id) ? ' selected' : '') + '>' + v.title + (!v.available ? ' - Sold out' : '') + '</option>'; }).join('') + '</select></div>') : '';
      return '<div class="ai-upsell-card" data-product-id="' + product.id + '" data-inventory-quantity="' + (product.inventoryQuantity !== undefined ? product.inventoryQuantity : 999) + '" data-inventory-policy="' + (product.inventoryPolicy || 'continue') + '"><div class="ai-offer-type-badge ai-offer-type-cart-bundle">Complete Your Look</div><a href="' + product.url + '" class="ai-upsell-link"><div class="ai-upsell-image-wrapper">' + (product.image ? '<img src="' + product.image + '" alt="' + product.title + '" class="ai-upsell-image" loading="lazy" />' : '') + '</div><div class="ai-upsell-info"><h3 class="ai-upsell-product-title">' + product.title + '</h3><p class="ai-upsell-price-block">' + (dc && parseFloat(dc) > parseFloat(dp) ? '<span class="ai-upsell-compare-price">$' + parseFloat(dc).toFixed(2) + '</span> ' : '') + '<span class="ai-upsell-price">$' + parseFloat(dp).toFixed(2) + '</span>' + discountLabel + '</p>' + savingsLine + '</div></a><div class="ai-upsell-actions">' + variantSelectHtml + '<div class="ai-upsell-quantity"><span class="ai-qty-label">Quantity</span><div class="ai-qty-controls"><button class="ai-qty-btn ai-qty-minus" aria-label="Decrease quantity">\u2212</button><input type="number" class="ai-qty-input" value="1" min="1" max="99" readonly /><button class="ai-qty-btn ai-qty-plus" aria-label="Increase quantity">+</button></div></div><button class="ai-add-to-cart-btn" data-variant-id="' + eVid + '" data-product-id="' + product.id + '" data-recommendation-type="' + (product.type || 'cart_bundle') + '" data-confidence="' + product.confidence + '" ' + (!product.availableForSale ? 'disabled' : '') + '>' + (product.availableForSale ? 'Add to Cart' : 'Out of Stock') + '</button></div></div>';
    }

    function buildBundleCardHTML(product) {
      var src = window.__AI_SOURCE_PRODUCT__ || null;
      var upsellPrice = parseFloat(product.price) || 0;
      var sourcePrice = src ? parseFloat(src.price) : 0;
      var discountPct = parseFloat(product.discountPercent) || 0;
      var discountedUpsell = discountPct > 0 ? upsellPrice * (1 - discountPct / 100) : upsellPrice;
      var bundleOriginalTotal = sourcePrice + upsellPrice;
      var bundleDiscountedTotal = sourcePrice + discountedUpsell;
      var savings = bundleOriginalTotal - bundleDiscountedTotal;
      var srcImg = src && src.image ? '<img src="' + src.image + '" alt="" class="ai-bundle-img" />' : '<div class="ai-bundle-img-placeholder"></div>';
      var upsellImg = product.image ? '<img src="' + product.image + '" alt="" class="ai-bundle-img" />' : '<div class="ai-bundle-img-placeholder"></div>';
      var upsellVid = product.variantId || product.id;
      if (typeof upsellVid === 'string' && upsellVid.includes('/')) upsellVid = upsellVid.split('/').pop();
      var savingsHtml = savings > 0 ? '<p class="ai-bundle-savings">You save $' + savings.toFixed(2) + ' (' + formatDiscountPercent(discountPct) + '% off)</p>' : '';
      var comparePriceHtml = bundleOriginalTotal > bundleDiscountedTotal ? '<span class="ai-bundle-compare">$' + bundleOriginalTotal.toFixed(2) + '</span>' : '';
      return '<div class="ai-upsell-card ai-bundle-card" data-product-id="' + product.id + '" data-inventory-quantity="' + (product.inventoryQuantity !== undefined ? product.inventoryQuantity : 999) + '" data-inventory-policy="' + (product.inventoryPolicy || 'continue') + '"><div class="ai-offer-type-badge ai-offer-type-bundle">Bundle &amp; Save</div><div class="ai-bundle-products"><div class="ai-bundle-item"><a href="' + (src ? src.url : '#') + '" class="ai-bundle-img-link">' + srcImg + '</a><p class="ai-bundle-item-title">' + (src ? src.title : 'Current Product') + '</p></div><div class="ai-bundle-plus">+</div><div class="ai-bundle-item"><a href="' + product.url + '" class="ai-bundle-img-link">' + upsellImg + '</a><p class="ai-bundle-item-title">' + product.title + '</p></div></div><div class="ai-bundle-pricing"><p class="ai-bundle-total-label">Bundle Price</p><p class="ai-bundle-price-row">' + comparePriceHtml + '<span class="ai-bundle-price">$' + bundleDiscountedTotal.toFixed(2) + '</span></p>' + savingsHtml + '</div><div class="ai-upsell-actions"><button class="ai-add-to-cart-btn" data-variant-id="' + upsellVid + '" data-product-id="' + product.id + '" data-source-variant-id="' + (src && src.variantId ? src.variantId : '') + '" data-source-product-id="' + (src && src.id ? src.id : '') + '" data-discount-percent="' + discountPct + '" data-recommendation-type="' + (product.type || 'bundle') + '" data-confidence="' + product.confidence + '"' + (!product.availableForSale ? ' disabled' : '') + '>' + (product.availableForSale ? 'Add to Cart' : 'Out of Stock') + '</button></div></div>';
    }

    function buildCardHTML(product) {
      if (product.isCartBundle) return buildCartBundleCardHTML(product);
      if (product.offerType === 'bundle') return buildBundleCardHTML(product);
      var vid = product.variantId || product.id;
      if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
      var hasV = Array.isArray(product.variants) && product.variants.length > 0 && !(product.variants.length === 1 && product.variants[0].title === 'Default Title');
      var first = hasV ? (product.variants.find(function (v) { return v.available; }) || product.variants[0]) : null;
      var eVid = hasV ? (first && first.id) : vid;
      var dp = hasV && first && first.price ? first.price : product.price;
      var dc = hasV && first && first.compareAtPrice ? first.compareAtPrice : product.compareAtPrice;
      var offerType = product.offerType || 'addon_upsell';
      var discountPct = offerType === 'volume_discount' ? getVolumeDiscountPercent(product, 1) : product.discountPercent;
      var priceInfo = applyAiDiscount(dp, dc, discountPct);
      dp = priceInfo.price; dc = priceInfo.compareAt;
      var discountLabel = offerType === 'volume_discount'
        ? '<span class="ai-upsell-discount-pill" style="display:' + (discountPct > 0 ? 'inline-flex' : 'none') + '">-' + formatDiscountPercent(discountPct) + '%</span>'
        : (isFinite(parseFloat(discountPct)) && parseFloat(discountPct) > 0 ? '<span class="ai-upsell-discount-pill">-' + formatDiscountPercent(discountPct) + '%</span>' : '');
      var volumeTiersAttr = offerType === 'volume_discount' && Array.isArray(product.tiers) ? ' data-volume-tiers="' + encodeURIComponent(JSON.stringify(product.tiers)) + '"' : '';
      var variantHtml = hasV ? '<div class="ai-variant-wrapper"><select class="ai-variant-select">' + product.variants.map(function (v) { var vInfo = applyAiDiscount(v.price, v.compareAtPrice || '', discountPct); return '<option value="' + v.id + '" data-price="' + vInfo.price + '" data-compare="' + (vInfo.compareAt || '') + '"' + (!v.available ? ' disabled' : '') + (v.id === (first && first.id) ? ' selected' : '') + '>' + v.title + (!v.available ? ' - Sold out' : '') + '</option>'; }).join('') + '</select></div>' : '';
      return '<div class="ai-upsell-card" data-product-id="' + product.id + '" data-offer-type="' + offerType + '"' + volumeTiersAttr + ' data-selling-plan-id="' + (product.sellingPlanIdNumeric || product.sellingPlanId || '') + '" data-inventory-quantity="' + (product.inventoryQuantity !== undefined ? product.inventoryQuantity : 999) + '" data-inventory-policy="' + (product.inventoryPolicy || 'continue') + '">' + getOfferTypeBadge(product) + '<a href="' + product.url + '" class="ai-upsell-link"><div class="ai-upsell-image-wrapper">' + (product.image ? '<img src="' + product.image + '" alt="' + product.title + '" class="ai-upsell-image" loading="lazy" />' : '') + '</div><div class="ai-upsell-info"><h3 class="ai-upsell-product-title">' + product.title + '</h3><p class="ai-upsell-price-block">' + (dc && parseFloat(dc) > parseFloat(dp) ? '<span class="ai-upsell-compare-price">$' + parseFloat(dc).toFixed(2) + '</span> ' : '') + '<span class="ai-upsell-price">$' + parseFloat(dp).toFixed(2) + '</span>' + discountLabel + '</p></div></a><div class="ai-upsell-actions">' + variantHtml + '<div class="ai-upsell-quantity"><span class="ai-qty-label">Quantity</span><div class="ai-qty-controls"><button class="ai-qty-btn ai-qty-minus" aria-label="Decrease quantity">\u2212</button><input type="number" class="ai-qty-input" value="1" min="1" max="99" readonly /><button class="ai-qty-btn ai-qty-plus" aria-label="Increase quantity">+</button></div></div><button class="ai-add-to-cart-btn" data-variant-id="' + eVid + '" data-product-id="' + product.id + '" data-discount-percent="' + (discountPct || 0) + '" data-recommendation-type="' + product.type + '" data-confidence="' + product.confidence + '" ' + (!product.availableForSale ? 'disabled' : '') + '>' + (product.availableForSale ? 'Add to Cart' : 'Out of Stock') + '</button></div></div>';
    }

    function updateUpsellPrice(card, qty) {
      var el = card.querySelector('span.ai-upsell-price'); if (!el) return;
      var orig = el.getAttribute('data-original-price') || el.textContent;
      var m = orig.match(/[\d,]+\.?\d*/); if (!m) return;
      var sym = (orig.match(/[^\d\s,\.]+/) || ['$'])[0];
      var base = parseFloat(m[0].replace(/,/g, ''));
      el.textContent = sym + (base * qty).toFixed(2);
      if (!el.hasAttribute('data-original-price')) el.setAttribute('data-original-price', orig);
      var cel = card.querySelector('span.ai-upsell-compare-price');
      if (cel) { var co = cel.getAttribute('data-original-price') || cel.textContent; var cm = co.match(/[\d,]+\.?\d*/); if (cm) { cel.textContent = sym + (parseFloat(cm[0].replace(/,/g, '')) * qty).toFixed(2); if (!cel.hasAttribute('data-original-price')) cel.setAttribute('data-original-price', co); } }
    }

    function attachQtyListeners(contentEl) {
      contentEl.querySelectorAll('.ai-qty-minus').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.preventDefault(); var c = btn.closest('.ai-upsell-card'), i = btn.parentElement.querySelector('.ai-qty-input'), v = parseInt(i.value); if (v > 1) { i.value = v - 1; updateUpsellPrice(c, v - 1); } });
      });
      contentEl.querySelectorAll('.ai-qty-plus').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.preventDefault(); var c = btn.closest('.ai-upsell-card'), i = btn.parentElement.querySelector('.ai-qty-input'), v = parseInt(i.value); if (c.dataset.inventoryPolicy === 'deny' && v >= parseInt(c.dataset.inventoryQuantity)) { btn.style.opacity = '0.5'; setTimeout(function () { btn.style.opacity = '1'; }, 200); return; } if (v < 99) { i.value = v + 1; updateUpsellPrice(c, v + 1); } });
      });
    }

    function attachVariantListeners(contentEl) {
      contentEl.querySelectorAll('.ai-variant-select').forEach(function (select) {
        select.addEventListener('change', function (e) {
          e.stopPropagation();
          var card = select.closest('.ai-upsell-card'), btn = card.querySelector('.ai-add-to-cart-btn'), opt = select.options[select.selectedIndex];
          btn.setAttribute('data-variant-id', select.value);
          var np = opt.dataset.price, nc = opt.dataset.compare;
          if (np) {
            var pe = card.querySelector('.ai-upsell-price');
            if (pe) { var s = (pe.textContent.match(/[^\d\s,\.]+/) || ['$'])[0]; pe.textContent = s + parseFloat(np).toFixed(2); pe.removeAttribute('data-original-price'); }
            var ce = card.querySelector('.ai-upsell-compare-price');
            if (ce) { if (nc && parseFloat(nc) > parseFloat(np)) { var s2 = (ce.textContent.match(/[^\d\s,\.]+/) || ['$'])[0]; ce.textContent = s2 + parseFloat(nc).toFixed(2); ce.style.display = ''; ce.removeAttribute('data-original-price'); } else { ce.style.display = 'none'; } }
          }
          var qi = card.querySelector('.ai-qty-input'); if (qi) qi.value = '1';
          updateUpsellPrice(card, 1);
        });
      });
    }

    function updateCartCountBubble(count) {
      try {
        document.querySelectorAll('#cart-icon-bubble').forEach(function (target) {
          var bubble = target.querySelector('.cart-count-bubble');
          if (!bubble) { bubble = document.createElement('div'); bubble.className = 'cart-count-bubble'; var vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true'); var hidden = document.createElement('span'); hidden.className = 'visually-hidden'; bubble.appendChild(vis); bubble.appendChild(hidden); target.appendChild(bubble); }
          var visEl = bubble.querySelector('[aria-hidden]') || bubble.querySelector('.cart-count-bubble__count');
          var hiddenEl = bubble.querySelector('.visually-hidden');
          if (!hiddenEl) { hiddenEl = document.createElement('span'); hiddenEl.className = 'visually-hidden'; bubble.appendChild(hiddenEl); }
          if (visEl) visEl.textContent = String(count);
          hiddenEl.textContent = count + ' ' + (count === 1 ? 'item' : 'items');
          bubble.hidden = count <= 0;
        });
      } catch (_) {}
    }

    async function fetchAiRecommendations(productId, maxProducts) {
      var userId = window.__AI_UPSELL_USER_ID__ || '';
      var apiUrl = '/apps/ai-upsell?id=gid://shopify/Product/' + productId + (userId ? '&userId=' + encodeURIComponent(userId) : '');
      var fetchPromise = window.__AI_UPSELL_PREFETCH__;
      if (fetchPromise) window.__AI_UPSELL_PREFETCH__ = null;
      else fetchPromise = fetch(apiUrl);
      var response = await fetchPromise;
      if (!response.ok) return null;
      var data = await response.json();
      if (!data.success || !data.recommendations || data.recommendations.length === 0) return null;
      return data.recommendations.slice(0, maxProducts);
    }

    async function fetchShopifyRecommendations(productId, maxProducts) {
      var response = await fetch('/recommendations/products.json?product_id=' + productId + '&limit=' + maxProducts);
      if (!response.ok) return null;
      var data = await response.json();
      var products = (data && data.products) || [];
      if (products.length === 0) return null;
      return products.map(function (p) {
        var variants = Array.isArray(p.variants) ? p.variants : [];
        var firstVariant = variants.find(function (v) { return v.available; }) || variants[0] || {};
        var priceCents = typeof p.price === 'number' ? p.price : parseInt(p.price, 10);
        var price = Number.isFinite(priceCents) ? (priceCents / 100).toFixed(2) : '0.00';
        var image = (p.featured_image && p.featured_image.url) || p.featured_image || (Array.isArray(p.images) ? p.images[0] : '');
        return { id: p.id, title: p.title, handle: p.handle, price: price, image: image, reason: 'Recommended for you', confidence: 0.5, type: 'similar', url: '/products/' + p.handle, availableForSale: firstVariant.available !== undefined ? firstVariant.available : !!p.available, variantId: firstVariant.id || null, inventoryQuantity: 999, inventoryPolicy: 'continue' };
      });
    }

    async function fetchCartRecommendations(productGids, maxProducts) {
      var cartUserId = window.__AI_UPSELL_USER_ID__ || '';
      var apiUrl = '/apps/ai-upsell/cart?ids=' + encodeURIComponent(JSON.stringify(productGids)) + (cartUserId ? '&userId=' + encodeURIComponent(cartUserId) : '');
      var fetchPromise = window.__AI_CART_PREFETCH__;
      if (fetchPromise) { window.__AI_CART_PREFETCH__ = null; } else { fetchPromise = fetch(apiUrl); }
      var response = await fetchPromise;
      if (!response.ok) return null;
      var data = await response.json();
      if (!data.success || !data.recommendations || data.recommendations.length === 0) return null;
      return data.recommendations.slice(0, maxProducts);
    }

    async function addToCartAndRefresh(variantId, quantity, cartPayload, discountCode) {
      var response = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cartPayload) });
      if (!response.ok) throw new Error('Failed to add to cart');
      if (discountCode) {
        try {
          await fetch(SHOPIFY_ROOT + 'cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discount: discountCode }) });
          window.__AI_UPSELL_DISCOUNT_CODE__ = discountCode;
        } catch (_) {}
      }
      return response;
    }

    function refreshCartUI(upsellProductId) {
      fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
        document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart, source: 'ai-upsell' } }));
        updateCartCountBubble(cart.item_count);
        fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble,main-cart-items').then(function (r) { return r.json(); }).then(function (sections) {
          if (sections['cart-drawer']) { var el = document.querySelector('cart-drawer'); if (el) { var f = document.createElement('div'); f.innerHTML = sections['cart-drawer']; var n = f.querySelector('cart-drawer'); if (n) el.replaceWith(n); } }
          if (sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
          if (sections['main-cart-items']) { var el3 = document.querySelector('cart-items'); if (el3) { var f3 = document.createElement('div'); f3.innerHTML = sections['main-cart-items']; var n3 = f3.querySelector('cart-items'); if (n3) el3.replaceWith(n3); } }
          placeInCartPage();
          refreshSecondaryFromCart(cart);
          loadDrawerUpsellsFromCart(cart);
        });
      });
    }

    function renderSecondaryList() {
      if (!secondaryWidget) return;
      var loadingEl = secondaryWidget.querySelector('.ai-secondary-loading');
      var contentEl = secondaryWidget.querySelector('.ai-secondary-content');
      var products = secondaryAllProducts.slice(0, MAX_PRODUCTS);
      var productMap = new Map(products.map(function (p) { return [String(p.id), p]; }));
      if (!products || products.length === 0) { secondaryWidget.style.display = 'none'; return; }
      secondaryWidget.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'block';
      if (contentEl) contentEl.innerHTML = '';
      var html = '<div class="ai-upsell-header"><h2 class="ai-upsell-title">Upsell Products</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + MAX_PRODUCTS + '">';
      products.forEach(function (p) { html += buildCardHTML(p); });
      html += '</div>';
      contentEl.innerHTML = html;
      if (loadingEl) loadingEl.style.display = 'none';
      attachQtyListeners(contentEl);
      attachVariantListeners(contentEl);
      placeInCartDrawer();
      trackViewEvents(products, { location: 'cart_page_secondary', sourceProductId: secondarySourceProductId ? secondarySourceProductId.toString() : null, sourceProductName: 'Secondary Recommendation' });

      contentEl.querySelectorAll('.ai-add-to-cart-btn').forEach(function (button) {
        button.addEventListener('click', async function (e) {
          e.preventDefault(); e.stopPropagation();
          var variantId = button.getAttribute('data-variant-id');
          var sourceVariantId = button.getAttribute('data-source-variant-id');
          var sourceProductId = button.getAttribute('data-source-product-id');
          var upsellProductId = button.getAttribute('data-product-id');
          var recommendationType = button.getAttribute('data-recommendation-type');
          var confidence = button.getAttribute('data-confidence');
          var originalText = button.textContent;
          var productCard = button.closest('.ai-upsell-card');
          var qtyInput = productCard.querySelector('.ai-qty-input');
          var quantity = qtyInput ? parseInt(qtyInput.value) : 1;
          var productTitle = (productCard.querySelector('.ai-upsell-product-title') || {}).textContent || 'Unknown Product';
          var productData = productMap.get(String(upsellProductId)) || {};
          var offerType = (productCard.dataset && productCard.dataset.offerType) || productData.offerType || 'addon_upsell';
          var sellingPlanId = normalizeSellingPlanId((productCard.dataset && productCard.dataset.sellingPlanId) || productData.sellingPlanIdNumeric || productData.sellingPlanId);
          var effectiveDiscount;
          if (offerType === 'volume_discount') {
            var cartRes = await fetch('/cart.js'); var cartData = await cartRes.json();
            var cartProductIds = new Set((cartData.items || []).map(function (item) { return item.product_id; }));
            effectiveDiscount = getVolumeDiscountPercent(productData, cartProductIds.size + (cartProductIds.has(Number(upsellProductId)) ? 0 : 1));
          } else { effectiveDiscount = parseFloat(productData.discountPercent) || 0; }
          try {
            button.disabled = true; button.textContent = 'Adding...';
            var discountCode = effectiveDiscount > 0 ? await createDiscountCode(sourceVariantId ? [sourceProductId, upsellProductId] : [upsellProductId], effectiveDiscount) : null;
            window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
            var bundleProps = effectiveDiscount > 0 ? { properties: { 'Offer': (offerType === 'volume_discount' ? 'Volume ' : 'Bundle ') + Math.round(effectiveDiscount) + '% off' } } : {};
            var cartPayload = sourceVariantId ? { items: [{ id: sourceVariantId, quantity: 1, ...bundleProps }, { id: variantId, quantity: quantity, ...bundleProps }] } : { id: variantId, quantity: quantity, ...bundleProps };
            if (sellingPlanId && offerType === 'subscription_upgrade' && !sourceVariantId) cartPayload.selling_plan = sellingPlanId;
            await addToCartAndRefresh(variantId, quantity, cartPayload, discountCode);
            fetch('/apps/ai-upsell/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'cart_add', shopId: _C.shopDomain, sessionId: window.__AI_UPSELL_USER_ID__ || null, userId: window.__AI_UPSELL_USER_ID__ || null, sourceProductId: secondarySourceProductId ? secondarySourceProductId.toString() : null, sourceProductName: 'Secondary Recommendation', upsellProductId: upsellProductId, upsellProductName: productTitle, variantId: variantId, recommendationType: recommendationType, confidence: parseFloat(confidence), quantity: quantity, metadata: { location: 'cart_page_secondary', offerType: offerType, discountPercent: effectiveDiscount } }) }).catch(function () {});
            refreshCartUI(upsellProductId);
            try { sessionStorage.setItem('lastAiUpsellProduct', upsellProductId); } catch (_) {}
            document.dispatchEvent(new CustomEvent('ai-upsell:product-added', { detail: { productId: upsellProductId, source: 'ai-upsell' } }));
            secondaryAllProducts = secondaryAllProducts.filter(function (p) { return String(p.id) !== String(upsellProductId); });
            renderSecondaryList();
            button.textContent = 'Added!'; button.style.background = '#008060';
            setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000);
          } catch (_) { button.textContent = 'Failed'; button.style.background = '#d72c0d'; setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000); }
        });
      });
    }

    async function loadAIUpsells(productIdOverride) {
      if (!widget || widget.__aiUpsellFetchInFlight) return;
      var loadingEl = widget.querySelector('.ai-upsell-loading');
      var contentEl = widget.querySelector('.ai-upsell-content');
      var currentProductId = productIdOverride || resolveProductId();
      if (!currentProductId) { startLoadingFallback(widget, loadingEl, 6000); return; }
      try {
        widget.__aiUpsellFetchInFlight = true;
        startLoadingFallback(widget, loadingEl, 6000);
        var products = await fetchAiRecommendations(currentProductId, MAX_PRODUCTS);
        if (!products) products = await fetchShopifyRecommendations(currentProductId, MAX_PRODUCTS);
        if (!products || products.length === 0) { clearLoadingFallback(widget); widget.__aiUpsellFetchInFlight = false; widget.style.display = 'none'; return; }
        var productMap = new Map(products.map(function (p) { return [String(p.id), p]; }));
        if (secondaryAllProducts.length === 0) secondaryAllProducts = products;
        var html = '<div class="ai-upsell-header"><h2 class="ai-upsell-title">' + (_C.heading || 'Recommended for You') + '</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + MAX_PRODUCTS + '">';
        products.forEach(function (p) { html += buildCardHTML(p); });
        html += '</div>';
        clearLoadingFallback(widget);
        widget.__aiUpsellFetched = true; widget.__aiUpsellFetchInFlight = false;
        loadingEl.style.display = 'none'; contentEl.innerHTML = html; contentEl.style.display = 'block';
        attachQtyListeners(contentEl); attachVariantListeners(contentEl);
        trackViewEvents(products, { location: 'product_detail_page', sourceProductId: PRODUCT_ID || null, sourceProductName: _C.productTitle || '' });

        contentEl.querySelectorAll('.ai-add-to-cart-btn').forEach(function (button) {
          button.addEventListener('click', async function (e) {
            e.preventDefault(); e.stopPropagation();
            var variantId = button.getAttribute('data-variant-id');
            var sourceVariantId = button.getAttribute('data-source-variant-id');
            var sourceProductId = button.getAttribute('data-source-product-id');
            var discountPercent = parseFloat(button.getAttribute('data-discount-percent') || '0');
            var upsellProductId = button.getAttribute('data-product-id');
            var recommendationType = button.getAttribute('data-recommendation-type');
            var confidence = button.getAttribute('data-confidence');
            var originalText = button.textContent;
            var productCard = button.closest('.ai-upsell-card');
            var qtyInput = productCard.querySelector('.ai-qty-input');
            var quantity = qtyInput ? parseInt(qtyInput.value) : 1;
            var productTitle = (productCard.querySelector('.ai-upsell-product-title') || {}).textContent || 'Unknown Product';
            var productData = productMap.get(String(upsellProductId)) || {};
            var offerType = (productCard.dataset && productCard.dataset.offerType) || productData.offerType || 'addon_upsell';
            var sellingPlanId = normalizeSellingPlanId((productCard.dataset && productCard.dataset.sellingPlanId) || productData.sellingPlanIdNumeric || productData.sellingPlanId);
            var effectiveDiscount;
            if (offerType === 'volume_discount') {
              var cartRes = await fetch('/cart.js'); var cartData = await cartRes.json();
              var cartProductIds = new Set((cartData.items || []).map(function (item) { return item.product_id; }));
              effectiveDiscount = getVolumeDiscountPercent(productData, cartProductIds.size + (cartProductIds.has(Number(upsellProductId)) ? 0 : 1));
            } else { effectiveDiscount = parseFloat(discountPercent) || parseFloat(productData.discountPercent) || 0; }
            try {
              button.disabled = true; button.textContent = 'Adding...';
              var discountCode = effectiveDiscount > 0 ? await createDiscountCode(sourceVariantId ? [sourceProductId, upsellProductId] : [upsellProductId], effectiveDiscount) : null;
              window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
              var bundleProps = effectiveDiscount > 0 ? { properties: { 'Offer': (offerType === 'volume_discount' ? 'Volume ' : 'Bundle ') + Math.round(effectiveDiscount) + '% off' } } : {};
              var cartPayload = sourceVariantId ? { items: [{ id: sourceVariantId, quantity: 1, ...bundleProps }, { id: variantId, quantity: quantity, ...bundleProps }] } : { id: variantId, quantity: quantity, ...bundleProps };
              if (sellingPlanId && offerType === 'subscription_upgrade' && !sourceVariantId) cartPayload.selling_plan = sellingPlanId;
              await addToCartAndRefresh(variantId, quantity, cartPayload, discountCode);
              fetch('/apps/ai-upsell/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'cart_add', shopId: _C.shopDomain, sessionId: window.__AI_UPSELL_USER_ID__ || null, userId: window.__AI_UPSELL_USER_ID__ || null, sourceProductId: PRODUCT_ID, sourceProductName: _C.productTitle || '', upsellProductId: upsellProductId, upsellProductName: productTitle, variantId: variantId, recommendationType: recommendationType, confidence: parseFloat(confidence), quantity: quantity, metadata: { location: 'product_detail_page', offerType: offerType, discountPercent: effectiveDiscount } }) }).catch(function () {});
              fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
                document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart } }));
                updateCartCountBubble(cart.item_count);
                fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble').then(function (r) { return r.json(); }).then(function (sections) {
                  if (sections['cart-drawer']) { var el = document.querySelector('cart-drawer'); if (el) { var f = document.createElement('div'); f.innerHTML = sections['cart-drawer']; var n = f.querySelector('cart-drawer'); if (n) el.replaceWith(n); } }
                  if (sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
                  setTimeout(function () { var cartIcon = document.querySelector('#cart-icon-bubble, summary[aria-controls="cart-drawer"]'); if (cartIcon) cartIcon.click(); handleCartUpdated(); }, 100);
                });
              });
              button.textContent = 'Added \u2713'; button.style.background = '#008060';
              try { sessionStorage.setItem('lastAiUpsellProduct', upsellProductId); } catch (_) {}
              document.dispatchEvent(new CustomEvent('ai-upsell:product-added', { detail: { productId: upsellProductId, source: 'ai-upsell' } }));
              setTimeout(function () { button.textContent = originalText; button.disabled = false; }, 2000);
            } catch (_) { button.textContent = 'Failed'; button.style.background = '#d72c0d'; setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000); }
          });
        });
      } catch (_) { clearLoadingFallback(widget); widget.__aiUpsellFetchInFlight = false; widget.style.display = 'none'; }
    }

    async function loadCartUpsells() {
      pickWidgets();
      if (!widget) return;
      var loadingEl = widget.querySelector('.ai-upsell-loading');
      var contentEl = widget.querySelector('.ai-upsell-content');
      try {
        startLoadingFallback(widget, loadingEl, 6000);
        var cartResponse = await fetch('/cart.js');
        if (!cartResponse.ok) throw new Error('Failed to fetch cart');
        var cart = await cartResponse.json();
        if (!cart.items || cart.items.length === 0) { clearLoadingFallback(widget); widget.style.display = 'none'; return; }
        var cartProductGids = cart.items.map(function (item) { return 'gid://shopify/Product/' + item.product_id; });
        var products = await fetchCartRecommendations(cartProductGids, MAX_PRODUCTS);
        if (!products) { var fallbackProductId = cart.items[0] && cart.items[0].product_id; if (fallbackProductId) products = await fetchShopifyRecommendations(fallbackProductId, MAX_PRODUCTS); }
        if (!products || products.length === 0) { clearLoadingFallback(widget); widget.style.display = 'none'; return; }
        var cartProductIdSet = new Set(cart.items.map(function (item) { return String(item.product_id); }));
        products = products.filter(function (p) { return !cartProductIdSet.has(String(p.id)); });
        if (products.length === 0) { clearLoadingFallback(widget); widget.style.display = 'none'; return; }
        var productMap = new Map(products.map(function (p) { return [String(p.id), p]; }));
        var sourceTitle = cart.items.map(function (item) { return item.product_title; }).join(', ') || 'Cart Items';
        var html = '<div class="ai-upsell-header"><h2 class="ai-upsell-title">' + (_C.heading || 'Recommended for You') + '</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + MAX_PRODUCTS + '">';
        products.forEach(function (p) { html += buildCardHTML(p); });
        html += '</div>';
        clearLoadingFallback(widget);
        loadingEl.style.display = 'none'; contentEl.innerHTML = html; contentEl.style.display = 'block';
        attachQtyListeners(contentEl); attachVariantListeners(contentEl);
        trackViewEvents(products, { location: 'cart_page', sourceProductId: cart.items[0] && cart.items[0].product_id || null, sourceProductName: sourceTitle });

        contentEl.querySelectorAll('.ai-add-to-cart-btn').forEach(function (button) {
          button.addEventListener('click', async function (e) {
            e.preventDefault(); e.stopPropagation();
            var variantId = button.getAttribute('data-variant-id');
            var upsellProductId = button.getAttribute('data-product-id');
            var recommendationType = button.getAttribute('data-recommendation-type');
            var confidence = button.getAttribute('data-confidence');
            var originalText = button.textContent;
            var productCard = button.closest('.ai-upsell-card');
            var qtyInput = productCard.querySelector('.ai-qty-input');
            var quantity = qtyInput ? parseInt(qtyInput.value) : 1;
            var productTitle = (productCard.querySelector('.ai-upsell-product-title') || {}).textContent || 'Unknown Product';
            var productData = productMap.get(String(upsellProductId)) || {};
            var offerType = (productCard.dataset && productCard.dataset.offerType) || productData.offerType || 'addon_upsell';
            var sellingPlanId = normalizeSellingPlanId((productCard.dataset && productCard.dataset.sellingPlanId) || productData.sellingPlanIdNumeric || productData.sellingPlanId);
            var effectiveDiscount;
            if (offerType === 'volume_discount') {
              var cartRes = await fetch('/cart.js'); var cartData = await cartRes.json();
              var cartProductIds = new Set((cartData.items || []).map(function (item) { return item.product_id; }));
              effectiveDiscount = getVolumeDiscountPercent(productData, cartProductIds.size + (cartProductIds.has(Number(upsellProductId)) ? 0 : 1));
            } else { effectiveDiscount = parseFloat(productData.discountPercent) || 0; }
            try {
              button.disabled = true; button.textContent = 'Adding...';
              var discountCode = effectiveDiscount > 0 ? await createDiscountCode([upsellProductId], effectiveDiscount) : null;
              window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
              var cartPayload = { id: variantId, quantity: quantity };
              if (sellingPlanId && offerType === 'subscription_upgrade') cartPayload.selling_plan = sellingPlanId;
              await addToCartAndRefresh(variantId, quantity, cartPayload, discountCode);
              fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
                var originalCartItems = (cart.items || []).filter(function (item) { return String(item.product_id) !== String(upsellProductId); });
                fetch('/apps/ai-upsell/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'cart_add', shopId: _C.shopDomain, sessionId: window.__AI_UPSELL_USER_ID__ || null, userId: window.__AI_UPSELL_USER_ID__ || null, sourceProductId: originalCartItems.length > 0 ? originalCartItems[0].product_id.toString() : null, sourceProductName: originalCartItems.map(function (i) { return i.product_title; }).join(', ') || 'Cart Items', upsellProductId: upsellProductId, upsellProductName: productTitle, variantId: variantId, recommendationType: recommendationType, confidence: parseFloat(confidence), quantity: quantity, metadata: { location: 'cart_page', offerType: offerType, discountPercent: effectiveDiscount } }) }).catch(function () {});
                document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart, source: 'ai-upsell' } }));
                updateCartCountBubble(cart.item_count);
                fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble,main-cart-items').then(function (r) { return r.json(); }).then(function (sections) {
                  if (sections['cart-drawer']) { var el = document.querySelector('cart-drawer'); if (el) { var f = document.createElement('div'); f.innerHTML = sections['cart-drawer']; var n = f.querySelector('cart-drawer'); if (n) el.replaceWith(n); } }
                  if (sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
                  if (sections['main-cart-items']) { var el3 = document.querySelector('cart-items'); if (el3) { var f3 = document.createElement('div'); f3.innerHTML = sections['main-cart-items']; var n3 = f3.querySelector('cart-items'); if (n3) el3.replaceWith(n3); } }
                  placeInCartPage(); refreshSecondaryFromCart(cart);
                });
              });
              button.textContent = 'Added \u2713'; button.style.background = '#008060';
              setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000);
            } catch (_) { button.textContent = 'Failed'; button.style.background = '#d72c0d'; setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000); }
          });
        });
      } catch (_) { clearLoadingFallback(widget); widget.style.display = 'none'; }
    }

    async function loadSecondaryRecommendations(productIds, cartOverride) {
      pickWidgets();
      if (!secondaryWidget || !productIds || productIds.length === 0) return;
      secondarySourceProductId = productIds[0];
      var loadingEl = secondaryWidget.querySelector('.ai-secondary-loading');
      var contentEl = secondaryWidget.querySelector('.ai-secondary-content');
      var previousProducts = secondaryAllProducts.slice();
      secondaryWidget.style.display = 'block';
      if (loadingEl) loadingEl.style.display = 'block';
      if (contentEl) contentEl.innerHTML = '';
      startLoadingFallback(secondaryWidget, loadingEl, 6000);
      try {
        var productGids = productIds.map(function (id) { return 'gid://shopify/Product/' + id; });
        var cartUid = window.__AI_UPSELL_USER_ID__ || '';
        var apiUrl = '/apps/ai-upsell/cart?ids=' + encodeURIComponent(JSON.stringify(productGids)) + (cartUid ? '&userId=' + encodeURIComponent(cartUid) : '');
        var fetchPromise = window.__AI_CART_PREFETCH__;
        if (fetchPromise) window.__AI_CART_PREFETCH__ = null; else fetchPromise = fetch(apiUrl);
        var response = await fetchPromise;
        if (!response.ok) throw new Error('Failed');
        var data = await response.json();
        var products = (data.success && data.recommendations && data.recommendations.length > 0) ? uniqueSecondaryById(data.recommendations) : [];
        products = await filterSecondaryAgainstCart(products, cartOverride);

        // If not enough products, fetch AI recommendations for each cart product to fill gaps
        if (products.length < MAX_PRODUCTS) {
          var seenIds = new Set(products.map(function (p) { return String(p.id); }));
          for (var pi = 0; pi < productIds.length && products.length < MAX_PRODUCTS; pi++) {
            var extra = await fetchAiRecommendations(productIds[pi], MAX_PRODUCTS * 2);
            if (extra && extra.length > 0) {
              extra = await filterSecondaryAgainstCart(uniqueSecondaryById(extra), cartOverride);
              extra.forEach(function (p) { if (!seenIds.has(String(p.id)) && products.length < MAX_PRODUCTS) { seenIds.add(String(p.id)); products.push(p); } });
            }
          }
        }

        // Still not enough? Use Shopify native recommendations as final fallback
        if (products.length < MAX_PRODUCTS) {
          var seenIds2 = new Set(products.map(function (p) { return String(p.id); }));
          for (var si = 0; si < productIds.length && products.length < MAX_PRODUCTS; si++) {
            var shopifyRecs = await fetchShopifyRecommendations(productIds[si], MAX_PRODUCTS * 2);
            if (shopifyRecs && shopifyRecs.length > 0) {
              shopifyRecs = await filterSecondaryAgainstCart(shopifyRecs, cartOverride);
              shopifyRecs.forEach(function (p) { if (!seenIds2.has(String(p.id)) && products.length < MAX_PRODUCTS) { seenIds2.add(String(p.id)); products.push(p); } });
            }
          }
        }

        if (!products || products.length === 0) {
          if (previousProducts && previousProducts.length > 0) { var cleanedPrev = await filterSecondaryAgainstCart(previousProducts, cartOverride); if (cleanedPrev && cleanedPrev.length > 0) { secondaryAllProducts = cleanedPrev; renderSecondaryList(); if (loadingEl) loadingEl.style.display = 'none'; return; } }
          clearLoadingFallback(secondaryWidget); secondaryWidget.style.display = 'none'; return;
        }
        secondaryAllProducts = products;
        clearLoadingFallback(secondaryWidget);
        renderSecondaryList(); placeInCartPage();
        setTimeout(function () { placeInCartDrawer(); }, 200);
      } catch (err) { console.warn('⚠️ loadSecondaryRecommendations failed:', err && err.message || err); clearLoadingFallback(secondaryWidget); secondaryWidget.style.display = 'none'; }
    }

    async function refreshSecondaryFromCart(cartOverride) {
      pickWidgets();
      if (!secondaryWidget) return;
      try {
        var cart = cartOverride;
        if (!cart || !cart.items) { var cartRes = await fetch('/cart.js'); cart = await cartRes.json(); }
        var cartProductIds = (cart && cart.items || []).map(function (item) { return item.product_id; });
        if (cartProductIds.length > 0) loadSecondaryRecommendations(cartProductIds, cart);
        else secondaryWidget.style.display = 'none';
      } catch (_) {}
    }

    window.__AI_UPSELL_REFRESH_SECONDARY__ = refreshSecondaryFromCart;

    function init() {
      pickWidgets();
      var isCartPage = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
      if (isCartPage) {
        if (widget) widget.style.display = 'none';
        placeInCartPage();
        refreshSecondaryFromCart();
      } else if (widget) {
        widget.style.display = 'block';
        startProductPlacement();
        var pid = resolveProductId();
        if (pid) { loadAIUpsells(pid); }
        else if (!window.__AI_UPSELL_PID_TIMER__) {
          window.__AI_UPSELL_PID_TIMER__ = true;
          var pidTries = 0;
          var pidInterval = setInterval(function () {
            pidTries += 1;
            var nextId = resolveProductId();
            if (nextId) { loadAIUpsells(nextId); clearInterval(pidInterval); }
            else if (pidTries > 20) clearInterval(pidInterval);
          }, 400);
        }
      }
    }

    function maybeInit() {
      pickWidgets();
      if (window.__AI_UPSELL_INIT__) return;
      window.__AI_UPSELL_INIT__ = true;
      init();
    }

    function ensureProductFetch() {
      var isCartPage = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
      if (isCartPage) return;
      pickWidgets();
      if (!widget || widget.__aiUpsellFetched || widget.__aiUpsellFetchInFlight) return;
      var pid = resolveProductId();
      if (!pid) return;
      loadAIUpsells(pid);
    }

    if (!window.__AI_UPSELL_EVENT_LISTENERS__) {
      window.__AI_UPSELL_EVENT_LISTENERS__ = true;
      document.addEventListener('ai-upsell:product-added', function (event) {
        var isCart = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
        if (!isCart || (event && event.detail && event.detail.source === 'ai-upsell')) return;
        refreshSecondaryFromCart(event && event.detail && event.detail.cart);
      });
      document.addEventListener('shopify:section:load', function () { startProductPlacement(); handleCartUpdated(); });
      document.addEventListener('cart:updated', function (event) {
        if (window.__AI_CART_BUSY__) return;
        window.__AI_CART_BUSY__ = true;
        setTimeout(function () { handleCartUpdated(event); window.__AI_CART_BUSY__ = false; }, 200);
      });
    }

    startProductPlacement();
    setTimeout(ensureProductFetch, 800);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') ensureProductFetch(); });

    var _drawerProducts = [];

    async function loadDrawerUpsellsFromCart(cartOverride) {
      var drawer = document.querySelector('cart-drawer');
      if (!drawer) return;
      // Remove existing drawer upsell so it can be re-rendered with fresh products
      var existing = drawer.querySelector('.ai-drawer-upsell');
      if (existing) existing.remove();
      try {
        var cart = cartOverride;
        if (!cart || !cart.items) { var cartRes = await fetch('/cart.js'); cart = await cartRes.json(); }
        var cartItems = cart.items || [];
        if (cartItems.length === 0) return;
        var cartProductIds = new Set(cartItems.map(function (i) { return String(i.product_id); }));
        // Fetch more than 2 to ensure we have at least 2 after filtering
        var products = await fetchAiRecommendations(cartItems[0].product_id, MAX_PRODUCTS);
        if (!products || products.length === 0) {
          products = await fetchShopifyRecommendations(cartItems[0].product_id, MAX_PRODUCTS);
        }
        if (!products || products.length === 0) return;
        products = products.filter(function (p) { return !cartProductIds.has(String(p.id)); });
        if (products.length === 0) return;
        _drawerProducts = products.slice(0, 2);
        secondaryAllProducts = _drawerProducts;
        placeInCartDrawer();
      } catch (_) {}
    }

    if (!window.__AI_DRAWER_OBSERVER__) {
      window.__AI_DRAWER_OBSERVER__ = true;
      async function loadDrawerUpsells() {
        var drawer = document.querySelector('cart-drawer');
        if (!drawer || drawer.querySelector('.ai-drawer-upsell')) return;
        try {
          var cartRes = await fetch('/cart.js'); var cart = await cartRes.json();
          var cartItems = cart.items || [];
          if (cartItems.length === 0) return;
          var cartProductIds = new Set(cartItems.map(function (i) { return String(i.product_id); }));
          var products = await fetchAiRecommendations(cartItems[0].product_id, MAX_PRODUCTS);
          if (!products || products.length === 0) {
            products = await fetchShopifyRecommendations(cartItems[0].product_id, MAX_PRODUCTS);
          }
          if (!products || products.length === 0) return;
          products = products.filter(function (p) { return !cartProductIds.has(String(p.id)); });
          if (products.length === 0) return;
          _drawerProducts = products.slice(0, 2);
          secondaryAllProducts = _drawerProducts;
          placeInCartDrawer();
        } catch (_) {}
      }
      var drawerEl = document.querySelector('cart-drawer');
      if (drawerEl) {
        var drawerObserver = new MutationObserver(function () { if (drawerEl.classList.contains('active') || drawerEl.hasAttribute('open')) loadDrawerUpsells(); });
        drawerObserver.observe(drawerEl, { attributes: true, attributeFilter: ['class', 'open'] });
      }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeInit);
    else maybeInit();
  } catch (err) {
    window.__AI_UPSELL_INIT_ERROR__ = err && err.message ? err.message : String(err);
  }
})();
