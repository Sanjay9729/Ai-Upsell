import { json } from "@remix-run/node";
import { useLoaderData, useActionData } from "@remix-run/react";
import { useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import {
  getMerchantContext,
  saveMerchantContext,
  getOfferControlMap,
  setOfferControl,
  getOfferLogs
} from "../services/merchandisingIntelligence.server";
import { syncProductsWithGraphQL } from "../../backend/database/collections.js";

function parseDelimitedList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function splitIdsAndHandles(tokens, { idRegex } = {}) {
  const ids = [];
  const handles = [];
  const gidRegex = idRegex || /(Product|Collection)\/(\d+)/i;

  for (const raw of tokens || []) {
    const token = String(raw).trim();
    if (!token) continue;
    const gidMatch = token.match(gidRegex);
    if (gidMatch?.[2]) {
      ids.push(gidMatch[2]);
      continue;
    }
    if (/^\d+$/.test(token)) {
      ids.push(token);
      continue;
    }
    handles.push(token.toLowerCase());
  }

  return {
    ids: Array.from(new Set(ids)),
    handles: Array.from(new Set(handles)),
  };
}

function buildListText(ids = [], handles = []) {
  const items = [];
  if (Array.isArray(ids)) items.push(...ids.map(String));
  if (Array.isArray(handles)) items.push(...handles.map(String));
  return items.join(", ");
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const { getDb, collections } = await import("../../backend/database/mongodb.js");
  const db = await getDb();

  const [context, offerLogResult, contextDoc] = await Promise.all([
    getMerchantContext(shopId),
    getOfferLogs(shopId, { limit: 120 }),
    db.collection(collections.merchantIntelligence).findOne(
      { shopId },
      { projection: { updatedAt: 1, createdAt: 1 } }
    )
  ]);

  const offers = (offerLogResult.offers || []).map((offer) => ({
    offerId: offer.offerId,
    offerKey: offer.offerKey,
    contextKey: offer.contextKey,
    placement: offer.placement,
    sourceProductId: offer.sourceProductId,
    sourceProductName: offer.sourceProductName,
    upsellProductId: offer.upsellProductId,
    upsellProductName: offer.upsellProductName,
    offerType: offer.offerType,
    recommendationType: offer.recommendationType,
    confidence: offer.confidence,
    decisionScore: offer.decisionScore,
    decisionReason: offer.decisionReason,
    aiReason: offer.aiReason,
    discountPercent: offer.discountPercent,
    goal: offer.goal,
    riskTolerance: offer.riskTolerance,
    createdAt: offer.createdAt
  }));

  const offerKeys = offers.map((o) => o.offerKey).filter(Boolean);
  const controlMap = await getOfferControlMap(shopId, offerKeys);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const perfRows = await db.collection(collections.upsellEvents).aggregate([
    {
      $match: {
        shopId,
        isUpsellEvent: true,
        timestamp: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          sourceProductId: { $ifNull: ["$sourceProductId", "cart"] },
          upsellProductId: "$upsellProductId",
          eventType: "$eventType"
        },
        count: { $sum: 1 }
      }
    }
  ]).toArray();

  const performanceMap = {};
  for (const row of perfRows) {
    const key = `${row._id.sourceProductId}:${row._id.upsellProductId}`;
    if (!performanceMap[key]) performanceMap[key] = { views: 0, clicks: 0, cart_adds: 0 };
    if (row._id.eventType === 'view') performanceMap[key].views = row.count;
    if (row._id.eventType === 'click') performanceMap[key].clicks = row.count;
    if (row._id.eventType === 'cart_add') performanceMap[key].cart_adds = row.count;
  }

  const segmentRows = await db.collection(collections.upsellEvents).aggregate([
    {
      $match: {
        shopId,
        isUpsellEvent: true,
        timestamp: { $gte: thirtyDaysAgo }
      }
    },
    {
      $project: {
        eventType: 1,
        segment: {
          $ifNull: [
            "$metadata.segment",
            {
              $cond: [
                { $ifNull: ["$customerId", false] },
                "known_customer",
                "anonymous"
              ]
            }
          ]
        }
      }
    },
    {
      $group: {
        _id: { segment: "$segment", eventType: "$eventType" },
        count: { $sum: 1 }
      }
    }
  ]).toArray();

  const segmentMap = {};
  for (const row of segmentRows) {
    const segment = row._id.segment || 'unknown';
    if (!segmentMap[segment]) {
      segmentMap[segment] = { segment, views: 0, clicks: 0, cartAdds: 0 };
    }
    if (row._id.eventType === 'view') segmentMap[segment].views += row.count;
    if (row._id.eventType === 'click') segmentMap[segment].clicks += row.count;
    if (row._id.eventType === 'cart_add') segmentMap[segment].cartAdds += row.count;
  }

  const segments = Object.values(segmentMap).map((s) => ({
    ...s,
    clickThroughRate: s.views > 0 ? (s.clicks / s.views) * 100 : 0,
    conversionRate: s.views > 0 ? (s.cartAdds / s.views) * 100 : 0
  }));

  return json({
    context,
    offers,
    controlMap,
    performanceMap,
    segments,
    lastSavedAt: contextDoc?.updatedAt || contextDoc?.createdAt || null
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_context") {
    const priority = formData.get("priority") || "none";
    const notes = formData.get("notes") || "";
    const preferBundles = formData.get("preferBundles") === "on";
    const productsInput = formData.get("focusProducts") || "";
    const collectionsInput = formData.get("focusCollections") || "";

    const productTokens = parseDelimitedList(productsInput);
    const collectionTokens = parseDelimitedList(collectionsInput);

    const { ids: focusProductIds, handles: focusProductHandles } = splitIdsAndHandles(productTokens, {
      idRegex: /Product\/(\d+)/i
    });
    const { ids: focusCollectionIds, handles: focusCollectionHandles } = splitIdsAndHandles(collectionTokens, {
      idRegex: /Collection\/(\d+)/i
    });

    const result = await saveMerchantContext(shopId, {
      priority,
      notes,
      preferBundles,
      focusProductIds,
      focusProductHandles,
      focusCollectionIds,
      focusCollectionHandles
    });

    if (result.success) {
      // Auto-sync products so collection data is fresh in MongoDB
      const { admin } = await authenticate.admin(request);
      syncProductsWithGraphQL(shopId, admin.graphql).catch(err =>
        console.warn("[intelligence] Background sync failed:", err.message)
      );
    }

    return json({ success: result.success, error: result.error || null, intent });
  }

  if (intent === "offer_action") {
    const offerKey = formData.get("offerKey");
    const status = formData.get("status");
    const note = formData.get("note") || "";
    const sourceProductId = formData.get("sourceProductId");
    const upsellProductId = formData.get("upsellProductId");
    const contextKey = formData.get("contextKey") || "product";

    const result = await setOfferControl(shopId, {
      offerKey,
      status,
      note,
      sourceProductId,
      upsellProductId,
      contextKey
    });

    return json({ success: result.success, error: result.error || null, intent });
  }

  return json({ success: false, error: "Unknown intent", intent }, { status: 400 });
};

export default function IntelligencePage() {
  const { context, offers, controlMap, performanceMap, segments, lastSavedAt } = useLoaderData();
  const actionData = useActionData();
  const [filter, setFilter] = useState("all");

  const filteredOffers = useMemo(() => {
    if (filter === "all") return offers;
    return offers.filter((o) => o.offerType === filter);
  }, [offers, filter]);

  const focusProducts = buildListText(context.focusProductIds, context.focusProductHandles);
  const focusCollections = buildListText(context.focusCollectionIds, context.focusCollectionHandles);

  const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const buttonClass = (active = false, variant = "tertiary") => {
    const base = "mi-button";
    const tone = active ? "mi-button--primary" : variant === "primary" ? "mi-button--primary" : "mi-button--tertiary";
    return `${base} ${tone}`;
  };

  return (
    <s-page heading="Merchandising Intelligence">
      <style>{`
        * {
          font-family: ${fontFamily} !important;
        }
        .mi-button {
          appearance: none;
          border: 1px solid #c9cccf;
          background: #f6f6f7;
          color: #202223;
          border-radius: 6px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .mi-button--primary {
          background: #008060;
          border-color: #007a5c;
          color: #ffffff;
        }
        .mi-button--tertiary {
          background: #ffffff;
          border-color: #c9cccf;
          color: #202223;
        }
        .mi-button:focus {
          outline: 2px solid #004c3f;
          outline-offset: 2px;
        }
        .mi-input {
          border: 1px solid #c9cccf;
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 12px;
          min-width: 220px;
        }
      `}</style>

      <s-section heading="Context Injection">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
          Provide strategic guidance. The AI treats this as a soft preference and never violates guardrails.
        </div>
        <form key={lastSavedAt || 'default'} method="post" style={{ display: "grid", gap: "12px" }}>
          <input type="hidden" name="intent" value="save_context" />
          <label style={{ fontSize: "12px", fontWeight: 600, color: "#303030" }}>
            Priority
            <select
              name="priority"
              defaultValue={context.priority || "none"}
              style={{
                display: "block",
                marginTop: "6px",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #c9cccf",
                fontSize: "13px",
                width: "260px"
              }}
            >
              <option value="none">No special priority</option>
              <option value="push_new_collection">Push new collection</option>
              <option value="clear_overstock">Clear overstock</option>
              <option value="grow_subscriptions">Grow subscriptions</option>
              <option value="maximize_margin">Maximize margin</option>
              <option value="custom">Custom focus</option>
            </select>
          </label>

          <label style={{ fontSize: "12px", fontWeight: 600, color: "#303030" }}>
            Focus products (IDs or handles)
            <textarea
              name="focusProducts"
              defaultValue={focusProducts}
              placeholder="e.g. 7708018999350, premium-bracelet"
              style={{
                display: "block",
                marginTop: "6px",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #c9cccf",
                fontSize: "13px",
                width: "100%",
                minHeight: "70px"
              }}
            />
          </label>

          <label style={{ fontSize: "12px", fontWeight: 600, color: "#303030" }}>
            Focus collections (IDs or handles)
            <textarea
              name="focusCollections"
              defaultValue={focusCollections}
              placeholder="e.g. summer-collection, 123456789"
              style={{
                display: "block",
                marginTop: "6px",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #c9cccf",
                fontSize: "13px",
                width: "100%",
                minHeight: "70px"
              }}
            />
          </label>

          <label style={{ fontSize: "12px", fontWeight: 600, color: "#303030" }}>
            Notes
            <textarea
              name="notes"
              defaultValue={context.notes || ""}
              placeholder='e.g. Push “New Arrivals” and avoid discounting premium bundles.'
              style={{
                display: "block",
                marginTop: "6px",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #c9cccf",
                fontSize: "13px",
                width: "100%",
                minHeight: "70px"
              }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#303030" }}>
            <input type="checkbox" name="preferBundles" defaultChecked={context.preferBundles} />
            Prefer bundle-style offers when possible
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button type="submit" className={buttonClass(true)}>Save Context</button>
            {actionData?.success && actionData?.intent === "save_context" && (
              <span style={{ fontSize: "12px", color: "#008060" }}>Saved</span>
            )}
            {actionData?.error && actionData?.intent === "save_context" && (
              <span style={{ fontSize: "12px", color: "#b42318" }}>{actionData.error}</span>
            )}
            {lastSavedAt && (
              <span style={{ fontSize: "12px", color: "#6d7175" }}>
                Last saved: {new Date(lastSavedAt).toLocaleString()}
              </span>
            )}
          </div>
        </form>
      </s-section>

      <s-section heading="Segment Performance (Last 30 Days)">
        {segments.length === 0 ? (
          <div style={{ padding: "16px", color: "#6d7175", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #e1e3e5" }}>
            No segment data yet. When events include metadata.segment or customer IDs, performance will appear here.
          </div>
        ) : (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead style={{ background: "#f7f7f8" }}>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ padding: "10px 14px" }}>Segment</th>
                  <th style={{ padding: "10px 14px" }}>Views</th>
                  <th style={{ padding: "10px 14px" }}>Clicks</th>
                  <th style={{ padding: "10px 14px" }}>Adds</th>
                  <th style={{ padding: "10px 14px" }}>CTR</th>
                  <th style={{ padding: "10px 14px" }}>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg) => (
                  <tr key={seg.segment} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}>{seg.segment}</td>
                    <td style={{ padding: "10px 14px" }}>{seg.views}</td>
                    <td style={{ padding: "10px 14px" }}>{seg.clicks}</td>
                    <td style={{ padding: "10px 14px" }}>{seg.cartAdds}</td>
                    <td style={{ padding: "10px 14px" }}>{seg.views > 0 ? `${seg.clickThroughRate.toFixed(1)}%` : "—"}</td>
                    <td style={{ padding: "10px 14px" }}>{seg.views > 0 ? `${seg.conversionRate.toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading="Bundle & Offer Review">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
          <button type="button" className={buttonClass(filter === "all")} onClick={() => setFilter("all")}>
            All ({offers.length})
          </button>
          <button type="button" className={buttonClass(filter === "bundle")} onClick={() => setFilter("bundle")}>
            Bundles
          </button>
          <button type="button" className={buttonClass(filter === "volume_discount")} onClick={() => setFilter("volume_discount")}>
            Volume
          </button>
          <button type="button" className={buttonClass(filter === "subscription_upgrade")} onClick={() => setFilter("subscription_upgrade")}>
            Subscription
          </button>
          <button type="button" className={buttonClass(filter === "addon_upsell")} onClick={() => setFilter("addon_upsell")}>
            Add-ons
          </button>
        </div>

        {filteredOffers.length === 0 ? (
          <div style={{ padding: "16px", color: "#6d7175", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #e1e3e5" }}>
            No offers logged yet. Offers will appear here after the decision engine runs.
          </div>
        ) : (
          <div style={{ display: "grid", gap: "14px" }}>
            {filteredOffers.map((offer) => {
              const perfKey = `${offer.sourceProductId || "cart"}:${offer.upsellProductId}`;
              const perf = performanceMap[perfKey] || { views: 0, clicks: 0, cart_adds: 0 };
              const status = controlMap[offer.offerKey]?.status || "auto";
              const note = controlMap[offer.offerKey]?.note || "";
              const ctr = perf.views > 0 ? ((perf.clicks / perf.views) * 100).toFixed(1) : "—";
              const conv = perf.views > 0 ? ((perf.cart_adds / perf.views) * 100).toFixed(1) : "—";

              return (
                <div key={offer.offerId} style={{ border: "1px solid #e1e3e5", borderRadius: "10px", padding: "16px", background: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                    <div>
                      <div style={{ fontSize: "12px", color: "#6d7175", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                        Source → Offer
                      </div>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#202223" }}>
                        {offer.sourceProductName || offer.sourceProductId || "Cart"} → {offer.upsellProductName || offer.upsellProductId}
                      </div>
                    </div>
                    <span style={{
                      display: "inline-block",
                      padding: "4px 12px",
                      borderRadius: "999px",
                      fontSize: "12px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      background: status === "paused" ? "#fde8e8" : status === "approved" ? "#e3f5e1" : status === "guided" ? "#eaf0ff" : "#f1f2f3",
                      color: status === "paused" ? "#b42318" : status === "approved" ? "#1a7f37" : status === "guided" ? "#3b5998" : "#6d7175",
                      border: `1px solid ${status === "paused" ? "#f3bebe" : status === "approved" ? "#b7e4b0" : status === "guided" ? "#c5d4f5" : "#d2d5d8"}`
                    }}>
                      {status}
                    </span>
                  </div>

                  <div style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#4a4a4a" }}>
                    <div>
                      Type: <strong>{offer.offerType || "addon_upsell"}</strong> · Recommendation: {offer.recommendationType || "similar"} · Placement: {offer.placement}
                    </div>
                    <div>
                      Goal: {offer.goal || "—"} · Risk: {offer.riskTolerance || "—"} · Discount: {offer.discountPercent != null ? `${offer.discountPercent}%` : "—"}
                    </div>
                    <div>
                      Decision: {offer.decisionReason || "—"} · AI: {offer.aiReason || "—"}
                    </div>
                    <div>
                      Confidence: {offer.confidence != null ? offer.confidence : "—"} · Score: {offer.decisionScore != null ? offer.decisionScore : "—"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "14px", marginTop: "10px", fontSize: "12px", color: "#6d7175" }}>
                    <div>Views: {perf.views}</div>
                    <div>Clicks: {perf.clicks}</div>
                    <div>Adds: {perf.cart_adds}</div>
                    <div>CTR: {ctr === "—" ? "—" : `${ctr}%`}</div>
                    <div>Conv: {conv === "—" ? "—" : `${conv}%`}</div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "12px" }}>
                    <form method="post">
                      <input type="hidden" name="intent" value="offer_action" />
                      <input type="hidden" name="offerKey" value={offer.offerKey} />
                      <input type="hidden" name="status" value="approved" />
                      <input type="hidden" name="contextKey" value={offer.contextKey || "product"} />
                      <input type="hidden" name="sourceProductId" value={offer.sourceProductId || ""} />
                      <input type="hidden" name="upsellProductId" value={offer.upsellProductId || ""} />
                      <button type="submit" className={buttonClass(false, "primary")}>Approve</button>
                    </form>

                    <form method="post">
                      <input type="hidden" name="intent" value="offer_action" />
                      <input type="hidden" name="offerKey" value={offer.offerKey} />
                      <input type="hidden" name="status" value="paused" />
                      <input type="hidden" name="contextKey" value={offer.contextKey || "product"} />
                      <input type="hidden" name="sourceProductId" value={offer.sourceProductId || ""} />
                      <input type="hidden" name="upsellProductId" value={offer.upsellProductId || ""} />
                      <button type="submit" className={buttonClass(false, "tertiary")}>Pause</button>
                    </form>

                    <form method="post" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input type="hidden" name="intent" value="offer_action" />
                      <input type="hidden" name="offerKey" value={offer.offerKey} />
                      <input type="hidden" name="status" value="guided" />
                      <input type="hidden" name="contextKey" value={offer.contextKey || "product"} />
                      <input type="hidden" name="sourceProductId" value={offer.sourceProductId || ""} />
                      <input type="hidden" name="upsellProductId" value={offer.upsellProductId || ""} />
                      <input
                        type="text"
                        name="note"
                        placeholder="Guide (optional)"
                        defaultValue={note}
                        className="mi-input"
                      />
                      <button type="submit" className={buttonClass(false, "tertiary")}>Guide</button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </s-section>
    </s-page>
  );
}
