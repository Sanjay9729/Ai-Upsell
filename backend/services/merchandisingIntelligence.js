import crypto from 'node:crypto';
import { getDb, collections } from '../database/mongodb.js';

const DEFAULT_CONTEXT = {
  priority: 'none',
  notes: '',
  focusProductIds: [],
  focusProductHandles: [],
  focusCollectionIds: [],
  focusCollectionHandles: [],
  preferBundles: false
};

function normalizePreferBundles(value) {
  return (
    value === true ||
    value === 'true' ||
    value === 'on' ||
    value === 1 ||
    value === '1'
  );
}

function normalizeList(value, { lower = false } = {}) {
  if (!value) return [];
  const base = Array.isArray(value) ? value : [value];
  const cleaned = base
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => (lower ? item.toLowerCase() : item));
  return Array.from(new Set(cleaned));
}

export function buildOfferKey({ contextKey = 'product', sourceProductId, upsellProductId }) {
  const src = sourceProductId ? String(sourceProductId) : 'cart';
  const upsell = upsellProductId ? String(upsellProductId) : 'unknown';
  return `${contextKey}:${src}:${upsell}`;
}

export async function getMerchantContext(shopId) {
  if (!shopId) return { ...DEFAULT_CONTEXT };
  try {
    const db = await getDb();
    const doc = await db.collection(collections.merchantIntelligence).findOne(
      { shopId },
      { projection: { _id: 0 } }
    );
    if (!doc) return { ...DEFAULT_CONTEXT };
    const context = doc.context || {};
    return {
      ...DEFAULT_CONTEXT,
      ...context,
      preferBundles: normalizePreferBundles(context.preferBundles)
    };
  } catch (err) {
    console.warn('⚠️ getMerchantContext failed:', err.message);
    return { ...DEFAULT_CONTEXT };
  }
}

export async function saveMerchantContext(shopId, context = {}) {
  if (!shopId) return { success: false, error: 'Missing shopId' };
  try {
    const db = await getDb();
    const now = new Date();
    const preferBundles = normalizePreferBundles(context.preferBundles);
    const payload = {
      priority: String(context.priority || 'none'),
      notes: String(context.notes || '').trim(),
      preferBundles,
      focusProductIds: normalizeList(context.focusProductIds),
      focusProductHandles: normalizeList(context.focusProductHandles, { lower: true }),
      focusCollectionIds: normalizeList(context.focusCollectionIds),
      focusCollectionHandles: normalizeList(context.focusCollectionHandles, { lower: true })
    };

    await db.collection(collections.merchantIntelligence).updateOne(
      { shopId },
      {
        $set: {
          shopId,
          context: payload,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    return { success: true };
  } catch (err) {
    console.error('❌ saveMerchantContext failed:', err.message);
    return { success: false, error: err.message };
  }
}

export async function getOfferControlMap(shopId, offerKeys = []) {
  if (!shopId || !Array.isArray(offerKeys) || offerKeys.length === 0) return {};
  try {
    const db = await getDb();
    const docs = await db.collection(collections.offerControls)
      .find({ shopId, offerKey: { $in: offerKeys } })
      .toArray();
    const map = {};
    for (const doc of docs) {
      map[doc.offerKey] = doc;
    }
    return map;
  } catch (err) {
    console.warn('⚠️ getOfferControlMap failed:', err.message);
    return {};
  }
}

export async function setOfferControl(shopId, {
  offerKey,
  status,
  note = '',
  sourceProductId = null,
  upsellProductId = null,
  contextKey = 'product'
} = {}) {
  if (!shopId || !offerKey || !status) {
    return { success: false, error: 'Missing required fields' };
  }

  try {
    const db = await getDb();
    const now = new Date();
    const cleanStatus = String(status);
    const cleanNote = String(note || '').trim();

    await db.collection(collections.offerControls).updateOne(
      { shopId, offerKey },
      {
        $set: {
          shopId,
          offerKey,
          status: cleanStatus,
          note: cleanNote,
          contextKey,
          sourceProductId: sourceProductId ? String(sourceProductId) : null,
          upsellProductId: upsellProductId ? String(upsellProductId) : null,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    return { success: true };
  } catch (err) {
    console.error('❌ setOfferControl failed:', err.message);
    return { success: false, error: err.message };
  }
}

export async function logDecisionOffers({
  shopId,
  contextKey = 'product',
  placement = 'product_page',
  sourceProduct = null,
  cartProducts = [],
  offers = [],
  meta = {},
  merchantContext = null
} = {}) {
  try {
    if (!shopId || !Array.isArray(offers) || offers.length === 0) return;
    const db = await getDb();
    const now = new Date();
    const cartProductIds = Array.isArray(cartProducts)
      ? cartProducts.map((p) => String(p?.productId || p?.id)).filter(Boolean)
      : [];

    const docs = offers.map((offer) => {
      const offerKey = buildOfferKey({
        contextKey,
        sourceProductId: sourceProduct?.productId || sourceProduct?.id || null,
        upsellProductId: offer?.productId || offer?.id || null
      });
      return {
        shopId,
        offerId: crypto.randomUUID(),
        offerKey,
        contextKey,
        placement,
        sourceProductId: sourceProduct?.productId || sourceProduct?.id || null,
        sourceProductName: sourceProduct?.title || sourceProduct?.name || null,
        cartProductIds,
        upsellProductId: offer?.productId || offer?.id || null,
        upsellProductName: offer?.title || offer?.productName || null,
        offerType: offer?.offerType || null,
        recommendationType: offer?.recommendationType || null,
        confidence: Number.isFinite(Number(offer?.confidence)) ? Number(offer.confidence) : null,
        decisionScore: Number.isFinite(Number(offer?.decisionScore)) ? Number(offer.decisionScore) : null,
        decisionReason: offer?.decisionReason || null,
        aiReason: offer?.aiReason || offer?.reason || null,
        discountPercent: Number.isFinite(Number(offer?.discountPercent)) ? Number(offer.discountPercent) : null,
        goal: meta?.goal || null,
        riskTolerance: meta?.riskTolerance || null,
        guardrails: meta?.guardrails || null,
        merchantContext: merchantContext || null,
        createdAt: now
      };
    });

    if (docs.length > 0) {
      await db.collection(collections.offerLogs).insertMany(docs, { ordered: false });
    }
  } catch (err) {
    console.warn('⚠️ logDecisionOffers failed:', err.message);
  }
}

export async function getOfferLogs(shopId, { limit = 100 } = {}) {
  if (!shopId) return { offers: [], count: 0 };
  try {
    const db = await getDb();
    const offers = await db.collection(collections.offerLogs)
      .find({ shopId })
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 100)
      .toArray();
    return { offers, count: offers.length };
  } catch (err) {
    console.warn('⚠️ getOfferLogs failed:', err.message);
    return { offers: [], count: 0 };
  }
}
