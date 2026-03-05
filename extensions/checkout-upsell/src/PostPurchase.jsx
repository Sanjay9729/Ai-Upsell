import {
  extension,
  BlockStack,
  InlineStack,
  Image,
  Text,
  Button,
  Divider,
  Heading,
  Badge,
  View,
  Banner,
} from '@shopify/ui-extensions/checkout';

const BACKEND_URL = 'https://ai-upsell.onrender.com';

/**
 * Post-Purchase One-Click Offer
 * Shows on the order confirmation / thank-you page.
 * Target: purchase.thank-you.block.render
 *
 * Because the order is already placed, we cannot use applyCartLinesChange.
 * Instead, we track the customer's interest and redirect to a pre-filled cart
 * URL so they can complete a second purchase in one tap.
 */
export default extension('purchase.thank-you.block.render', async (root, api) => {
  const shop = api.shop?.myshopifyDomain?.current;
  const order = api.order?.current;

  if (!shop || !order) return;

  // lineItems is a plain array on the order object, not a subscription
  const lineItems = order.lineItems || [];

  console.log('[AI Upsell] PostPurchase loaded. shop:', shop, 'orderId:', order.id);
  console.log('[AI Upsell] lineItems:', JSON.stringify(lineItems));

  const productIds = lineItems
    .map(li => li.variant?.product?.id?.split('/').pop())
    .filter(Boolean);

  console.log('[AI Upsell] productIds extracted:', productIds);

  if (productIds.length === 0) {
    console.warn('[AI Upsell] No productIds found — check lineItems shape above');
    return;
  }

  // ── Attribute this purchase against any upsell cart_add events ────────────

  // Build line_items in the format processPurchaseEvent() expects
  const purchaseLineItems = lineItems.map(li => ({
    product_id: li.variant?.product?.id?.split('/').pop() || '',
    variant_id: li.variant?.id?.split('/').pop() || '',
    title: li.title || '',
    price: String(li.totalPrice?.amount || li.unitPrice?.amount || '0'),
    quantity: li.quantity || 1,
  }));

  console.log('[AI Upsell] Mapped purchaseLineItems:', JSON.stringify(purchaseLineItems));

  const purchasePayload = {
    shopId: shop,
    orderId: String(order.id?.split('/').pop() || order.id),
    totalPrice: order.totalPrice?.amount || '0',
    lineItems: purchaseLineItems,
    customerId: api.buyerIdentity?.customer?.current?.id?.split('/').pop() || null,
    createdAt: new Date().toISOString(),
  };

  console.log('[AI Upsell] Sending purchase payload to backend:', JSON.stringify(purchasePayload));

  fetch(`${BACKEND_URL}/webhooks/orders/created`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(purchasePayload),
  })
    .then(res => res.json().then(data => {
      console.log('[AI Upsell] Purchase attribution response:', res.status, JSON.stringify(data));
    }))
    .catch(err => {
      console.error('[AI Upsell] Purchase attribution fetch error:', err);
    });

  let offer;
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/checkout-upsell?shop=${encodeURIComponent(shop)}&ids=${encodeURIComponent(JSON.stringify(productIds))}&placement=post_purchase&limit=1`
    );
    const data = await res.json();
    offer = data.offer || null;
  } catch {
    return;
  }

  if (!offer || !offer.variantId) return;

  const originalPrice = parseFloat(offer.price) || 0;
  const discountPct = parseFloat(offer.discountPercent) || 0;
  const discountedPrice = discountPct > 0
    ? (originalPrice * (1 - discountPct / 100)).toFixed(2)
    : originalPrice.toFixed(2);
  const hasDiscount = discountPct > 0 && parseFloat(discountedPrice) < originalPrice;

  // Track this post-purchase offer view
  try {
    await fetch(`${BACKEND_URL}/api/track-purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop,
        orderId: order.id,
        event: 'post_purchase_offer_viewed',
        offerId: offer.id,
        variantId: offer.variantId,
      })
    });
  } catch { /* non-blocking */ }

  // ── Build UI ──────────────────────────────────────────────────────────────
  const card = root.createComponent(BlockStack, { spacing: 'base' });
  card.appendChild(root.createComponent(Divider));
  card.appendChild(root.createComponent(Heading, { level: 2 }, '🎁 Special One-Time Offer'));

  const subtext = root.createComponent(Text, { size: 'small', appearance: 'subdued' },
    'Add this to a new cart in one click — exclusive to today\'s order.'
  );
  card.appendChild(subtext);

  const row = root.createComponent(InlineStack, { spacing: 'base', blockAlignment: 'center' });

  if (offer.image) {
    const imgWrap = root.createComponent(View, { maxInlineSize: 80 });
    imgWrap.appendChild(root.createComponent(Image, {
      source: offer.image,
      accessibilityDescription: offer.title,
    }));
    row.appendChild(imgWrap);
  }

  const info = root.createComponent(BlockStack, { spacing: 'extraTight' });
  info.appendChild(root.createComponent(Text, { size: 'medium', emphasis: 'bold' }, offer.title));

  const priceRow = root.createComponent(InlineStack, { spacing: 'tight', blockAlignment: 'center' });
  if (hasDiscount) {
    priceRow.appendChild(root.createComponent(Text, {
      size: 'small',
      appearance: 'subdued',
      accessibilityRole: 'deletion',
    }, `$${originalPrice.toFixed(2)}`));
  }
  priceRow.appendChild(root.createComponent(Text, {
    size: 'medium',
    appearance: hasDiscount ? 'accent' : 'base',
  }, `$${discountedPrice}`));
  if (hasDiscount) {
    priceRow.appendChild(root.createComponent(Badge, { tone: 'success' }, `${Math.round(discountPct)}% off`));
  }
  info.appendChild(priceRow);

  if (offer.reason) {
    info.appendChild(root.createComponent(Text, { size: 'small', appearance: 'subdued' }, offer.reason));
  }
  row.appendChild(info);
  card.appendChild(row);

  // ── Add to New Cart button ─────────────────────────────────────────────────
  // Post-purchase: redirect to a pre-filled Shopify cart URL (one-click add)
  let clicked = false;
  const gid = `gid://shopify/ProductVariant/${offer.variantId}`;
  const cartUrl = `/cart/${offer.variantId}:1${discountPct > 0 && offer.discountCode ? `?discount=${offer.discountCode}` : ''}`;

  const btn = root.createComponent(Button, {
    kind: 'secondary',
    to: cartUrl,
    onPress: async () => {
      if (clicked) return;
      clicked = true;
      btn.updateProps({ disabled: true });

      // Track click
      try {
        await fetch(`${BACKEND_URL}/api/track-purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop,
            orderId: order.id,
            event: 'post_purchase_offer_clicked',
            offerId: offer.id,
            variantId: offer.variantId,
          })
        });
      } catch { /* non-blocking */ }
    },
  }, 'Add to Cart →');

  card.appendChild(btn);
  root.appendChild(card);
});
