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

export default extension('purchase.checkout.block.render', async (root, api) => {
  const shop = api.shop.myshopifyDomain.current;
  const lines = api.lines.current;

  if (!lines || lines.length === 0) return;

  const productIds = lines
    .map(l => l.merchandise?.product?.id?.split('/').pop())
    .filter(Boolean);

  if (productIds.length === 0) return;

  let offer;
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/checkout-upsell?shop=${shop}&ids=${encodeURIComponent(JSON.stringify(productIds))}&placement=checkout&limit=1`
    );
    const data = await res.json();
    offer = data.offer || null;
  } catch {
    return;
  }

  if (!offer) return;

  const originalPrice = parseFloat(offer.price) || 0;
  const discountPct = parseFloat(offer.discountPercent) || 0;
  const discountedPrice = discountPct > 0
    ? (originalPrice * (1 - discountPct / 100)).toFixed(2)
    : originalPrice.toFixed(2);
  const hasDiscount = discountPct > 0 && parseFloat(discountedPrice) < originalPrice;
  const sellingPlanGid = offer.sellingPlanId || (offer.sellingPlanIdNumeric ? `gid://shopify/SellingPlan/${offer.sellingPlanIdNumeric}` : null);

  // ── Build UI ──────────────────────────────────────────────────────────────
  const card = root.createComponent(BlockStack, { spacing: 'base' });
  card.appendChild(root.createComponent(Divider));
  card.appendChild(root.createComponent(Heading, { level: 2 }, 'Complete Your Order'));

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

  // ── Add to Order button ───────────────────────────────────────────────────
  let added = false;
  const btn = root.createComponent(Button, {
    kind: 'secondary',
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
          btn.replaceChildren('Added to Order ✓');

          // Track cart_add event so processPurchaseEvent can attribute this upsell
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
                location: 'checkout',
                offerType: offer.offerType || 'addon_upsell',
                discountPercent: discountPct,
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
  }, 'Add to Order');

  card.appendChild(btn);
  root.appendChild(card);
});
