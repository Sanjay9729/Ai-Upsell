import { json } from "@remix-run/node";
import crypto from "node:crypto";
import { authenticate } from "../shopify.server";
import { decideProductOffers } from "../../backend/services/decisionEngine.js";
import { ensureProductFromAdminGraphQL, getProductById } from "../../backend/database/collections.js";
import { getSafetyMode } from "../../backend/services/safetyMode.js";

// Pre-warm MongoDB at module load — eliminates cold-start delay on first request after server restart
import("../../backend/database/mongodb.js").then(({ getDb }) => getDb()).catch(() => {});

/**
 * Shopify App Proxy Handler
 * Handles requests from storefront via /apps/ai-upsell proxy
 *
 * URL Format: /apps/ai-upsell?id=gid://shopify/Product/{productId}
 * Maps to: /api/proxy?id=gid://shopify/Product/{productId}&shop={shop}&...
 */

function getOfferTypeExtras(offerType, discountPercent) {
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

function extractNumericId(gid) {
  if (!gid || typeof gid !== 'string') return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

function verifyProxySignature(query) {
  const { signature, ...params } = query;

  if (!signature) {
    return false;
  }

  // Sort parameters and create query string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('');

  // Calculate HMAC
  const calculatedSignature = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(sortedParams)
    .digest('hex');

  return calculatedSignature === signature;
}

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams);
    const isDev = process.env.NODE_ENV !== "production";

    // Verify the request is from Shopify
    if (!verifyProxySignature(params)) {
      if (!isDev) {
        return json({ error: "Invalid signature" }, { status: 401 });
      }
      console.warn("⚠️ Skipping app proxy signature validation in development");
    }

    const shop = params.shop;
    const productGid = params.id; // Format: gid://shopify/Product/{id}
    const userId = params.userId || null;

    if (!shop || !productGid) {
      return json({ error: "Missing required parameters" }, { status: 400 });
    }

    // Pillar 5: Lazy-trigger optimization in background if overdue (fire-and-forget)
    if (shop) {
      import("../../backend/services/schedulerService.js")
        .then(({ shouldRunOptimization, runScheduledOptimization }) =>
          shouldRunOptimization(shop).then((overdue) => {
            if (overdue) {
              runScheduledOptimization(shop, "lazy_proxy").catch(() => {});
            }
          })
        )
        .catch(() => {}); // Never block the response
    }

    // Extract numeric product ID from GID
    const productIdMatch = productGid.match(/Product\/(\d+)/);
    if (!productIdMatch) {
      return json({ error: "Invalid product ID format" }, { status: 400 });
    }

    // Convert to number to match MongoDB storage format
    const productId = parseInt(productIdMatch[1], 10);

    console.log(`🔍 Looking for product ID: ${productId} (type: ${typeof productId})`);

    // ── Persistent response cache (survives server restarts) ─────────────────
    // FRESH  (< 10 min) : return instantly, skip entire pipeline
    // STALE  (10-60 min): return stale data immediately + refresh in background
    // EXPIRED (> 60 min): run full pipeline, save new result to cache
    const CACHE_FRESH_MS = 10 * 60 * 1000;
    const CACHE_STALE_MS = 60 * 60 * 1000;
    const _cacheHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    };

    // Fetch cache + merchantConfig in parallel so offerDisplayMode filter applies to cached results too
    const hasSignature = Boolean(params.signature);

    // Safety mode check — must run before cache so paused state is always respected
    const safetyStatus = await getSafetyMode(shop).catch(() => null);
    if (safetyStatus === true) {
      return json(
        { success: true, productId, shop, recommendations: [], count: 0, decision: { reason: 'safety_mode_active', status: 'safety_mode' } },
        { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } }
      );
    }

    const [cachedDoc, merchantConfig] = await Promise.all([
      import("../../backend/database/mongodb.js")
        .then(({ getDb }) => getDb().then(db =>
          db.collection('upsell_response_cache').findOne(
            { shopId: shop, productId },
            { projection: { _id: 0, recommendations: 1, decision: 1, cachedAt: 1 } }
          )
        ))
        .catch(() => null),
      import("../../backend/database/mongodb.js")
        .then(async ({ getDb, collections }) => {
          const db = await getDb();
          return db.collection(collections.merchantConfig).findOne({ shopId: shop });
        })
        .catch(() => null),
    ]);

    const cacheAge = cachedDoc ? Date.now() - new Date(cachedDoc.cachedAt).getTime() : Infinity;

    // Helper to apply goal + offerDisplayMode filter to a recommendations array
    function applyDisplayModeFilter(recs, goal, displayMode, decisionDiscountPercent = null) {
      // Revenue per Visitor & Subscription Adoption: always addon_upsell, no bundles/volume
      if (goal === 'revenue_per_visitor' || goal === 'subscription_adoption') {
        return recs.map(r => ({ ...r, offerType: 'addon_upsell' }));
      }
      // AOV & Inventory Movement: apply merchant's display mode choice
      if (displayMode === 'bundle') {
        // When remapping to bundle, restore discountPercent if it was zeroed (e.g. was volume_discount in cache)
        return recs.map(r => {
          const missingDiscount = (r.discountPercent === 0 || r.discountPercent === null || r.discountPercent === undefined);
          return {
            ...r,
            offerType: 'bundle',
            discountPercent: missingDiscount && decisionDiscountPercent > 0 ? decisionDiscountPercent : r.discountPercent,
          };
        });
      }
      if (displayMode === 'volume_discount') {
        return recs.map(r => ({ ...r, offerType: 'volume_discount' }));
      }
      // 'both': if volume_discount is present, convert bundle products to volume_discount
      // so all products appear together in the "Buy More, Save More" grid instead of
      // splitting between "Bundle & Save" and "Buy More, Save More" sections.
      const hasVolume = recs.some(r => r.offerType === 'volume_discount');
      if (hasVolume) {
        return recs.map(r => r.offerType === 'bundle' ? { ...r, offerType: 'volume_discount' } : r);
      }
      return recs;
    }

    const cachedGoal = merchantConfig?.goal || 'increase_aov';
    const cachedDisplayMode = merchantConfig?.offerDisplayMode || 'both';

    // Skip cache if it stored a safety_mode response — so disabling safety mode takes effect immediately.
    // Also skip if cached count is below the expected limit (e.g. was built before a guardrail fix)
    // so the pipeline re-runs and replenishes to the full 4-product set.
    const EXPECTED_MIN = 4;
    const cachedCountLow = Array.isArray(cachedDoc?.recommendations) && cachedDoc.recommendations.length < EXPECTED_MIN;
    if (cachedDoc && cacheAge < CACHE_FRESH_MS && cachedDoc.decision?.reason !== 'safety_mode_active' && !cachedCountLow) {
      console.log(`⚡ Cache hit for product ${productId} (age: ${Math.round(cacheAge / 1000)}s)`);
      const cachedDiscountPct = cachedDoc.decision?.discountPercent ?? null;
      const filteredRecs = applyDisplayModeFilter(cachedDoc.recommendations, cachedGoal, cachedDisplayMode, cachedDiscountPct);
      return json(
        { success: true, productId, shop, recommendations: filteredRecs, count: filteredRecs.length, decision: cachedDoc.decision || null },
        { headers: _cacheHeaders }
      );
    }

    if (cachedDoc && cacheAge < CACHE_STALE_MS && !cachedCountLow) {
      console.log(`⏱️ Stale cache for product ${productId} — serving stale, refreshing in background`);
      // Background refresh — fire and forget, never blocks response
      ;(async () => {
        try {
          const freshDecision = await decideProductOffers({ shopId: shop, productId, userId, limit: 4, placement: "product_page" });
          const freshRecs = (freshDecision.offers || []).map(product => {
            const recType = product.recommendationType || "similar";
            const offerType = product.offerType || "addon_upsell";
            const baseDiscount = product.discountPercent ?? freshDecision.meta?.discountPercent ?? null;
            const discountPercent = (offerType === 'volume_discount' || offerType === 'subscription_upgrade') ? 0 : baseDiscount;
            const sellingPlanId = product.sellingPlanId || product.sellingPlanIds?.[0] || null;
            const sellingPlanIdNumeric = product.sellingPlanIdNumeric || extractNumericId(sellingPlanId);
            return {
              id: product.productId, title: product.title, handle: product.handle,
              price: product.aiData?.price || "0", compareAtPrice: product.aiData?.compareAtPrice || null,
              image: product.images?.[0]?.src || product.image?.src || "",
              reason: product.aiReason, confidence: product.confidence,
              type: recType, offerType, discountPercent, sellingPlanId, sellingPlanIdNumeric,
              decisionScore: product.decisionScore ?? null, decisionReason: product.decisionReason ?? null,
              url: `/products/${product.handle}`,
              availableForSale: product.status?.toUpperCase() === 'ACTIVE',
              variantId: product.variants?.[0]?.id || null,
              ...getOfferTypeExtras(offerType, baseDiscount),
            };
          });
          const { getDb } = await import("../../backend/database/mongodb.js");
          const db = await getDb();
          await db.collection('upsell_response_cache').updateOne(
            { shopId: shop, productId },
            { $set: { recommendations: freshRecs, decision: freshDecision.meta || null, cachedAt: new Date() } },
            { upsert: true }
          );
          console.log(`✅ Background cache refresh done for product ${productId}`);
        } catch (bgErr) {
          console.warn('⚠️ Background cache refresh failed:', bgErr.message);
        }
      })();
      const staleDiscountPct = cachedDoc.decision?.discountPercent ?? null;
      const filteredRecs = applyDisplayModeFilter(cachedDoc.recommendations, cachedGoal, cachedDisplayMode, staleDiscountPct);
      return json(
        { success: true, productId, shop, recommendations: filteredRecs, count: filteredRecs.length, decision: cachedDoc.decision || null },
        { headers: _cacheHeaders }
      );
    }
    // ── End cache check — falling through to full pipeline ───────────────────

    // Run auth (merchantConfig already fetched above alongside cache)
    const authResult = hasSignature
      ? await authenticate.public.appProxy(request).catch(err => {
          console.error('⚠️ App proxy auth failed (continuing without admin):', err.message || err);
          return null;
        })
      : null;

    const admin = authResult?.admin || null;
    if (hasSignature && !admin) console.warn('⚠️ No admin client from appProxy auth');

    let offerDisplayMode = merchantConfig?.offerDisplayMode || 'both';
    let merchantGoal = merchantConfig?.goal || 'increase_aov';

    // Self-heal: if webhook missed, fetch product via Admin GraphQL and upsert
    if (admin?.graphql) {
      const existing = await getProductById(shop, productId);
      const updatedAt = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const stale = !existing || (Date.now() - updatedAt > 10 * 60 * 1000);
      if (stale) {
        const refreshPromise = ensureProductFromAdminGraphQL(shop, admin.graphql, productId);
        if (!existing) {
          // Product not in DB yet — must wait before AI can find it
          await refreshPromise;
        } else {
          // Product exists but stale — refresh in background, don't block response
          refreshPromise.catch(err => console.warn('⚠️ Background product refresh failed:', err));
        }
      }
    }

    // Run decision engine to select offers (pass userId for personalization)
    const decision = await decideProductOffers({
      shopId: shop,
      productId,
      userId,
      limit: 4,
      placement: "product_page"
    });
    let recommendations = decision.offers || [];

    // Apply goal-based offer type filter
    recommendations = applyDisplayModeFilter(recommendations, merchantGoal, offerDisplayMode);

    // Use source product already fetched by AI engine — no extra DB query needed
    const sourceProductTitle = decision.sourceProduct?.title || `Product ${productId}`;
    console.log(`📝 Source product title: ${sourceProductTitle}`);

    // Format response for frontend
    const formattedRecommendations = recommendations.map(product => {
      const recommendationType = product.recommendationType || "similar";
      const offerType = product.offerType || "addon_upsell";
      const baseDiscountPercent = product.discountPercent ?? decision.meta?.discountPercent ?? null;
      const offerTypeExtras = getOfferTypeExtras(offerType, baseDiscountPercent);
      const discountPercent = (offerType === 'volume_discount' || offerType === 'subscription_upgrade') ? 0 : baseDiscountPercent;
      const sellingPlanId = product.sellingPlanId || product.sellingPlanIds?.[0] || null;
      const sellingPlanIdNumeric = product.sellingPlanIdNumeric || extractNumericId(sellingPlanId);
      return ({
      id: product.productId,
      title: product.title,
      handle: product.handle,
      price: product.aiData?.price || "0",
      compareAtPrice: product.aiData?.compareAtPrice || null,
      image: product.images?.[0]?.src || product.image?.src || "",
      reason: product.aiReason,
      confidence: product.confidence,
      type: recommendationType,
      offerType,
      discountPercent,
      sellingPlanId,
      sellingPlanIdNumeric,
      decisionScore: product.decisionScore ?? null,
      decisionReason: product.decisionReason ?? null,
      url: `/products/${product.handle}`,
      availableForSale: product.status?.toUpperCase() === 'ACTIVE',
      variantId: product.variants?.[0]?.id || null,
      ...offerTypeExtras,
    })});

    // Enrich with live inventory from Shopify Admin API
    try {
      if (admin) {
        const productGids = formattedRecommendations.map(r => `gid://shopify/Product/${r.id}`);
        const gqlResponse = await admin.graphql(
          `#graphql
          query getInventory($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                status
                totalInventory
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryPolicy
                      inventoryQuantity
                      compareAtPrice
                    }
                  }
                }
              }
            }
          }`,
          { variables: { ids: productGids } }
        );
        const gqlData = await gqlResponse.json();
        console.log('📦 Shopify inventory response:', JSON.stringify(gqlData.data?.nodes?.map(n => ({
          id: n?.id, status: n?.status, totalInventory: n?.totalInventory
        })), null, 2));

        const inventoryMap = {};
        for (const node of gqlData.data?.nodes || []) {
          if (!node || !node.id) continue;
          const numericId = node.id.match(/Product\/(\d+)/)?.[1];
          if (numericId) {
            const variant = node.variants?.edges?.[0]?.node;
            const policy = variant?.inventoryPolicy === 'DENY' ? 'deny' : 'continue';
            const totalInv = node.totalInventory ?? variant?.inventoryQuantity ?? 0;
            const allVariants = (node.variants?.edges || []).map(e => {
              const v = e.node;
              const vPolicy = v.inventoryPolicy === 'DENY' ? 'deny' : 'continue';
              return {
                id: v.id.split('/').pop(),
                title: v.title,
                price: v.price,
                compareAtPrice: v.compareAtPrice || null,
                available: node.status === 'ACTIVE' && (v.inventoryQuantity > 0 || vPolicy === 'continue')
              };
            });
            inventoryMap[numericId] = {
              availableForSale: node.status === 'ACTIVE' && (totalInv > 0 || policy === 'continue'),
              inventoryQuantity: totalInv,
              inventoryPolicy: policy,
              variantId: variant?.id || null,
              compareAtPrice: variant?.compareAtPrice || null,
              variants: allVariants
            };
          }
        }
        console.log('📦 Inventory map:', inventoryMap);

        // Merge inventory & pricing into recommendations
         formattedRecommendations.forEach((rec, i) => {
           const live = inventoryMap[String(rec.id)] || {};
           if (live.availableForSale !== undefined) {
             // Get live price from variants if available
             const livePrice = live.variants && live.variants[0] ? String(live.variants[0].price) : rec.price;
             formattedRecommendations[i] = {
               ...rec,
               availableForSale: live.availableForSale,
               inventoryQuantity: live.inventoryQuantity,
               inventoryPolicy: live.inventoryPolicy,
               variantId: live.variantId || rec.variantId,
               price: livePrice,
               compareAtPrice: (live.variants && live.variants[0]?.compareAtPrice) || live.compareAtPrice || rec.compareAtPrice,
               variants: live.variants || []
             };
           }
         });
      }
    } catch (invError) {
      console.error('⚠️ Inventory enrichment failed:', invError.message);
    }

    // Persist result to MongoDB cache for instant future loads (fire-and-forget)
    import("../../backend/database/mongodb.js")
      .then(({ getDb }) => getDb().then(db =>
        db.collection('upsell_response_cache').updateOne(
          { shopId: shop, productId },
          { $set: { recommendations: formattedRecommendations, decision: decision.meta || null, cachedAt: new Date() } },
          { upsert: true }
        )
      ))
      .catch(() => {}); // never block the response

    // Return response in Liquid-compatible format
    return json({
      success: true,
      productId,
      shop,
      recommendations: formattedRecommendations,
      count: formattedRecommendations.length,
      decision: decision.meta || null
    }, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      }
    });

  } catch (error) {
    console.error("❌ Error in app proxy:", error);
    return json({
      success: false,
      error: error.message,
      recommendations: []
    }, {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      }
    });
  }
};
