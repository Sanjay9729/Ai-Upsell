function corsHeaders() {
  return {};
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
    const t = String(token).trim();
    if (!t) continue;
    const gidMatch = t.match(/(Product|Collection)\/(\d+)/i);
    if (gidMatch?.[2]) { ids.push(gidMatch[2]); continue; }
    if (/^\d+$/.test(t)) { ids.push(t); continue; }
    handles.push(t.toLowerCase());
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
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    const { getMerchantContext, getOfferLogs, getOfferControlMap } = await import("../services/merchandisingIntelligence.server.js");

    let getBundlesWithPerformance = async () => [];
    let getExplainabilityDashboard = async () => [];
    try {
      const p6 = await import("../../backend/services/pillar6IntelligenceService.js");
      getBundlesWithPerformance = p6.getBundlesWithPerformance;
      getExplainabilityDashboard = p6.getExplainabilityDashboard;
    } catch (e) {
      console.warn("[intelligence API] pillar6 import failed:", e.message);
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [context, offerLogResult, contextDoc, bundles, explainability] = await Promise.all([
      getMerchantContext(shop),
      getOfferLogs(shop, { limit: 120 }),
      db.collection(collections.merchantIntelligence).findOne(
        { shopId: shop },
        { projection: { updatedAt: 1, createdAt: 1 } }
      ),
      getBundlesWithPerformance(shop, 50).catch(() => []),
      getExplainabilityDashboard(shop, 20).catch(() => []),
    ]);

    const offers = (offerLogResult.offers || []).map((o) => ({
      offerId: o.offerId,
      offerKey: o.offerKey,
      contextKey: o.contextKey,
      placement: o.placement,
      sourceProductId: o.sourceProductId,
      sourceProductName: o.sourceProductName,
      upsellProductId: o.upsellProductId,
      upsellProductName: o.upsellProductName,
      offerType: o.offerType,
      confidence: o.confidence,
      decisionScore: o.decisionScore,
      decisionReason: o.decisionReason,
      aiReason: o.aiReason,
      discountPercent: o.discountPercent,
      goal: o.goal,
      createdAt: o.createdAt,
    }));

    const offerKeys = offers.map((o) => o.offerKey).filter(Boolean);
    const controlMap = await getOfferControlMap(shop, offerKeys);

    const perfAgg = await db.collection(collections.upsellEvents).aggregate([
      { $match: { shopId: shop, isUpsellEvent: true, timestamp: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: {
            sourceProductId: { $ifNull: ["$sourceProductId", "cart"] },
            upsellProductId: "$upsellProductId",
            eventType: "$eventType",
          },
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    const performanceMap = {};
    for (const row of perfAgg) {
      const key = `${row._id.sourceProductId}:${row._id.upsellProductId}`;
      if (!performanceMap[key]) performanceMap[key] = { views: 0, cart_adds: 0 };
      if (row._id.eventType === "view") performanceMap[key].views = row.count;
      if (row._id.eventType === "cart_add") performanceMap[key].cart_adds = row.count;
    }

    const segmentAgg = await db.collection(collections.upsellEvents).aggregate([
      { $match: { shopId: shop, isUpsellEvent: true, timestamp: { $gte: thirtyDaysAgo } } },
      {
        $project: {
          eventType: 1,
          segment: {
            $ifNull: [
              "$metadata.segment",
              { $cond: [{ $ifNull: ["$customerId", false] }, "known_customer", "anonymous"] },
            ],
          },
        },
      },
      { $group: { _id: { segment: "$segment", eventType: "$eventType" }, count: { $sum: 1 } } },
    ]).toArray();

    const segmentMap = {};
    for (const row of segmentAgg) {
      const seg = row._id.segment || "unknown";
      if (!segmentMap[seg]) segmentMap[seg] = { segment: seg, views: 0, cartAdds: 0 };
      if (row._id.eventType === "view") segmentMap[seg].views += row.count;
      if (row._id.eventType === "cart_add") segmentMap[seg].cartAdds += row.count;
    }
    const segments = Object.values(segmentMap).map((s) => ({
      ...s,
      conversionRate: s.views > 0 ? ((s.cartAdds / s.views) * 100).toFixed(1) : "0.0",
    }));

    return Response.json({
      context,
      offers,
      controlMap,
      performanceMap,
      segments,
      bundles,
      explainability,
      lastSavedAt: contextDoc?.updatedAt || contextDoc?.createdAt || null,
    }, { headers: corsHeaders() });

  } catch (err) {
    console.error("[api.dashboard.intelligence GET]", err);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders() });
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
    const { intent } = body;

    if (intent === "save_context") {
      const { saveMerchantContext } = await import("../services/merchandisingIntelligence.server.js");
      const { priority, notes, preferBundles, focusProductsRaw, focusCollectionsRaw } = body;

      const productTokens = parseDelimitedList(focusProductsRaw);
      const collectionTokens = parseDelimitedList(focusCollectionsRaw);
      const { ids: focusProductIds, handles: focusProductHandles } = splitIdsAndHandles(productTokens);
      const { ids: focusCollectionIds, handles: focusCollectionHandles } = splitIdsAndHandles(collectionTokens);

      const result = await saveMerchantContext(shop, {
        priority: priority || "none",
        notes: notes || "",
        preferBundles: !!preferBundles,
        focusProductIds,
        focusProductHandles,
        focusCollectionIds,
        focusCollectionHandles,
      });

      return Response.json({ success: result.success, error: result.error || null }, { headers: corsHeaders() });
    }

    if (intent === "offer_action") {
      const { setOfferControl } = await import("../services/merchandisingIntelligence.server.js");
      const { offerKey, status, note, sourceProductId, upsellProductId, contextKey } = body;

      const result = await setOfferControl(shop, {
        offerKey,
        status,
        note: note || "",
        sourceProductId,
        upsellProductId,
        contextKey: contextKey || "product",
      });

      return Response.json({ success: result.success, error: result.error || null }, { headers: corsHeaders() });
    }

    return Response.json({ error: "Unknown intent" }, { status: 400, headers: corsHeaders() });

  } catch (err) {
    console.error("[api.dashboard.intelligence POST]", err);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders() });
  }
};
