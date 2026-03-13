/**
 * Discount Service — Pillar 3
 *
 * Manages Shopify discount code creation and application for upsell bundles.
 * Creates unique discount codes that can be applied to cart.
 */

import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';

/**
 * getOrCreateDiscountCode(shopId, adminGraphQL, { bundleProducts, discountPercent, expiresAt })
 *
 * Gets existing discount code or creates a new one for this bundle.
 * Returns: { success, code, discountId, discountPercent, expiresAt }
 */
export async function getOrCreateDiscountCode(
  shopId,
  adminGraphQL,
  { bundleProducts = [], discountPercent = 0, expiresAt = null }
) {
  try {
    // Generate unique code based on products + discount
    const bundleKey = generateBundleKey(bundleProducts, discountPercent);
    const discountCode = `UPSELL-${bundleKey}`;

    // Check if code already exists in Shopify
    const existingCode = await findDiscountCodeInShopify(shopId, adminGraphQL, discountCode);
    if (existingCode) {
      console.log(`✅ Using existing discount code: ${discountCode}`);
      return {
        success: true,
        code: discountCode,
        discountId: existingCode.id,
        discountPercent,
        expiresAt: existingCode.endsAt || expiresAt
      };
    }

    // Create new discount code
    const result = await createDiscountCodeInShopify(
      shopId,
      adminGraphQL,
      discountCode,
      discountPercent,
      expiresAt,
      bundleProducts
    );

    if (result.success) {
      // Log in MongoDB for tracking
      await logDiscountCreation(shopId, {
        code: discountCode,
        discountId: result.discountId,
        discountPercent,
        bundleProducts,
        expiresAt
      });

      console.log(`✅ Created discount code: ${discountCode}`);
      return result;
    } else {
      console.warn(`⚠️ Failed to create discount: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Error in getOrCreateDiscountCode:', error);
    return { success: false, error: error.message };
  }
}

/**
 * createDiscountCodeInShopify(shopId, adminGraphQL, code, percent, expiresAt, bundleProducts)
 *
 * Creates a discount code in Shopify via GraphQL.
 * Returns: { success, code, discountId }
 */
async function createDiscountCodeInShopify(
  shopId,
  adminGraphQL,
  code,
  percent,
  expiresAt,
  bundleProducts
) {
  try {
    // Ensure expires_at is in the future
    const endsAt = expiresAt
      ? new Date(expiresAt).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days default

    const mutation = `
      mutation CreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            code
            message
          }
        }
      }
    `;

    // Apply discount to entire cart subtotal (not specific products)
    const variables = {
      basicCodeDiscount: {
        title: `AI Upsell ${code}`,
        code,
        combinesWith: {
          productDiscounts: true,
          shippingDiscounts: false,
          orderDiscounts: true
        },
        appliesOncePerCustomer: false,
        usageLimit: 1000,
        startsAt: new Date().toISOString(),
        endsAt,
        customerGets: {
          value: {
            percentage: percent / 100
          },
          items: {
            all: true
          }
        },
        customerSelection: {
          all: true
        }
      }
    };

    const response = await adminGraphQL(mutation, { variables });
    const data = await response.json();

    if (Array.isArray(data.errors) && data.errors.length > 0) {
      console.error('Shopify GraphQL top-level errors:', data.errors);
      return { success: false, error: data.errors[0]?.message || 'Unknown GraphQL error' };
    }

    if (data.data?.discountCodeBasicCreate?.userErrors?.length > 0) {
      const errors = data.data.discountCodeBasicCreate.userErrors;
      console.error('Shopify errors:', errors);
      return { success: false, error: errors[0]?.message || 'Unknown error' };
    }

    const discountId = data.data?.discountCodeBasicCreate?.codeDiscountNode?.id;

    if (discountId) {
      return {
        success: true,
        code,
        discountId
      };
    }

    return { success: false, error: 'Failed to create discount' };
  } catch (error) {
    console.error('❌ Shopify GraphQL error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * findDiscountCodeInShopify(shopId, adminGraphQL, code)
 *
 * Searches for existing discount code in Shopify.
 */
async function findDiscountCodeInShopify(shopId, adminGraphQL, code) {
  try {
    const query = `
      query GetDiscountCode($query: String!) {
        codeDiscountNodes(first: 1, query: $query) {
          edges {
            node {
              id
              codeDiscount {
                codes(first: 1) {
                  edges {
                    node {
                      code
                    }
                  }
                }
                endsAt
              }
            }
          }
        }
      }
    `;

    const response = await adminGraphQL(query, {
      variables: { query: `code:${code}` }
    });
    const data = await response.json();

    const node = data.data?.codeDiscountNodes?.edges?.[0]?.node;
    if (node) {
      return {
        id: node.id,
        code: node.codeDiscount?.codes?.edges?.[0]?.node?.code,
        endsAt: node.codeDiscount?.endsAt
      };
    }

    return null;
  } catch (error) {
    console.error('⚠️ Error searching for discount:', error);
    return null;
  }
}

/**
 * logDiscountCreation(shopId, { code, discountId, discountPercent, bundleProducts, expiresAt })
 *
 * Log discount creation to MongoDB for tracking.
 */
async function logDiscountCreation(shopId, { code, discountId, discountPercent, bundleProducts, expiresAt }) {
  try {
    const db = await getDb();
    await db.collection(collections.bundles).insertOne({
      shopId,
      discountCode: code,
      discountId,
      discountPercent,
      productIds: bundleProducts.map(p => p.productId),
      variantIds: bundleProducts.map(p => p.variantId),
      expiresAt: new Date(expiresAt),
      createdAt: new Date()
    });

    logger.logDatabase('insert', 'bundles', { shopId, code });
  } catch (error) {
    console.error('⚠️ Error logging discount creation:', error);
  }
}

/**
 * generateBundleKey(products, discountPercent)
 *
 * Generate unique key for this bundle combination.
 */
function generateBundleKey(products, discountPercent) {
  const productIds = products
    .map(p => String(p.productId || p.variantId).replace(/\D/g, ''))
    .sort()
    .join('-');
  const discount = Math.round(discountPercent);
  const hash = simpleHash(`${productIds}-${discount}`);
  return hash.toUpperCase().substring(0, 8);
}

/**
 * simpleHash(str)
 *
 * Simple hash function for generating unique codes.
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * getDiscountCodeForBundle(shopId, bundleProducts, discountPercent)
 *
 * Get discount code from MongoDB without creating new one.
 */
export async function getDiscountCodeForBundle(shopId, bundleProducts, discountPercent) {
  try {
    const db = await getDb();
    const bundleKey = generateBundleKey(bundleProducts, discountPercent);
    const code = `UPSELL-${bundleKey}`;

    const bundle = await db.collection(collections.bundles).findOne(
      { shopId, discountCode: code },
      { projection: { discountCode: 1, discountPercent: 1 } }
    );

    if (bundle) {
      return {
        success: true,
        code: bundle.discountCode,
        discountPercent: bundle.discountPercent
      };
    }

    return { success: false, error: 'Discount code not found' };
  } catch (error) {
    console.error('❌ Error getting discount code:', error);
    return { success: false, error: error.message };
  }
}

/**
 * validateDiscountCode(adminGraphQL, code)
 *
 * Check if a discount code is valid and active.
 */
export async function validateDiscountCode(adminGraphQL, code) {
  try {
    const query = `
      query GetDiscount($query: String!) {
        codeDiscountNodes(first: 1, query: $query) {
          edges {
            node {
              codeDiscount {
                status
                endsAt
                startDate
              }
            }
          }
        }
      }
    `;

    const response = await adminGraphQL(query, {
      variables: { query: `code:${code}` }
    });
    const data = await response.json();

    const discount = data.data?.codeDiscountNodes?.edges?.[0]?.node?.codeDiscount;
    if (!discount) {
      return { valid: false, error: 'Code not found' };
    }

    const now = new Date();
    const endsAt = new Date(discount.endsAt);

    if (endsAt < now) {
      return { valid: false, error: 'Code has expired' };
    }

    return {
      valid: true,
      status: discount.status,
      expiresAt: discount.endsAt
    };
  } catch (error) {
    console.error('❌ Error validating discount:', error);
    return { valid: false, error: error.message };
  }
}
