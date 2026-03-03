/**
 * Offer Formatter — Pillar 2 V1
 *
 * Shapes the raw decision engine output into a clean, frontend-ready payload.
 *
 * V1 output shape:
 * {
 *   type: "add_on",
 *   upsellProduct: {
 *     productId, title, handle, image,
 *     variantId, originalPrice, productType, vendor
 *   },
 *   discountPercent: number,   // e.g. 10
 *   discountedPrice: number    // e.g. 49.50  (2 decimal places)
 * }
 */

/**
 * formatOffer(product, variant, discountPercent)
 *
 * @param {object} product        - MongoDB product document (the upsell winner)
 * @param {object} variant        - the best variant from that product
 * @param {number} discountPercent - e.g. 10 means 10% off
 * @returns {object}              - structured offer payload
 */
export function formatOffer(product, variant, discountPercent) {
  const originalPrice = Number(variant.price) || 0;
  const discountedPrice = roundToTwo(originalPrice * (1 - discountPercent / 100));

  return {
    type: 'add_on',
    upsellProduct: {
      productId: product.productId,
      title: product.title,
      handle: product.handle,
      image: product.image ?? null,
      variantId: variant.variantId,
      originalPrice,
      productType: product.productType ?? '',
      vendor: product.vendor ?? '',
    },
    discountPercent,
    discountedPrice,
  };
}

export function formatBundleOffer(product, variant, discountPercent) {
  const originalPrice = Number(variant.price) || 0;
  const discountedPrice = roundToTwo(originalPrice * (1 - discountPercent / 100));
  return {
    type: 'bundle',
    upsellProduct: {
      productId: product.productId,
      title: product.title,
      handle: product.handle,
      image: product.image ?? null,
      variantId: variant.variantId,
      originalPrice,
      productType: product.productType ?? '',
      vendor: product.vendor ?? '',
    },
    discountPercent,
    discountedPrice,
    tagline: 'Bundle & Save',
  };
}

export function formatVolumeDiscountOffer(product, variant, discountPercent) {
  const originalPrice = Number(variant.price) || 0;
  const discountedPrice = roundToTwo(originalPrice * (1 - discountPercent / 100));
  const tier1Discount = Math.round(discountPercent * 0.6);
  const tier2Discount = discountPercent;
  return {
    type: 'volume_discount',
    upsellProduct: {
      productId: product.productId,
      title: product.title,
      handle: product.handle,
      image: product.image ?? null,
      variantId: variant.variantId,
      originalPrice,
      productType: product.productType ?? '',
      vendor: product.vendor ?? '',
    },
    discountPercent,
    discountedPrice,
    tiers: [
      { quantity: 2, discountPercent: tier1Discount, pricePerUnit: roundToTwo(originalPrice * (1 - tier1Discount / 100)) },
      { quantity: 3, discountPercent: tier2Discount, pricePerUnit: roundToTwo(originalPrice * (1 - tier2Discount / 100)) },
    ],
    tagline: 'Buy More, Save More',
  };
}

export function formatSubscriptionUpgradeOffer(product, variant, discountPercent) {
  const originalPrice = Number(variant.price) || 0;
  const discountedPrice = roundToTwo(originalPrice * (1 - discountPercent / 100));
  return {
    type: 'subscription_upgrade',
    upsellProduct: {
      productId: product.productId,
      title: product.title,
      handle: product.handle,
      image: product.image ?? null,
      variantId: variant.variantId,
      originalPrice,
      productType: product.productType ?? '',
      vendor: product.vendor ?? '',
    },
    discountPercent,
    discountedPrice,
    interval: 'monthly',
    tagline: 'Subscribe & Save',
  };
}

export function formatOfferByType(type, product, variant, discountPercent) {
  switch (type) {
    case 'bundle':               return formatBundleOffer(product, variant, discountPercent);
    case 'volume_discount':      return formatVolumeDiscountOffer(product, variant, discountPercent);
    case 'subscription_upgrade': return formatSubscriptionUpgradeOffer(product, variant, discountPercent);
    default:                     return formatOffer(product, variant, discountPercent);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}
