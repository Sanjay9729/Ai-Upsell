// Shared (client-safe) mappings for merchant config UI.

export const GOAL_MAPPING = {
  increase_aov: {
    offerPriority: ["bundle", "volume_discount", "addon_upsell", "subscription_upgrade"],
    placementBias: "cart_drawer",
    description: "Bundles and volume discounts are prioritised to grow basket size before checkout.",
  },
  revenue_per_visitor: {
    offerPriority: ["addon_upsell", "bundle", "volume_discount", "subscription_upgrade"],
    placementBias: "product_page",
    description: "Add-on upsells on product pages maximise revenue from each visitor early in the journey.",
  },
  subscription_adoption: {
    offerPriority: ["subscription_upgrade", "addon_upsell", "bundle", "volume_discount"],
    placementBias: "post_purchase",
    description: "Subscription upgrades are prioritised at post-purchase where intent to re-buy is highest.",
  },
  inventory_movement: {
    offerPriority: ["volume_discount", "bundle", "addon_upsell", "subscription_upgrade"],
    placementBias: "cart_drawer",
    description: "Volume discounts and bundles surface slow-moving stock before cart abandonment.",
  },
};

export const RISK_MAPPING = {
  conservative: {
    maxOfferFrequency: 4,
    minAcceptanceProbability: 0.25,
    discountMultiplier: 0.5,
    allowedPlacements: ["product_page"],
    description: "Four offers per view, half the discount ceiling, product page only. Lowest disruption.",
  },
  balanced: {
    maxOfferFrequency: 4,
    minAcceptanceProbability: 0.15,
    discountMultiplier: 0.75,
    allowedPlacements: ["product_page", "cart_drawer", "checkout", "post_purchase"],
    description: "Four offers per view, 75% of discount ceiling, all placement stages enabled.",
  },
  aggressive: {
    maxOfferFrequency: 4,
    minAcceptanceProbability: 0.05,
    discountMultiplier: 1.0,
    allowedPlacements: ["product_page", "cart_drawer", "checkout", "post_purchase"],
    description: "Maximum offers per view, full discount ceiling, all placement stages enabled.",
  },
};
