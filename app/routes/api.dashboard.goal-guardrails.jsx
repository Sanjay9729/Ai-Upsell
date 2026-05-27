import { getMerchantConfig, saveMerchantConfig } from "../services/merchantConfig.server";

const ALLOWED_ORIGIN = process.env.DASHBOARD_URL || "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key",
  };
}

function checkAuth(request) {
  const apiKey = process.env.DASHBOARD_API_KEY;
  if (!apiKey) return true;
  return request.headers.get("X-Dashboard-Key") === apiKey;
}

function parseDelimitedList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function splitIdsAndHandles(tokens) {
  const ids = [];
  const handles = [];
  for (const token of tokens || []) {
    if (/^\d+$/.test(token)) { ids.push(token); continue; }
    handles.push(token.toLowerCase());
  }
  return { ids: [...new Set(ids)], handles: [...new Set(handles)] };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return Response.json({ error: "Missing shop parameter" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const config = await getMerchantConfig(shop);
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    const rawConfig = await db.collection(collections.merchantConfig).findOne({ shopId: shop });
    return Response.json(
      { ...config, offerDisplayMode: rawConfig?.offerDisplayMode || "both" },
      { headers: corsHeaders() }
    );
  } catch (err) {
    return Response.json({ error: String(err.message) }, { status: 500, headers: corsHeaders() });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return Response.json({ error: "Missing shop parameter" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const body = await request.json();
    const { goal, riskTolerance, offerDisplayMode, guardrails } = body;

    let excludedProductIds = guardrails?.excludedProductIds || [];
    let excludedProductHandles = guardrails?.excludedProductHandles || [];
    let excludedCollectionIds = guardrails?.excludedCollectionIds || [];
    let excludedCollectionHandles = guardrails?.excludedCollectionHandles || [];

    if (guardrails?.excludedProductsRaw) {
      const tokens = parseDelimitedList(guardrails.excludedProductsRaw);
      const parsed = splitIdsAndHandles(tokens);
      excludedProductIds = parsed.ids;
      excludedProductHandles = parsed.handles;
    }
    if (guardrails?.excludedCollectionsRaw) {
      const tokens = parseDelimitedList(guardrails.excludedCollectionsRaw);
      const parsed = splitIdsAndHandles(tokens);
      excludedCollectionIds = parsed.ids;
      excludedCollectionHandles = parsed.handles;
    }

    const result = await saveMerchantConfig(shop, {
      goal,
      riskTolerance,
      offerDisplayMode,
      guardrails: {
        maxDiscountCap: guardrails?.maxDiscountCap ?? 20,
        inventoryMinThreshold: guardrails?.inventoryMinThreshold ?? 0,
        sessionOfferLimit: guardrails?.sessionOfferLimit ?? 4,
        premiumSkuProtection: !!guardrails?.premiumSkuProtection,
        subscriptionProtection: !!guardrails?.subscriptionProtection,
        excludedProductIds,
        excludedProductHandles,
        excludedCollectionIds,
        excludedCollectionHandles,
      },
    });

    if (!result.success) {
      return Response.json({ success: false, errors: result.errors }, { status: 400, headers: corsHeaders() });
    }

    const { getDb } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    await db.collection("upsell_response_cache").deleteMany({ shopId: shop });

    return Response.json({ success: true }, { headers: corsHeaders() });
  } catch (err) {
    console.error("[api.dashboard.goal-guardrails] error:", err);
    return Response.json({ error: String(err.message) }, { status: 500, headers: corsHeaders() });
  }
};
