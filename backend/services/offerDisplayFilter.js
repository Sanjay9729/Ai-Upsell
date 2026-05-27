/**
 * Offer Display Filter — Shared Module
 *
 * Maps merchant goal + offerDisplayMode to the correct offer type
 * for storefront display. Used by all API routes that serve
 * upsell recommendations to the storefront widget.
 */

/**
 * Returns extra fields (tagline, tiers, interval) for a given offer type.
 */
export function getOfferTypeExtras(offerType, discountPercent) {
  if (offerType === 'bundle') {
    return { tagline: 'Bundle & Save' };
  }
  if (offerType === 'volume_discount') {
    const t1 = Math.round((discountPercent || 0) * 0.6);
    const t2 = discountPercent || 0;
    return {
      tagline: 'Buy More, Save More',
      tiers: [
        { quantity: 2, discountPercent: t1, label: '2+ items' },
        { quantity: 3, discountPercent: t2, label: '3+ items' },
      ],
    };
  }
  if (offerType === 'subscription_upgrade') {
    return { tagline: 'Subscribe & Save', interval: 'monthly' };
  }
  return {};
}

/**
 * Applies goal-based offer type filtering to a recommendations array.
 *
 * Goal → Offer type mapping:
 *   increase_aov         → depends on offerDisplayMode (bundle / volume_discount / both)
 *   revenue_per_visitor   → addon_upsell (direct product recommendations)
 *   subscription_adoption → subscription_upgrade for eligible, addon_upsell for rest
 *   inventory_movement    → depends on offerDisplayMode (bundle / volume_discount / both)
 *
 * @param {Array}  recs                    - recommendation objects with offerType field
 * @param {string} goal                    - merchant's selected business goal
 * @param {string} displayMode             - 'bundle' | 'volume_discount' | 'both'
 * @param {number|null} decisionDiscountPercent - fallback discount from decision meta
 * @returns {Array} filtered recommendations with correct offerType and extras
 */
export function applyDisplayModeFilter(recs, goal, displayMode, decisionDiscountPercent = null) {
  if (!Array.isArray(recs) || recs.length === 0) return recs || [];

  // Strip stale tagline/tiers so getOfferTypeExtras always wins
  const strip = ({ tagline, tiers, interval, ...r }) => r;

  // ── Revenue per Visitor: always addon_upsell ──
  if (goal === 'revenue_per_visitor') {
    return recs.map(r => ({
      ...strip(r),
      offerType: 'addon_upsell',
      ...getOfferTypeExtras('addon_upsell', r.discountPercent),
    }));
  }

  // ── Subscription Adoption: preserve subscription_upgrade, rest become addon_upsell ──
  if (goal === 'subscription_adoption') {
    return recs.map(r => {
      if (r.offerType === 'subscription_upgrade') {
        return { ...strip(r), offerType: 'subscription_upgrade', ...getOfferTypeExtras('subscription_upgrade', r.discountPercent) };
      }
      return { ...strip(r), offerType: 'addon_upsell', ...getOfferTypeExtras('addon_upsell', r.discountPercent) };
    });
  }

  // ── AOV & Inventory Movement: apply merchant's display mode choice ──
  if (displayMode === 'bundle') {
    return recs.map(r => {
      const missingDiscount = (r.discountPercent === 0 || r.discountPercent === null || r.discountPercent === undefined);
      const discountPercent = missingDiscount && decisionDiscountPercent > 0 ? decisionDiscountPercent : r.discountPercent;
      return { ...strip(r), offerType: 'bundle', discountPercent, ...getOfferTypeExtras('bundle', discountPercent) };
    });
  }
  if (displayMode === 'volume_discount') {
    return recs.map(r => ({
      ...strip(r),
      offerType: 'volume_discount',
      ...getOfferTypeExtras('volume_discount', r.discountPercent),
    }));
  }

  // 'both' (default): if volume_discount is present, convert bundle → volume_discount for consistency
  const hasVolume = recs.some(r => r.offerType === 'volume_discount');
  if (hasVolume) {
    return recs.map(r =>
      r.offerType === 'bundle'
        ? { ...strip(r), offerType: 'volume_discount', ...getOfferTypeExtras('volume_discount', r.discountPercent) }
        : r
    );
  }
  return recs;
}
