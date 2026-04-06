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
} from '@shopify/ui-extensions/checkout';

const BACKEND_URL = 'https://ai-upsell.onrender.com';

export default extension('purchase.thank-you.block.render', async (root, api) => {
  const shop = api.shop.myshopifyDomain.current;

  // ── Order ID via orderConfirmation (the correct API for thank-you page) ──
  const orderConfirmation = api.orderConfirmation?.current;
  const orderId = orderConfirmation?.order?.id?.split('/').pop() || null;

  // ── Cart lines via api.lines (CartLine[]) ──
  const cartLines = api.lines?.current ?? [];

  // ── Total price via api.cost ──
  const totalPrice = api.cost?.totalAmount?.current?.amount || 0;

  // ── Product IDs for fetching upsell offers ──
  const productIds = cartLines
    .map(li => li.merchandise?.product?.id?.split('/').pop())
    .filter(Boolean);

  // ── Track items to send to backend ──
  // CartLine.merchandise is ProductVariant: { id, title, product: { id } }
  const trackItems = cartLines
    .map(li => ({
      variantId: li.merchandise?.id?.split('/').pop(),
      productId: li.merchandise?.product?.id?.split('/').pop() || null,
      title: li.merchandise?.title || '',
      quantity: li.quantity || 1,
      price: li.cost?.totalAmount?.amount || 0,
    }))
    .filter(li => li.variantId);

  // Always fire tracking — store order even if some fields are partial
  fetch(`${BACKEND_URL}/webhooks/orders/created`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shopId: shop,
      orderId: orderId || `ext-${Date.now()}`,
      totalPrice,
      lineItems: trackItems,
    }),
  })
    .then(res => res.json())
    .then(data => console.log('✅ Purchase tracked:', data))
    .catch(err => console.error('❌ Purchase tracking failed:', err));

  // ── Fetch post-purchase upsell offers ──
  const idsParam = productIds.length > 0
    ? `&ids=${encodeURIComponent(JSON.stringify(productIds))}`
    : '';

  let offers = [];
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/checkout-upsell?shop=${shop}${idsParam}&placement=post_purchase&limit=4`
    );
    if (!res.ok) return;
    const data = await res.json();
    offers = data.offers || (data.offer ? [data.offer] : []);
  } catch {
    return;
  }

  if (offers.length === 0) return;

  // ── Build UI ──────────────────────────────────────────────────────────────
  const container = root.createComponent(BlockStack, { spacing: 'loose' });
  container.appendChild(root.createComponent(Divider));
  container.appendChild(root.createComponent(Heading, { level: 2 }, 'You Might Also Love'));
  container.appendChild(root.createComponent(Text, { appearance: 'subdued', size: 'small' },
    'Customers who bought this also purchased:'));

  const list = root.createComponent(BlockStack, { spacing: 'base' });

  for (const offer of offers) {
    const originalPrice = parseFloat(offer.price) || 0;
    const discountPct = parseFloat(offer.discountPercent) || 0;
    const discountedPrice = discountPct > 0
      ? (originalPrice * (1 - discountPct / 100)).toFixed(2)
      : originalPrice.toFixed(2);
    const hasDiscount = discountPct > 0 && parseFloat(discountedPrice) < originalPrice;
    const sellingPlanGid = offer.sellingPlanId || (offer.sellingPlanIdNumeric ? `gid://shopify/SellingPlan/${offer.sellingPlanIdNumeric}` : null);

    const row = root.createComponent(InlineStack, { spacing: 'base', blockAlignment: 'center' });

    if (offer.image) {
      const imgWrap = root.createComponent(View, { maxInlineSize: 72 });
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
        size: 'small', appearance: 'subdued', accessibilityRole: 'deletion',
      }, `$${originalPrice.toFixed(2)}`));
    }
    priceRow.appendChild(root.createComponent(Text, {
      size: 'medium', appearance: hasDiscount ? 'accent' : 'base',
    }, `$${discountedPrice}`));
    if (hasDiscount) {
      priceRow.appendChild(root.createComponent(Badge, { tone: 'success' }, `${Math.round(discountPct)}% off`));
    }
    info.appendChild(priceRow);

    if (offer.reason) {
      info.appendChild(root.createComponent(Text, { size: 'small', appearance: 'subdued' }, offer.reason));
    }
    row.appendChild(info);

    // ── Add to Cart button ──────────────────────────────────────────────────
    let added = false;
    const btn = root.createComponent(Button, {
      kind: 'secondary',
      size: 'slim',
      onPress: async () => {
        if (added || !offer.variantId) return;
        btn.updateProps({ loading: true });
        try {
          const payload = {
            type: 'addCartLine',
            merchandiseId: `gid://shopify/ProductVariant/${offer.variantId}`,
            quantity: 1,
          };
          if (sellingPlanGid) {
            payload.sellingPlanId = sellingPlanGid;
          }
          const result = await api.applyCartLinesChange(payload);
          if (result.type === 'success') {
            added = true;
            btn.updateProps({ loading: false, disabled: true });
            btn.replaceChildren('Added ✓');

            // Track cart_add event
            fetch(`${BACKEND_URL}/api/proxy/analytics/track`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventType: 'cart_add',
                shopId: shop,
                sourceProductId: productIds[0] || null,
                sourceProductName: '',
                upsellProductId: String(offer.id),
                upsellProductName: offer.title || '',
                variantId: String(offer.variantId),
                recommendationType: offer.type || 'complementary',
                confidence: offer.confidence || 0,
                quantity: 1,
                isUpsellEvent: true,
                metadata: {
                  location: 'post_purchase',
                  offerType: offer.offerType || 'addon_upsell',
                  discountPercent: parseFloat(offer.discountPercent) || 0,
                },
              }),
            }).catch(() => {});
          } else {
            btn.updateProps({ loading: false });
          }
        } catch {
          btn.updateProps({ loading: false });
        }
      },
    }, 'Add to Cart');

    const btnWrap = root.createComponent(View, { inlineAlignment: 'end' });
    btnWrap.appendChild(btn);
    row.appendChild(btnWrap);

    list.appendChild(row);
  }

  container.appendChild(list);
  root.appendChild(container);
});
