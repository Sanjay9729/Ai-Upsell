/**
 * Public route: GET /scripts/order-status-tracking.js
 *
 * Served as a ScriptTag on merchants' order status (thank-you) pages.
 * Shopify injects this automatically after app installation via the afterAuth hook.
 * Sends purchase data to the app proxy for upsell attribution.
 */
export const loader = async () => {
  const script = `
(function() {
  if (!window.Shopify || !window.Shopify.checkout) return;
  var checkout = window.Shopify.checkout;
  var lineItems = checkout.line_items || [];
  if (!lineItems.length) return;

  // Only run once per page load
  if (window.__AI_UPSELL_PURCHASE_TRACKED__) return;
  window.__AI_UPSELL_PURCHASE_TRACKED__ = true;

  fetch('/apps/ai-upsell/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: checkout.order_id,
      totalPrice: checkout.total_price,
      lineItems: lineItems.map(function(item) {
        return {
          product_id: item.product_id,
          variant_id: item.variant_id,
          title: item.title,
          price: item.price,
          quantity: item.quantity
        };
      })
    })
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    if (data.upsellsAttributed > 0) {
      console.log('[AI Upsell] Purchase attributed:', data.upsellsAttributed, 'upsell(s)');
    }
  })
  .catch(function() {});
})();
`;

  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
