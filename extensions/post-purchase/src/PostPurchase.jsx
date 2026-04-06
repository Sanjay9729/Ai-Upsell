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

  console.log('🚀 AI Upsell Post-Purchase Extension loaded. Shop:', shop);
  console.log('🔍 api.order:', api.order);
  console.log('🔍 api.order?.current:', api.order?.current);

  // Extract product IDs from order line items (best effort — may be empty)
  const order = api.order?.current ?? api.order ?? null;
  const lineItems = order?.lineItems?.nodes ?? order?.lineItems ?? [];
  const productIds = lineItems
    .map(li => li.variant?.product?.id?.split('/').pop())
    .filter(Boolean);

  console.log('📋 Order:', order ? `ID=${order.id}` : 'null');
  console.log('📋 Line items count:', lineItems.length);
  console.log('📋 Product IDs:', productIds);

  // Fire-and-forget purchase tracking — Pillar 5
  if (lineItems.length > 0) {
    const orderId = order?.id?.split('/').pop() || order?.id;
    const totalPrice = parseFloat(order?.totalPrice?.amount || 0);
    
    console.log('📦 PostPurchase Extension Debug:');
    console.log('   Shop:', shop);
    console.log('   Order ID:', orderId);
    console.log('   Total Price:', totalPrice);
    console.log('   Line Items:', lineItems.length);
    
    const trackItems = lineItems
      .map((li, idx) => {
        const item = {
          variantId: li.variant?.id?.split('/').pop(),
          productId: li.variant?.product?.id?.split('/').pop(),
          title: li.title,
          quantity: li.quantity || 1,
          price: parseFloat(li.price?.amount || li.totalPrice?.amount || '0'),
        };
        console.log(`   Item ${idx}:`, item);
        return item;
      })
      .filter(li => li.variantId && li.productId);
    
    console.log('   Filtered Items:', trackItems.length);
    
    if (trackItems.length > 0) {
      const payload = { 
        shopId: shop,
        orderId, 
        totalPrice,
        lineItems: trackItems 
      };
      
      console.log('📤 Sending to:', `${BACKEND_URL}/webhooks/orders/created`);
      console.log('📋 Payload:', JSON.stringify(payload));
      
      fetch(`${BACKEND_URL}/webhooks/orders/created`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      .then(res => {
        console.log('✅ Purchase tracking response:', res.status, res.statusText);
        return res.json();
      })
      .then(data => {
        console.log('✅ Purchase tracking result:', data);
      })
      .catch((err) => {
        console.error('❌ Purchase tracking failed:', err);
      });
    } else {
      console.warn('⚠️ No trackable items found');
    }
  } else {
    console.warn('⚠️ No line items in order');
  }

  // Build the fetch URL — if no product IDs, skip the ids param
  const idsParam = productIds.length > 0
    ? `&ids=${encodeURIComponent(JSON.stringify(productIds))}`
    : '';

  let offers = [];
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/checkout-upsell?shop=${shop}${idsParam}&placement=post_purchase&limit=2`
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

            // Track cart_add event for purchase attribution
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
