/**
 * SIMPLIFIED Cart Endpoint - Phase 1 MVP
 *
 * Purpose: Return bundle recommendations for the cart
 * Logic: Query MongoDB for active bundles, return them
 * No AI, no analytics, no complex logic
 */

import { json } from "@remix-run/node";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids");
    const shop = url.searchParams.get("shop");

    // Validate inputs
    if (!idsParam || !shop) {
      console.warn("⚠️ Cart API: Missing ids or shop parameter");
      return json({
        success: true,
        bundles: [],
        message: "Missing parameters"
      });
    }

    // Parse cart product IDs
    let cartProductIds = [];
    try {
      const gids = JSON.parse(idsParam);
      cartProductIds = gids
        .map(gid => {
          const match = gid.match(/Product\/(\d+)/);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter(id => id !== null);
    } catch (parseErr) {
      console.warn("⚠️ Cart API: Failed to parse product IDs", parseErr.message);
      return json({
        success: true,
        bundles: [],
        message: "Invalid product IDs format"
      });
    }

    if (cartProductIds.length === 0) {
      return json({
        success: true,
        bundles: [],
        message: "Empty cart"
      });
    }

    console.log(`📦 Cart API: Fetching bundles for ${cartProductIds.length} products`);

    // Connect to MongoDB
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    // Fetch ALL active bundles for this shop (no filtering)
    const bundles = await db
      .collection(collections.bundles)
      .find({
        shopId: shop,
        status: "active"
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    console.log(`✅ Found ${bundles.length} active bundles for ${shop}`);

    // Convert to simple format
    const bundleRecommendations = bundles
      .filter(b => b.productIds && b.productIds.length > 0)
      .map(bundle => {
        // Only include products that aren't already in cart
        const newProducts = bundle.productIds.filter(
          pid => !cartProductIds.includes(Number(pid))
        );

        // Skip if all products already in cart
        if (newProducts.length === 0) {
          console.log(`  ⏭️ Skipping bundle "${bundle.name}" - all products in cart`);
          return null;
        }

        console.log(`  ✅ Including bundle "${bundle.name}" with ${newProducts.length} new products`);

        return {
          _id: bundle._id.toString(),
          name: bundle.name,
          productIds: newProducts.slice(0, 3), // Max 3 products per bundle
          discountPercent: bundle.discountPercent || 10,
          bundleType: bundle.bundleType || "manual",
          confidence: bundle.confidence || 0.8
        };
      })
      .filter(Boolean); // Remove nulls

    console.log(`📊 Returning ${bundleRecommendations.length} bundle recommendations`);

    return json(
      {
        success: true,
        bundles: bundleRecommendations,
        cartProductIds: cartProductIds,
        shop: shop,
        timestamp: new Date().toISOString()
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("❌ Cart API Error:", error.message);
    return json(
      {
        success: false,
        bundles: [],
        error: error.message
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
};
