import { shopifyFunction, DiscountApplicationStrategy } from "@shopify/shopify_function";

const BUY2_GOALS = new Set(["increase_aov", "inventory_movement"]);
const IMMEDIATE_GOALS = new Set(["revenue_per_visitor", "subscription_adoption"]);

function getGoal(cart) {
  // Use explicit alias from input.graphql
  return cart?.aiGoal?.value || "revenue_per_visitor";
}

function parsePercentFromAttribute(attr, upperAttr) {
  const value = attr?.value || upperAttr?.value;
  if (!value) return 0;
  const match = String(value).match(/(\d+(?:\.\d+)?)\s*%/);
  if (match) return Math.max(0, Math.min(100, parseFloat(match[1])));
  return 0;
}

export const run = shopifyFunction(({ input }) => {
  const cart = input.cart;
  const goal = getGoal(cart);
  const totalQty = cart.lines.reduce((sum, line) => sum + (line?.quantity || 0), 0);
  const discounts = [];

  if (BUY2_GOALS.has(goal) && totalQty < 2) {
    return { discountApplicationStrategy: DiscountApplicationStrategy.First, discounts: [] };
  }

  for (const line of cart.lines) {
    // Line attributes now fetched one-by-one via attribute(key: "offer")
    const pct = parsePercentFromAttribute(line.offer, line.offerUpper);
    if (!pct) continue;

    let pctToApply = pct;
    if (BUY2_GOALS.has(goal)) {
      if (line.quantity < 2) continue;
      // Apply a blended percentage so only units beyond the first are effectively discounted.
      pctToApply = pct * ((line.quantity - 1) / line.quantity);
    }
    // IMMEDIATE_GOALS use full pct on all units; default fallback also full pct.

    discounts.push({
      message: BUY2_GOALS.has(goal)
        ? `Buy more & save (${pct}% off beyond first)`
        : `AI offer ${pct}% off`,
      targets: [
        {
          cartLine: {
            id: line.id,
          },
        },
      ],
      value: {
        percentage: {
          value: pctToApply,
        },
      },
    });
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts,
  };
});

export default run;
