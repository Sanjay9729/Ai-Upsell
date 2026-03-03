/**
 * API Route: Get/Create Discount Codes
 *
 * GET /api/discount-code?bundleProducts=[...]&discountPercent=20
 *   Returns discount code for the bundle, creates if needed
 *
 * POST /api/discount-code/validate
 *   Validates a discount code
 */

import { authenticate } from '../shopify.server.js';
import {
  getOrCreateDiscountCode,
  getDiscountCodeForBundle,
  validateDiscountCode
} from '../../backend/services/discountService.js';

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const bundleProductsParam = url.searchParams.get('bundleProducts');
  const discountPercent = parseFloat(url.searchParams.get('discountPercent')) || 0;

  if (!bundleProductsParam) {
    return new Response(
      JSON.stringify({ error: 'Missing bundleProducts parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let bundleProducts = [];
    try {
      bundleProducts = JSON.parse(decodeURIComponent(bundleProductsParam));
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid bundleProducts JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!Array.isArray(bundleProducts) || bundleProducts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'bundleProducts must be a non-empty array' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get shop info
    const shopData = await admin.graphql(`query { shop { myshopifyDomain } }`);
    const shopId = shopData.data?.shop?.myshopifyDomain;

    if (!shopId) {
      return new Response(
        JSON.stringify({ error: 'Unable to determine shop ID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get or create discount code
    const result = await getOrCreateDiscountCode(
      shopId,
      admin.graphql,
      {
        bundleProducts,
        discountPercent,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    );

    if (!result.success) {
      console.error('Failed to create discount:', result.error);
      // Fallback: try to get existing code
      const existing = await getDiscountCodeForBundle(shopId, bundleProducts, discountPercent);
      if (existing.success) {
        return new Response(
          JSON.stringify(existing),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: result.error || 'Failed to create discount code' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        code: result.code,
        discountPercent,
        expiresAt: result.expiresAt
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error in discount-code loader:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function action({ request }) {
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { admin } = await authenticate.admin(request);
  const { code } = await request.json();

  if (!code) {
    return new Response(
      JSON.stringify({ error: 'Missing code parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const result = await validateDiscountCode(admin.graphql, code);
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error validating discount:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
