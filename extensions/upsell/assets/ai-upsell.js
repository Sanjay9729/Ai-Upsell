(function () {
  'use strict';
  var _C = window.__AI_UPSELL_CONFIG__ || {};
  if (typeof window.__AI_UPSELL_GOAL__ === 'undefined') window.__AI_UPSELL_GOAL__ = null;
  if (typeof window.__AI_UPSELL_LAST_DECISION__ === 'undefined') window.__AI_UPSELL_LAST_DECISION__ = null;

  function setDecisionMeta(meta) {
    if (!meta) return;
    window.__AI_UPSELL_LAST_DECISION__ = meta;
    if (meta.goal) window.__AI_UPSELL_GOAL__ = meta.goal;
  }

  function getCurrentGoal() {
    return window.__AI_UPSELL_GOAL__ || (window.__AI_UPSELL_LAST_DECISION__ && window.__AI_UPSELL_LAST_DECISION__.goal) || null;
  }

  function isBuy2Goal(goal) {
    return goal === 'increase_aov' || goal === 'inventory_movement';
  }

  function isImmediateDiscountGoal(goal) {
    return goal === 'revenue_per_visitor' || goal === 'subscription_adoption';
  }

  function shouldUseFunctionDiscount(goal) {
    return isImmediateDiscountGoal(goal) || isBuy2Goal(goal);
  }

  function safeLoadDrawerUpsells() {
    try {
      if (typeof window.__AI_UPSELL_LOAD_DRAWER__ === 'function') {
        window.__AI_UPSELL_LOAD_DRAWER__();
      }
    } catch (_) {}
  }

  async function restoreDiscountFromCart() {
    try {
      var res = await fetch('/cart.js');
      if (!res || !res.ok) return;
      var cart = await res.json();
      var code = cart && cart.discount_code;
      if (!code && cart && cart.attributes && cart.attributes.ai_discount_code) {
        code = cart.attributes.ai_discount_code;
      }
      if (!code) {
        var apps = Array.isArray(cart && cart.cart_level_discount_applications)
          ? cart.cart_level_discount_applications
          : [];
        var match = apps.find(function (d) {
          return isAiDiscountLabel((d && (d.code || d.title)) || '');
        });
        if (match) code = match.code || match.title;
      }
      if (code && isAiDiscountLabel(code)) {
        window.__AI_UPSELL_DISCOUNT_CODE__ = code;
        try { sessionStorage.setItem('__ai_volume_target__', JSON.stringify({ code: code })); } catch (_) {}
        if (typeof syncCheckoutLinks === 'function') syncCheckoutLinks(code);
      }
    } catch (_) {}
  }

  function safeBuildDiscountRedirectUrl(code, redirectPath) {
    try {
      if (typeof buildDiscountRedirectUrl === 'function') {
        return buildDiscountRedirectUrl(code, redirectPath);
      }
    } catch (_) {}
    if (!code) return null;
    var rootPath = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ? window.Shopify.routes.root : '/';
    if (rootPath.charAt(0) !== '/') rootPath = '/' + rootPath;
    if (rootPath.charAt(rootPath.length - 1) !== '/') rootPath += '/';
    var cleanRedirect = String(redirectPath || 'cart').replace(/^\/+/, '');
    var redirect = rootPath + cleanRedirect;
    if (redirect.charAt(0) !== '/') redirect = '/' + redirect;
    return rootPath + 'discount/' + encodeURIComponent(code) + '?redirect=' + encodeURIComponent(redirect);
  }

  function buildCheckoutUrlWithDiscount(code) {
    if (!code) return null;
    var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ? window.Shopify.routes.root : '/';
    if (root.charAt(0) !== '/') root = '/' + root;
    if (root.charAt(root.length - 1) !== '/') root += '/';
    var checkout = root + 'checkout';
    var joiner = checkout.indexOf('?') === -1 ? '?' : '&';
    return checkout + joiner + 'discount=' + encodeURIComponent(code);
  }

  // ── Restore discount code across page navigations ─────────────────────────
  // window.__AI_UPSELL_DISCOUNT_CODE__ is in-memory only. Restore it from
  // sessionStorage so the checkout-button handler can append it even after
  // the user navigates from the product page to the cart page.
  try {
    var _storedVolume = sessionStorage.getItem('__ai_volume_target__');
    if (_storedVolume) {
      var _parsedVolume = JSON.parse(_storedVolume);
      if (_parsedVolume && _parsedVolume.code) {
        window.__AI_UPSELL_DISCOUNT_CODE__ = _parsedVolume.code;
        // Sync checkout links after DOM is ready so any checkout anchors get the discount URL
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { syncCheckoutLinks(_parsedVolume.code); });
        } else {
          syncCheckoutLinks(_parsedVolume.code);
        }
      }
    }
  } catch (_) {}
  if (!window.__AI_UPSELL_DISCOUNT_CODE__) {
    restoreDiscountFromCart();
  }

  var __AI_UPSELL_CART_GOAL__ = null;

  async function ensureCartGoalAttribute(goal) {
    if (!goal) return;
    if (__AI_UPSELL_CART_GOAL__ === goal) return;
    try {
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: { ai_goal: goal } })
      });
      __AI_UPSELL_CART_GOAL__ = goal;
    } catch (_) {}
  }

  function normalizeImmediateDiscount(offerType, productData, effectiveDiscount, goal) {
    if (!isImmediateDiscountGoal(goal)) return effectiveDiscount;
    var current = Number(effectiveDiscount) || 0;
    if (current > 0) return current;
    // Fallback: use configured discountPercent if present
    var pd = productData || {};
    var cfg = Number(pd.discountPercent || pd.aiDiscountPercent || 0);
    if (cfg > 0) return cfg;
    // Last resort: max tier discount
    var tiers = Array.isArray(pd.tiers) ? pd.tiers : [];
    var best = 0;
    tiers.forEach(function (t) {
      var d = Number(t && t.discountPercent || 0);
      if (d > best) best = d;
    });
    return best;
  }

  // ── Fetch interceptor (must run ASAP) ──────────────────────────────────────
  if (!window.__AI_UPSELL_FETCH_HOOK__) {
    window.__AI_UPSELL_FETCH_HOOK__ = true;

    document.addEventListener('click', function (e) {
      var code = window.__AI_UPSELL_DISCOUNT_CODE__;
      // Always refresh drawer upsells when cart drawer is opened
      var cartDrawerToggle = e.target.closest('#cart-icon-bubble, summary[aria-controls="cart-drawer"], button[aria-controls="cart-drawer"], a[href*="cart"]');
      if (cartDrawerToggle) {
        setTimeout(function () { safeLoadDrawerUpsells(); }, 120);
      }
      if (!code) {
        if (window.__AI_UPSELL_FORCE_CLEAR_DISCOUNT__) {
          var _checkoutEl = e.target.closest('a[href*="/checkout"], button[name="checkout"], input[name="checkout"]');
          if (!_checkoutEl) {
            var _submitEl = e.target.closest('button[type="submit"], input[type="submit"], button:not([type])');
            if (_submitEl) {
              var _parentForm = _submitEl.closest('form');
              if (_parentForm && (_parentForm.action || '').indexOf('/checkout') !== -1) _checkoutEl = _submitEl;
            }
          }
          if (_checkoutEl) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            window.location.href = (SHOPIFY_ROOT || '/') + 'checkout?clear_discount=1';
            return;
          }
        }
        return;
      }
      // Broad checkout button detection: named buttons, links, and submit buttons inside checkout forms
      var _checkoutEl = e.target.closest('a[href*="/checkout"], button[name="checkout"], input[name="checkout"]');
      if (!_checkoutEl) {
        var _submitEl = e.target.closest('button[type="submit"], input[type="submit"], button:not([type])');
        if (_submitEl) {
          var _parentForm = _submitEl.closest('form');
          if (_parentForm && (_parentForm.action || '').indexOf('/checkout') !== -1) _checkoutEl = _submitEl;
        }
      }
      if (_checkoutEl) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (typeof redirectToCheckoutWithDiscount === 'function') {
          redirectToCheckoutWithDiscount(code);
        } else {
          var _checkoutUrl = (window.location && window.location.pathname && window.location.pathname.indexOf('/cart') === 0)
            ? buildCheckoutUrlWithDiscount(code)
            : safeBuildDiscountRedirectUrl(code, 'checkout');
          _checkoutUrl = _checkoutUrl || (SHOPIFY_ROOT + 'checkout');
          if (_checkoutUrl) window.location.href = _checkoutUrl;
        }
        return;
      }

      var cartTarget = e.target.closest('a[href="/cart"], a[href$="/cart"], a[href*="/cart?"]');
      if (cartTarget && cartTarget.tagName === 'A' && cartTarget.href) {
        var cartUrl = safeBuildDiscountRedirectUrl(code, 'cart');
        if (cartUrl) cartTarget.href = cartUrl;
      }
    }, true);

    // Also catch checkout form submissions (e.g. cart page form[action="/checkout"])
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      var action = form.action || form.getAttribute('action') || '';
      if (action.indexOf('/checkout') === -1) return;
      var code = window.__AI_UPSELL_DISCOUNT_CODE__;
      if (!code) {
        if (window.__AI_UPSELL_FORCE_CLEAR_DISCOUNT__) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = (SHOPIFY_ROOT || '/') + 'checkout?clear_discount=1';
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof redirectToCheckoutWithDiscount === 'function') {
        redirectToCheckoutWithDiscount(code);
      } else {
        var _checkoutUrl2 = (window.location && window.location.pathname && window.location.pathname.indexOf('/cart') === 0)
          ? buildCheckoutUrlWithDiscount(code)
          : safeBuildDiscountRedirectUrl(code, 'checkout');
        _checkoutUrl2 = _checkoutUrl2 || (SHOPIFY_ROOT + 'checkout');
        if (_checkoutUrl2) window.location.href = _checkoutUrl2;
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

  // ── Early prefetch — start API call before DOM is ready to reduce latency ──
  if (!_C.isCartPage && _C.productId && !window.__AI_UPSELL_PREFETCH__) {
    var _prefetchUid = window.__AI_UPSELL_USER_ID__ || '';
    window.__AI_UPSELL_PREFETCH__ = fetch(
      '/apps/ai-upsell?id=gid://shopify/Product/' + _C.productId +
      (_prefetchUid ? '&userId=' + encodeURIComponent(_prefetchUid) : '')
    );
  }

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
      var finalMain = document.querySelector('main, #MainContent, .content-for-layout, .page-width');
      if (finalMain) { finalMain.appendChild(getWidgetWrapper(widget)); return true; }
      return true;
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
      // Avoid inserting near checkout CTA to prevent theme-specific CTA hiding issues.
      var cartFooter = document.querySelector('#main-cart-footer, .cart__footer, cart-footer');
      if (cartFooter && cartFooter.parentNode && !isInsideCartDrawer(cartFooter)) { insertAfter(cartFooter, targetWidget); return; }
      // Fallback: attach to main content if theme selectors don't match
      var fallbackHost = document.querySelector('#MainContent, main, .content-for-layout') || document.body;
      if (fallbackHost && targetWidget.parentNode !== fallbackHost) {
        fallbackHost.appendChild(targetWidget);
      }
    }

    var PRODUCT_ID = _C.productId || '';
    var MAX_PRODUCTS = _C.maxProducts || 4;
    // Cart drawer "You may also like" should always show up to 4 items, regardless of goal/settings.
    var DRAWER_MAX_PRODUCTS = 4;
    var SHOPIFY_ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ? window.Shopify.routes.root : '/';
    var secondarySourceProductId = null;
    var secondaryAllProducts = [];
    var __AI_UPSELL_DISCOUNT_SYNC__ = false;
    var __AI_UPSELL_PATCH_IN_FLIGHT__ = false;
    var __AI_UPSELL_PATCH_SUPPRESS_UNTIL__ = 0;
    // Serializes concurrent cart-add calls so Shopify never sees two writes at once.
    var _aiCartAddQueue = Promise.resolve();
    
    // Initialize bundle count from current cart on page load
    (async function initializeBundleCount() {
      try {
        var res = await fetch(SHOPIFY_ROOT + 'cart.js');
        if (res.ok) {
          var cart = await res.json();
          var bundleCount = (cart.items || []).filter(function(item) {
            return item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
          }).length;
          window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ = bundleCount;
          console.log('[AI Upsell] 🔧 Initialized bundle count:', bundleCount);
        }
      } catch (err) {
        console.error('[AI Upsell] Error initializing bundle count:', err);
      }
    })();

    function suppressCartPatchObservers(ms) {
      var until = Date.now() + Math.max(0, Number(ms || 0));
      if (until > __AI_UPSELL_PATCH_SUPPRESS_UNTIL__) {
        __AI_UPSELL_PATCH_SUPPRESS_UNTIL__ = until;
      }
    }

    function isCartPatchSuppressed() {
      return Date.now() < __AI_UPSELL_PATCH_SUPPRESS_UNTIL__;
    }

    function isCartPage() {
      return window.location.pathname === '/cart' || window.location.pathname.indexOf('/cart') === 0;
    }

    function cartItemHasAiOffer(item) {
      var props = item && item.properties;
      return !!(props && typeof props === 'object' && (props.Offer || props.offer || props._source === 'ai-bundle'));
    }

    function getElementText(el) {
      return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function rowLooksLikeAiOffer(row) {
      var text = getElementText(row);
      return /Offer:\s*(Bundle|Volume|Offer)|AIUS-|UPSELL-|ai-bundle/i.test(text);
    }

    function normalizeCartText(value) {
      return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function findCartRowFromControl(control) {
      if (!control || !control.closest) return null;
      return control.closest(
        '.cart-item, .cart-drawer-item, .drawer-cart-item, ' +
        '[id^="CartDrawer-Item-"], [id^="CartItem-"], [data-cart-item], [data-line-item]'
      );
    }

    function getLineIndexFromCartControl(control, row) {
      var candidates = [control, row];
      if (control && control.closest) {
        candidates.push(control.closest('[data-index], [line], [data-line]'));
      }
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!el || !el.getAttribute) continue;
        var raw = el.getAttribute('data-index') || el.getAttribute('line') || el.getAttribute('data-line') || '';
        var parsed = parseInt(raw, 10);
        if (isFinite(parsed) && parsed > 0) return parsed;
      }
      var id = (control && control.id) || (row && row.id) || '';
      var match = String(id).match(/(?:Remove|Item)-(\d+)/i);
      if (match) {
        var fromId = parseInt(match[1], 10);
        if (isFinite(fromId) && fromId > 0) return fromId;
      }
      return 0;
    }

    function getCartItemKeyFromControl(control) {
      if (!control || !control.getAttribute) return '';
      var direct = control.getAttribute('data-key') || control.getAttribute('data-cart-item-key') || control.getAttribute('data-line-item-key') || control.getAttribute('data-id') || control.getAttribute('data-variant-id') || '';
      if (direct) return direct;
      var href = control.getAttribute('href') || '';
      if (!href && control.querySelector) {
        var link = control.querySelector('a[href*="/cart/change"]');
        href = link ? (link.getAttribute('href') || '') : '';
      }
      if (!href) return '';
      try {
        var url = new URL(href, window.location.origin);
        return url.searchParams.get('id') || '';
      } catch (_) {
        var match = href.match(/[?&]id=([^&]+)/);
        return match ? decodeURIComponent(match[1]) : '';
      }
    }

    function findAiCartItemForRow(cart, row, control) {
      var items = cart && Array.isArray(cart.items) ? cart.items : [];
      if (!items.length) return null;

      var key = getCartItemKeyFromControl(control);
      if (key) {
        var byKey = items.find(function(cartItem) { return cartItem && (cartItem.key === key || String(cartItem.variant_id) === String(key)); });
        if (byKey && cartItemHasAiOffer(byKey)) return byKey;
      }

      var line = getLineIndexFromCartControl(control, row);
      var byLine = line > 0 ? items[line - 1] : null;
      if (byLine && cartItemHasAiOffer(byLine)) return byLine;

      var rowText = normalizeCartText(getElementText(row));
      var aiItems = items.filter(cartItemHasAiOffer);
      if (aiItems.length === 1) return aiItems[0];
      for (var i = 0; i < aiItems.length; i++) {
        var title = normalizeCartText(aiItems[i].product_title || aiItems[i].title || '');
        var variantTitle = normalizeCartText(aiItems[i].variant_title || '');
        if (title && rowText.indexOf(title) !== -1) return aiItems[i];
        if (variantTitle && variantTitle !== 'default title' && rowText.indexOf(variantTitle) !== -1) return aiItems[i];
      }
      return null;
    }

    function isDrawerVisiblyOpen(drawer) {
      if (!drawer) return false;
      return (drawer.classList && (
        drawer.classList.contains('active') ||
        drawer.classList.contains('is-open') ||
        drawer.classList.contains('animate')
      )) ||
      drawer.hasAttribute('open') ||
      drawer.getAttribute('aria-hidden') === 'false' ||
      document.body.classList.contains('overflow-hidden');
    }

    function keepDrawerOpen(drawer, cart) {
      if (!drawer) return;
      // Do NOT call drawer.open() — in Dawn theme that method calls renderContents(),
      // which fires a new sections fetch that can overwrite our correct content with
      // a stale/empty-cart cached response.
      if (drawer.classList) {
        drawer.classList.add('active');
        drawer.classList.add('animate');
        // Only remove is-empty when cart has items; when cart is empty the drawer
        // should keep is-empty so Dawn shows the "Your cart is empty" content.
        if (!cart || !('item_count' in cart) || cart.item_count > 0) {
          drawer.classList.remove('is-empty');
        }
      }
      drawer.setAttribute('aria-hidden', 'false');
      drawer.removeAttribute('inert');
      document.body.classList.add('overflow-hidden');
    }

    function replaceDrawerContentsInPlace(currentDrawer, nextDrawer) {
      if (!currentDrawer || !nextDrawer) return false;
      var narrowSelectors = [
        'cart-drawer-items',
        '#CartDrawer-CartItems',
        '.cart-drawer__items',
        '.drawer__contents .cart-items',
        '.drawer__contents [data-cart-items]',
        '[data-cart-items]'
      ];
      var replacedAny = false;
      for (var i = 0; i < narrowSelectors.length; i++) {
        var oldEl = currentDrawer.querySelector(narrowSelectors[i]);
        var newEl = nextDrawer.querySelector(narrowSelectors[i]);
        if (oldEl && newEl) {
          oldEl.replaceWith(newEl);
          replacedAny = true;
        }
      }
      return replacedAny;
    }

    function drawerHasVisibleCartRows(drawer) {
      if (!drawer || !drawer.querySelectorAll) return false;
      var rows = drawer.querySelectorAll('.cart-item, [id^="CartDrawer-Item-"], [data-cart-item], [data-line-item], .drawer-cart-item, .cart-drawer-item');
      return Array.prototype.slice.call(rows).some(function(row) {
        if (!row || !row.getBoundingClientRect) return false;
        var rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }

    function getCartDrawerInsertionPoint(drawer) {
      if (!drawer || !drawer.querySelector) return null;
      return drawer.querySelector('cart-drawer-items, #CartDrawer-CartItems, .cart-drawer__items, .drawer__contents .cart-items, .drawer__contents [data-cart-items], [data-cart-items]');
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, function(ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
      });
    }

    function buildFallbackCartItemsHtml(cart) {
      var items = cart && Array.isArray(cart.items) ? cart.items : [];
      if (!items.length) return '';
      return '<div class="ai-cart-fallback-items" data-ai-cart-fallback="true">' + items.map(function(item, index) {
        var props = item.properties && typeof item.properties === 'object' ? item.properties : {};
        var offer = props.Offer || props.offer || '';
        var image = item.image || item.featured_image && item.featured_image.url || '';
        var variant = item.variant_title && item.variant_title !== 'Default Title'
          ? '<div class="ai-cart-fallback-meta">' + escapeHtml(item.variant_title) + '</div>'
          : '';
        var offerHtml = offer ? '<div class="ai-cart-fallback-meta">Offer: ' + escapeHtml(offer) + '</div>' : '';
        return '<div class="cart-item ai-cart-fallback-row" data-cart-item data-line-item data-line="' + (index + 1) + '" data-cart-item-key="' + escapeHtml(item.key) + '">'
          + '<div class="ai-cart-fallback-media">' + (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.product_title || item.title) + '" />' : '') + '</div>'
          + '<div class="ai-cart-fallback-details">'
          + '<div class="ai-cart-fallback-title">' + escapeHtml(item.product_title || item.title) + '</div>'
          + variant + offerHtml
          + '<div class="ai-cart-fallback-qty">Qty: ' + escapeHtml(item.quantity) + '</div>'
          + '</div>'
          + '<button type="button" class="ai-cart-fallback-remove" aria-label="Remove" title="Remove" data-cart-item-key="' + escapeHtml(item.key) + '" data-line="' + (index + 1) + '">×</button>'
          + '</div>';
      }).join('') + '</div>';
    }

    function ensureDrawerShowsCartItems(cart) {
      var drawer = document.querySelector('cart-drawer');
      if (!drawer || !cart || !Array.isArray(cart.items) || cart.items.length === 0) return;
      // DOM-presence check must run before the visual check. When the drawer is closed or
      // mid-animation, getBoundingClientRect returns 0x0 for all rows, causing
      // drawerHasVisibleCartRows to return false even when proper theme HTML is present.
      // Injecting fallback HTML in that case produces a simplified item list (no prices, no
      // qty controls) that replaces the theme's correct rendering.
      var domRows = drawer.querySelectorAll(
        '.cart-item, [id^="CartDrawer-Item-"], [id^="CartItem-"], ' +
        '[data-cart-item], [data-line-item], .drawer-cart-item, .cart-drawer-item'
      );
      if (domRows.length > 0) return;
      if (drawerHasVisibleCartRows(drawer)) return;
      Array.prototype.slice.call(drawer.querySelectorAll('[data-ai-cart-fallback="true"]')).forEach(function(node) { node.remove(); });
      var html = buildFallbackCartItemsHtml(cart);
      if (!html) return;
      var target = getCartDrawerInsertionPoint(drawer);
      if (target) {
        target.innerHTML = html;
      } else {
        var footer = drawer.querySelector('.drawer__footer, .cart-drawer__footer, #CartDrawer-Footer, cart-drawer-footer, .ai-drawer-upsell');
        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        if (footer && footer.parentNode) footer.parentNode.insertBefore(wrap.firstChild, footer);
        else drawer.appendChild(wrap.firstChild);
      }
      Array.prototype.slice.call(drawer.querySelectorAll('.cart-drawer__empty-content, .drawer__inner-empty, .cart__empty-text, .cart-drawer__warnings, [data-cart-empty]')).forEach(function(el) {
        el.style.display = 'none';
      });
      keepDrawerOpen(drawer);
    }

    function safelyUpdateDrawerFromSection(sectionHtml, cart, options) {
      var drawer = document.querySelector('cart-drawer');
      if (!drawer || !sectionHtml) return false;
      var wasOpen = isDrawerVisiblyOpen(drawer);
      var frag = document.createElement('div');
      frag.innerHTML = patchCartSectionHtml(sectionHtml, cart);
      var nextDrawer = frag.querySelector('cart-drawer');
      if (!nextDrawer) return false;
      
      // Check if bundle was just cleared (no bundle items in cart but HTML might still have offer text)
      var hasBundleItems = cart && cart.items && cart.items.some(function(item) {
        return item.properties && 
               ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
      });
      
      // If no bundle items, aggressively remove all offer-related text from the HTML
      if (!hasBundleItems) {
        var allElements = nextDrawer.querySelectorAll('*');
        allElements.forEach(function(el) {
          if (el.textContent) {
            var text = el.textContent.trim();
            // Remove elements that contain only offer text
            if ((text.indexOf('Bundle') !== -1 || text.indexOf('Offer') !== -1) && 
                text.length < 100) { // Likely an offer label, not main content
              // Check if this is a property/offer label element
              if (el.className && (el.className.indexOf('property') !== -1 || 
                                   el.className.indexOf('offer') !== -1 ||
                                   el.className.indexOf('label') !== -1)) {
                el.style.display = 'none';
              }
            }
          }
        });
      }
      
      // When cart is empty, skip narrow replace and always do a full innerHTML swap.
      // replaceDrawerContentsInPlace only updates cart-drawer-items (a child element),
      // so it never adds is-empty to the parent cart-drawer — meaning Dawn's CSS keeps
      // hiding .drawer__inner-empty. Full replace also clears any inline display:none
      // we set on .drawer__inner-empty during a prior add-to-cart flow.
      var cartIsEmpty = cart && 'item_count' in cart && cart.item_count === 0;
      var replaced = !cartIsEmpty && replaceDrawerContentsInPlace(drawer, nextDrawer);
      if (!replaced && options && options.allowFullReplace) {
        // Use innerHTML instead of replaceWith to avoid re-inserting the cart-drawer
        // custom element, which would fire connectedCallback → renderContents() and
        // fetch a potentially stale cached section, overwriting the correct HTML.
        drawer.innerHTML = nextDrawer.innerHTML;
        // Carry over classes from the server-rendered element (e.g. is-empty)
        // but keep any open-state classes already on the live element.
        Array.prototype.slice.call(nextDrawer.classList).forEach(function(c) {
          if (c !== 'active' && c !== 'animate' && c !== 'is-open') drawer.classList.add(c);
        });
        // Only strip is-empty when cart has items — when empty the server-rendered
        // section includes is-empty so Dawn shows "Your cart is empty" correctly.
        if (!cart || !('item_count' in cart) || cart.item_count > 0) {
          drawer.classList.remove('is-empty');
        }
        replaced = true;
      }
      if (replaced && wasOpen) setTimeout(function () { keepDrawerOpen(document.querySelector('cart-drawer') || drawer, cart); }, 30);
      return replaced;
    }

    async function refreshDrawerAfterAiCartChange(cart, inlineSections) {
      var isCart = isCartPage();
      updateCartCountBubble(cart && cart.item_count);
      var sections = inlineSections || null;
      if (!sections) {
        var reqSections = isCart ? 'cart-drawer,cart-icon-bubble,main-cart-items' : 'cart-drawer,cart-icon-bubble';
        // Cache-bust so Shopify always returns fresh section HTML after property changes.
        var sectionsRes = await fetch(SHOPIFY_ROOT + '?sections=' + reqSections + '&_t=' + Date.now());
        if (!sectionsRes.ok) return;
        sections = await sectionsRes.json();
      }
      if (sections['cart-drawer']) {
        // CRITICAL: Check if bundle is incomplete BEFORE updating drawer
        var hasBundleItems = cart && cart.items && cart.items.some(function(item) {
          return item.properties && 
                 ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                  (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
        });
        
        var hasIncompleteBundles = false;
        if (hasBundleItems) {
          cart.items.forEach(function(item) {
            if (item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0))) {
              var bundleProductIds = item.properties._bundle_product_ids;
              if (bundleProductIds) {
                var expectedIds = bundleProductIds.split(',');
                var cartProductIds = cart.items.map(function(cartItem) { return String(cartItem.variant_id); });
                var allPresent = expectedIds.every(function(expectedId) {
                  return cartProductIds.indexOf(expectedId) !== -1;
                });
                if (!allPresent) {
                  hasIncompleteBundles = true;
                  console.log('[AI Upsell] 🛑 Incomplete bundle detected in refreshDrawerAfterAiCartChange - will skip initial price patching');
                }
              }
            }
          });
        }
        
        // Always use safelyUpdateDrawerFromSection — renderContents() relies on Dawn's
        // internal section ID format which may not match the 'cart-drawer' key returned
        // by Shopify's sections API, causing it to silently fail and leave stale content
        // (Bundle offer labels, discount prices) visible until the next page refresh.
        safelyUpdateDrawerFromSection(sections['cart-drawer'], cart, { allowFullReplace: true, skipPricePatching: hasIncompleteBundles });
      }
      if (sections['cart-icon-bubble']) {
        var bubble = document.getElementById('cart-icon-bubble');
        if (bubble) {
          var bubbleFrag = document.createElement('div');
          bubbleFrag.innerHTML = sections['cart-icon-bubble'];
          var nextBubble = bubbleFrag.querySelector('#cart-icon-bubble');
          if (nextBubble) {
            bubble.replaceWith(nextBubble);
            updateCartCountBubble(cart && cart.item_count);
          }
        }
      }
      if (isCart && sections['main-cart-items']) {
        var el3 = document.querySelector('cart-items');
        if (el3) {
          var f3 = document.createElement('div');
          f3.innerHTML = patchCartSectionHtml(sections['main-cart-items'], cart);
          var n3 = f3.querySelector('cart-items');
          if (n3) el3.replaceWith(n3);
        }
      }
      if (isCart) {
        restoreCartFooterVisibility();
        setTimeout(function () {
          updateLineItemDiscountedPrices(cart);
          restoreCartFooterVisibility();
          document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart, source: 'ai-upsell' } }));
        }, 100);
        placeInCartPage(); refreshSecondaryFromCart(cart);
      }
      
      // Check if bundle was just broken (bundle count decreased)
      var currentBundleCount = (cart && cart.items || []).filter(function(item) {
        return item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
      }).length;
      var prevBundleCount = window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ || 0;
      var bundleBroke = currentBundleCount > 0 && prevBundleCount > 0 && currentBundleCount < prevBundleCount;
      
      // Only apply price patches if bundle didn't just break
      if (!bundleBroke) {
        updateLineItemDiscountedPrices(cart);
      } else {
        console.log('[AI Upsell] 🔴 Bundle broke - skipping price patch, will clear properties');
      }
      
      ensureDrawerShowsCartItems(cart);
      // After any render path, if cart is empty ensure is-empty is on cart-drawer
      // and drawer__inner-empty is visible (renderContents may not always set it
      // reliably when called from our context).
      if (cart && cart.item_count === 0) {
        var d = document.querySelector('cart-drawer');
        if (d) {
          d.classList.remove('ai-has-upsell');
          d.classList.add('is-empty');
          var emp = d.querySelector('.drawer__inner-empty, .cart-drawer__empty-content');
          if (emp) emp.style.display = '';
        }
      }
    }

    async function removeAiCartLineByControl(control) {
      var row = findCartRowFromControl(control);
      if (!row || !rowLooksLikeAiOffer(row)) return false;
      var cartRes = await fetch(SHOPIFY_ROOT + 'cart.js');
      if (!cartRes.ok) return false;
      var cart = await cartRes.json();
      var item = findAiCartItemForRow(cart, row, control);
      if (!item || !cartItemHasAiOffer(item)) return false;
      var isCart = isCartPage();
      var reqSections = isCart ? 'cart-drawer,cart-icon-bubble,main-cart-items' : 'cart-drawer,cart-icon-bubble';
      var sectionsPayload = { sections: reqSections };
      var changeRes = await fetch(SHOPIFY_ROOT + 'cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.key, quantity: 0, ...sectionsPayload })
      });
      if (!changeRes.ok) {
        var err = await changeRes.text().catch(function() { return ''; });
        console.warn('[AI Upsell] AI cart remove by key failed, retrying by line:', changeRes.status, err);
        var line = cart.items.indexOf(item) + 1;
        if (line <= 0) return false;
        changeRes = await fetch(SHOPIFY_ROOT + 'cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ line: line, quantity: 0, ...sectionsPayload })
        });
        if (!changeRes.ok) {
          var lineErr = await changeRes.text().catch(function() { return ''; });
          console.error('[AI Upsell] AI cart remove failed:', changeRes.status, lineErr);
          return false;
        }
      }
      var updatedCart = await changeRes.json();
      var inlineSections = updatedCart.sections || null;
      if (inlineSections) delete updatedCart.sections;
      
      var bundleWasIncomplete = cartHasIncompleteBundle(updatedCart);

      if (bundleWasIncomplete) {
        console.log('[AI Upsell] 🔴 Bundle became incomplete during remove - clearing properties and discount');
        bundleWasIncomplete = true;
        window.__AI_UPSELL_SKIP_PRICE_PATCH__ = true;
        
        // Clear properties via API calls
        await maybeClearInvalidBundleProperties(updatedCart, true);
        
        // CRITICAL: Wait longer for server to process property changes and propagate to cart.js
        // The API calls complete, but the cart state may not be immediately updated
        // We need to poll until the Offer properties are actually cleared
        var maxRetries = 10;
        var retryCount = 0;
        var cartHasOldOffers = true;
        
        while (cartHasOldOffers && retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 200));
          retryCount++;
          
          try {
            var checkRes = await fetch(SHOPIFY_ROOT + 'cart.js?t=' + Date.now());
            if (checkRes.ok) {
              var checkCart = await checkRes.json();
              var stillHasOffers = checkCart.items.some(function(item) {
                return item.properties && 
                       ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                        (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
              });
              
              if (!stillHasOffers) {
                console.log('[AI Upsell] ✅ Bundle offers cleared on server after', retryCount, 'retries');
                updatedCart = checkCart;
                cartHasOldOffers = false;
              } else {
                console.log('[AI Upsell] ⏳ Bundle offers still present, retrying... (attempt', retryCount, ')');
              }
            }
          } catch (err) {
            console.error('[AI Upsell] ❌ Error checking cart state:', err);
          }
        }
        
        if (cartHasOldOffers) {
          console.warn('[AI Upsell] ⚠️ Bundle offers still present after max retries, proceeding anyway');
        }
        
        window.__AI_UPSELL_SKIP_PRICE_PATCH__ = false;
        
        // CRITICAL: Do NOT use inline sections when bundle was incomplete
        // The inline sections contain old prices with discounts
        // Force a fresh fetch of sections instead
        inlineSections = null;
        console.log('[AI Upsell] 🛑 Discarding inline sections - forcing fresh fetch due to bundle clearing');
      }
      
      // Now refresh drawer with the correct cart state
      await refreshDrawerAfterAiCartChange(updatedCart, inlineSections);
      return true;
    }

    function restoreCartFooterVisibility() {
      if (!isCartPage()) return;
      try {
        var footer = document.getElementById('main-cart-footer') || document.querySelector('cart-footer, .cart__footer');
        if (footer) {
          if (footer.style && footer.style.display === 'none') footer.style.display = '';
          if (footer.style && footer.style.visibility === 'hidden') footer.style.visibility = '';
          if (footer.hasAttribute && footer.hasAttribute('hidden')) footer.removeAttribute('hidden');
          if (footer.classList) {
            footer.classList.remove('loading', 'is-loading', 'cart-footer--loading');
          }
          var targets = footer.querySelectorAll('.js-contents, .cart__blocks, .cart__ctas, .totals, .totals__wrapper, [data-cart-footer]');
          Array.prototype.slice.call(targets).forEach(function (el) {
            if (!el) return;
            if (el.style && el.style.display === 'none') el.style.display = '';
            if (el.style && el.style.visibility === 'hidden') el.style.visibility = '';
            if (el.hasAttribute && el.hasAttribute('hidden')) el.removeAttribute('hidden');
            if (el.classList) {
              el.classList.remove('loading', 'is-loading', 'cart-footer--loading', 'cart-items--loading');
            }
            if (el.getAttribute && el.getAttribute('data-ai-hidden-cart-discount') === 'true') {
              el.removeAttribute('data-ai-hidden-cart-discount');
            }
          });
        }
        Array.prototype.slice.call(document.querySelectorAll('[data-ai-hidden-cart-discount="true"]')).forEach(function (el) {
          if (!el.closest || !el.closest('cart-drawer')) {
            el.style.display = '';
            el.removeAttribute('data-ai-hidden-cart-discount');
          }
        });
      } catch (_) {}
    }

    function isAiManagedMutationNode(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.matches && node.matches('[data-ai-discounted-node="true"], [data-ai-hidden-detail-price="true"], [data-ai-hidden-offer="true"]')) return true;
      return !!(node.querySelector && node.querySelector('[data-ai-discounted-node="true"], [data-ai-hidden-detail-price="true"], [data-ai-hidden-offer="true"]'));
    }

    function normalizeRootPath(path) {
      var value = String(path || '/');
      if (value.charAt(0) !== '/') value = '/' + value;
      if (value.charAt(value.length - 1) !== '/') value += '/';
      return value;
    }

    function buildDiscountRedirectUrl(code, redirectPath) {
      if (!code) return null;
      var rootPath = normalizeRootPath(SHOPIFY_ROOT);
      var cleanRedirect = String(redirectPath || 'cart').replace(/^\/+/, '');
      var redirect = rootPath + cleanRedirect;
      if (redirect.charAt(0) !== '/') redirect = '/' + redirect;
      return rootPath + 'discount/' + encodeURIComponent(code) + '?redirect=' + encodeURIComponent(redirect);
    }

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms || 0); });
    }

    async function waitForCartDiscount(code, attempts) {
      var tries = typeof attempts === 'number' ? attempts : 8;
      for (var i = 0; i < tries; i++) {
        try {
          var r = await fetch(SHOPIFY_ROOT + 'cart.js');
          if (r && r.ok) {
            var cart = await r.json();
            if (cart && (cart.discount_code === code || (cart.cart_level_discount_applications || []).some(function (d) { return isAiDiscountLabel((d && (d.title || d.code)) || ''); }))) {
              return true;
            }
          }
        } catch (_) {}
        await sleep(150);
      }
      return false;
    }

    // Ensure discount is applied before navigating to checkout.
    function redirectToCheckoutWithDiscount(code) {
      if (!code) return;
      var navigated = false;
      var fallbackUrl = safeBuildDiscountRedirectUrl(code, 'checkout') || (SHOPIFY_ROOT + 'checkout');
      var fallbackTimer = setTimeout(function () {
        if (navigated || !fallbackUrl) return;
        navigated = true;
        window.location.href = fallbackUrl;
      }, 1200);
      (async function () {
        try {
          await applyDiscountCodeToCart(code, 'checkout');
          await waitForCartDiscount(code, 8);
        } catch (_) {}
        if (navigated) return;
        navigated = true;
        clearTimeout(fallbackTimer);
        var checkoutUrl = safeBuildDiscountRedirectUrl(code, 'checkout') || (SHOPIFY_ROOT + 'checkout');
        if (checkoutUrl) window.location.href = checkoutUrl;
      })();
    }

    // Update all checkout anchor links on the page to go through the discount redirect URL.
    // Called proactively whenever a discount code is set so the user reaches checkout
    // with the discount applied regardless of which button or link they click.
    function syncCheckoutLinks(code) {
      if (!code) return;
      try {
        var checkoutUrl = safeBuildDiscountRedirectUrl(code, 'checkout');
        if (!checkoutUrl) return;
        document.querySelectorAll('a[href*="/checkout"]').forEach(function (el) {
          el.setAttribute('href', checkoutUrl);
        });
      } catch (_) {}
    }

    function cartHasAiOfferItems(cart) {
      if (!cart || !Array.isArray(cart.items)) return false;
      return cart.items.some(function (item) {
        var props = item && item.properties;
        return !!(props && typeof props === 'object' && (props.Offer || props.offer));
      });
    }

    function cartHasNativeDiscount(cart) {
      if (!cart) return false;
      if (Number(cart.total_discount || 0) > 0) return true;
      var cartDiscounts = Array.isArray(cart.cart_level_discount_applications) ? cart.cart_level_discount_applications : [];
      if (cartDiscounts.length > 0) return true;
      var items = Array.isArray(cart.items) ? cart.items : [];
      return items.some(function (item) {
        return Array.isArray(item && item.line_level_discount_allocations) && item.line_level_discount_allocations.length > 0;
      });
    }

    function isAiDiscountLabel(value) {
      var text = String(value || '').trim().toUpperCase();
      return text.indexOf('AIUS-') === 0 || text.indexOf('UPSELL-') === 0;
    }

    function getAiCartDiscountApplications(cart) {
      if (!cart) return [];
      var cartDiscounts = Array.isArray(cart.cart_level_discount_applications) ? cart.cart_level_discount_applications : [];
      return cartDiscounts.filter(function (discount) {
        return isAiDiscountLabel((discount && (discount.title || discount.code)) || '');
      });
    }

    async function clearExistingAiDiscounts(cartOverride) {
      var cart = cartOverride;
      if (!cart || !Array.isArray(cart.items)) {
        try {
          var cartRes = await fetch('/cart.js');
          if (!cartRes.ok) return false;
          cart = await cartRes.json();
        } catch (_) {
          return false;
        }
      }

      if (!getAiCartDiscountApplications(cart).length) return false;

      try {
        await fetch(SHOPIFY_ROOT + 'cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discount: null })
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    async function applyDiscountCodeToCart(discountCode, redirectPath) {
      if (!discountCode) return false;

      // Step 1: Set discount directly on cart object (most reliable — Shopify checkout reads this)
      // Always do this first so the discount persists to checkout even if step 2 fails.
      var cartUpdateOk = false;
      try {
        var updateRes = await fetch(SHOPIFY_ROOT + 'cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discount: discountCode, attributes: { ai_discount_code: discountCode } })
        });
        cartUpdateOk = !!(updateRes && updateRes.ok);
        console.log('[AI Upsell] cart/update.js discount set:', cartUpdateOk, discountCode);
      } catch (err2) {
        console.warn('[AI Upsell] cart/update discount apply failed:', err2 && err2.message ? err2.message : err2);
      }

      // Step 2: Also apply via /discount/CODE redirect to set the session cookie
      // (belt-and-suspenders for older checkout and cart page display)
      var redirectUrl = safeBuildDiscountRedirectUrl(discountCode, redirectPath || 'cart');
      if (redirectUrl) {
        try {
          await fetch(redirectUrl, {
            method: 'GET',
            credentials: 'same-origin',
            redirect: 'follow'
          });
        } catch (_) {}
      }

      return cartUpdateOk;
    }

    async function syncStoredDiscountToCart(cartOverride) {
      var discountCode = window.__AI_UPSELL_DISCOUNT_CODE__;
      if (!discountCode || __AI_UPSELL_DISCOUNT_SYNC__) return cartOverride || null;

      var cart = cartOverride;
      if (!cart || !Array.isArray(cart.items)) {
        try {
          var cartRes = await fetch('/cart.js');
          if (!cartRes.ok) return cartOverride || null;
          cart = await cartRes.json();
        } catch (_) {
          return cartOverride || null;
        }
      }

      if (!cartHasAiOfferItems(cart) || cartHasNativeDiscount(cart)) return cart;

      __AI_UPSELL_DISCOUNT_SYNC__ = true;
      try {
        var applied = await applyDiscountCodeToCart(discountCode, 'cart');
        if (!applied) return cart;
        var refreshedRes = await fetch('/cart.js');
        if (!refreshedRes.ok) return cart;
        return await refreshedRes.json();
      } catch (_) {
        return cart;
      } finally {
        __AI_UPSELL_DISCOUNT_SYNC__ = false;
      }
    }

    function applyAiDiscount(price, compareAtPrice, discountPercent) {
      var base = parseFloat(price);
      var pct = parseFloat(discountPercent);
      if (!isFinite(base) || base <= 0) return { price: price, compareAt: compareAtPrice, applied: false };
      if (!isFinite(pct) || pct <= 0) return { price: price, compareAt: compareAtPrice, applied: false };
      // Always treat the current selling price as the base for discounts.
      // This ensures the displayed discount reflects what will actually be applied in checkout.
      var compareAt = base.toFixed(2);
      var discounted = Math.max(0, base * (1 - pct / 100));
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
      if (drawer.querySelector('.ai-drawer-upsell')) { drawer.classList.add('ai-has-upsell'); return; }
      var products = secondaryAllProducts.length > 0 ? secondaryAllProducts.slice(0, DRAWER_MAX_PRODUCTS) : [];
      if (products.length === 0) return;

      // Build slider card HTML for each product
      var cardsHtml = products.map(function (p) {
        var vid = p.variantId || p.id;
        if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
        var imgHtml = p.image
          ? '<img src="' + p.image + '" alt="' + p.title + '" class="ai-dc-img" loading="lazy" />'
          : '<div class="ai-dc-img-ph"></div>';
        var offerType = p.offerType || 'addon_upsell';
        var discountPct = parseFloat(p.discountPercent || 0);
        var priceInfo = applyAiDiscount(p.price, p.compareAtPrice, discountPct);
        var basePrice = parseFloat(p.price || 0).toFixed(2);
        var compareAtParsed = parseFloat(p.compareAtPrice);
        var priceHtml;
        if (priceInfo.applied && priceInfo.compareAt !== priceInfo.price) {
          priceHtml = '<s class="ai-dc-cmp">$' + priceInfo.compareAt + '</s><span class="ai-dc-price">$' + priceInfo.price + '</span>';
        } else if (isFinite(compareAtParsed) && compareAtParsed > parseFloat(p.price || 0) && compareAtParsed.toFixed(2) !== basePrice) {
          priceHtml = '<s class="ai-dc-cmp">$' + compareAtParsed.toFixed(2) + '</s><span class="ai-dc-price">$' + basePrice + '</span>';
        } else {
          priceHtml = '<span class="ai-dc-price">$' + basePrice + '</span>';
        }
        var badgeHtml = '';
        if (discountPct > 0) {
          var badgeLabel = offerType === 'bundle'
            ? 'Bundle ' + formatDiscountPercent(discountPct) + '% off'
            : '-' + formatDiscountPercent(discountPct) + '%';
          badgeHtml = '<span class="ai-dc-badge">' + badgeLabel + '</span>';
        }
        var tiersHtml = '';
        if (offerType === 'volume_discount' && Array.isArray(p.tiers) && p.tiers.length > 0) {
          tiersHtml = '<div class="ai-dc-tiers">' + p.tiers.map(function (t) { return t.quantity + '+ = ' + t.discountPercent + '% off'; }).join(' · ') + '</div>';
        }
        return '<div class="ai-drawer-card">' +
          '<div class="ai-dc-img-wrap">' + imgHtml + badgeHtml + '</div>' +
          '<div class="ai-dc-body">' +
            '<div class="ai-dc-title">' + p.title + '</div>' +
            '<div class="ai-dc-prices">' + priceHtml + '</div>' +
            tiersHtml +
            '<button class="ai-drawer-add-btn" data-variant-id="' + vid + '" data-product-id="' + (p.id || '') + '" data-offer-type="' + offerType + '" data-discount-percent="' + discountPct + '">Add</button>' +
          '</div>' +
        '</div>';
      }).join('');

      var wrapper = document.createElement('div');
      wrapper.className = 'ai-drawer-upsell';
      wrapper.innerHTML =
        '<div class="ai-drawer-upsell-inner">' +
          '<div class="ai-drawer-upsell-hd">' +
            '<span class="ai-drawer-upsell-ttl">You may also like</span>' +
            '<div class="ai-slider-arrows">' +
              '<button class="ai-slider-btn ai-slider-prev" aria-label="Previous">&#8249;</button>' +
              '<button class="ai-slider-btn ai-slider-next" aria-label="Next">&#8250;</button>' +
            '</div>' +
          '</div>' +
          '<div class="ai-slider-viewport">' +
            '<div class="ai-slider-track">' + cardsHtml + '</div>' +
          '</div>' +
        '</div>';

      // Mark drawer so CSS can safely scope sticky footer tweaks
      drawer.classList.add('ai-has-upsell');

      // Slider arrow navigation
      var track = wrapper.querySelector('.ai-slider-track');
      var prevBtn = wrapper.querySelector('.ai-slider-prev');
      var nextBtn = wrapper.querySelector('.ai-slider-next');
      function scrollSlider(dir) {
        var firstCard = track.querySelector('.ai-drawer-card');
        var cardW = firstCard ? firstCard.offsetWidth + 10 : 160;
        track.scrollBy({ left: dir * cardW, behavior: 'smooth' });
      }
      prevBtn.addEventListener('click', function () { scrollSlider(-1); });
      nextBtn.addEventListener('click', function () { scrollSlider(1); });

      // Build a map of drawer products for volume discount lookups
      var drawerProductMap = new Map(products.map(function (p) { return [String(p.id), p]; }));
      wrapper.querySelectorAll('.ai-drawer-add-btn').forEach(function (btn) {
        btn.addEventListener('click', async function (e) {
          e.preventDefault();
          var varId = btn.getAttribute('data-variant-id');
          var productId = btn.getAttribute('data-product-id');
          var productData = drawerProductMap.get(String(productId)) || {};
          if (!varId || varId === 'null' || varId === 'undefined' || varId === String(productId)) {
            if (productData.variants && productData.variants.length > 0) {
              var _availVar = productData.variants.find(function(v) { return v && v.available !== false && v.id; }) || productData.variants[0];
              if (_availVar && _availVar.id && String(_availVar.id) !== String(productId)) varId = String(_availVar.id);
            }
            if (!varId || varId === 'null' || varId === 'undefined' || varId === String(productId)) {
              if (productData.handle) {
                try {
                  var _pRes = await fetch(SHOPIFY_ROOT + 'products/' + productData.handle + '.js');
                  if (_pRes.ok) {
                    var _pData = await _pRes.json();
                    var _firstVariant = (_pData.variants || [])[0];
                    if (_firstVariant && _firstVariant.id) varId = String(_firstVariant.id);
                  }
                } catch (_) {}
              }
            }
            if (!varId || varId === 'null' || varId === String(productId)) {
              btn.textContent = 'Failed'; btn.style.background = '#d72c0d';
              setTimeout(function () { btn.textContent = 'Add'; btn.disabled = false; btn.style.background = ''; }, 2000);
              return;
            }
          }
          var offerType = productData.offerType || 'addon_upsell';
          var discountPct = parseFloat(btn.getAttribute('data-discount-percent') || '0');
          var allDiscountProductIds = [productId];
          var cartDataD = null;
          var currentGoalD = getCurrentGoal();
          await ensureCartGoalAttribute(currentGoalD);
          if (offerType === 'volume_discount') {
            var cartResD = await fetch('/cart.js'); cartDataD = await cartResD.json();
            var totalQty = getCartTotalQuantity(cartDataD) + 1;
            discountPct = getVolumeDiscountPercent(productData, isImmediateDiscountGoal(currentGoalD) ? Math.max(totalQty, getMinVolumeQuantity(productData) || totalQty) : totalQty);
            var minQtyDrawer = getMinVolumeQuantity(productData);
            if (!isImmediateDiscountGoal(currentGoalD) && minQtyDrawer && totalQty < minQtyDrawer) discountPct = 0;
            allDiscountProductIds = Array.from(new Set(getCartProductIdList(cartDataD).concat([productId])));
          } else if (offerType === 'bundle') {
            // Do not clear the discount for bundle. The source item is already in the cart
            // so we should pass the discount along to the upsell item.
          }
          discountPct = normalizeImmediateDiscount(offerType, productData, discountPct, currentGoalD);
          var gateResultD = await applyGoalDiscountGate(currentGoalD, discountPct, cartDataD, 1);
          discountPct = gateResultD.discount;
          if (!cartDataD && gateResultD.cartData) cartDataD = gateResultD.cartData;
          var discountTargetsD = await buildDiscountTargets(allDiscountProductIds, cartDataD, currentGoalD);
          var offerPropsD = getOfferProperties(
            offerType, discountPct, currentGoalD,
            resolveOriginalBasePrice(productData, null),
            resolveFunctionDiscountPercent(productData, null, discountPct)
          );
          btn.textContent = '...'; btn.disabled = true;
          try {
            console.log('[AI Upsell] Primary: goal=' + currentGoalD + ' discount=' + discountPct);
            var discountCode = discountPct > 0 ? await getOrCreateDiscountCode(discountTargetsD, discountPct) : null;
            // Include sections in cart/add.js payload — Dawn theme returns rendered HTML inline
            var cartPayload = { id: varId, quantity: 1, sections: 'cart-drawer,cart-icon-bubble', ...offerPropsD };
            var addRes = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cartPayload) });
            var addData = addRes.ok ? await addRes.json() : {};
            if (discountCode) {
              window.__AI_UPSELL_DISCOUNT_CODE__ = discountCode;
              syncCheckoutLinks(discountCode);
              try { sessionStorage.setItem('__ai_volume_target__', JSON.stringify({ productId: productId, minQty: getMinVolumeQuantity(productData) || 1, code: discountCode })); } catch (_) {}
              applyDiscountCodeToCart(discountCode, 'cart').catch(function() {});
            }
            btn.textContent = '✓'; btn.style.background = '#333';
            // Remove this product from future "You may also like" suggestions
            secondaryAllProducts = secondaryAllProducts.filter(function (p) { return String(p.id) !== String(productId); });
            // Refresh cart drawer so new item appears immediately
            try {
              var cartRes = await fetch(SHOPIFY_ROOT + 'cart.js');
              var cartData = await cartRes.json();
              // Use inline sections from /cart/add.js if available, else fetch separately.
              // NOTE: we always use safelyUpdateDrawerFromSection instead of renderContents —
              // renderContents relies on Dawn's internal section ID format which may not match
              // the 'cart-drawer' key Shopify returns, causing it to silently fail or clear
              // the drawer, leaving stale content until a page refresh.
              var sectionsData = (addData && addData.sections) ? addData.sections : null;
              if (!sectionsData) {
                var sectionsRes = await fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble');
                sectionsData = await sectionsRes.json();
              }
              updateCartCountBubble(cartData.item_count);
              var drawerEl = document.querySelector('cart-drawer');
              if (drawerEl && sectionsData && sectionsData['cart-drawer']) {
                safelyUpdateDrawerFromSection(sectionsData['cart-drawer'], cartData, { allowFullReplace: true });
                keepDrawerOpen(drawerEl, cartData);
                var scrollEl = drawerEl.querySelector('cart-drawer-items, #CartDrawer-CartItems, .cart-drawer__items, .drawer__contents .cart-items, .drawer__contents [data-cart-items]');
                if (scrollEl) scrollEl.scrollTop = 0;
                else drawerEl.scrollTop = 0;
              }
              if (sectionsData && sectionsData['cart-icon-bubble']) {
                var iconEl = document.getElementById('cart-icon-bubble');
                if (iconEl) { var tmp2 = document.createElement('div'); tmp2.innerHTML = sectionsData['cart-icon-bubble']; var newIcon = tmp2.querySelector('#cart-icon-bubble'); if (newIcon) { iconEl.replaceWith(newIcon); updateCartCountBubble(cartData.item_count); } }
              }
              updateLineItemDiscountedPrices(cartData);
              if (window.__AI_UPSELL_DISCOUNT_CODE__) syncCheckoutLinks(window.__AI_UPSELL_DISCOUNT_CODE__);
              // Dispatch after our DOM writes so the theme reacts to already-updated content
              document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cartData, source: 'ai-upsell' } }));
            } catch (_) {
              fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
                document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart } }));
                updateCartCountBubble(cart.item_count);
                updateLineItemDiscountedPrices(cart);
              }).catch(function () {});
            }
            // Re-inject upsell into the (possibly new) drawer
            setTimeout(function () {
              var activeDrawer = document.querySelector('cart-drawer');
              if (activeDrawer && !activeDrawer.querySelector('.ai-drawer-upsell')) placeInCartDrawer();
            }, 80);
            setTimeout(function () { btn.textContent = 'Add'; btn.disabled = false; btn.style.background = '#008060'; }, 2000);
          } catch (_) { btn.textContent = 'Add'; btn.disabled = false; }
        });
      });
      // Place before footer so checkout sits below the upsell block.
      var footer = drawer.querySelector('.drawer__footer, .cart-drawer__footer, #CartDrawer-Footer, cart-drawer-footer');
      if (footer && footer.parentNode) { footer.parentNode.insertBefore(wrapper, footer); return; }
      // If footer not found, place before checkout CTA inside drawer.
      var checkoutBtn = drawer.querySelector('button[name="checkout"], #CartDrawer-Checkout, .cart__checkout-button button, a[href*="/checkout"]');
      if (checkoutBtn && checkoutBtn.parentNode) {
        var checkoutWrap = checkoutBtn.closest('.cart__ctas, .cart__checkout-button, .drawer__footer, .cart-drawer__footer, form') || checkoutBtn.parentNode;
        if (checkoutWrap && checkoutWrap.parentNode) { checkoutWrap.parentNode.insertBefore(wrapper, checkoutWrap); return; }
      }
      // Fallback: place under cart items if footer not found.
      var itemsHost = drawer.querySelector('cart-drawer-items, #CartDrawer-CartItems, .drawer__contents .cart-items, .drawer__contents [data-cart-items]');
      if (itemsHost && itemsHost.parentNode) { insertAfter(itemsHost, wrapper); return; }
      var contents = drawer.querySelector('.drawer__inner, .drawer__contents, cart-drawer-items');
      if (contents) contents.appendChild(wrapper);
    }

    var _drawerUpsellRefreshInFlight = false;
    async function refreshDrawerUpsellFromCart() {
      if (_drawerUpsellRefreshInFlight) return;
      _drawerUpsellRefreshInFlight = true;
      try {
        var drawer = document.querySelector('cart-drawer');
        if (!drawer) return;
        if (drawer.querySelector('.ai-drawer-upsell')) return;
        var cartRes = await fetch(SHOPIFY_ROOT + 'cart.js');
        if (!cartRes.ok) return;
        var cart = await cartRes.json();
        var cartProductIds = (cart && cart.items || []).map(function (item) { return item.product_id; });
        if (!cartProductIds.length) return;
        await loadSecondaryRecommendations(cartProductIds, cart);
        placeInCartDrawer();
      } catch (_) {
        // ignore
      } finally {
        _drawerUpsellRefreshInFlight = false;
      }
    }

    function handleCartUpdated(event) {
       var cartFromEvent = event && event.detail && event.detail.cart;
       console.log('[AI Upsell] 🛒 handleCartUpdated fired, source:', event && event.detail && event.detail.source);
       if (cartFromEvent && cartFromEvent.items) {
         // Check if a bundle item was just removed — if so, skip patching to avoid
         // flashing the wrong discounted price while maybeClearInvalidBundleProperties clears it.
         var bundleCount = cartFromEvent.items.filter(function(item) {
           return item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
         }).length;
         var prevBundleCount = window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ || 0;
         var bundleBroke = bundleCount > 0 && prevBundleCount > 0 && bundleCount < prevBundleCount;
         if (!bundleBroke) {
           setTimeout(function () { console.log('[AI Upsell] handleCartUpdated: calling updateLineItemDiscountedPrices'); updateLineItemDiscountedPrices(cartFromEvent); }, 80);
         } else {
           console.log('[AI Upsell] 🔴 Bundle broke (count went from', prevBundleCount, 'to', bundleCount, ') - skipping price patch, will clear bundle properties');
         }
       } else {
         console.log('[AI Upsell] handleCartUpdated: calling patchCartDrawerPricesFromAPI');
         patchCartDrawerPricesFromAPI();
       }
       // Ensure checkout footer stays visible on cart page after AJAX updates.
       setTimeout(function () { restoreCartFooterVisibility(); }, 120);
       setTimeout(function () { restoreCartFooterVisibility(); }, 600);
       if (event && event.detail && event.detail.source === 'ai-upsell') {
         var isCart = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
         if (isCart) {
           setTimeout(function () { placeInCartPage(); refreshSecondaryFromCart(cartFromEvent); }, 150);
         }
         return;
       }
       var isCart = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
       setTimeout(function () {
         maybeClearExpiredVolumeDiscount(cartFromEvent);
         maybeClearInvalidBundleProperties(cartFromEvent);
         if (isCart) {
           placeInCartPage();
           refreshSecondaryFromCart(cartFromEvent);
         }
         loadDrawerUpsellsFromCart(cartFromEvent);
         restoreCartFooterVisibility();
       }, 150);
     }

    async function maybeClearExpiredVolumeDiscount(cartOverride) {
      try {
        var dataStr = null;
        try { dataStr = sessionStorage.getItem('__ai_volume_target__'); } catch (_) {}
        if (!dataStr) return;
        var parsed = null;
        try { parsed = JSON.parse(dataStr); } catch (_) {}
        if (!parsed || !parsed.productId) return;
        var minQty = Number(parsed.minQty || 0);
        if (!minQty || !isFinite(minQty)) return;
        var cart = cartOverride;
        if (!cart || !cart.items) { var res = await fetch('/cart.js'); cart = await res.json(); }
        var qty = getQuantityForProductInCart(cart, parsed.productId);
        if (qty >= minQty) return;
        await fetch(SHOPIFY_ROOT + 'cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discount: null }) });
        window.__AI_UPSELL_DISCOUNT_CODE__ = null;
        try { sessionStorage.removeItem('__ai_volume_target__'); } catch (_) {}
      } catch (err) {
        console.error('[AI Upsell] Error in maybeClearVolumeDiscountCode', err);
      }
    }

    function getBundleOfferItems(cart) {
      if (!cart || !Array.isArray(cart.items)) return [];
      return cart.items.filter(function(item) {
        return item.properties &&
               ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
      });
    }

    function isBundleItemIncomplete(item, cart) {
      if (!item || !item.properties || !cart || !Array.isArray(cart.items)) return false;
      var bundleProductIds = item.properties._bundle_product_ids;
      if (!bundleProductIds) return true;
      var expectedIds = String(bundleProductIds).split(',').map(function(id) { return String(id).trim(); }).filter(Boolean);
      if (!expectedIds.length) return true;
      var cartVariantIds = cart.items.map(function(cartItem) { return String(cartItem.variant_id); });
      return !expectedIds.every(function(expectedId) {
        return cartVariantIds.indexOf(expectedId) !== -1;
      });
    }

    function cartHasIncompleteBundle(cart) {
      return getBundleOfferItems(cart).some(function(item) {
        return isBundleItemIncomplete(item, cart);
      });
    }

    async function clearAiDiscountCodeFromCart() {
      try {
        await fetch(SHOPIFY_ROOT + 'cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discount: '', attributes: { ai_discount_code: '' } })
        });
        console.log('[AI Upsell] ✅ AI discount code cleared from cart update');
      } catch (_) {}

      // Force clear the Shopify discount session cookie to prevent it from persisting to checkout
      try {
        await fetch(SHOPIFY_ROOT + 'discount/CLEAR', {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'follow'
        });
        console.log('[AI Upsell] ✅ AI discount session cookie cleared');
      } catch (_) {}

      // Aggressively clear the checkout session discount directly
      try {
        await fetch(SHOPIFY_ROOT + 'checkout?clear_discount=1', {
          method: 'GET',
          credentials: 'same-origin'
        });
        console.log('[AI Upsell] ✅ AI discount cleared from checkout session');
      } catch (_) {}

      window.__AI_UPSELL_DISCOUNT_CODE__ = null;
      window.__AI_UPSELL_FORCE_CLEAR_DISCOUNT__ = true;
      try { sessionStorage.removeItem('__ai_volume_target__'); } catch (_) {}
      try {
        document.querySelectorAll('a[href*="/discount/"]').forEach(function(link) {
          var h = link.getAttribute('href') || '';
          if (/\/discount\/(AIUS-|UPSELL-)/i.test(h)) {
            link.setAttribute('href', (SHOPIFY_ROOT || '/') + 'checkout?clear_discount=1');
          }
        });
      } catch (_) {}
    }

    async function maybeClearInvalidBundleProperties(cartOverride, skipDrawerRefresh) {
      if (window.__AI_UPSELL_BUNDLE_CLEARING__) {
        console.log('[AI Upsell] ⏸️ Bundle clearing already in progress, skipping');
        return;
      }
      try {
        var cart = cartOverride;
        if (!cart || !cart.items) {
          var res = await fetch(SHOPIFY_ROOT + 'cart.js');
          if (!res.ok) return;
          cart = await res.json();
        }

        var itemsToClean = getBundleOfferItems(cart);

        var currentBundleCount = itemsToClean.length;
        var prevBundleCount = window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ || 0;
        var hasIncompleteBundle = cartHasIncompleteBundle(cart);

        console.log('[AI Upsell] 📊 Bundle check: current=' + currentBundleCount + ', prev=' + prevBundleCount + ', incomplete=' + hasIncompleteBundle);

        if (currentBundleCount === 0) {
          console.log('[AI Upsell] ✅ No bundle items in cart');
          window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ = 0;
          return;
        }

        // Bundle grew or stayed the same and every expected variant is present.
        if (!hasIncompleteBundle && currentBundleCount >= prevBundleCount) {
          console.log('[AI Upsell] ✅ Bundle intact or grew, recording count');
          window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ = currentBundleCount;
          return;
        }

        // Bundle is incomplete — a bundle item was removed; clear discounts from all remaining bundle items.
        console.log('[AI Upsell] 🔴 Bundle incomplete! Clearing properties from', itemsToClean.length, 'items');
        window.__AI_UPSELL_BUNDLE_ITEM_COUNT__ = 0;
        window.__AI_UPSELL_BUNDLE_CLEARING__ = true;
        // Suppress price patching immediately so cart:updated events fired by the
        // property-clearing API calls below cannot re-apply discounts mid-clear.
        window.__AI_UPSELL_SKIP_PRICE_PATCH__ = true;

        // CRITICAL: Stop the persistent watcher BEFORE clearing to prevent re-applying discounts
        if (_patchPersistentTimer) {
          clearInterval(_patchPersistentTimer);
          _patchPersistentTimer = null;
          console.log('[AI Upsell] ⏹️ Stopped persistent patch watcher before bundle clearing');
        }

        // Execute API calls sequentially to prevent Shopify cart state race conditions
        for (var i = 0; i < itemsToClean.length; i++) {
          var item = itemsToClean[i];
          var newProps = Object.assign({}, item.properties);
          console.log('[AI Upsell] 🧹 Clearing properties for item:', item.title, 'key:', item.key, 'old Offer:', newProps.Offer);
          newProps.Offer = '';
          newProps.offer = '';

          try {
            var res = await fetch(SHOPIFY_ROOT + 'cart/change.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: item.key,
                quantity: item.quantity,
                properties: newProps
              })
            });
            console.log('[AI Upsell] ✅ API call completed for item', item.key, 'status:', res.status);
          } catch (err) {
            console.error('[AI Upsell] ❌ Failed to clear bundle properties for item', item.key, ':', err);
          }
        }
        console.log('[AI Upsell] ✅ All bundle property-clearing API calls completed sequentially');

        // Bundle is broken — remove the Shopify discount code from the cart so the
        // remaining items are no longer discounted at checkout.
        await clearAiDiscountCodeFromCart();

        window.__AI_UPSELL_BUNDLE_CLEARING__ = false;

        // Remove all AI discount patches from the DOM
        console.log('[AI Upsell] 🧹 Removing AI discount patches from DOM');
        var patchedWrappers = document.querySelectorAll('[data-ai-price-patched="true"]');
        console.log('[AI Upsell] Found', patchedWrappers.length, 'patched wrappers');
        patchedWrappers.forEach(function(wrapper) {
          // Remove the discounted price element
          var discountedNode = wrapper.querySelector('[data-ai-discounted-node="true"]');
          if (discountedNode) {
            console.log('[AI Upsell] Removing discounted node');
            discountedNode.remove();
          }
          
          // Remove strikethrough from original price
          var priceNodes = wrapper.querySelectorAll('[data-ai-hidden-duplicate-price="true"]');
          priceNodes.forEach(function(node) {
            node.style.display = '';
            node.removeAttribute('data-ai-hidden-duplicate-price');
          });
          
          // Restore first price node styling
          var firstPrice = wrapper.querySelector('span');
          if (firstPrice) {
            firstPrice.style.textDecoration = '';
            firstPrice.style.color = '';
            firstPrice.style.fontWeight = '';
          }
          
          wrapper.style.display = '';
          wrapper.style.flexDirection = '';
          wrapper.style.alignItems = '';
          wrapper.style.gap = '';
          wrapper.removeAttribute('data-ai-price-patched');
        });

        // Hide the Offer property text in the cart drawer
        console.log('[AI Upsell] 🧹 Hiding Offer property text in cart drawer');
        var cartDrawer = document.querySelector('cart-drawer');
        if (cartDrawer) {
          var allPropertyElements = cartDrawer.querySelectorAll('[data-cart-item-property], .cart-item__property, .properties');
          allPropertyElements.forEach(function(el) {
            if (el.textContent && (el.textContent.indexOf('Bundle') !== -1 || el.textContent.indexOf('Offer') !== -1)) {
              console.log('[AI Upsell] Hiding property element:', el.textContent);
              el.style.display = 'none';
            }
          });
        }

        // Only refresh drawer if not skipped (e.g., when called from remove item flow where drawer is already being refreshed)
        if (!skipDrawerRefresh) {
          // Fetch fresh cart state and refresh drawer immediately after all API calls complete
          // Add cache-busting parameter to ensure fresh data
          try {
            var cachebustedUrl = SHOPIFY_ROOT + 'cart.js?t=' + Date.now();
            var finalRes = await fetch(cachebustedUrl);
            if (finalRes.ok) {
              var finalCart = await finalRes.json();
              console.log('[AI Upsell] 🔄 Refreshing drawer with fresh cart state after bundle clearing');
              await refreshDrawerAfterAiCartChange(finalCart, null);
            }
          } catch (err) {
            console.error('[AI Upsell] ❌ Error fetching fresh cart after bundle clearing:', err);
          }
        }
        window.__AI_UPSELL_SKIP_PRICE_PATCH__ = false;
      } catch (e) {
        console.error('[AI Upsell] ❌ Error in maybeClearInvalidBundleProperties:', e);
        window.__AI_UPSELL_BUNDLE_CLEARING__ = false;
        window.__AI_UPSELL_SKIP_PRICE_PATCH__ = false;
      }
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
            body: JSON.stringify({ eventType: 'view', shopId: _C.shopDomain, sessionId: userId, userId: userId, sourceProductId: sourceProductId ? sourceProductId.toString() : null, sourceProductName: sourceProductName, upsellProductId: pid, upsellProductName: p.title || p.productTitle || null, recommendationType: p.type || p.recommendationType || null, confidence: parseFloat(p.confidence || 0), quantity: 1, metadata: { location: location, segment: _C.customerSegment || window.__AI_UPSELL_SEGMENT__ || 'anonymous' } })
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

    function getMinVolumeQuantity(product) {
      var tiers = Array.isArray(product && product.tiers) ? product.tiers : [];
      var minQty = Infinity;
      tiers.forEach(function (t) {
        var tq = Number(t && t.quantity || 0);
        if (tq > 0 && tq < minQty) minQty = tq;
      });
      return isFinite(minQty) ? minQty : null;
    }

    function getQuantityForProductInCart(cartData, productId) {
      if (!cartData || !Array.isArray(cartData.items)) return 0;
      var pid = String(productId);
      return cartData.items.reduce(function (sum, item) {
        return sum + (String(item.product_id) === pid ? (parseInt(item.quantity, 10) || 0) : 0);
      }, 0);
    }

    async function fetchQuantityForProduct(productId) {
      try {
        var cartRes = await fetch('/cart.js');
        if (!cartRes.ok) return 0;
        var cartData = await cartRes.json();
        return getQuantityForProductInCart(cartData, productId);
      } catch (_) { return 0; }
    }

    function getCartTotalQuantity(cartData) {
      if (!cartData || !Array.isArray(cartData.items)) return 0;
      return cartData.items.reduce(function (sum, item) {
        var q = parseInt(item.quantity, 10);
        return sum + (isFinite(q) ? q : 0);
      }, 0);
    }

    function getCartProductIdList(cartData) {
      if (!cartData || !Array.isArray(cartData.items)) return [];
      return cartData.items.map(function (item) { return String(item.product_id); });
    }

    async function fetchCartSafe() {
      try {
        var res = await fetch('/cart.js');
        if (!res.ok) return null;
        return await res.json();
      } catch (_) { return null; }
    }

    function collectUpsellProductIds(cartData) {
      if (!cartData || !Array.isArray(cartData.items)) return [];
      var ids = [];
      cartData.items.forEach(function (item) {
        if (item && item.properties && (item.properties.Offer || item.properties.offer)) {
          ids.push(String(item.product_id));
        }
      });
      return ids;
    }

    function collectAllCartProductIds(cartData) {
      if (!cartData || !Array.isArray(cartData.items)) return [];
      return cartData.items.map(function (item) { return String(item.product_id); });
    }

    async function buildDiscountTargets(allDiscountProductIds, cartData, goal) {
      // For buy-2 goals we must not re-apply discount to the first item, so keep only the new targets.
      if (isBuy2Goal(goal)) return Array.from(new Set(allDiscountProductIds.map(String)));
      var data = cartData || await fetchCartSafe();
      var baseIds = isImmediateDiscountGoal(goal)
        ? collectAllCartProductIds(data) // include every cart item so later upsells also stay covered
        : collectUpsellProductIds(data);
      return Array.from(new Set(baseIds.concat(allDiscountProductIds.map(String))));
    }

    async function applyGoalDiscountGate(goal, effectiveDiscount, cartData, quantityToAdd) {
      if (!isBuy2Goal(goal)) return { discount: effectiveDiscount, cartData: cartData };
      var data = cartData || await fetchCartSafe();
      var totalAfterAdd = getCartTotalQuantity(data) + (quantityToAdd || 0);
      if (totalAfterAdd < 2) return { discount: 0, cartData: data };
      return { discount: effectiveDiscount, cartData: data };
    }

    function resolveSelectedVariantData(productData, productCard) {
      var selectedOption = productCard && productCard.querySelector ? productCard.querySelector('.ai-variant-select option:checked') : null;
      var selectedId = selectedOption ? String(selectedOption.value || '') : '';
      var variants = Array.isArray(productData && productData.variants) ? productData.variants : [];
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i] && variants[i].id) === selectedId) return variants[i];
      }
      return null;
    }

    function resolvePricingContext(productData, productCard) {
      var variant = resolveSelectedVariantData(productData, productCard);
      var currentPrice = parseFloat(variant && variant.price || productData && productData.price || '');
      // Always treat the current selling price as the base for discounts.
      var originalBase = currentPrice;
      return {
        currentPrice: isFinite(currentPrice) && currentPrice > 0 ? currentPrice : NaN,
        originalBase: isFinite(originalBase) && originalBase > 0 ? originalBase : NaN
      };
    }

    function resolveOriginalBasePrice(productData, productCard) {
      var pricing = resolvePricingContext(productData, productCard);
      return isFinite(pricing.originalBase) ? pricing.originalBase.toFixed(2) : null;
    }

    function resolveFunctionDiscountPercent(productData, productCard, effectiveDiscount) {
      var pct = parseFloat(effectiveDiscount || 0);
      if (!isFinite(pct) || pct <= 0) return 0;
      var pricing = resolvePricingContext(productData, productCard);
      if (!isFinite(pricing.currentPrice) || pricing.currentPrice <= 0) return pct;
      if (!isFinite(pricing.originalBase) || pricing.originalBase <= 0) return pct;
      var targetPrice = pricing.originalBase * (1 - pct / 100);
      if (!isFinite(targetPrice) || targetPrice <= 0) return pct;
      if (targetPrice >= pricing.currentPrice) return 0;
      var actualPct = (1 - (targetPrice / pricing.currentPrice)) * 100;
      return Math.max(0, Math.min(100, actualPct));
    }

    function getOfferProperties(offerType, effectiveDiscount, goal, originalBasePrice, functionDiscountPercent) {
      if (!effectiveDiscount || Number(effectiveDiscount) <= 0) return {};
      var formattedDiscount = formatDiscountPercent(effectiveDiscount);
      var functionPct = isFinite(Number(functionDiscountPercent)) && Number(functionDiscountPercent) > 0
        ? formatDiscountPercent(Number(functionDiscountPercent))
        : formattedDiscount;
      if (offerType === 'volume_discount') {
        var volumeProps = { 'Offer': 'Volume ' + formattedDiscount + '% off' };
        if (originalBasePrice) volumeProps['_ai_original_price'] = String(originalBasePrice);
        return { properties: volumeProps };
      }
      // Always store the discount % in the Offer property so updateLineItemDiscountedPrices
      // can read it back and patch the cart drawer price regardless of AI goal type.
      var prefix = offerType === 'bundle' ? 'Bundle' : 'Offer';
      var props = { 'Offer': prefix + ' ' + formattedDiscount + '% off' };
      if (originalBasePrice) props['_ai_original_price'] = String(originalBasePrice);
      return { properties: props };
    }

    async function getOrCreateDiscountCode(productIds, discountPercent) {
      var existing = window.__AI_UPSELL_DISCOUNT_CODE__;
      if (existing && Number(window.__AI_UPSELL_DISCOUNT_PERCENT__) === Number(discountPercent)) {
        console.log('[AI Upsell] Reusing existing discount code:', existing);
        return existing;
      }
      var code = await createDiscountCode(productIds, discountPercent);
      if (code) window.__AI_UPSELL_DISCOUNT_PERCENT__ = discountPercent;
      return code;
    }

    async function createDiscountCode(productIds, discountPercent) {
      if (!productIds || productIds.length === 0 || !discountPercent || Number(discountPercent) <= 0) {
        console.warn('[AI Upsell] createDiscountCode called with invalid params:', { productIds, discountPercent });
        return null;
      }
      try {
        // Extract shop from domain
        var shop = window.location.hostname.split('.')[0] || 'unknown';
        var payload = { productIds: productIds.filter(Boolean), discountPercent: discountPercent };
        console.log('[AI Upsell] Creating discount code:', { shop, productIds: payload.productIds.length, discountPercent: payload.discountPercent });
        var discRes = await fetch('/apps/ai-upsell/discount?shop=' + encodeURIComponent(shop), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        console.log('[AI Upsell] Discount API response status:', discRes.status);
        if (!discRes.ok) { 
          var errorText = '';
          try { errorText = await discRes.text(); } catch(_) {}
          console.error('[AI Upsell] Discount API failed:', discRes.status, discRes.statusText, errorText); 
          return null; 
        }
        var discData = await discRes.json();
        console.log('[AI Upsell] Discount API response data:', discData);
        if (discData.error) { console.error('[AI Upsell] Discount API error response:', discData.error); return null; }
        if (!discData.code) { console.warn('[AI Upsell] Discount API returned no code'); return null; }
        console.log('[AI Upsell] ✅ Discount code created successfully via admin API:', discData.code);
        return discData.code;
      } catch (err) { console.error('[AI Upsell] Discount creation error:', err.message, err.stack); return null; }
    }

    function getOfferTypeBadge(product) {
      var type = product.offerType || 'addon_upsell';
      if (type === 'bundle') return '<div class="ai-offer-type-badge ai-offer-type-bundle">Bundle &amp; Save</div>';
      if (type === 'volume_discount') {
        var tiersHtml = '';
        if (Array.isArray(product.tiers) && product.tiers.length > 0) {
          tiersHtml = '<div class="ai-volume-tiers">' + product.tiers.map(function (t) { return '<span class="ai-volume-tier">Buy ' + t.quantity + '+ items &mdash; ' + t.discountPercent + '% off</span>'; }).join('') + '</div>';
        }
        return '<div class="ai-offer-type-badge ai-offer-type-volume">' + tiersHtml + '</div>';
      }
      if (type === 'subscription_upgrade') return '<div class="ai-offer-type-badge ai-offer-type-subscription">Subscribe &amp; Save</div>';
      return '';
    }

    function getWidgetHeading(products, fallbackHeading, customHeading) {
      if (customHeading) return customHeading;
      var base = fallbackHeading || 'Recommended for You';
      var list = Array.isArray(products) ? products : [];
      if (list.length === 0) return base;
      var subscriptionCount = list.filter(function (product) {
        return product && product.offerType === 'subscription_upgrade';
      }).length;
      if (subscriptionCount === list.length) return 'Subscribe & Save';
      if (subscriptionCount > 0) return 'Subscription Picks';
      return base;
    }

    function getSubscriptionMetaHTML(product) {
      var interval = String((product && product.interval) || '').trim().toLowerCase();
      var cadence = interval ? ('Delivered ' + interval) : 'Recurring delivery available';
      var renews = product && (product.sellingPlanId || product.sellingPlanIdNumeric) ? ' · Auto-renews' : '';
      return '<div class="ai-subscription-meta"><p class="ai-subscription-copy">' + (product.tagline || 'Subscribe &amp; Save') + '</p><p class="ai-subscription-interval">' + cadence + renews + '</p></div>';
    }

    function buildCartBundleCardHTML(product) {
      var vid = product.variantId || product.id;
      if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
      var hasV = Array.isArray(product.variants) && product.variants.length > 0 && !(product.variants.length === 1 && product.variants[0].title === 'Default Title');
      var first = hasV ? (product.variants.find(function (v) { return v.available; }) || product.variants[0]) : null;
      var eVid = (hasV ? (first && first.id) : null) || vid;
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

    function buildMultiBundleCardHTML(sourceProduct, bundleProducts) {
      var src = sourceProduct || null;
      var capped = bundleProducts.slice(0, 4);
      // Only count visible bundle products — source product is added silently
      var totalCount = capped.length;
      var srcPrice = src ? (parseFloat(src.price) || 0) : 0;
      var originalTotal = 0; // only visible bundle products
      var discountedTotal = 0; // only visible bundle products
      var maxDiscountPct = 0;
      capped.forEach(function(p) {
        var price = parseFloat(p.price) || 0;
        var dp = parseFloat(p.discountPercent) || 0;
        if (dp > maxDiscountPct) maxDiscountPct = dp;
        originalTotal += price;
        discountedTotal += dp > 0 ? price * (1 - dp / 100) : price;
      });
      var savings = originalTotal - discountedTotal;
      // Only show upsell products in grid — source product is already on the page
      var itemsHtml = '';
      capped.forEach(function(p) {
        var price = parseFloat(p.price) || 0;
        var imgHtml = p.image ? '<img src="' + p.image + '" alt="" class="ai-mbc-img" />' : '<div class="ai-mbc-img-placeholder"></div>';
        var firstVariant = Array.isArray(p.variants) && p.variants.length > 0
          ? (p.variants.find(function(v) { return v && v.available !== false; }) || p.variants[0])
          : null;
        var vid = p.variantId || (firstVariant && (firstVariant.id || firstVariant.variantId)) || p.id;
        if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
        itemsHtml += '<div class="ai-mbc-item" data-vid="' + (vid || '') + '" data-product-id="' + (p.id || '') + '" data-handle="' + (p.handle || '') + '">'
          + '<a href="' + (p.url || '#') + '" class="ai-mbc-img-link">' + imgHtml + '</a>'
          + '<p class="ai-mbc-title">' + (p.title || '') + '</p>'
          + '<p class="ai-mbc-price-row"><span class="ai-mbc-price">$' + price.toFixed(2) + '</span></p>'
          + '<div class="ai-mbc-qty"><button type="button" class="ai-mbc-qty-btn ai-mbc-minus">\u2212</button><span class="ai-mbc-qty-val">1</span><button type="button" class="ai-mbc-qty-btn ai-mbc-plus">+</button></div>'
          + '</div>';
      });
      var variantIds = capped.map(function(p) {
        var firstVariant = Array.isArray(p.variants) && p.variants.length > 0
          ? (p.variants.find(function(v) { return v && v.available !== false; }) || p.variants[0])
          : null;
        var vid = p.variantId || (firstVariant && (firstVariant.id || firstVariant.variantId)) || p.id;
        if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
        return vid;
      }).filter(Boolean);
      var srcVariantId = src && src.variantId ? src.variantId : '';
      var buttonText = 'Add ' + totalCount + ' Items';
      var totalPriceHtml = savings > 0
        ? '<span class="ai-mbc-total-label">Total price : </span><span class="ai-mbc-total-original">$' + originalTotal.toFixed(2) + '</span> <span class="ai-mbc-total-discounted">$' + discountedTotal.toFixed(2) + '</span>'
        : '<span class="ai-mbc-total-label">Total price : </span><span class="ai-mbc-total-discounted">$' + discountedTotal.toFixed(2) + '</span>';
      return '<div class="ai-upsell-card ai-bundle-card ai-multi-bundle-card" data-source-price="' + srcPrice.toFixed(2) + '">'
        + '<div class="ai-offer-type-badge ai-offer-type-bundle">Bundle &amp; Save</div>'
        + '<div class="ai-mbc-grid">' + itemsHtml + '</div>'
        + '<div class="ai-mbc-total-row">' + totalPriceHtml + '</div>'
        + '<div class="ai-upsell-actions"><button type="button" class="ai-multi-bundle-btn" data-variant-ids="' + variantIds.join(',') + '" data-source-variant-id="' + srcVariantId + '" data-discount-percent="' + maxDiscountPct + '">' + buttonText + '</button></div>'
        + '</div>';
    }

    async function handleMultiBundleAdd(button, event) {
      if (!button || button.__aiBundleAdding) return;
      if (event) {
        event.preventDefault(); event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      }
      var variantIdsStr = button.getAttribute('data-variant-ids') || '';
      var variantIds = variantIdsStr.split(',').filter(Boolean);
      var originalText = button.getAttribute('data-original-text') || button.textContent;
      var card = button.closest('.ai-multi-bundle-card');
      var qtyEls = card ? card.querySelectorAll('.ai-mbc-item') : [];
      if (variantIds.length === 0 && qtyEls.length > 0) {
        variantIds = Array.from(qtyEls).map(function(itemEl) {
          return itemEl.getAttribute('data-vid') || '';
        }).filter(Boolean);
      }
      if (variantIds.length === 0) {
        console.error('[AI Upsell] Bundle button has no variants to add');
        button.textContent = 'Failed'; button.style.background = '#d72c0d';
        setTimeout(function() { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000);
        return;
      }
      button.__aiBundleAdding = true;
      button.disabled = true; button.textContent = 'Adding...';
      var discountPct = parseFloat(button.getAttribute('data-discount-percent') || '0');
      var offerProp = discountPct > 0 ? ('Bundle ' + discountPct + '% off') : 'Bundle';
      function normalizeVariantId(value) {
        if (value === null || value === undefined) return '';
        var id = String(value).trim();
        if (!id || id === 'null' || id === 'undefined') return '';
        if (id.indexOf('/') !== -1) id = id.split('/').pop();
        return /^\d+$/.test(id) ? id : '';
      }
      async function resolveVariantId(handle, fallbackVid) {
        var normalizedFallback = normalizeVariantId(fallbackVid);
        if (!handle) return normalizedFallback;
        try {
          var r = await fetch('/products/' + handle + '.js');
          if (!r.ok) return normalizedFallback;
          var pData = await r.json();
          var variants = Array.isArray(pData.variants) ? pData.variants : [];
          var v = variants.find(function(variant) { return variant && variant.available !== false; }) || variants[0];
          var resolved = normalizeVariantId(v && v.id);
          return resolved || normalizedFallback;
        } catch (_) { return normalizedFallback; }
      }
      var itemData = [];
      for (var i = 0; i < variantIds.length; i++) {
        var itemEl = qtyEls[i];
        var qty = itemEl ? (parseInt((itemEl.querySelector('.ai-mbc-qty-val') || {}).textContent) || 1) : 1;
        var handle = itemEl ? (itemEl.getAttribute('data-handle') || '') : '';
        var productId = itemEl ? (itemEl.getAttribute('data-product-id') || '') : '';
        itemData.push({ fallbackVid: variantIds[i], qty: qty, handle: handle, productId: productId });
      }
      var resolvedVids = await Promise.all(itemData.map(function(d) { return resolveVariantId(d.handle, d.fallbackVid); }));
      var items = itemData.map(function(d, i) {
        var resolvedId = normalizeVariantId(resolvedVids[i]);
        if (!resolvedId || (d.productId && resolvedId === String(d.productId))) {
          console.warn('[AI Upsell] Bundle item has no valid variant ID:', { productId: d.productId, handle: d.handle, fallbackVid: d.fallbackVid, resolvedVid: resolvedVids[i] });
          return null;
        }
        return { id: Number(resolvedId), quantity: d.qty, properties: { _source: 'ai-bundle', Offer: offerProp, _bundle_product_ids: resolvedVids.join(',') } };
      }).filter(Boolean);
      if (items.length === 0) {
        console.error('[AI Upsell] No valid bundle variants could be added to cart');
        button.textContent = 'Failed'; button.style.background = '#d72c0d';
        setTimeout(function() { button.textContent = originalText; button.disabled = false; button.style.background = ''; button.__aiBundleAdding = false; }, 2000);
        return;
      }
      try {
        window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
        console.log('[AI Upsell] Bundle items to add:', JSON.stringify(items));
        var addedCount = 0;
        var bulkResp = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: items,
            sections: 'cart-drawer,cart-icon-bubble'
          })
        });
        var addSections = null;
        if (bulkResp.ok) {
          addedCount = items.length;
          var bulkData = await bulkResp.json().catch(function() { return {}; });
          addSections = bulkData && bulkData.sections ? bulkData.sections : null;
        } else {
          var bulkErr = await bulkResp.json().catch(function() { return {}; });
          console.warn('[AI Upsell] Bundle bulk add failed, retrying one-by-one:', bulkErr.description || bulkErr.errors || bulkResp.status);
          for (var ii = 0; ii < items.length; ii++) {
            var itemResp = await fetch('/cart/add.js', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [items[ii]],
                sections: 'cart-drawer,cart-icon-bubble'
              })
            });
            if (itemResp.ok) {
              addedCount++;
              var itemDataResp = await itemResp.json().catch(function() { return {}; });
              if (itemDataResp && itemDataResp.sections) addSections = itemDataResp.sections;
            } else {
              var itemErr = await itemResp.json().catch(function() { return {}; });
              console.warn('[AI Upsell] Skipping variant', items[ii].id, '-', itemErr.description || itemErr.errors || itemResp.status);
            }
          }
        }
        if (addedCount === 0) throw new Error('No items could be added to cart');
        button.textContent = 'Added \u2713'; button.style.background = '#008060';
        fetch(SHOPIFY_ROOT + 'cart.js').then(function(r) { return r.json(); }).then(function(cart) {
          updateCartCountBubble(cart.item_count);
          // Use the inline sections returned by cart/add.js — these are atomically fresh
          // (same server response as the add) so no race condition with cached section renders.
          var sectionsPromise = addSections
            ? Promise.resolve(addSections)
            : fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble&_t=' + Date.now()).then(function(r) { return r.json(); });
          sectionsPromise.then(function(sections) {
            if (sections['cart-drawer']) safelyUpdateDrawerFromSection(sections['cart-drawer'], cart, { allowFullReplace: true });
            if (sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
            // Open the drawer visually WITHOUT calling CartDrawer.open() / renderContents().
            // Clicking the cart icon triggers renderContents(), which fires a new sections
            // fetch that can return a stale/empty-cart cached response and overwrite the
            // correct content we just inserted. Instead we set the CSS state directly.
            setTimeout(function() {
              var drawer = document.querySelector('cart-drawer');
              if (drawer) {
                if (drawer.classList) { drawer.classList.add('active', 'animate'); drawer.classList.remove('is-empty'); }
                drawer.setAttribute('aria-hidden', 'false');
                drawer.removeAttribute('inert');
                document.body.classList.add('overflow-hidden');
                // Hide empty-state elements and force the items area visible.
                var emptyEls = drawer.querySelectorAll('.drawer__inner-empty, .cart__empty-text, [data-cart-empty], .cart-drawer__warnings');
                Array.prototype.slice.call(emptyEls).forEach(function(el) { el.style.display = 'none'; });
                // Remove is-empty from both cart-drawer and cart-drawer-items so Dawn's
                // CSS no longer hides .js-contents or the items form inside.
                var itemsEl = drawer.querySelector('cart-drawer-items');
                if (itemsEl) {
                  itemsEl.classList.remove('is-empty');
                  // Make the items form/list visible in case it was hidden inline.
                  var itemsForm = itemsEl.querySelector('form, .cart-items, ul.cart-items, [id$="-CartItems"]');
                  if (itemsForm) itemsForm.style.display = '';
                }
                var jsContents = drawer.querySelector('.js-contents');
                if (jsContents) jsContents.style.display = '';
                // Re-enable the checkout button — Dawn may have left it disabled
                // while the cart was in a "loading/updating" state that we bypassed.
                var checkoutBtns = drawer.querySelectorAll(
                  'button[name="checkout"], button[type="submit"], ' +
                  '.cart__checkout-button, a[href*="/checkout"], button.cart__checkout, ' +
                  '[id*="CartDrawer-Checkout"], [id*="checkout-button"]'
                );
                Array.prototype.slice.call(checkoutBtns).forEach(function(btn) {
                  btn.removeAttribute('disabled');
                  btn.removeAttribute('aria-disabled');
                  btn.classList.remove('loading', 'is-loading', 'btn--loading', 'cart__checkout-button--loading', 'button--loading');
                  btn.style.pointerEvents = '';
                  btn.style.opacity = '';
                });
                // Also clear any loading state on the footer/form.
                var drawerForm = drawer.querySelector('form#CartDrawer-Form, form[id*="CartDrawer"]');
                if (drawerForm) {
                  drawerForm.classList.remove('loading', 'is-loading');
                  drawerForm.removeAttribute('disabled');
                }
                var drawerFooter = drawer.querySelector('.cart-drawer__footer, .drawer__footer, [id*="CartDrawer-Footer"]');
                if (drawerFooter) drawerFooter.classList.remove('loading', 'is-loading', 'cart-drawer__footer--loading');
              } else {
                var cartIcon = document.querySelector('#cart-icon-bubble, summary[aria-controls="cart-drawer"], button[aria-controls="cart-drawer"]');
                if (cartIcon) cartIcon.click();
              }
              updateLineItemDiscountedPrices(cart);
              startPersistentPatchWatcher(cart);
              setTimeout(function() { updateLineItemDiscountedPrices(cart); restoreCartFooterVisibility(); }, 400);
              setTimeout(function() { updateLineItemDiscountedPrices(cart); restoreCartFooterVisibility(); }, 800);
            }, 100);
          });
        });
        if (discountPct > 0) {
          (async function() {
            try {
              var bundleOnlyVids = items
                .filter(function(it) { return it.properties && (it.properties.Offer || it.properties.offer); })
                .map(function(it) { return String(it.id); });
              var shop = window.location.hostname.split('.')[0] || 'unknown';
              var discRes = await fetch('/apps/ai-upsell/discount?shop=' + encodeURIComponent(shop), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ variantIds: bundleOnlyVids, discountPercent: discountPct })
              });
              if (discRes.ok) {
                var discData = await discRes.json();
                if (discData.code) {
                  window.__AI_UPSELL_DISCOUNT_CODE__ = discData.code;
                  syncCheckoutLinks(discData.code);
                  try { sessionStorage.setItem('__ai_volume_target__', JSON.stringify({ code: discData.code })); } catch(_) {}
                  await applyDiscountCodeToCart(discData.code, 'cart');
                  console.log('[AI Upsell] ✅ Bundle discount code applied:', discData.code);
                }
              }
            } catch(discErr) { console.warn('[AI Upsell] Bundle discount code error:', discErr); }
          })();
        }
        setTimeout(function() { button.textContent = originalText; button.disabled = false; button.style.background = ''; button.__aiBundleAdding = false; }, 2000);
      } catch(addErr) {
        console.error('[AI Upsell] Bundle add failed:', addErr && addErr.message ? addErr.message : addErr);
        button.textContent = 'Failed'; button.style.background = '#d72c0d';
        setTimeout(function() { button.textContent = originalText; button.disabled = false; button.style.background = ''; button.__aiBundleAdding = false; }, 2000);
      }
    }

    function attachMultiBundleListeners(contentEl) {
      // Recalculate total price row when any quantity changes
      function recalculateBundleTotal(card) {
        var btn = card ? card.querySelector('.ai-multi-bundle-btn') : null;
        if (!btn) return;
        var discountPct = parseFloat(btn.getAttribute('data-discount-percent') || '0');
        // Source product price (hidden from grid, always qty=1, no discount)
        var srcPrice = parseFloat(card.getAttribute('data-source-price') || '0');
        var srcVid = btn.getAttribute('data-source-variant-id') || '';
        var itemEls = card.querySelectorAll('.ai-mbc-item');
        var originalTotal = 0; // only visible bundle products
        var discountedTotal = 0; // only visible bundle products
        var totalQty = 0; // source product added silently, not counted in button text
        itemEls.forEach(function(itemEl) {
          var priceEl = itemEl.querySelector('.ai-mbc-price');
          var qtyEl = itemEl.querySelector('.ai-mbc-qty-val');
          var price = priceEl ? parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0 : 0;
          var qty = qtyEl ? parseInt(qtyEl.textContent) || 1 : 1;
          totalQty += qty;
          originalTotal += price * qty;
          discountedTotal += discountPct > 0 ? price * qty * (1 - discountPct / 100) : price * qty;
        });
        var savings = originalTotal - discountedTotal;
        var totalRow = card.querySelector('.ai-mbc-total-row');
        if (totalRow) {
          totalRow.innerHTML = savings > 0.001
            ? '<span class="ai-mbc-total-label">Total price : </span><span class="ai-mbc-total-original">$' + originalTotal.toFixed(2) + '</span> <span class="ai-mbc-total-discounted">$' + discountedTotal.toFixed(2) + '</span>'
            : '<span class="ai-mbc-total-label">Total price : </span><span class="ai-mbc-total-discounted">$' + discountedTotal.toFixed(2) + '</span>';
        }
        btn.setAttribute('data-original-text', 'Add ' + totalQty + ' Items');
        if (btn.textContent !== 'Adding...' && btn.textContent !== 'Added \u2713') {
          btn.textContent = 'Add ' + totalQty + ' Items';
        }
      }

      // Quantity +/- buttons inside each bundle item
      contentEl.querySelectorAll('.ai-mbc-minus').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          var valEl = btn.parentElement.querySelector('.ai-mbc-qty-val');
          var v = parseInt(valEl.textContent) || 1;
          if (v > 1) { valEl.textContent = v - 1; recalculateBundleTotal(btn.closest('.ai-multi-bundle-card')); }
        });
      });
      contentEl.querySelectorAll('.ai-mbc-plus').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          var valEl = btn.parentElement.querySelector('.ai-mbc-qty-val');
          var v = parseInt(valEl.textContent) || 1;
          if (v < 10) { valEl.textContent = v + 1; recalculateBundleTotal(btn.closest('.ai-multi-bundle-card')); }
        });
      });

      contentEl.querySelectorAll('.ai-multi-bundle-btn').forEach(function(button) {
        if (button.__aiBundleListenerAttached) return;
        button.__aiBundleListenerAttached = true;
        button.addEventListener('click', async function(e) {
          handleMultiBundleAdd(button, e);
        });
      });
    }

    function buildCardHTML(product) {
      if (product.isCartBundle) return buildCartBundleCardHTML(product);
      if (product.offerType === 'bundle') return buildBundleCardHTML(product);
      var vid = product.variantId || product.id;
      if (typeof vid === 'string' && vid.includes('/')) vid = vid.split('/').pop();
      var hasV = Array.isArray(product.variants) && product.variants.length > 0 && !(product.variants.length === 1 && product.variants[0].title === 'Default Title');
      var first = hasV ? (product.variants.find(function (v) { return v.available; }) || product.variants[0]) : null;
      var eVid = (hasV ? (first && first.id) : null) || vid;
      var dp = hasV && first && first.price ? first.price : product.price;
      var dc = hasV && first && first.compareAtPrice ? first.compareAtPrice : product.compareAtPrice;
      var offerType = product.offerType || 'addon_upsell';
      var discountPct = offerType === 'volume_discount' ? getVolumeDiscountPercent(product, 1) : product.discountPercent;
      var priceInfo = applyAiDiscount(dp, dc, discountPct);
      dp = priceInfo.price; dc = priceInfo.compareAt;
      var cardClass = 'ai-upsell-card' + (offerType === 'subscription_upgrade' ? ' ai-upsell-card-subscription' : '');
      var discountLabel = offerType === 'volume_discount'
        ? '<span class="ai-upsell-discount-pill" style="display:' + (discountPct > 0 ? 'inline-flex' : 'none') + '">-' + formatDiscountPercent(discountPct) + '%</span>'
        : (isFinite(parseFloat(discountPct)) && parseFloat(discountPct) > 0 ? '<span class="ai-upsell-discount-pill">-' + formatDiscountPercent(discountPct) + '%</span>' : '');
      var volumeTiersAttr = offerType === 'volume_discount' && Array.isArray(product.tiers) ? ' data-volume-tiers="' + encodeURIComponent(JSON.stringify(product.tiers)) + '"' : '';
      var variantHtml = hasV ? '<div class="ai-variant-wrapper"><select class="ai-variant-select">' + product.variants.map(function (v) { var vInfo = applyAiDiscount(v.price, v.compareAtPrice || '', discountPct); return '<option value="' + v.id + '" data-price="' + vInfo.price + '" data-compare="' + (vInfo.compareAt || '') + '"' + (!v.available ? ' disabled' : '') + (v.id === (first && first.id) ? ' selected' : '') + '>' + v.title + (!v.available ? ' - Sold out' : '') + '</option>'; }).join('') + '</select></div>' : '';
      var subscriptionMetaHtml = offerType === 'subscription_upgrade' ? getSubscriptionMetaHTML(product) : '';
      var primaryActionLabel = product.availableForSale ? (offerType === 'subscription_upgrade' ? 'Start Subscription' : 'Add to Cart') : 'Out of Stock';
      return '<div class="' + cardClass + '" data-product-id="' + product.id + '" data-offer-type="' + offerType + '"' + volumeTiersAttr + ' data-selling-plan-id="' + (product.sellingPlanIdNumeric || product.sellingPlanId || '') + '" data-inventory-quantity="' + (product.inventoryQuantity !== undefined ? product.inventoryQuantity : 999) + '" data-inventory-policy="' + (product.inventoryPolicy || 'continue') + '">' + getOfferTypeBadge(product) + '<a href="' + product.url + '" class="ai-upsell-link"><div class="ai-upsell-image-wrapper">' + (product.image ? '<img src="' + product.image + '" alt="' + product.title + '" class="ai-upsell-image" loading="lazy" />' : '') + '</div><div class="ai-upsell-info"><h3 class="ai-upsell-product-title">' + product.title + '</h3><p class="ai-upsell-price-block">' + (dc && parseFloat(dc) > parseFloat(dp) && parseFloat(dc).toFixed(2) !== parseFloat(dp).toFixed(2) ? '<span class="ai-upsell-compare-price">$' + parseFloat(dc).toFixed(2) + '</span> ' : '') + '<span class="ai-upsell-price">$' + parseFloat(dp).toFixed(2) + '</span>' + discountLabel + '</p>' + subscriptionMetaHtml + '</div></a><div class="ai-upsell-actions">' + variantHtml + '<div class="ai-upsell-quantity"><span class="ai-qty-label">Quantity</span><div class="ai-qty-controls"><button class="ai-qty-btn ai-qty-minus" aria-label="Decrease quantity">\u2212</button><input type="number" class="ai-qty-input" value="1" min="1" max="99" readonly /><button class="ai-qty-btn ai-qty-plus" aria-label="Increase quantity">+</button></div></div><button class="ai-add-to-cart-btn" data-variant-id="' + eVid + '" data-product-id="' + product.id + '" data-discount-percent="' + (discountPct || 0) + '" data-recommendation-type="' + product.type + '" data-confidence="' + product.confidence + '" ' + (!product.availableForSale ? 'disabled' : '') + '>' + primaryActionLabel + '</button></div></div>';
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
      var n = Number(count) || 0;
      try {
        // Dawn / Online Store 2.0 default bubble
        document.querySelectorAll('#cart-icon-bubble').forEach(function (target) {
          var bubble = target.querySelector('.cart-count-bubble');
          if (!bubble) {
            bubble = document.createElement('div');
            bubble.className = 'cart-count-bubble';
            var vis = document.createElement('span'); vis.setAttribute('aria-hidden', 'true');
            var hidden = document.createElement('span'); hidden.className = 'visually-hidden';
            bubble.appendChild(vis); bubble.appendChild(hidden);
            target.appendChild(bubble);
          }
          var visEl = bubble.querySelector('[aria-hidden]') || bubble.querySelector('.cart-count-bubble__count');
          var hiddenEl = bubble.querySelector('.visually-hidden');
          if (!hiddenEl) { hiddenEl = document.createElement('span'); hiddenEl.className = 'visually-hidden'; bubble.appendChild(hiddenEl); }
          if (visEl) visEl.textContent = String(n);
          hiddenEl.textContent = n + ' ' + (n === 1 ? 'item' : 'items');
          bubble.hidden = n <= 0;
        });

        // Fallbacks for themes that don't use #cart-icon-bubble
        document.querySelectorAll('.cart-count-bubble__count, .cart-count-bubble span[aria-hidden], [data-cart-count], [data-cart-quantity]').forEach(function (el) {
          if (el.dataset) {
            if (el.hasAttribute('data-cart-count')) el.setAttribute('data-cart-count', String(n));
            if (el.hasAttribute('data-cart-quantity')) el.setAttribute('data-cart-quantity', String(n));
          }
          if (!el.classList.contains('visually-hidden')) el.textContent = String(n);
        });
      } catch (_) {}
    }

    async function fetchCartDrawerRecommendations(cartItems) {
      try {
        var userId = window.__AI_UPSELL_USER_ID__ || '';
        var segment = window.__AI_UPSELL_SEGMENT__ || _C.customerSegment || '';
        var ts = Date.now();
        var gids = cartItems.map(function (i) { return 'gid://shopify/Product/' + i.product_id; });
        var url = '/apps/ai-upsell/cart?ids=' + encodeURIComponent(JSON.stringify(gids))
          + (userId ? '&userId=' + encodeURIComponent(userId) : '')
          + (segment ? '&segment=' + encodeURIComponent(segment) : '')
          + '&_t=' + ts;
        var res = await fetch(url);
        if (!res.ok) return null;
        var data = await res.json();
        if (!data.success || !data.recommendations || data.recommendations.length === 0) return null;
        return data.recommendations;
      } catch (_) { return null; }
    }

    async function fetchAiRecommendations(productId, maxProducts) {
      var userId = window.__AI_UPSELL_USER_ID__ || '';
      var segment = window.__AI_UPSELL_SEGMENT__ || _C.customerSegment || '';
      var ts = Date.now();
      var apiUrl = '/apps/ai-upsell?id=gid://shopify/Product/' + productId + (userId ? '&userId=' + encodeURIComponent(userId) : '') + (segment ? '&segment=' + encodeURIComponent(segment) : '') + '&_t=' + ts;
      var fetchPromise = window.__AI_UPSELL_PREFETCH__;
      if (fetchPromise) {
        window.__AI_UPSELL_PREFETCH__ = null;
        console.log('[AI Upsell] Using prefetch promise');
      } else {
        console.log('[AI Upsell] No prefetch, fetching fresh:', apiUrl);
        fetchPromise = fetch(apiUrl);
      }
      var response = await fetchPromise;
      console.log('[AI Upsell] API response status:', response.status);
      if (!response.ok) { console.error('[AI Upsell] API returned non-ok:', response.status); return null; }
      // Clone response in case body was already consumed
      var data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        console.warn('[AI Upsell] Prefetch body already consumed, fetching fresh');
        var freshRes = await fetch(apiUrl);
        if (!freshRes.ok) return null;
        data = await freshRes.json();
      }
      setDecisionMeta(data.decision);
      console.log('[AI Upsell] API data: success=' + data.success + ' count=' + (data.recommendations ? data.recommendations.length : 0));
      if (!data.success || !data.recommendations || data.recommendations.length === 0) {
        console.warn('[AI Upsell] No recommendations in response');
        return null;
      }
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
        // Extract compare_at_price so applyAiDiscount can use it as the true original base
        var compareAtCents = firstVariant.compare_at_price;
        var compareAtPrice = (compareAtCents && Number.isFinite(Number(compareAtCents)) && Number(compareAtCents) > priceCents)
          ? (Number(compareAtCents) / 100).toFixed(2) : null;
        var image = (p.featured_image && p.featured_image.url) || p.featured_image || (Array.isArray(p.images) ? p.images[0] : '');
        return { id: p.id, title: p.title, handle: p.handle, price: price, compareAtPrice: compareAtPrice, image: image, reason: 'Recommended for you', confidence: 0.5, type: 'similar', url: '/products/' + p.handle, availableForSale: firstVariant.available !== undefined ? firstVariant.available : !!p.available, variantId: firstVariant.id || null, inventoryQuantity: 999, inventoryPolicy: 'continue' };
      });
    }

    async function fetchCartRecommendations(productGids, maxProducts) {
      var cartUserId = window.__AI_UPSELL_USER_ID__ || '';
      var segment = window.__AI_UPSELL_SEGMENT__ || _C.customerSegment || '';
      var ts = Date.now();
      var apiUrl = '/apps/ai-upsell/cart?ids=' + encodeURIComponent(JSON.stringify(productGids)) + (cartUserId ? '&userId=' + encodeURIComponent(cartUserId) : '') + (segment ? '&segment=' + encodeURIComponent(segment) : '') + '&_t=' + ts;
      var fetchPromise = window.__AI_CART_PREFETCH__;
      if (fetchPromise) { window.__AI_CART_PREFETCH__ = null; } else { fetchPromise = fetch(apiUrl); }
      var response = await fetchPromise;
      if (!response.ok) return null;
      var data;
      try {
        data = await response.json();
      } catch (e) {
        var freshRes = await fetch(apiUrl);
        if (!freshRes.ok) return null;
        data = await freshRes.json();
      }
      setDecisionMeta(data.decision);
      if (!data.success || !data.recommendations || data.recommendations.length === 0) return null;
      return data.recommendations.slice(0, maxProducts);
    }

    async function addToCartAndRefresh(variantId, quantity, cartPayload, discountCode) {
      console.log('[AI Upsell] cart/add.js payload:', JSON.stringify(cartPayload));
      var response = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cartPayload) });
      if (!response.ok) {
        var errBody = '';
        try { errBody = await response.text(); } catch (_) {}
        console.error('[AI Upsell] /cart/add.js failed:', response.status, errBody);
        throw new Error('Cart add failed (' + response.status + '): ' + errBody);
      }
      var addData = {};
      try { addData = await response.json(); } catch (_) {}
      if (discountCode) {
        console.log('[AI Upsell] Applying discount code (background):', discountCode);
        window.__AI_UPSELL_DISCOUNT_CODE__ = discountCode;
        syncCheckoutLinks(discountCode);
        try { sessionStorage.setItem('__ai_volume_target__', JSON.stringify({ code: discountCode })); } catch (_) {}
        // Fire-and-forget: don't block the cart add on discount application
        applyDiscountCodeToCart(discountCode, 'cart').then(function(applied) {
          if (!applied) console.warn('[AI Upsell] Failed to apply discount code to cart');
          else console.log('[AI Upsell] Discount application success');
        }).catch(function(err) { console.error('[AI Upsell] Error applying discount:', err && err.message ? err.message : err); });
      } else {
        console.warn('[AI Upsell] No discount code to apply');
      }
      return addData;
    }

    function getCurrencyCode(cart) {
      if (cart && cart.currency) return cart.currency;
      if (window.Shopify && window.Shopify.currency) {
        return window.Shopify.currency.active || window.Shopify.currency.default || 'USD';
      }
      return 'USD';
    }

    function tryShopifyFormatMoney(cents) {
      try {
        if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
          var format = window.Shopify.money_format || window.Shopify.money_with_currency_format;
          return window.Shopify.formatMoney(cents, format);
        }
      } catch (_) {}
      return '';
    }

    function formatMoneyFromReference(cents, referenceText, cart) {
      var amount = (Number(cents || 0) / 100).toFixed(2);
      var ref = String(referenceText || '').trim();
      if (ref) {
        var lowered = ref.toLowerCase();
        if (lowered.indexOf('estimated') !== -1 || lowered.indexOf('subtotal') !== -1 || lowered.indexOf('total') !== -1) {
          var cleaned = ref.replace(/estimated|subtotal|total/ig, '').replace(/\s+/g, ' ').trim();
          if (cleaned && /\d/.test(cleaned)) ref = cleaned;
        }
      }
      var prefixMatch = ref.match(/^[^\d-]*/);
      var suffixMatch = ref.match(/[^\d.,\s]+[\s]*$/);
      var prefix = prefixMatch ? prefixMatch[0] : '';
      var suffix = suffixMatch ? suffixMatch[0] : '';
      if (prefix || suffix) {
        return (prefix + amount + suffix).trim();
      }
      var shopifyFormatted = tryShopifyFormatMoney(cents);
      if (shopifyFormatted) return shopifyFormatted;
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: getCurrencyCode(cart),
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(Number(cents || 0) / 100);
      } catch (_) {
        return amount;
      }
    }

    function parseMoneyTextToCents(text) {
      var value = String(text || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      if (!value) return 0;
      var amount = parseFloat(value[0]);
      if (!isFinite(amount)) return 0;
      return Math.round(amount * 100);
    }

    function isLikelyValueText(text) {
      var t = String(text || '').trim();
      if (!/\d/.test(t)) return false;
      // If the text includes long words (e.g. "Estimated", "Subtotal"), it's likely a label row.
      var alphaWords = t.match(/[A-Za-z]{4,}/g);
      return !alphaWords;
    }

    function shouldUpdateSubtotalNode(el) {
      if (!el || (el.children && el.children.length)) return false;
      if (el.hasAttribute && el.hasAttribute('data-cart-subtotal')) return true;
      var cls = el.classList;
      if (cls && (cls.contains('totals__subtotal-value') || cls.contains('totals__total-value') || cls.contains('cart-subtotal__price'))) {
        return true;
      }
      return isLikelyValueText(el.textContent);
    }

    function getSubtotalReferenceText(nodes) {
      if (!nodes || !nodes.length) return '';
      for (var i = 0; i < nodes.length; i++) {
        if (shouldUpdateSubtotalNode(nodes[i])) {
          var t1 = String(nodes[i].textContent || '').trim();
          if (t1) return t1;
        }
      }
      for (var j = 0; j < nodes.length; j++) {
        var t2 = String(nodes[j].textContent || '').trim();
        if (isLikelyValueText(t2)) return t2;
      }
      return String(nodes[0].textContent || '').trim();
    }

    function getStoredOriginalPriceCents(properties) {
      if (!properties || typeof properties !== 'object') return 0;
      var raw = properties._ai_original_price || properties._AI_ORIGINAL_PRICE || properties['Original Price'] || '';
      return parseMoneyTextToCents(raw);
    }

    function getCartPriceNodes(scope) {
      if (!scope || !scope.querySelectorAll) return [];
      var selectors = [
        '.price--end',
        '.price',
        '.cart-item__price',
        '.line-item__price',
        '.line-item__total',
        '.cart-item__final-price',
        '.money',
        '[data-product-price]',
        '[data-cart-item-regular-price]',
        '[data-cart-item-final-price]',
        '[data-cart-item-total]'
      ].join(', ');
      return Array.prototype.slice.call(scope.querySelectorAll(selectors)).filter(function (el) {
        return el && !el.children.length && /\d/.test(el.textContent || '');
      });
    }

    function getCartLineWrappers(container) {
      if (!container || !container.querySelectorAll) return [];
      var selectors = [
        '.cart-item__totals .cart-item__price-wrapper',
        '.line-item__totals .line-item__price-wrapper',
        '.line-item__price-wrapper',
        '.line-item__total',
        '.cart-item__totals',
        '[data-cart-item-total]',
        '[data-cart-item-final-price]',
        '[data-cart-item-regular-price]'
      ].join(', ');

      // Return all matching wrappers, deduplicated so nested matches don't cause double-patching.
      var wrappers = Array.prototype.slice.call(container.querySelectorAll(selectors));
      if (wrappers.length) {
        // Remove any wrapper that is an ancestor or descendant of another wrapper
        var deduped = wrappers.filter(function (w, i) {
          for (var j = 0; j < wrappers.length; j++) {
            if (i !== j && w.contains(wrappers[j])) return false; // w is ancestor of another, skip w (keep the inner one)
          }
          return true;
        });
        // Further deduplicate: if two wrappers are the same node, keep only the first
        var seen = [];
        deduped = deduped.filter(function (w) {
          if (seen.indexOf(w) !== -1) return false;
          seen.push(w);
          return true;
        });
        return deduped.length ? deduped : [wrappers[0]];
      }

      var fallbackTotals = container.querySelector('.cart-item__totals, .line-item__totals, [data-cart-item-total], .cart-item__price-wrapper');
      if (fallbackTotals) return [fallbackTotals];
      return [];
    }

    function getCartDetailsRoot(container) {
      if (!container || !container.querySelector) return null;
      return container.querySelector(
        '.cart-item__details, .line-item__details, .drawer-cart-item__details, ' +
        '.cart-drawer-item__details, [data-cart-item-details]'
      );
    }

    function getCartDetailPriceNodes(container, candidateCents) {
      var detailRoot = getCartDetailsRoot(container);
      if (!detailRoot || !detailRoot.querySelectorAll) return [];
      var allowed = Array.isArray(candidateCents)
        ? candidateCents.filter(function (value) { return isFinite(value) && value > 0; })
        : [];
      var selectors = [
        '.product-option',
        '.line-item-property',
        '.cart-item__option',
        '.product-option__value',
        'dd',
        'p',
        'span',
        'div'
      ].join(', ');
      return Array.prototype.slice.call(detailRoot.querySelectorAll(selectors)).filter(function (el) {
        if (!el || el.children.length) return false;
        if (el.getAttribute('data-ai-hidden-detail-price') === 'true') return false;
        if (el.closest('.cart-item__totals, .line-item__totals, .cart-item__price-wrapper, .line-item__price-wrapper')) return false;
        var text = String(el.textContent || '').trim();
        if (!text || !/\d/.test(text) || /%/.test(text)) return false;
        if (/offer|bundle|color|size|qty|quantity|delivered|auto-renews/i.test(text)) return false;
        var cents = parseMoneyTextToCents(text);
        if (!cents) return false;
        if (allowed.length && allowed.indexOf(cents) === -1) return false;
        var normalized = text
          .replace(/rs\.?|inr|usd|cad|aud|eur|gbp|\$|€|£|¥/ig, '')
          .replace(/[\d\s,.\-:()]/g, '')
          .trim();
        return !normalized;
      });
    }

    function hideDetailUnitPriceNodes(container, candidateCents) {
      var nodes = getCartDetailPriceNodes(container, candidateCents);
      if (!nodes.length) return false;
      nodes.forEach(function (node) {
        node.style.display = 'none';
        node.setAttribute('data-ai-hidden-detail-price', 'true');
      });
      return true;
    }

    function hideDuplicateOfferNodes(container) {
      var detailRoot = getCartDetailsRoot(container);
      if (!detailRoot || !detailRoot.querySelectorAll) return false;
      var selectors = ['.product-option', '.line-item-property', '.cart-item__option', 'dd', 'p', 'span', 'div'].join(', ');
      var nodes = Array.prototype.slice.call(detailRoot.querySelectorAll(selectors)).filter(function (el) {
        if (!el) return false;
        if (el.getAttribute('data-ai-hidden-offer') === 'true') return false;
        var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        return /%/.test(text) && /^offer\b/i.test(text) && !/^Offer\b/.test(text);
      });
      if (!nodes.length) return false;
      nodes.forEach(function (node) {
        node.style.display = 'none';
        node.setAttribute('data-ai-hidden-offer', 'true');
      });
      return true;
    }

    function hideInternalOfferNodes(root) {
      if (!root || !root.querySelectorAll) return false;
      var selectors = [
        '.product-option',
        '.line-item-property',
        '.cart-item__option',
        '.cart-item__details p',
        '.cart-item__details span',
        '.cart-item__details div',
        '.line-item__details p',
        '.line-item__details span',
        '.line-item__details div',
        '.cart-drawer-item__details p',
        '.cart-drawer-item__details span',
        '.cart-drawer-item__details div',
        'dd',
        'p',
        'span',
        'div'
      ].join(', ');
      var nodes = Array.prototype.slice.call(root.querySelectorAll(selectors)).filter(function (el) {
        if (!el) return false;
        if (el.getAttribute('data-ai-hidden-offer') === 'true') return false;
        var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        return /%/.test(text) && /^offer\b/i.test(text) && !/^Offer\b/.test(text);
      });
      if (!nodes.length) return false;
      nodes.forEach(function (node) {
        node.style.display = 'none';
        node.setAttribute('data-ai-hidden-offer', 'true');
      });
      return true;
    }

    function hideAiDiscountApplicationNodes(root) {
      if (!root || !root.querySelectorAll) return false;
      var isCartPage = window.location.pathname === '/cart' || window.location.pathname.indexOf('/cart') === 0;
      // Cart page: do not hide discount nodes at all to prevent checkout being hidden.
      if (isCartPage) return false;
      var selectors = [
        '.discounts__discount',
        '.totals__discount',
        '.cart-discount',
        '.discount',
        '.discounts li',
        '[data-cart-discount]',
        '[data-discount-code]'
      ].join(', ');
      var nodes = Array.prototype.slice.call(root.querySelectorAll(selectors)).filter(function (el) {
        if (!el || el.getAttribute('data-ai-hidden-cart-discount') === 'true') return false;
        // On cart page, never hide discount nodes outside the cart drawer.
        if (isCartPage && !(el.closest && el.closest('cart-drawer'))) return false;
        // Skip broad containers that include totals or checkout — hiding them would remove the checkout section.
        if (el.querySelector && el.querySelector('.totals, .cart__ctas, button[name="checkout"], a[href*="/checkout"]')) return false;
        if (el.classList && (el.classList.contains('cart__footer') || el.classList.contains('cart__blocks') || el.classList.contains('cart__ctas') || el.classList.contains('js-contents'))) return false;
        // Must be within a discount container to be eligible.
        if (el.closest && !el.closest('.discounts, .cart__discounts, .cart-discount, .totals__discount, .discounts__discount, [data-cart-discount], [data-discount-code]')) return false;
        var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return false;
        if (!/^((AIUS|UPSELL)-[A-Z0-9-]+)/i.test(text)) return false;
        // Only hide small, leaf-like nodes (avoid large containers that happen to include the code)
        if (text.length > 40) return false;
        if (el.children && el.children.length) return false;
        return true;
      });
      if (!nodes.length) return false;
      nodes.forEach(function (node) {
        var row = (node.closest && node.closest('li, .discounts__discount, .totals__discount, .cart-discount, .discount')) || null;
        var rowHasTotals = row && row.querySelector && row.querySelector('.totals, .cart__ctas, button[name="checkout"], a[href*="/checkout"]');
        var inDrawer = !!(node.closest && node.closest('cart-drawer'));
        if (row && !rowHasTotals && inDrawer && !isCartPage) {
          row.style.display = 'none';
          row.setAttribute('data-ai-hidden-cart-discount', 'true');
          return;
        }
        // Only hide the label itself if row is unsafe to hide (or on cart page)
        node.style.display = 'none';
        node.setAttribute('data-ai-hidden-cart-discount', 'true');
      });
      return true;
    }

    function findCartLineContainer(root, item, index) {
      if (!root || !root.querySelectorAll) { console.log('[AI Upsell] findCartLineContainer: no root'); return null; }
      var oneBased = index + 1;
      var selectors = [
        '[data-cart-item-key="' + item.key + '"]',
        '[data-key="' + item.key + '"]',
        '[data-line-item-key="' + item.key + '"]',
        '#CartItem-' + oneBased,
        '#CartDrawer-Item-' + oneBased,
        '[data-index="' + oneBased + '"]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var found = root.querySelector(selectors[i]);
        if (found) { console.log('[AI Upsell] findCartLineContainer: Found via selector', selectors[i]); return found; }
      }
      console.log('[AI Upsell] findCartLineContainer: Trying fallback selectors');
      var rows = root.querySelectorAll(
        'cart-drawer-items .cart-item, cart-items .cart-item, [id^="CartItem-"], ' +
        '.drawer-cart-item, .cart-drawer-item, [data-cart-item], [data-line-item]'
      );
      console.log('[AI Upsell] findCartLineContainer: Found', rows.length, 'rows, returning index', index);
      return rows[index] || null;
    }

    function patchLineItemPriceDisplay(container, discountedCents, cart, docLike, originalLineCents, originalUnitCents) {
      if (!container) { console.log('[AI Upsell] patchLineItemPriceDisplay: no container'); return false; }
      var wrappers = getCartLineWrappers(container);
      console.log('[AI Upsell] patchLineItemPriceDisplay: Found', wrappers.length, 'wrappers');
      if (!wrappers.length) { console.log('[AI Upsell] patchLineItemPriceDisplay: No wrappers found, discounted:', discountedCents); return false; }
      var createNodeWith = docLike && docLike.createElement ? docLike : document;
      var patched = false;
      var hasCorrectPatch = false;
      wrappers.forEach(function (wrapper) {
        if (!wrapper) return;
        // Check if patch already exists and is correct
        var existingPatch = wrapper.querySelector('[data-ai-discounted-node="true"]');
        if (existingPatch && existingPatch.textContent) {
          var expectedPrice = formatMoneyFromReference(discountedCents, wrapper.textContent, cart);
          if (existingPatch.textContent === expectedPrice) {
            console.log('[AI Upsell] patchLineItemPriceDisplay: Patch already correct, skipping');
            hasCorrectPatch = true;
            return; // Already patched correctly, skip
          }
        }
        if (wrapper.setAttribute) wrapper.setAttribute('data-ai-price-patched', 'true');
        Array.prototype.slice.call(wrapper.querySelectorAll('[data-ai-discounted-node="true"]')).forEach(function (node) {
          node.remove();
        });
        var priceNodes = getCartPriceNodes(wrapper);
        console.log('[AI Upsell] patchLineItemPriceDisplay: Found', priceNodes.length, 'price nodes');
        var referenceText = (priceNodes[0] && priceNodes[0].textContent) || wrapper.textContent || '';
        if (!/\d/.test(referenceText)) { console.log('[AI Upsell] patchLineItemPriceDisplay: No digits in reference text'); return; }
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'flex-end';
        wrapper.style.gap = '2px';
        // Only keep the first price node visible with strikethrough, hide the rest
        priceNodes.forEach(function (el, idx) {
          if (idx === 0) {
            // First price node: apply strikethrough styling
            // Use originalUnitCents for checkout pages (single unit price), fall back to line total for cart pages
            var priceToShow = originalUnitCents && originalUnitCents > 0 ? originalUnitCents : originalLineCents;
            if (priceToShow && priceToShow > 0) {
              el.textContent = formatMoneyFromReference(priceToShow, referenceText, cart);
            }
            el.style.textDecoration = 'line-through';
            el.style.color = '#9ca3af';
            el.style.fontWeight = '400';
            el.style.whiteSpace = 'nowrap';
          } else {
            // Hide duplicate price nodes
            el.style.display = 'none';
            el.setAttribute('data-ai-hidden-duplicate-price', 'true');
          }
        });
        var discountEl = createNodeWith.createElement('div');
        discountEl.setAttribute('data-ai-discounted-node', 'true');
        discountEl.style.cssText = 'font-weight:700;color:#008060;font-size:inherit;white-space:nowrap;line-height:1.2;';
        discountEl.textContent = formatMoneyFromReference(discountedCents, referenceText, cart);
        console.log('[AI Upsell] patchLineItemPriceDisplay: Setting discounted price to', discountEl.textContent);
        wrapper.insertBefore(discountEl, wrapper.firstChild);
        patched = true;
      });
      return patched || hasCorrectPatch;
    }

    function patchVisibleCartPricesFromDOM(root) {
      var scope = root || document;
      if (!scope || !scope.querySelectorAll) return false;
      suppressCartPatchObservers(400);
      var rows = scope.querySelectorAll(
        'cart-drawer .cart-item, cart-drawer-items .cart-item, cart-items .cart-item, ' +
        '[id^="CartDrawer-Item-"], [id^="CartItem-"]'
      );
      if (!rows.length) return false;

      var rowsArr = Array.prototype.slice.call(rows);
      if (scope === document) {
        var isCartPage = window.location.pathname === '/cart' || window.location.pathname.indexOf('/cart') === 0;
        if (isCartPage) {
          // On the cart page, exclude hidden cart-drawer rows to avoid double counting.
          rowsArr = rowsArr.filter(function (row) { return !(row.closest && row.closest('cart-drawer')); });
        } else {
          // On non-cart pages, prefer drawer rows if present.
          var drawerRows = rowsArr.filter(function (row) { return row.closest && row.closest('cart-drawer'); });
          if (drawerRows.length) rowsArr = drawerRows;
        }
      }
      if (!rowsArr.length) return false;

      var anyPatched = false;
      var subtotalCents = 0;
      rowsArr.forEach(function (row) {
        var offerText = '';
        var detailText = row.querySelector('.cart-item__details') ? row.querySelector('.cart-item__details').textContent : row.textContent;
        var offerMatch = String(detailText || '').match(/Offer[\s\S]*?(\d+(?:\.\d+)?)\s*%/i);
        var pct = offerMatch ? parseFloat(offerMatch[1]) : 0;

        var priceNode = row.querySelector(
          '.cart-item__totals .price--end, .cart-item__totals .price, ' +
          '.line-item__totals .price--end, .line-item__totals .price, ' +
          '.cart-item__price-wrapper .price--end, .cart-item__price-wrapper .price'
        );
        var referenceText = priceNode ? priceNode.textContent : '';
        var baseLineCents = parseMoneyTextToCents(referenceText);

        var qtyInput = row.querySelector('input.quantity__input, .quantity__input, input[name^="updates["]');
        var qty = qtyInput ? parseInt(qtyInput.value, 10) : 1;
        if (!isFinite(qty) || qty < 1) qty = 1;

        if (pct > 0 && baseLineCents > 0) {
          var discountedLineCents = Math.round(baseLineCents * (1 - pct / 100));
          if (patchLineItemPriceDisplay(row, discountedLineCents, null, document, baseLineCents, null)) anyPatched = true;
          subtotalCents += discountedLineCents;
        } else {
          subtotalCents += baseLineCents;
        }
      });

      if (subtotalCents > 0) {
        var subtotalTargets = scope.querySelectorAll(
          '.totals__subtotal-value, .totals__total-value, ' +
          '[data-cart-subtotal], .cart-subtotal__price, ' +
          '.cart__subtotal, .cart-drawer__footer .totals p, ' +
          'cart-drawer .totals__subtotal-value'
        );
        var subtotalRef = getSubtotalReferenceText(subtotalTargets);
        var subtotalStr = formatMoneyFromReference(subtotalCents, subtotalRef, null);
        Array.prototype.slice.call(subtotalTargets).forEach(function (el) {
          if (shouldUpdateSubtotalNode(el)) el.textContent = subtotalStr;
        });
      }

      hideInternalOfferNodes(scope);
      hideAiDiscountApplicationNodes(scope);

      return anyPatched;
    }

    function updateLineItemDiscountedPrices(cart) {
      if (window.__AI_UPSELL_SKIP_PRICE_PATCH__) {
        console.log('[AI Upsell] ⏭️ Skipping price patch - bundle clearing in progress');
        return false;
      }
      if (!cart || !Array.isArray(cart.items)) { console.log('[AI Upsell] ❌ updateLineItemDiscountedPrices: no cart or items'); return false; }
      suppressCartPatchObservers(400);
      console.log('[AI Upsell] 📊 updateLineItemDiscountedPrices called with', cart.items.length, 'items');
      
      // CRITICAL: For bundle discounts, validate that ALL bundle items are still in cart FIRST
      // Check each bundle item to see if its complete bundle is still present
      var bundleItems = cart.items.filter(function(item) {
        return item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
      });
      
      // For each bundle item, validate its complete bundle is present
      var incompleteBundleIndices = [];
      var clearedAnyBundleProperties = false;
      bundleItems.forEach(function(bundleItem) {
        var bundleProductIds = bundleItem.properties && bundleItem.properties._bundle_product_ids;
        if (bundleProductIds) {
          var expectedIds = bundleProductIds.split(',');
          var cartProductIds = cart.items.map(function(cartItem) { return String(cartItem.variant_id); });
          var allPresent = expectedIds.every(function(expectedId) {
            return cartProductIds.indexOf(expectedId) !== -1;
          });
          if (!allPresent) {
            console.log('[AI Upsell] 🔴 Bundle is incomplete! Expected:', expectedIds, 'Found:', cartProductIds);
            incompleteBundleIndices.push(cart.items.indexOf(bundleItem));
            clearedAnyBundleProperties = true;
            // Mark this bundle as invalid by clearing its Offer property
            bundleItem.properties.Offer = '';
            bundleItem.properties.offer = '';
            
            // CRITICAL: Remove existing price patches from the DOM for this item
            var container = findCartLineContainer(document, bundleItem, cart.items.indexOf(bundleItem));
            if (container) {
              var discountedNode = container.querySelector('[data-ai-discounted-node="true"]');
              if (discountedNode) {
                console.log('[AI Upsell] Removing discounted price patch for incomplete bundle item');
                discountedNode.remove();
              }
              
              // CRITICAL: Remove all offer-related text from the DOM to prevent patchVisibleCartPricesFromDOM from finding it
              var allElements = container.querySelectorAll('*');
              allElements.forEach(function(el) {
                if (el.textContent) {
                  var text = el.textContent.trim();
                  if ((text.indexOf('Bundle') !== -1 || text.indexOf('Offer') !== -1) && text.length < 100) {
                    el.style.display = 'none';
                  }
                }
              });
            }
          }
        } else {
          // If no _bundle_product_ids property, check if Offer property exists
          // If it does, it means the bundle was cleared on the backend
          if (bundleItem.properties.Offer || bundleItem.properties.offer) {
            console.log('[AI Upsell] 🔴 Bundle item has Offer but no _bundle_product_ids - clearing');
            incompleteBundleIndices.push(cart.items.indexOf(bundleItem));
            clearedAnyBundleProperties = true;
            bundleItem.properties.Offer = '';
            bundleItem.properties.offer = '';
            
            // CRITICAL: Remove existing price patches from the DOM
            var container = findCartLineContainer(document, bundleItem, cart.items.indexOf(bundleItem));
            if (container) {
              var discountedNode = container.querySelector('[data-ai-discounted-node="true"]');
              if (discountedNode) {
                console.log('[AI Upsell] Removing discounted price patch for cleared bundle item');
                discountedNode.remove();
              }
              
              // CRITICAL: Remove all offer-related text from the DOM
              var allElements = container.querySelectorAll('*');
              allElements.forEach(function(el) {
                if (el.textContent) {
                  var text = el.textContent.trim();
                  if ((text.indexOf('Bundle') !== -1 || text.indexOf('Offer') !== -1) && text.length < 100) {
                    el.style.display = 'none';
                  }
                }
              });
            }
          }
        }
      });
      
      var anyPatched = false;
      cart.items.forEach(function (item, index) {
        // Read discount % from the Offer line-item property
        var discountPct = 0;
        if (item.properties && typeof item.properties === 'object') {
          var offerText = item.properties['Offer'] || item.properties['offer'] || '';
          console.log('[AI Upsell] Item', index, 'title:', item.title, '- Offer property:', offerText);
          var discountMatch = offerText.match(/(\d+(?:\.\d+)?)\s*%/);
          if (discountMatch) discountPct = parseFloat(discountMatch[1]);
        }
        console.log('[AI Upsell] Item', index, '- Discount %:', discountPct);
        if (discountPct <= 0) { 
          console.log('[AI Upsell] Item', index, '- No discount, skipping'); 
          return; 
        }
        
        // CRITICAL: If this is a bundle item but the bundle is incomplete, skip patching
        var isBundleItem = item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
        if (isBundleItem) {
          var bundleProductIds = item.properties._bundle_product_ids;
          if (!bundleProductIds) {
            console.log('[AI Upsell] Item', index, '- Bundle item with no _bundle_product_ids, skipping patch');
            return;
          }
          var expectedIds = bundleProductIds.split(',');
          var cartProductIds = cart.items.map(function(cartItem) { return String(cartItem.variant_id); });
          var allPresent = expectedIds.every(function(expectedId) {
            return cartProductIds.indexOf(expectedId) !== -1;
          });
          if (!allPresent) {
            console.log('[AI Upsell] Item', index, '- Bundle is incomplete, skipping patch');
            return;
          }
        }

        // Always treat the current selling price as the base for discounts (ignore compare_at_price).
        var storedOriginalCents = getStoredOriginalPriceCents(item.properties);
        var unitCents = storedOriginalCents || item.original_price || item.price;
        var compareAtCents = item.compare_at_price || 0;
        var baseUnitCents = unitCents;
        var quantity = item.quantity || 1;
        var originalLineCents = baseUnitCents * quantity;
        var originalUnitCents = baseUnitCents;
        var discountedLineCents = Math.round(baseUnitCents * (1 - discountPct / 100)) * quantity;
        console.log('[AI Upsell] Item', index, '- storedOriginal:', storedOriginalCents, 'unitCents:', unitCents, 'compareAt:', compareAtCents, 'base:', baseUnitCents, 'qty:', quantity, 'discountedLine:', discountedLineCents);
        var container = findCartLineContainer(document, item, index);
        console.log('[AI Upsell] Item', index, '- container found:', !!container);
        if (container) console.log('[AI Upsell] Item', index, '- container HTML:', container.outerHTML.substring(0, 200));
        if (patchLineItemPriceDisplay(container, discountedLineCents, cart, document, originalLineCents, originalUnitCents)) { console.log('[AI Upsell] Item', index, '- ✅ patched'); anyPatched = true; } else { console.log('[AI Upsell] Item', index, '- ❌ patch failed'); }
        var detailCandidates = [
          item.original_price,
          item.price,
          item.final_price,
          quantity > 0 ? Math.round((item.original_line_price || 0) / quantity) : 0,
          quantity > 0 ? Math.round((item.final_line_price || 0) / quantity) : 0
        ].filter(function (value) { return isFinite(value) && value > 0 && value !== baseUnitCents; });
        if (hideDetailUnitPriceNodes(container, detailCandidates)) anyPatched = true;
        if (hideDuplicateOfferNodes(container)) anyPatched = true;
        if (hideInternalOfferNodes(container || document)) anyPatched = true;
      });

      // ── Patch subtotal / estimated total ───────────────────────────────────
      // Re-sum all items: discounted price for AI-offer items, Shopify final price otherwise.
      var newSubtotalCents = 0;
      var anyAiDiscount = false;
      cart.items.forEach(function (it) {
        var pct = 0;
        if (it.properties && typeof it.properties === 'object') {
          var txt = it.properties['Offer'] || it.properties['offer'] || '';
          var mm = txt.match(/(\d+(?:\.\d+)?)\s*%/);
          if (mm) pct = parseFloat(mm[1]);
        }
        if (pct > 0) {
          anyAiDiscount = true;
          var storedOriginalCents2 = getStoredOriginalPriceCents(it.properties);
          var uC = storedOriginalCents2 || it.original_price || it.price;
          // Always use the current selling price as the base for discounts.
          var bC = uC;
          newSubtotalCents += Math.round(bC * (1 - pct / 100)) * (it.quantity || 1);
        } else {
          newSubtotalCents += (it.final_line_price || it.original_line_price || it.price * (it.quantity || 1));
        }
      });
      if (anyAiDiscount) {
        var subtotalTargets = document.querySelectorAll(
          '.totals__subtotal-value, .totals__total-value, ' +
          '[data-cart-subtotal], .cart-subtotal__price, ' +
          '.cart__subtotal, .cart-drawer__footer .totals p, ' +
          'cart-drawer .totals__subtotal-value'
        );
        var subtotalRef = getSubtotalReferenceText(subtotalTargets);
        var subtotalStr = formatMoneyFromReference(newSubtotalCents, subtotalRef, cart);
        // Targets: Dawn .totals__subtotal-value, common fallbacks for other themes
        Array.prototype.slice.call(subtotalTargets).forEach(function (el) {
          if (shouldUpdateSubtotalNode(el) && !el.dataset.aiSubtotal) {
            el.textContent = subtotalStr;
            el.dataset.aiSubtotal = 'true';
          }
        });
      }
      hideInternalOfferNodes(document);
      hideAiDiscountApplicationNodes(document);

      // If we didn't patch via the API-derived cart data, fall back to detecting
      // discounts directly in the DOM - BUT ONLY if we didn't clear any bundle properties
      var hasBundleItems = cart.items.some(function(item) {
        return item.properties && 
               ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
      });
      
      // CRITICAL: If we cleared any bundle properties, don't call patchVisibleCartPricesFromDOM
      // because the DOM still has the old offer text from the server-rendered HTML
      if (!anyPatched && !hasBundleItems && !clearedAnyBundleProperties) {
        anyPatched = patchVisibleCartPricesFromDOM(document);
      } else if (clearedAnyBundleProperties) {
        console.log('[AI Upsell] 🛑 Skipping patchVisibleCartPricesFromDOM - cleared bundle properties, DOM still has old offer text');
        clearAiDiscountCodeFromCart().catch(function () {});
        maybeClearInvalidBundleProperties(null).catch(function () {});
      }

      // If we applied any patches and we have cart data, start a persistent watcher
      // to reapply them in case the theme re-renders the cart layout later.
      if (anyPatched && cart && Array.isArray(cart.items)) startPersistentPatchWatcher(cart);

      return anyPatched;
    }

    // ── Pre-process sections HTML before DOM insertion ─────────────────────────
    // Modifies the raw Shopify sections API HTML string so prices are already
    // correct BEFORE el.replaceWith(n). This avoids the race condition where the
    // theme re-renders the drawer in response to cart:updated and overwrites patches.
    function patchCartSectionHtml(sectionHtml, cart) {
      if (!sectionHtml || !cart || !Array.isArray(cart.items)) return sectionHtml;
      try {
        var doc = new DOMParser().parseFromString(sectionHtml, 'text/html');
        var modified = false;

        // ── Line item prices ───────────────────────────────────────────────────
        cart.items.forEach(function (item, index) {
          var discountPct = 0;
          if (item.properties && typeof item.properties === 'object') {
            var m = (item.properties['Offer'] || item.properties['offer'] || '').match(/(\d+(?:\.\d+)?)\s*%/);
            if (m) discountPct = parseFloat(m[1]);
          }
          if (discountPct <= 0) return;

          // CRITICAL: Check if this is a bundle item and if the bundle is complete
          var isBundleItem = item.properties && ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) || (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
          if (isBundleItem) {
            var bundleProductIds = item.properties._bundle_product_ids;
            if (bundleProductIds) {
              var expectedIds = bundleProductIds.split(',');
              var cartProductIds = cart.items.map(function(cartItem) { return String(cartItem.variant_id); });
              var allPresent = expectedIds.every(function(expectedId) {
                return cartProductIds.indexOf(expectedId) !== -1;
              });
              if (!allPresent) {
                console.log('[AI Upsell] 🛑 patchCartSectionHtml: Bundle is incomplete, skipping price patch for item', index);
                return; // Skip patching incomplete bundles
              }
            }
          }

          var storedOriginalCents3 = getStoredOriginalPriceCents(item.properties);
          var unitCents = storedOriginalCents3 || item.original_price || item.price;
          // Use the current selling price as the base price for display calculations.
          var baseCents = unitCents;
          var qty = item.quantity || 1;
          var originalLineCents = baseCents * qty;
          var originalUnitCents = baseCents;
          var discLineCents = Math.round(baseCents * (1 - discountPct / 100)) * qty;
          var itemEl = findCartLineContainer(doc, item, index);
          if (patchLineItemPriceDisplay(itemEl, discLineCents, cart, doc, originalLineCents, originalUnitCents)) modified = true;
          var detailCandidates = [
            item.original_price,
            item.price,
            item.final_price,
            qty > 0 ? Math.round((item.original_line_price || 0) / qty) : 0,
            qty > 0 ? Math.round((item.final_line_price || 0) / qty) : 0
          ].filter(function (value) { return isFinite(value) && value > 0 && value !== baseCents; });
          if (hideDetailUnitPriceNodes(itemEl, detailCandidates)) modified = true;
          if (hideDuplicateOfferNodes(itemEl)) modified = true;
          if (hideInternalOfferNodes(itemEl || doc)) modified = true;
        });

        if (!modified) return sectionHtml;

        // ── Subtotal ───────────────────────────────────────────────────────────
        var newSubtotalCents = 0;
        cart.items.forEach(function (it) {
          var pct = 0;
          var m = ((it.properties && (it.properties['Offer'] || it.properties['offer'])) || '').match(/(\d+(?:\.\d+)?)\s*%/);
          if (m) pct = parseFloat(m[1]);
          if (pct > 0) {
            var storedOriginalCents4 = getStoredOriginalPriceCents(it.properties);
            var u = storedOriginalCents4 || it.original_price || it.price;
            // Always use the current selling price as the base for discounts.
            var b = u;
            newSubtotalCents += Math.round(b * (1 - pct / 100)) * (it.quantity || 1);
          } else {
            newSubtotalCents += (it.final_line_price || it.original_line_price || it.price * (it.quantity || 1));
          }
        });
        var subtotalTargets = doc.querySelectorAll(
          '.totals__subtotal-value, .totals__total-value, ' +
          '[data-cart-subtotal], .cart-subtotal__price, ' +
          '.cart__subtotal, cart-drawer .totals p'
        );
        var subtotalRef = getSubtotalReferenceText(subtotalTargets);
        var subtotalStr = formatMoneyFromReference(newSubtotalCents, subtotalRef, cart);
        Array.prototype.slice.call(subtotalTargets).forEach(function (el) {
          if (shouldUpdateSubtotalNode(el)) el.textContent = subtotalStr;
        });

        hideInternalOfferNodes(doc);
        hideAiDiscountApplicationNodes(doc);

        return doc.body.innerHTML;
      } catch (e) {
        return sectionHtml; // safety fallback — return original if parsing fails
      }
    }

    // Debounced helper: fetch /cart.js then patch all prices + subtotal in the drawer.
    // Used when we need to patch without already holding cart data (drawer open, etc.).
    var _patchDebounceTimer = null;
    var _patchPersistentTimer = null;
    
    function patchCartDrawerPricesFromAPI() {
      if (__AI_UPSELL_PATCH_IN_FLIGHT__ || isCartPatchSuppressed()) return;
      __AI_UPSELL_PATCH_IN_FLIGHT__ = true;
      suppressCartPatchObservers(500);
      clearTimeout(_patchDebounceTimer);
      _patchDebounceTimer = setTimeout(function () {
        fetch(SHOPIFY_ROOT + 'cart.js')
          .then(function (r) { return r.json(); })
          .then(function (cart) {
            if (cart && cart.item_count === 0) {
              var drawer = document.querySelector('cart-drawer');
              if (drawer) {
                var upsell = drawer.querySelector('.ai-drawer-upsell');
                if (upsell) upsell.remove();
                drawer.classList.remove('ai-has-upsell');
                // Proactively add is-empty so Dawn shows "Your cart is empty".
                // Without this, Dawn's CSS hides .drawer__inner-empty because
                // cart-drawer:not(.is-empty) .drawer__inner-empty { display:none }.
                drawer.classList.add('is-empty');
                var emptyEl = drawer.querySelector('.drawer__inner-empty, .cart-drawer__empty-content');
                if (emptyEl) emptyEl.style.display = '';
              }
            }
            var patched = updateLineItemDiscountedPrices(cart);
            if (!patched) patchVisibleCartPricesFromDOM(document);
          })
          .catch(function () { patchVisibleCartPricesFromDOM(document); })
          .finally(function () {
            suppressCartPatchObservers(250);
            __AI_UPSELL_PATCH_IN_FLIGHT__ = false;
          });
      }, 120);
    }
    
    // Persistent patch watcher - reapplies patches if they get removed by theme
    var _patchWatcherInFlight = false;
    var _patchWatcherConsecutiveSuccess = 0;
    function startPersistentPatchWatcher(cart) {
      console.log('[AI Upsell] ⏰ Starting persistent patch watcher');
      if (_patchPersistentTimer) clearInterval(_patchPersistentTimer);
      var checksWithoutPatches = 0;
      _patchWatcherConsecutiveSuccess = 0;
      _patchPersistentTimer = setInterval(function () {
        // Skip if another patch is in-flight, bundle clearing is in progress, or patches are suppressed.
        if (_patchWatcherInFlight || window.__AI_UPSELL_SKIP_PRICE_PATCH__ || window.__AI_UPSELL_BUNDLE_CLEARING__) return;
        
        // CRITICAL: Check if bundle is incomplete - if so, stop the watcher immediately
        var bundleItems = document.querySelectorAll('[data-ai-discounted-node="true"]');
        if (bundleItems.length > 0) {
          // Check if any of these items are part of an incomplete bundle
          var hasBundleInCart = cart && cart.items && cart.items.some(function(item) {
            return item.properties && 
                   ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                    (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
          });
          
          if (hasBundleInCart) {
            // Fetch fresh cart to check if bundle is still complete
            fetch(SHOPIFY_ROOT + 'cart.js')
              .then(function(r) { return r.json(); })
              .then(function(freshCart) {
                var bundleItems = freshCart.items.filter(function(item) {
                  return item.properties && 
                         ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                          (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
                });
                
                // If bundle is incomplete, stop the watcher
                if (bundleItems.length > 0) {
                  bundleItems.forEach(function(bundleItem) {
                    var bundleProductIds = bundleItem.properties && bundleItem.properties._bundle_product_ids;
                    if (bundleProductIds) {
                      var expectedIds = bundleProductIds.split(',');
                      var cartProductIds = freshCart.items.map(function(cartItem) { return String(cartItem.variant_id); });
                      var allPresent = expectedIds.every(function(expectedId) {
                        return cartProductIds.indexOf(expectedId) !== -1;
                      });
                      
                      if (!allPresent) {
                        console.log('[AI Upsell] 🛑 Bundle is incomplete - stopping persistent watcher to prevent re-patching');
                        clearInterval(_patchPersistentTimer);
                        _patchPersistentTimer = null;
                        return;
                      }
                    }
                  });
                }
              })
              .catch(function() {});
          }
        }
        
        var hasAiPatch = document.querySelector('[data-ai-discounted-node="true"]');
        if (!hasAiPatch) {
          checksWithoutPatches++;
          _patchWatcherConsecutiveSuccess = 0;
          if (checksWithoutPatches < 5) {
            console.log('[AI Upsell] ⚠️  AI patch missing! Reapplying... (check', checksWithoutPatches, ')');
            _patchWatcherInFlight = true;
            // Always fetch fresh cart data so the bundle-completeness check reflects the
            // real cart state. Using the stale closure cart would re-apply discounts to
            // the remaining items after one bundle product is deleted from the drawer.
            fetch(SHOPIFY_ROOT + 'cart.js')
              .then(function(r) { return r.json(); })
              .then(function(freshCart) {
                if (!window.__AI_UPSELL_SKIP_PRICE_PATCH__ && !window.__AI_UPSELL_BUNDLE_CLEARING__) {
                  var patched = updateLineItemDiscountedPrices(freshCart);
                  
                  // CRITICAL: Check if bundle is incomplete before calling patchVisibleCartPricesFromDOM
                  if (!patched) {
                    var hasIncompleteBundles = false;
                    var bundleItems = freshCart.items.filter(function(item) {
                      return item.properties && 
                             ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
                              (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0));
                    });
                    
                    bundleItems.forEach(function(bundleItem) {
                      var bundleProductIds = bundleItem.properties && bundleItem.properties._bundle_product_ids;
                      if (bundleProductIds) {
                        var expectedIds = bundleProductIds.split(',');
                        var cartProductIds = freshCart.items.map(function(cartItem) { return String(cartItem.variant_id); });
                        var allPresent = expectedIds.every(function(expectedId) {
                          return cartProductIds.indexOf(expectedId) !== -1;
                        });
                        if (!allPresent) {
                          hasIncompleteBundles = true;
                        }
                      }
                    });
                    
                    if (!hasIncompleteBundles) {
                      patchVisibleCartPricesFromDOM(document);
                    } else {
                      console.log('[AI Upsell] 🛑 Incomplete bundles detected - skipping patchVisibleCartPricesFromDOM');
                    }
                  }
                }
              })
              .catch(function() {})
              .finally(function() {
                setTimeout(function() { _patchWatcherInFlight = false; }, 600);
              });
          } else {
            console.log('[AI Upsell] ⏰ Stopping persistent watcher - no patches detected after 5 checks');
            clearInterval(_patchPersistentTimer);
            _patchPersistentTimer = null;
          }
        } else {
          checksWithoutPatches = 0;
          _patchWatcherConsecutiveSuccess++;
          if (_patchWatcherConsecutiveSuccess >= 2) {
            console.log('[AI Upsell] ⏰ Patch confirmed stable - stopping persistent watcher');
            clearInterval(_patchPersistentTimer);
            _patchPersistentTimer = null;
          }
        }
      }, 500);
    }

    function refreshCartUI(upsellProductId) {
      console.log('[AI Upsell] 🔄 refreshCartUI called with product:', upsellProductId);
      // Add extra delay to ensure discount is fully processed by Shopify
      setTimeout(function() {
        var cacheParam = '&_t=' + Date.now();
        fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
          console.log('[AI Upsell] 📦 Cart state after discount:', { itemCount: cart.item_count, discountCode: cart.discount_code, items: cart.items.length });
          cart.items.forEach(function (it, idx) { console.log('[AI Upsell] - Item', idx, ':', it.title, 'Offer:', (it.properties && (it.properties['Offer'] || it.properties['offer'])) || 'none'); });
          updateCartCountBubble(cart.item_count);
          // Fetch sections with cache busting to ensure fresh render.
          // NOTE: main-cart-footer is intentionally NOT replaced here. Replacing the
          // cart-footer custom element triggers connectedCallback in the theme JS, which
          // temporarily hides .js-contents (the Estimated Total + checkout button).
          // Instead we update the total price in-place via updateLineItemDiscountedPrices.
          fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble,main-cart-items' + cacheParam).then(function (r) { return r.json(); }).then(function (sections) {
            console.log('[AI Upsell] 📄 Got sections:', Object.keys(sections));
            // Pre-process HTML to bake discounted prices in BEFORE DOM insertion.
            // This prevents the theme's own cart:updated handler from overwriting patches.
            if (sections['cart-drawer']) safelyUpdateDrawerFromSection(sections['cart-drawer'], cart, { allowFullReplace: true });
            if (sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
            if (sections['main-cart-items']) { console.log('[AI Upsell] 🔍 Looking for cart-items element'); var el3 = document.querySelector('cart-items'); console.log('[AI Upsell] cart-items found:', !!el3); if (el3) { var f3 = document.createElement('div'); f3.innerHTML = patchCartSectionHtml(sections['main-cart-items'], cart); var n3 = f3.querySelector('cart-items'); if (n3) el3.replaceWith(n3); } else { console.log('[AI Upsell] No cart-items found, calling updateLineItemDiscountedPrices directly'); updateLineItemDiscountedPrices(cart); } }
            // Update the estimated total in the existing footer without replacing the element.
            restoreCartFooterVisibility();
            // Always ensure cart prices are patched after section updates
            setTimeout(function () {
              console.log('[AI Upsell] ⏱️ Calling updateLineItemDiscountedPrices with delay');
              updateLineItemDiscountedPrices(cart);
              restoreCartFooterVisibility();
              // Dispatch cart:updated only after our DOM writes + footer restore are done
              // so the theme reacts to the already-updated DOM rather than racing against us.
              document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart, source: 'ai-upsell' } }));
              setTimeout(function () { restoreCartFooterVisibility(); }, 400);
              startPersistentPatchWatcher(cart);
            }, 100);
            placeInCartPage();
            refreshSecondaryFromCart(cart);
            loadDrawerUpsellsFromCart(cart);
            });
        });
      }, 500);
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
      var secBundles = products.filter(function(p) { return p.offerType === 'bundle'; });
      var secVolumes = products.filter(function(p) { return p.offerType === 'volume_discount'; });
      var secOthers = products.filter(function(p) { return p.offerType !== 'bundle' && p.offerType !== 'volume_discount'; });
      var html = '';
      if (secBundles.length > 0) {
        html += '<div class="ai-upsell-header"><h2 class="ai-upsell-title">Bundle &amp; Save</h2></div>' + buildMultiBundleCardHTML(window.__AI_SOURCE_PRODUCT__ || null, secBundles);
      }
      if (secVolumes.length > 0) {
        html += '<div class="ai-upsell-header" style="margin-top:24px"><h2 class="ai-upsell-title">Buy More, Save More</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + secVolumes.length + '">';
        secVolumes.forEach(function(p) { html += buildCardHTML(p); });
        html += '</div>';
      }
      if (secOthers.length > 0) {
        html += '<div class="ai-upsell-header" style="margin-top:24px"><h2 class="ai-upsell-title">' + getWidgetHeading(secOthers, 'Upsell Products') + '</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + secOthers.length + '">';
        secOthers.forEach(function(p) { html += buildCardHTML(p); });
        html += '</div>';
      }
      contentEl.innerHTML = html;
      if (loadingEl) loadingEl.style.display = 'none';
      attachQtyListeners(contentEl);
      attachVariantListeners(contentEl);
      attachMultiBundleListeners(contentEl);
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
            if (!variantId || variantId === 'null' || variantId === 'undefined' || variantId === String(upsellProductId)) {
              if (productData.variants && productData.variants.length > 0) {
                var _availVar = productData.variants.find(function(v) { return v && v.available !== false && v.id; }) || productData.variants[0];
                if (_availVar && _availVar.id && String(_availVar.id) !== String(upsellProductId)) variantId = String(_availVar.id);
              }
              if (!variantId || variantId === 'null' || variantId === 'undefined' || variantId === String(upsellProductId)) {
                if (productData.handle) {
                  try {
                    var _pRes = await fetch(SHOPIFY_ROOT + 'products/' + productData.handle + '.js');
                    if (_pRes.ok) {
                      var _pData = await _pRes.json();
                      var _firstVariant = (_pData.variants || [])[0];
                      if (_firstVariant && _firstVariant.id) variantId = String(_firstVariant.id);
                    }
                  } catch (_) {}
                }
              }
              if (!variantId || variantId === 'null' || variantId === String(upsellProductId)) {
                button.textContent = 'Failed'; button.style.background = '#d72c0d';
                setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000);
                return;
              }
            }
            var offerType = (productCard.dataset && productCard.dataset.offerType) || productData.offerType || 'addon_upsell';
            var sellingPlanId = normalizeSellingPlanId((productCard.dataset && productCard.dataset.sellingPlanId) || productData.sellingPlanIdNumeric || productData.sellingPlanId);
            var effectiveDiscount;
            var allDiscountProductIds = [upsellProductId];
            var cartDataVD1 = null;
            var currentGoalSecondary = getCurrentGoal();
            await ensureCartGoalAttribute(currentGoalSecondary);
            if (offerType === 'volume_discount') {
              var cartResVD1 = await fetch('/cart.js');
              cartDataVD1 = await cartResVD1.json();
              var totalCartQty1 = getCartTotalQuantity(cartDataVD1);
              var totalQtySecondary = totalCartQty1 + quantity;
              effectiveDiscount = getVolumeDiscountPercent(productData, isImmediateDiscountGoal(currentGoalSecondary) ? Math.max(totalQtySecondary, getMinVolumeQuantity(productData) || totalQtySecondary) : totalQtySecondary);
              var minQtySecondary = getMinVolumeQuantity(productData);
              if (!isImmediateDiscountGoal(currentGoalSecondary) && minQtySecondary && totalQtySecondary < minQtySecondary) effectiveDiscount = 0;
              allDiscountProductIds = Array.from(new Set(getCartProductIdList(cartDataVD1).concat([upsellProductId])));
            } else if (offerType === 'bundle' && !sourceVariantId) {
              // Intentionally removed clamping
            } else { effectiveDiscount = parseFloat(productData.discountPercent) || 0; }
            effectiveDiscount = normalizeImmediateDiscount(offerType, productData, effectiveDiscount, currentGoalSecondary);
            var gateResultSecondary = await applyGoalDiscountGate(currentGoalSecondary, effectiveDiscount, cartDataVD1, quantity + (sourceVariantId ? 1 : 0));
            effectiveDiscount = gateResultSecondary.discount;
            if (!cartDataVD1 && gateResultSecondary.cartData) cartDataVD1 = gateResultSecondary.cartData;
            var discountTargetsSecondary = await buildDiscountTargets(allDiscountProductIds, cartDataVD1, currentGoalSecondary);
            var offerPropsSecondary = getOfferProperties(
              offerType,
              effectiveDiscount,
              currentGoalSecondary,
              resolveOriginalBasePrice(productData, productCard),
              resolveFunctionDiscountPercent(productData, productCard, effectiveDiscount)
            );
          try {
             button.disabled = true; button.textContent = 'Adding...';
             var discountTargetProducts = sourceVariantId ? [sourceProductId].concat(discountTargetsSecondary) : discountTargetsSecondary;
             console.log('[AI Upsell] Secondary: goal=' + currentGoalSecondary + ' discount=' + effectiveDiscount + ' shouldUseFunction=' + shouldUseFunctionDiscount(currentGoalSecondary));
             console.log('[AI Upsell] Secondary Offer properties:', offerPropsSecondary);
             var discountCode = effectiveDiscount > 0 ? await createDiscountCode(discountTargetProducts, effectiveDiscount) : null;
             console.log('[AI Upsell] Secondary Discount code created:', discountCode);
             window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
            var cartPayload = sourceVariantId ? { items: [{ id: sourceVariantId, quantity: 1, ...offerPropsSecondary }, { id: variantId, quantity: quantity, ...offerPropsSecondary }] } : { id: variantId, quantity: quantity, ...offerPropsSecondary };
            console.log('[AI Upsell] Secondary Cart payload:', cartPayload);
            if (sellingPlanId && offerType === 'subscription_upgrade' && !sourceVariantId) cartPayload.selling_plan = sellingPlanId;
            await (_aiCartAddQueue = _aiCartAddQueue.catch(function() {}).then(function() {
              return addToCartAndRefresh(variantId, quantity, cartPayload, discountCode);
            }));
            if (offerType === 'volume_discount' && effectiveDiscount > 0) {
              var minQtyApplied2 = getMinVolumeQuantity(productData);
              try { sessionStorage.setItem('__ai_volume_target__', JSON.stringify({ productId: upsellProductId, minQty: minQtyApplied2 || quantity, code: discountCode })); } catch (_) {}
            }
            if (offerType === 'volume_discount' && effectiveDiscount > 0) {
              var minQtyApplied = getMinVolumeQuantity(productData);
              try { sessionStorage.setItem('__ai_volume_target__', JSON.stringify({ productId: upsellProductId, minQty: minQtyApplied || quantity, code: discountCode })); } catch (_) {}
            }
            fetch('/apps/ai-upsell/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'cart_add', shopId: _C.shopDomain, sessionId: window.__AI_UPSELL_USER_ID__ || null, userId: window.__AI_UPSELL_USER_ID__ || null, sourceProductId: secondarySourceProductId ? secondarySourceProductId.toString() : null, sourceProductName: 'Secondary Recommendation', upsellProductId: upsellProductId, upsellProductName: productTitle, variantId: variantId, recommendationType: recommendationType, confidence: parseFloat(confidence), quantity: quantity, metadata: { location: 'cart_page_secondary', offerType: offerType, discountPercent: effectiveDiscount, segment: _C.customerSegment || window.__AI_UPSELL_SEGMENT__ || 'anonymous' } }) }).catch(function () {});
            refreshCartUI(upsellProductId);
            try { sessionStorage.setItem('lastAiUpsellProduct', upsellProductId); } catch (_) {}
            document.dispatchEvent(new CustomEvent('ai-upsell:product-added', { detail: { productId: upsellProductId, source: 'ai-upsell' } }));
            // Option 1 (direct refresh): avoid local removal to prevent 4→3 flicker.
            // The list will be refreshed via refreshCartUI -> refreshSecondaryFromCart.
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
        startLoadingFallback(widget, loadingEl, 15000);
        var products = null;
        try { products = await fetchAiRecommendations(currentProductId, MAX_PRODUCTS); } catch (fetchErr) { console.error('[AI Upsell] fetchAiRecommendations error:', fetchErr); }
        var _lastDecision = window.__AI_UPSELL_LAST_DECISION__;
        if (!products && (!_lastDecision || _lastDecision.status !== 'safety_mode')) { try { products = await fetchShopifyRecommendations(currentProductId, MAX_PRODUCTS); } catch (fallbackErr) { console.error('[AI Upsell] fetchShopifyRecommendations error:', fallbackErr); } }
        console.log('[AI Upsell] Products fetched:', products ? products.length : 0);
        if (products && products.length > 0) { console.log('[AI Upsell] First product:', JSON.stringify(products[0]).substring(0, 300)); }
        if (!products || products.length === 0) { clearLoadingFallback(widget); widget.__aiUpsellFetchInFlight = false; widget.style.display = 'none'; return; }
        var productMap = new Map(products.map(function (p) { return [String(p.id), p]; }));
        if (secondaryAllProducts.length === 0) secondaryAllProducts = products;
        var bundles = products.filter(function(p) { return p.offerType === 'bundle'; });
        var volumes = products.filter(function(p) { return p.offerType === 'volume_discount'; });
        var others = products.filter(function(p) { return p.offerType !== 'bundle' && p.offerType !== 'volume_discount'; });
        var html = '';
        if (bundles.length > 0) {
          html += '<div class="ai-upsell-header"><h2 class="ai-upsell-title">Bundle &amp; Save</h2></div>' + buildMultiBundleCardHTML(window.__AI_SOURCE_PRODUCT__ || null, bundles);
        }
        if (volumes.length > 0) {
          html += '<div class="ai-upsell-header" style="margin-top:24px"><h2 class="ai-upsell-title">Buy More, Save More</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + volumes.length + '">';
          volumes.forEach(function(p, idx) { try { html += buildCardHTML(p); } catch(e) { console.error('[AI Upsell] buildCardHTML error:', e); } });
          html += '</div>';
        }
        if (others.length > 0) {
          html += '<div class="ai-upsell-header" style="margin-top:24px"><h2 class="ai-upsell-title">' + getWidgetHeading(others, 'Recommended for You', _C.heading) + '</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + others.length + '">';
          others.forEach(function(p, idx) { try { html += buildCardHTML(p); } catch(e) { console.error('[AI Upsell] buildCardHTML error:', e); } });
          html += '</div>';
        }
        console.log('[AI Upsell] HTML built, length=' + html.length + ', rendering now...');
        clearLoadingFallback(widget);
        widget.__aiUpsellFetched = true; widget.__aiUpsellFetchInFlight = false; widget.__aiUpsellLastFetchAt = Date.now();
        widget.style.display = 'block';
        loadingEl.style.display = 'none'; contentEl.innerHTML = html; contentEl.style.display = 'block';
        console.log('[AI Upsell] ✅ Products rendered successfully');
        attachQtyListeners(contentEl); attachVariantListeners(contentEl); attachMultiBundleListeners(contentEl);
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
            // Validate variantId — if missing or same as productId, fetch real variant from Shopify storefront
            if (!variantId || variantId === 'null' || variantId === 'undefined' || variantId === String(upsellProductId)) {
              // Try 1: use variants already available in productData
              if (productData.variants && productData.variants.length > 0) {
                var _availVar = productData.variants.find(function(v) { return v && v.available !== false && v.id; }) || productData.variants[0];
                if (_availVar && _availVar.id && String(_availVar.id) !== String(upsellProductId)) {
                  variantId = String(_availVar.id);
                  console.log('[AI Upsell] PDP: resolved variantId=' + variantId + ' from productData.variants for product', upsellProductId);
                }
              }
              // Try 2: fetch from storefront via handle
              if (!variantId || variantId === 'null' || variantId === 'undefined' || variantId === String(upsellProductId)) {
                var _handle = productData.handle;
                if (_handle) {
                  try {
                    var _pRes = await fetch(SHOPIFY_ROOT + 'products/' + _handle + '.js');
                    if (_pRes.ok) {
                      var _pData = await _pRes.json();
                      var _firstVariant = (_pData.variants || [])[0];
                      if (_firstVariant && _firstVariant.id) {
                        variantId = String(_firstVariant.id);
                        console.log('[AI Upsell] PDP: resolved real variantId=' + variantId + ' via storefront for product', upsellProductId);
                      }
                    }
                  } catch (_) {}
                }
              }
              if (!variantId || variantId === 'null' || variantId === String(upsellProductId)) {
                console.error('[AI Upsell] PDP: cannot resolve variantId for product', upsellProductId);
                button.textContent = 'Failed'; button.style.background = '#d72c0d';
                setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000);
                return;
              }
            }
            console.log('[AI Upsell] PDP add-to-cart clicked: variantId=' + variantId + ' productId=' + upsellProductId);
            var offerType = (productCard.dataset && productCard.dataset.offerType) || productData.offerType || 'addon_upsell';
            var sellingPlanId = normalizeSellingPlanId((productCard.dataset && productCard.dataset.sellingPlanId) || productData.sellingPlanIdNumeric || productData.sellingPlanId);
            var effectiveDiscount;
            var allDiscountProductIds = [upsellProductId];
            var cartData = null;
            var currentGoalPdp = getCurrentGoal();
            await ensureCartGoalAttribute(currentGoalPdp);
            if (offerType === 'volume_discount') {
              var cartRes = await fetch('/cart.js'); cartData = await cartRes.json();
              var totalCartQty = getCartTotalQuantity(cartData);
              var totalQty = totalCartQty + quantity;
              effectiveDiscount = getVolumeDiscountPercent(productData, isImmediateDiscountGoal(currentGoalPdp) ? Math.max(totalQty, getMinVolumeQuantity(productData) || totalQty) : totalQty);
              var minQty = getMinVolumeQuantity(productData);
              if (!isImmediateDiscountGoal(currentGoalPdp) && minQty && totalQty < minQty) effectiveDiscount = 0;
              allDiscountProductIds = Array.from(new Set(getCartProductIdList(cartData).concat([upsellProductId])));
            } else if (offerType === 'bundle' && !sourceVariantId) {
              // Intentionally removed clamping
            } else { effectiveDiscount = parseFloat(discountPercent) || parseFloat(productData.discountPercent) || 0; }
            effectiveDiscount = normalizeImmediateDiscount(offerType, productData, effectiveDiscount, currentGoalPdp);
            var gateResultPdp = await applyGoalDiscountGate(currentGoalPdp, effectiveDiscount, cartData, quantity + (sourceVariantId ? 1 : 0));
            effectiveDiscount = gateResultPdp.discount;
            if (!cartData && gateResultPdp.cartData) cartData = gateResultPdp.cartData;
            var discountTargetsPdp = await buildDiscountTargets(allDiscountProductIds, cartData, currentGoalPdp);
            var offerPropsPdp = getOfferProperties(
              offerType,
              effectiveDiscount,
              currentGoalPdp,
              resolveOriginalBasePrice(productData, productCard),
              resolveFunctionDiscountPercent(productData, productCard, effectiveDiscount)
            );
            try {
              button.disabled = true; button.textContent = 'Adding...';
              var discountTargetProducts = sourceVariantId ? [sourceProductId].concat(discountTargetsPdp) : discountTargetsPdp;
              console.log('[AI Upsell] PDP: goal=' + currentGoalPdp + ' discount=' + effectiveDiscount);
              var discountCode = effectiveDiscount > 0 ? await createDiscountCode(discountTargetProducts, effectiveDiscount) : null;
              window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
              var cartPayload = sourceVariantId ? { items: [{ id: sourceVariantId, quantity: 1, ...offerPropsPdp }, { id: variantId, quantity: quantity, ...offerPropsPdp }] } : { id: variantId, quantity: quantity, ...offerPropsPdp };
              if (sellingPlanId && offerType === 'subscription_upgrade' && !sourceVariantId) cartPayload.selling_plan = sellingPlanId;
              // Request inline sections so Shopify returns fresh cart-drawer HTML atomically
              cartPayload.sections = 'cart-drawer,cart-icon-bubble';
              // Serialize against any concurrent cart add (prevents Shopify cart conflicts)
              var addData = await (_aiCartAddQueue = _aiCartAddQueue.catch(function() {}).then(function() {
                return addToCartAndRefresh(variantId, quantity, cartPayload, discountCode);
              }));
              fetch('/apps/ai-upsell/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'cart_add', shopId: _C.shopDomain, sessionId: window.__AI_UPSELL_USER_ID__ || null, userId: window.__AI_UPSELL_USER_ID__ || null, sourceProductId: PRODUCT_ID, sourceProductName: _C.productTitle || '', upsellProductId: upsellProductId, upsellProductName: productTitle, variantId: variantId, recommendationType: recommendationType, confidence: parseFloat(confidence), quantity: quantity, metadata: { location: 'product_detail_page', offerType: offerType, discountPercent: effectiveDiscount, segment: _C.customerSegment || window.__AI_UPSELL_SEGMENT__ || 'anonymous' } }) }).catch(function () {});
              fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
                updateCartCountBubble(cart.item_count);
                var drawerEl = document.querySelector('cart-drawer');
                var drawerOpen = isDrawerVisiblyOpen(drawerEl);
                if (drawerEl && !drawerOpen) {
                  keepDrawerOpen(drawerEl);
                  var overlay = document.getElementById('CartDrawer-Overlay');
                  if (overlay) {
                    overlay.classList.add('active');
                    if (!overlay.__aiOverlayBound) {
                      overlay.__aiOverlayBound = true;
                      overlay.addEventListener('click', function () { if (drawerEl && drawerEl.close) drawerEl.close(); });
                    }
                  }
                }
                // Open drawer before rendering — keepDrawerOpen adds 'active' class so Dawn's
                // own open() returns early and does NOT call its renderContents(null) which
                // would overwrite our content with stale data.
                var freshDrawerEl = document.querySelector('cart-drawer');
                if (freshDrawerEl && !isDrawerVisiblyOpen(freshDrawerEl)) {
                  keepDrawerOpen(freshDrawerEl);
                  var ov = document.getElementById('CartDrawer-Overlay');
                  if (ov) { ov.classList.add('active'); if (!ov.__aiOverlayBound) { ov.__aiOverlayBound = true; ov.addEventListener('click', function () { if (freshDrawerEl && freshDrawerEl.close) freshDrawerEl.close(); }); } }
                }
                // Mirror exactly the working drawer-add flow: prefer Dawn's native renderContents,
                // fall back to manual section injection.
                var inlineSections = addData && addData.sections ? addData.sections : null;
                var latestDrawer = document.querySelector('cart-drawer');
                if (latestDrawer && typeof latestDrawer.renderContents === 'function' && addData && addData.sections) {
                  latestDrawer.renderContents(addData);
                } else if (inlineSections && inlineSections['cart-drawer']) {
                  safelyUpdateDrawerFromSection(inlineSections['cart-drawer'], cart, { allowFullReplace: true });
                  ensureDrawerShowsCartItems(cart);
                } else {
                  fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble').then(function (r) { return r.json(); }).then(function (sections) {
                    var ld = document.querySelector('cart-drawer');
                    if (ld && typeof ld.renderContents === 'function' && sections) {
                      ld.renderContents({ sections: sections });
                    } else if (sections && sections['cart-drawer']) {
                      safelyUpdateDrawerFromSection(sections['cart-drawer'], cart, { allowFullReplace: true });
                      ensureDrawerShowsCartItems(cart);
                    }
                    if (sections && sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
                  }).catch(function () {});
                }
                if (inlineSections && inlineSections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = inlineSections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
                // Re-confirm drawer is open after renderContents (it may have closed is-empty state)
                var afterDrawer = document.querySelector('cart-drawer');
                if (afterDrawer) keepDrawerOpen(afterDrawer);
                setTimeout(function () {
                  updateLineItemDiscountedPrices(cart);
                  restoreCartFooterVisibility();
                  startPersistentPatchWatcher(cart);
                }, 500);
                setTimeout(function () { updateLineItemDiscountedPrices(cart); restoreCartFooterVisibility(); }, 900);
                document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart, source: 'ai-upsell' } }));
              });
              button.textContent = 'Added \u2713'; button.style.background = '#008060';
              try { sessionStorage.setItem('lastAiUpsellProduct', upsellProductId); } catch (_) {}
              document.dispatchEvent(new CustomEvent('ai-upsell:product-added', { detail: { productId: upsellProductId, source: 'ai-upsell' } }));
              setTimeout(function () { button.textContent = originalText; button.disabled = false; }, 2000);
            } catch (addErr) { console.error('[AI Upsell] PDP add-to-cart error:', addErr && addErr.message ? addErr.message : addErr); button.textContent = 'Failed'; button.style.background = '#d72c0d'; setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000); }
          });
        });
      } catch (renderErr) { console.error('[AI Upsell] loadAIUpsells render error:', renderErr); clearLoadingFallback(widget); widget.__aiUpsellFetchInFlight = false; widget.style.display = 'none'; }
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
        var cartBundles = products.filter(function(p) { return p.offerType === 'bundle'; });
        var cartVolumes = products.filter(function(p) { return p.offerType === 'volume_discount'; });
        var cartOthers = products.filter(function(p) { return p.offerType !== 'bundle' && p.offerType !== 'volume_discount'; });
        var html = '';
        if (cartBundles.length > 0) {
          html += '<div class="ai-upsell-header"><h2 class="ai-upsell-title">Bundle &amp; Save</h2></div>' + buildMultiBundleCardHTML(null, cartBundles);
        }
        if (cartVolumes.length > 0) {
          html += '<div class="ai-upsell-header" style="margin-top:24px"><h2 class="ai-upsell-title">Buy More, Save More</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + cartVolumes.length + '">';
          cartVolumes.forEach(function(p) { html += buildCardHTML(p); });
          html += '</div>';
        }
        if (cartOthers.length > 0) {
          html += '<div class="ai-upsell-header" style="margin-top:24px"><h2 class="ai-upsell-title">' + getWidgetHeading(cartOthers, 'Recommended for You', _C.heading) + '</h2></div><div class="ai-upsell-grid ai-upsell-grid-' + cartOthers.length + '">';
          cartOthers.forEach(function(p) { html += buildCardHTML(p); });
          html += '</div>';
        }
        clearLoadingFallback(widget);
        loadingEl.style.display = 'none'; contentEl.innerHTML = html; contentEl.style.display = 'block';
        attachQtyListeners(contentEl); attachVariantListeners(contentEl); attachMultiBundleListeners(contentEl);
        trackViewEvents(products, { location: 'cart_page', sourceProductId: cart.items[0] && cart.items[0].product_id || null, sourceProductName: sourceTitle });

        contentEl.querySelectorAll('.ai-add-to-cart-btn').forEach(function (button) {
          button.addEventListener('click', async function (e) {
            e.preventDefault(); e.stopPropagation();
            var variantId = button.getAttribute('data-variant-id');
            var sourceVariantId = button.getAttribute('data-source-variant-id');
            var upsellProductId = button.getAttribute('data-product-id');
            var recommendationType = button.getAttribute('data-recommendation-type');
            var confidence = button.getAttribute('data-confidence');
            var originalText = button.textContent;
            var productCard = button.closest('.ai-upsell-card');
            var qtyInput = productCard.querySelector('.ai-qty-input');
            var quantity = qtyInput ? parseInt(qtyInput.value) : 1;
            var productTitle = (productCard.querySelector('.ai-upsell-product-title') || {}).textContent || 'Unknown Product';
            var productData = productMap.get(String(upsellProductId)) || {};
            if (!variantId || variantId === 'null' || variantId === 'undefined' || variantId === String(upsellProductId)) {
              if (productData.variants && productData.variants.length > 0) {
                var _availVar = productData.variants.find(function(v) { return v && v.available !== false && v.id; }) || productData.variants[0];
                if (_availVar && _availVar.id && String(_availVar.id) !== String(upsellProductId)) variantId = String(_availVar.id);
              }
              if (!variantId || variantId === 'null' || variantId === 'undefined' || variantId === String(upsellProductId)) {
                if (productData.handle) {
                  try {
                    var _pRes = await fetch(SHOPIFY_ROOT + 'products/' + productData.handle + '.js');
                    if (_pRes.ok) {
                      var _pData = await _pRes.json();
                      var _firstVariant = (_pData.variants || [])[0];
                      if (_firstVariant && _firstVariant.id) variantId = String(_firstVariant.id);
                    }
                  } catch (_) {}
                }
              }
              if (!variantId || variantId === 'null' || variantId === String(upsellProductId)) {
                button.textContent = 'Failed'; button.style.background = '#d72c0d';
                setTimeout(function () { button.textContent = originalText; button.disabled = false; button.style.background = ''; }, 2000);
                return;
              }
            }
            var offerType = (productCard.dataset && productCard.dataset.offerType) || productData.offerType || 'addon_upsell';
            var sellingPlanId = normalizeSellingPlanId((productCard.dataset && productCard.dataset.sellingPlanId) || productData.sellingPlanIdNumeric || productData.sellingPlanId);
            var effectiveDiscount;
            var allDiscountProductIds = [upsellProductId];
            var cartData2 = null;
            var currentGoalCartPage = getCurrentGoal();
            await ensureCartGoalAttribute(currentGoalCartPage);
            if (offerType === 'volume_discount') {
              var cartRes2 = await fetch('/cart.js'); cartData2 = await cartRes2.json();
              var totalCartQty2 = getCartTotalQuantity(cartData2);
              var totalQty2 = totalCartQty2 + quantity;
              effectiveDiscount = getVolumeDiscountPercent(productData, isImmediateDiscountGoal(currentGoalCartPage) ? Math.max(totalQty2, getMinVolumeQuantity(productData) || totalQty2) : totalQty2);
              var minQty2 = getMinVolumeQuantity(productData);
              if (!isImmediateDiscountGoal(currentGoalCartPage) && minQty2 && totalQty2 < minQty2) effectiveDiscount = 0;
              allDiscountProductIds = Array.from(new Set(getCartProductIdList(cartData2).concat([upsellProductId])));
            } else if (offerType === 'bundle' && !sourceVariantId) {
              // Intentionally removed clamping
            } else { effectiveDiscount = parseFloat(productData.discountPercent) || 0; }
            effectiveDiscount = normalizeImmediateDiscount(offerType, productData, effectiveDiscount, currentGoalCartPage);
            var gateResultCartPage = await applyGoalDiscountGate(currentGoalCartPage, effectiveDiscount, cartData2, quantity + (sourceVariantId ? 1 : 0));
            effectiveDiscount = gateResultCartPage.discount;
            if (!cartData2 && gateResultCartPage.cartData) cartData2 = gateResultCartPage.cartData;
            var discountTargetsCartPage = await buildDiscountTargets(allDiscountProductIds, cartData2, currentGoalCartPage);
            var offerPropsCartPage = getOfferProperties(
              offerType,
              effectiveDiscount,
              currentGoalCartPage,
              resolveOriginalBasePrice(productData, productCard),
              resolveFunctionDiscountPercent(productData, productCard, effectiveDiscount)
            );
            try {
              button.disabled = true; button.textContent = 'Adding...';
              console.log('[AI Upsell] Cart: goal=' + currentGoalCartPage + ' discount=' + effectiveDiscount + ' targets=' + JSON.stringify(discountTargetsCartPage));
              console.log('[AI Upsell] Offer properties:', offerPropsCartPage);
              var discountCode = effectiveDiscount > 0 ? await createDiscountCode(discountTargetsCartPage, effectiveDiscount) : null;
              console.log('[AI Upsell] Discount code created:', discountCode);
              window.__AI_UPSELL_SKIP_NEXT_CART_ADD__ = true;
              var cartPayload = { id: variantId, quantity: quantity, ...offerPropsCartPage };
              console.log('[AI Upsell] Cart payload:', cartPayload);
              if (sellingPlanId && offerType === 'subscription_upgrade') cartPayload.selling_plan = sellingPlanId;
              await addToCartAndRefresh(variantId, quantity, cartPayload, discountCode);
              fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
                var originalCartItems = (cart.items || []).filter(function (item) { return String(item.product_id) !== String(upsellProductId); });
                fetch('/apps/ai-upsell/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventType: 'cart_add', shopId: _C.shopDomain, sessionId: window.__AI_UPSELL_USER_ID__ || null, userId: window.__AI_UPSELL_USER_ID__ || null, sourceProductId: originalCartItems.length > 0 ? originalCartItems[0].product_id.toString() : null, sourceProductName: originalCartItems.map(function (i) { return i.product_title; }).join(', ') || 'Cart Items', upsellProductId: upsellProductId, upsellProductName: productTitle, variantId: variantId, recommendationType: recommendationType, confidence: parseFloat(confidence), quantity: quantity, metadata: { location: 'cart_page', offerType: offerType, discountPercent: effectiveDiscount, segment: _C.customerSegment || window.__AI_UPSELL_SEGMENT__ || 'anonymous' } }) }).catch(function () {});
                updateCartCountBubble(cart.item_count);
                // main-cart-footer intentionally omitted — replacing it triggers connectedCallback
                // in the theme's cart-footer element which hides .js-contents (Estimated Total + checkout).
                // The total is updated in-place by updateLineItemDiscountedPrices below.
                fetch(SHOPIFY_ROOT + '?sections=cart-drawer,cart-icon-bubble,main-cart-items').then(function (r) { return r.json(); }).then(function (sections) {
                  if (sections['cart-drawer']) safelyUpdateDrawerFromSection(sections['cart-drawer'], cart, { allowFullReplace: true });
                  if (sections['cart-icon-bubble']) { var el2 = document.getElementById('cart-icon-bubble'); if (el2) { var f2 = document.createElement('div'); f2.innerHTML = sections['cart-icon-bubble']; var n2 = f2.querySelector('#cart-icon-bubble'); if (n2) { el2.replaceWith(n2); updateCartCountBubble(cart.item_count); } } }
                  if (sections['main-cart-items']) { var el3 = document.querySelector('cart-items'); if (el3) { var f3 = document.createElement('div'); f3.innerHTML = patchCartSectionHtml(sections['main-cart-items'], cart); var n3 = f3.querySelector('cart-items'); if (n3) el3.replaceWith(n3); } }
                  restoreCartFooterVisibility();
                  setTimeout(function () {
                    updateLineItemDiscountedPrices(cart);
                    restoreCartFooterVisibility();
                    document.documentElement.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: cart, source: 'ai-upsell' } }));
                    setTimeout(function () { restoreCartFooterVisibility(); }, 400);
                  }, 100);
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
      var hasExistingContent = secondaryAllProducts.length > 0 && contentEl && contentEl.children && contentEl.children.length > 0;
      if (!hasExistingContent) {
        if (loadingEl) loadingEl.style.display = 'block';
        if (contentEl) contentEl.innerHTML = '';
        startLoadingFallback(secondaryWidget, loadingEl, 6000);
      } else {
        if (loadingEl) loadingEl.style.display = 'none';
      }
      try {
        var productGids = productIds.map(function (id) { return 'gid://shopify/Product/' + id; });
        var cartUid = window.__AI_UPSELL_USER_ID__ || '';
        var segment = window.__AI_UPSELL_SEGMENT__ || _C.customerSegment || '';
        var ts = Date.now();
        var apiUrl = '/apps/ai-upsell/cart?ids=' + encodeURIComponent(JSON.stringify(productGids)) + (cartUid ? '&userId=' + encodeURIComponent(cartUid) : '') + (segment ? '&segment=' + encodeURIComponent(segment) : '') + '&_t=' + ts;
        var fetchPromise = window.__AI_CART_PREFETCH__;
        if (fetchPromise) window.__AI_CART_PREFETCH__ = null; else fetchPromise = fetch(apiUrl);
        var response = await fetchPromise;
        if (!response.ok) throw new Error('Failed');
        var data = await response.json();
        setDecisionMeta(data.decision);
        var products = (data.success && data.recommendations && data.recommendations.length > 0) ? uniqueSecondaryById(data.recommendations).slice(0, MAX_PRODUCTS) : [];
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
        // Patch any existing discounted items on cart page load.
        // Run at 100ms, 800ms, and 2500ms to survive theme re-renders
        // (e.g. Dawn's <cart-items> connectedCallback fires after DOMContentLoaded).
        [100, 800, 2500].forEach(function (delay) {
          setTimeout(function () {
            fetch('/cart.js')
              .then(function (r) { return r.json(); })
              .then(function (cart) {
                return syncStoredDiscountToCart(cart).then(function (resolvedCart) {
                  return resolvedCart || cart;
                }).catch(function () {
                  return cart;
                });
              })
              .then(function (cart) {
                var patched = updateLineItemDiscountedPrices(cart);
                if (!patched) patchVisibleCartPricesFromDOM(document);
              })
              .catch(function () { patchVisibleCartPricesFromDOM(document); });
          }, delay);
        });
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

    function ensureProductFetch(force) {
      var isCartPage = window.location.pathname === '/cart' || window.location.pathname.startsWith('/cart');
      if (isCartPage) return;
      pickWidgets();
      if (!widget || widget.__aiUpsellFetchInFlight) return;
      var pid = resolveProductId();
      if (!pid) return;
      if (force) {
        var lastAt = widget.__aiUpsellLastFetchAt || 0;
        if (Date.now() - lastAt < 2000) return;
        widget.__aiUpsellFetched = false;
      } else if (widget.__aiUpsellFetched) {
        return;
      }
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
      document.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var bundleButton = target.closest('.ai-multi-bundle-btn');
        if (bundleButton) {
          handleMultiBundleAdd(bundleButton, event);
          return;
        }
        var control = target.closest(
          'cart-remove-button, .cart-remove-button, .cart-item__remove, .cart-drawer__remove, ' +
          '[id^="CartDrawer-Remove-"], [id^="CartItem-Remove-"], [id*="Remove-"], ' +
          'a[href*="/cart/change"], a[href*="quantity=0"], button[name="remove"], ' +
          'button[aria-label*="Remove"], button[aria-label*="remove"], ' +
          'button[title*="Remove"], button[title*="remove"]'
        );
        if (!control) {
          var maybeRow = findCartRowFromControl(target);
          if (maybeRow && rowLooksLikeAiOffer(maybeRow)) {
            var maybeRemove = target.closest('button, a');
            var maybeRemoveText = getElementText(maybeRemove) + ' ' + ((maybeRemove && maybeRemove.getAttribute && (maybeRemove.getAttribute('aria-label') || maybeRemove.getAttribute('title') || maybeRemove.id || maybeRemove.className)) || '');
            if (/remove|delete|trash/i.test(String(maybeRemoveText))) control = maybeRemove;
          }
        }
        if (!control) return;
        var row = findCartRowFromControl(control);
        if (!row || !rowLooksLikeAiOffer(row)) {
          // Non-AI row removed by theme — check after theme finishes its AJAX
          setTimeout(function () {
            fetch(SHOPIFY_ROOT + 'cart.js').then(function (r) { return r.json(); }).then(function (cart) {
              if (cart && cart.item_count === 0) {
                var drawer = document.querySelector('cart-drawer');
                if (drawer) {
                  var upsell = drawer.querySelector('.ai-drawer-upsell');
                  if (upsell) upsell.remove();
                  drawer.classList.remove('ai-has-upsell');
                  drawer.classList.add('is-empty');
                  var emptyEl = drawer.querySelector('.drawer__inner-empty, .cart-drawer__empty-content');
                  if (emptyEl) emptyEl.style.display = '';
                }
              }
              // If a bundle item was removed, clear the bundle discount from remaining items.
              maybeClearInvalidBundleProperties(cart).catch(function () {});
            }).catch(function () {});
          }, 500);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        removeAiCartLineByControl(control).then(function(removed) {
          if (removed) return;
          // Fallback: our item-matching failed, but we already stopped the event.
          // Attempt removal directly using the key or line index from the DOM element
          // so the item doesn't get silently stuck in the cart.
          var fallbackKey = getCartItemKeyFromControl(control);
          var fallbackLine = getLineIndexFromCartControl(control, row);
          if (!fallbackKey && !fallbackLine) return;
          var payload = fallbackKey ? { id: fallbackKey, quantity: 0 } : { line: fallbackLine, quantity: 0 };
          fetch(SHOPIFY_ROOT + 'cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function(r) { return r.json(); }).then(function(updatedCart) {
            var inlineSections = updatedCart.sections || null;
            if (inlineSections) delete updatedCart.sections;
            if (cartHasIncompleteBundle(updatedCart)) {
              window.__AI_UPSELL_SKIP_PRICE_PATCH__ = true;
              maybeClearInvalidBundleProperties(updatedCart, true).then(function() {
                return fetch(SHOPIFY_ROOT + 'cart.js?t=' + Date.now());
              }).then(function(res) {
                return res && res.ok ? res.json() : updatedCart;
              }).then(function(freshCart) {
                window.__AI_UPSELL_SKIP_PRICE_PATCH__ = false;
                refreshDrawerAfterAiCartChange(freshCart, null);
              }).catch(function() {
                window.__AI_UPSELL_SKIP_PRICE_PATCH__ = false;
                refreshDrawerAfterAiCartChange(updatedCart, null);
              });
              return;
            }
            refreshDrawerAfterAiCartChange(updatedCart, inlineSections);
          }).catch(function() {});
        }).catch(function (err) {
          console.error('[AI Upsell] AI cart remove handler error:', err && err.message ? err.message : err);
        });
      }, true);
    }

    startProductPlacement();
    setTimeout(ensureProductFetch, 800);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') ensureProductFetch(true); });

    var _drawerProducts = [];

    async function buildDrawerProducts(cartItems, cartOverride) {
      try {
        var products = await fetchCartDrawerRecommendations(cartItems);
        if (!products || products.length === 0) {
          var fallbackId = cartItems[0] && cartItems[0].product_id;
          if (fallbackId) products = await fetchShopifyRecommendations(fallbackId, DRAWER_MAX_PRODUCTS * 2);
        }
        if (!products || products.length === 0) return [];
        products = uniqueSecondaryById(products);
        products = await filterSecondaryAgainstCart(products, cartOverride);

        if (products.length < DRAWER_MAX_PRODUCTS) {
          var fallbackId2 = cartItems[0] && cartItems[0].product_id;
          if (fallbackId2) {
            var shopifyRecs = await fetchShopifyRecommendations(fallbackId2, DRAWER_MAX_PRODUCTS * 3);
            if (shopifyRecs && shopifyRecs.length > 0) {
              shopifyRecs = await filterSecondaryAgainstCart(uniqueSecondaryById(shopifyRecs), cartOverride);
              var seen = new Set(products.map(function (p) { return String(p.id); }));
              shopifyRecs.forEach(function (p) {
                if (!seen.has(String(p.id)) && products.length < DRAWER_MAX_PRODUCTS) {
                  seen.add(String(p.id));
                  products.push(p);
                }
              });
            }
          }
        }

        return products;
      } catch (_) { return []; }
    }

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
        var products = await buildDrawerProducts(cartItems, cart);
        if (!products || products.length === 0) return;
        _drawerProducts = products.slice(0, DRAWER_MAX_PRODUCTS);
        secondaryAllProducts = _drawerProducts;
        placeInCartDrawer();
      } catch (_) {}
    }

    window.__AI_UPSELL_LOAD_DRAWER__ = function () {
      loadDrawerUpsellsFromCart();
    };

    if (!window.__AI_DRAWER_OBSERVER__) {
      window.__AI_DRAWER_OBSERVER__ = true;
      async function loadDrawerUpsells() {
        var drawer = document.querySelector('cart-drawer');
        if (!drawer || drawer.querySelector('.ai-drawer-upsell')) return;
        try {
          var cartRes = await fetch('/cart.js'); var cart = await cartRes.json();
          var cartItems = cart.items || [];
          if (cartItems.length === 0) return;
          var products = await buildDrawerProducts(cartItems, cart);
          if (!products || products.length === 0) return;
          _drawerProducts = products.slice(0, DRAWER_MAX_PRODUCTS);
          secondaryAllProducts = _drawerProducts;
          placeInCartDrawer();
        } catch (_) {}
      }

      // Use a body-level observer so we catch attribute changes on any cart-drawer
      // element — including ones injected via el.replaceWith(n) after add-to-cart.
      // Observing the original drawerEl ref directly would lose the connection once
      // that element is replaced and detached from the DOM.
      var _drawerWasOpen = false;
      var bodyDrawerObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          var el = m.target;
          if (!el || el.tagName !== 'CART-DRAWER') return;
          var isOpen = el.classList.contains('active') || el.classList.contains('is-open') ||
                       el.hasAttribute('open') || el.getAttribute('aria-hidden') === 'false';
          if (isOpen && !_drawerWasOpen) {
            _drawerWasOpen = true;
            loadDrawerUpsells();
            patchCartDrawerPricesFromAPI();
          } else if (!isOpen) {
            _drawerWasOpen = false;
          }
        });
      });
      bodyDrawerObserver.observe(document.body, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class', 'open', 'aria-hidden']
      });

      var bodyCartContentObserver = new MutationObserver(function (mutations) {
        if (isCartPatchSuppressed()) return;
        var shouldPatch = mutations.some(function (m) {
          if (m.type !== 'childList') return false;
          var target = m.target;
          if (!target) return false;
          var inCartScope = !!(target.closest && (target.closest('cart-drawer') || target.closest('cart-items') || target.id === 'CartDrawer-CartItems' || target.id === 'main-cart-items'));
          var addedNodes = Array.prototype.slice.call(m.addedNodes || []).filter(function (node) { return node && node.nodeType === 1; });
          var removedNodes = Array.prototype.slice.call(m.removedNodes || []).filter(function (node) { return node && node.nodeType === 1; });
          var aiOnlyMutation = (addedNodes.length || removedNodes.length) &&
            addedNodes.every(isAiManagedMutationNode) &&
            removedNodes.every(isAiManagedMutationNode);
          if (inCartScope) {
            if (aiOnlyMutation) return false;
            if (addedNodes.length || removedNodes.length) return true;
          }
          return addedNodes.some(function (node) {
            return node && node.nodeType === 1 && (
              (node.matches && (node.matches('cart-drawer, cart-items, cart-drawer-items') || node.matches('.cart-item, [id^="CartDrawer-Item-"], [id^="CartItem-"]'))) ||
              (node.querySelector && node.querySelector('cart-drawer, cart-items, cart-drawer-items, .cart-item, [id^="CartDrawer-Item-"], [id^="CartItem-"]'))
            );
          });
        });
        if (shouldPatch) patchCartDrawerPricesFromAPI();
      });
      bodyCartContentObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeInit);
    else maybeInit();
    try { window.__AI_PATCH_CART__ = patchCartDrawerPricesFromAPI; } catch (_) {}
  } catch (err) {
    window.__AI_UPSELL_INIT_ERROR__ = err && err.message ? err.message : String(err);
  }
})();
