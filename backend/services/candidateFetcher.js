/**
 * Candidate Fetcher — Pillar 2 V1
 *
 * Given a base product and merchant guardrails, fetches eligible upsell
 * candidates from MongoDB.
 *
 * V1 rules:
 *   - Same productType as the base product
 *   - Exclude the base product itself
 *   - Exclude products below inventoryMinThreshold (any variant)
 *   - Exclude products tagged "premium" when premiumSkuProtection is on
 *   - Only ACTIVE products
 */

import { getDb, collections } from '../database/mongodb.js';

/**
 * fetchCandidates(shopId, baseProduct, guardrails)
 *
 * @param {string} shopId        - e.g. "store.myshopify.com"
 * @param {object} baseProduct   - full MongoDB product document for the viewed product
 * @param {object} guardrails    - from getMerchantConfig: { inventoryMinThreshold, premiumSkuProtection, excludedProductIds, excludedProductHandles, excludedCollectionIds, excludedCollectionHandles }
 * @returns {Promise<object[]>}  - array of eligible MongoDB product documents
 */
export async function fetchCandidates(shopId, baseProduct, guardrails) {
  const {
    inventoryMinThreshold = 5,
    premiumSkuProtection = false,
    excludedProductIds = [],
    excludedProductHandles = [],
    excludedCollectionIds = [],
    excludedCollectionHandles = [],
  } = guardrails;

  const db = await getDb();
  const col = db.collection(collections.products);

  // Build the base query
  const query = {
    shopId,
    // Same product type (empty string matches empty string — both ungrouped)
    productType: baseProduct.productType ?? '',
    // ACTIVE only — normalize to uppercase for GraphQL-synced, lowercase for REST-synced
    $or: [{ status: 'ACTIVE' }, { status: 'active' }],
    // Exclude the base product itself
    productId: { $ne: baseProduct.productId },
    // At least one variant must clear the inventory threshold
    'variants.inventoryQuantity': { $gte: inventoryMinThreshold },
  };

  // Respect merchant's manually excluded product IDs
  if (excludedProductIds.length > 0) {
    // Handle both string and number IDs that may be stored
    const excludedSet = excludedProductIds.flatMap((id) => [
      String(id),
      Number(id),
    ]);
    query.productId = { ...query.productId, $nin: excludedSet };
  }

  if (excludedProductHandles.length > 0) {
    const handleSet = excludedProductHandles
      .map((handle) => String(handle).trim().toLowerCase())
      .filter(Boolean);
    if (handleSet.length > 0) {
      query.handle = { $nin: handleSet };
    }
  }

  if (excludedCollectionIds.length > 0) {
    const collectionIdSet = excludedCollectionIds
      .map((id) => String(id).trim())
      .filter(Boolean);
    if (collectionIdSet.length > 0) {
      query.collectionIds = { $nin: collectionIdSet };
    }
  }

  if (excludedCollectionHandles.length > 0) {
    const collectionHandleSet = excludedCollectionHandles
      .map((handle) => String(handle).trim().toLowerCase())
      .filter(Boolean);
    if (collectionHandleSet.length > 0) {
      query.collectionHandles = { $nin: collectionHandleSet };
    }
  }

  // Premium SKU protection: exclude products tagged "premium"
  if (premiumSkuProtection) {
    query.tags = { $not: { $elemMatch: { $regex: /^premium$/i } } };
  }

  const candidates = await col.find(query).toArray();

  return candidates;
}
