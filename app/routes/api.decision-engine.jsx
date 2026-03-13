import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { decideProductOffers, decideCartOffers } from "../../backend/services/decisionEngineV2.js";
import { runAutonomousOptimization } from "../../backend/services/autonomousOptimizer.js";
import {
  explainOfferDecision,
  getOfferAutomationJourney,
  getSegmentPerformance,
  analyzeContextInjection
} from "../../backend/services/explainabilityService.js";

/**
 * POST /api/decision-engine
 * 
 * Main decision engine API for offers
 * 
 * Payload:
 * {
 *   "action": "product_offers" | "cart_offers" | "explain" | "journey" | "segments" | "autonomy" | "context"
 *   ... action-specific params
 * }
 */
export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const body = await request.json();

  try {
    const { action, ...params } = body;

    // ─── PRODUCT OFFERS ───────────────────────────────────────────────
    if (action === "product_offers") {
      const result = await decideProductOffers({
        shopId,
        productId: params.productId,
        userId: params.userId,
        limit: params.limit || 4,
        placement: params.placement || "product_page"
      });

      return json(result);
    }

    // ─── CART OFFERS ──────────────────────────────────────────────────
    if (action === "cart_offers") {
      const result = await decideCartOffers({
        shopId,
        cartProductIds: params.cartProductIds || [],
        userId: params.userId,
        limit: params.limit || 4,
        placement: params.placement || "cart_drawer"
      });

      return json(result);
    }

    // ─── EXPLAIN OFFER DECISION ───────────────────────────────────────
    if (action === "explain") {
      const result = await explainOfferDecision(shopId, params.offerId);
      return json(result);
    }

    // ─── OFFER AUTOMATION JOURNEY ─────────────────────────────────────
    if (action === "journey") {
      const result = await getOfferAutomationJourney(shopId, params.offerId);
      return json(result);
    }

    // ─── SEGMENT PERFORMANCE ──────────────────────────────────────────
    if (action === "segments") {
      const result = await getSegmentPerformance(shopId, {
        limit: params.limit || 10,
        sortBy: params.sortBy || "conversion"
      });

      return json(result);
    }

    // ─── CONTEXT INJECTION ANALYSIS ───────────────────────────────────
    if (action === "context") {
      const result = await analyzeContextInjection(shopId);
      return json(result);
    }

    // ─── RUN AUTONOMOUS OPTIMIZATION ──────────────────────────────────
    if (action === "autonomy") {
      const result = await runAutonomousOptimization(shopId);
      return json(result);
    }

    return json({ error: "Unknown action", action }, { status: 400 });

  } catch (error) {
    console.error("❌ Decision engine API failed:", error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
};

export const loader = async () => {
  return json({
    status: "ok",
    message: "Decision Engine API v2",
    endpoints: {
      "product_offers": "Get product page offers",
      "cart_offers": "Get cart drawer offers",
      "explain": "Explain why an offer was selected",
      "journey": "Get offer automation journey",
      "segments": "Get segment performance deep-dive",
      "context": "Analyze context injection effectiveness",
      "autonomy": "Run autonomous optimization cycle"
    }
  });
};
