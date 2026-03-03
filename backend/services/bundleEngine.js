/**
 * Bundle Engine — Autonomous Bundle Creation
 *
 * Detects co-purchase patterns from analytics and autonomously creates
 * recommended bundle configurations. Uses confidence scoring and merchant
 * guardrails to validate bundles before recommendation.
 */

import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';

const BUNDLE_CONFIG = {
  minCoOccurrences: 5, // Minimum co-purchase count to create bundle
  minConfidenceScore: 0.65, // Min confidence (normalized)
  maxBundleSize: 4, // Max products per bundle
  bundleName: (productIds) => `Bundle-${productIds.slice(0, 2).join('-')}`
};

/**
 * Detect co-purchase patterns for a source product
 * Analyzes cart add events to find which products are frequently bought together
 */
export async function detectCoPurchasePatterns(shopId, sourceProductId, options = {}) {
  try {
    const db = await getDb();
    const {
      lookbackDays = 30,
      minOccurrences = BUNDLE_CONFIG.minCoOccurrences
    } = options;

    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // Find all cart_add events where sourceProductId appeared
    const cartAddEvents = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          sourceProductId: sourceProductId.toString(),
          eventType: 'cart_add',
          timestamp: { $gte: since }
        }
      },
      {
        $group: {
          _id: '$sessionId',
          products: { $addToSet: '$upsellProductId' },
          count: { $sum: 1 },
          avgConfidence: { $avg: '$confidence' }
        }
      }
    ]).toArray();

    if (cartAddEvents.length === 0) {
      return { patterns: [], sourceProductId, reason: 'no_cart_adds' };
    }

    // Count co-occurrences
    const coOccurrences = {};
    for (const session of cartAddEvents) {
      const products = Array.isArray(session.products) ? session.products : [];
      for (let i = 0; i < products.length; i++) {
        for (let j = i + 1; j < products.length; j++) {
          const key = [products[i], products[j]].sort().join('|');
          if (!coOccurrences[key]) {
            coOccurrences[key] = { count: 0, confidence: 0, sessions: 0 };
          }
          coOccurrences[key].count += 1;
          coOccurrences[key].confidence += (session.avgConfidence || 0.5);
          coOccurrences[key].sessions += 1;
        }
      }
    }

    // Filter and score patterns
    const patterns = Object.entries(coOccurrences)
      .filter(([, data]) => data.count >= minOccurrences)
      .map(([key, data]) => {
        const [pid1, pid2] = key.split('|');
        return {
          productIds: [pid1, pid2],
          coOccurrences: data.count,
          confidenceScore: Math.min(1, data.confidence / data.sessions),
          sessionCount: data.sessions
        };
      })
      .sort((a, b) => b.coOccurrences - a.coOccurrences);

    return { patterns, sourceProductId, lookbackDays, totalSessions: cartAddEvents.length };
  } catch (error) {
    logger.logError('detectCoPurchasePatterns', { shopId, sourceProductId, error: error.message });
    return { patterns: [], error: error.message };
  }
}

/**
 * Create or update a bundle configuration
 */
export async function createBundle({
  shopId,
  name,
  productIds = [],
  discountPercent = 10,
  bundleType = 'recommended', // 'merchant' or 'recommended'
  confidence = 0.7
} = {}) {
  try {
    if (!shopId || productIds.length < 2) {
      return { success: false, reason: 'invalid_input' };
    }

    const db = await getDb();
    const bundleDoc = {
      shopId,
      name: name || BUNDLE_CONFIG.bundleName(productIds),
      productIds: productIds.map(String),
      discountPercent: Number(discountPercent) || 10,
      bundleType,
      confidence: Number(confidence) || 0.7,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      stats: {
        views: 0,
        clicks: 0,
        adds: 0,
        conversionRate: 0
      }
    };

    // Check for duplicates (same product set)
    const existing = await db.collection(collections.bundles).findOne({
      shopId,
      productIds: { $all: bundleDoc.productIds, $size: bundleDoc.productIds.length }
    });

    if (existing) {
      // Update existing
      const result = await db.collection(collections.bundles).updateOne(
        { _id: existing._id },
        { $set: { ...bundleDoc, updatedAt: new Date() } }
      );
      return { success: result.modifiedCount > 0, bundleId: existing._id, action: 'updated' };
    }

    // Create new
    const result = await db.collection(collections.bundles).insertOne(bundleDoc);
    logger.logDatabase('insert', 'bundles', { shopId, bundleId: result.insertedId, productIds });
    return { success: true, bundleId: result.insertedId, action: 'created' };
  } catch (error) {
    logger.logError('createBundle', { shopId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get all bundles for a shop
 */
export async function getBundles(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      status = 'active',
      bundleType = null,
      limit = 50
    } = options;

    const query = { shopId };
    if (status) query.status = status;
    if (bundleType) query.bundleType = bundleType;

    const bundles = await db.collection(collections.bundles)
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return {
      success: true,
      bundles: bundles.map(b => ({
        ...b,
        _id: b._id.toString()
      })),
      count: bundles.length
    };
  } catch (error) {
    logger.logError('getBundles', { shopId, error: error.message });
    return { success: false, bundles: [], error: error.message };
  }
}

/**
 * Recommend bundles based on co-purchase analysis
 * Autonomously suggests bundles that meet confidence and occurrence thresholds
 */
export async function recommendBundles(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      minConfidence = BUNDLE_CONFIG.minConfidenceScore,
      minOccurrences = BUNDLE_CONFIG.minCoOccurrences,
      maxBundleSize = BUNDLE_CONFIG.maxBundleSize,
      limit = 10
    } = options;

    // Get top source products by recommendation count
    const topSourceProducts = await db.collection(collections.upsellEvents).aggregate([
      {
        $match: {
          shopId,
          eventType: 'cart_add',
          sourceProductId: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$sourceProductId',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]).toArray();

    const recommendations = [];

    for (const { _id: sourceProductId } of topSourceProducts) {
      const patterns = await detectCoPurchasePatterns(shopId, sourceProductId, {
        minOccurrences
      });

      for (const pattern of patterns.patterns) {
        if (pattern.confidenceScore >= minConfidence && pattern.productIds.length <= maxBundleSize) {
          const bundleResult = await createBundle({
            shopId,
            productIds: [sourceProductId, ...pattern.productIds],
            discountPercent: computeBundleDiscount(pattern.confidenceScore),
            bundleType: 'recommended',
            confidence: pattern.confidenceScore
          });

          if (bundleResult.success) {
            recommendations.push({
              bundleId: bundleResult.bundleId,
              productIds: [sourceProductId, ...pattern.productIds],
              confidence: pattern.confidenceScore,
              coOccurrences: pattern.coOccurrences,
              action: bundleResult.action
            });
          }

          if (recommendations.length >= limit) break;
        }
      }

      if (recommendations.length >= limit) break;
    }

    return { success: true, recommendations, count: recommendations.length };
  } catch (error) {
    logger.logError('recommendBundles', { shopId, error: error.message });
    return { success: false, recommendations: [], error: error.message };
  }
}

/**
 * Track bundle interactions
 */
export async function trackBundleEvent({
  eventType,
  shopId,
  bundleId,
  productIds = [],
  customerId = null,
  sessionId = null,
  metadata = {}
} = {}) {
  try {
    const db = await getDb();
    const event = {
      eventType,
      shopId,
      bundleId: bundleId?.toString(),
      productIds: productIds.map(String),
      customerId,
      sessionId,
      metadata,
      timestamp: new Date()
    };

    const result = await db.collection(collections.bundleEvents).insertOne(event);

    // Update bundle stats
    if (bundleId) {
      const statField = `stats.${getStatFieldName(eventType)}`;
      await db.collection(collections.bundles).updateOne(
        { _id: bundleId },
        { $inc: { [statField]: 1, 'stats.totalInteractions': 1 } }
      );
    }

    return { success: true, eventId: result.insertedId };
  } catch (error) {
    logger.logError('trackBundleEvent', { shopId, bundleId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get bundle analytics
 */
export async function getBundleAnalytics(shopId, bundleId = null, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate = new Date()
    } = options;

    const query = {
      shopId,
      timestamp: { $gte: startDate, $lte: endDate }
    };

    if (bundleId) {
      query.bundleId = bundleId.toString();
    }

    const events = await db.collection(collections.bundleEvents)
      .find(query)
      .sort({ timestamp: -1 })
      .toArray();

    // Aggregate stats
    const stats = {
      view: 0,
      click: 0,
      cart_add: 0,
      purchase: 0
    };

    for (const event of events) {
      if (stats[event.eventType] !== undefined) {
        stats[event.eventType] += 1;
      }
    }

    const conversionRate = stats.view > 0 ? (stats.cart_add / stats.view * 100).toFixed(2) : 0;

    return {
      success: true,
      analytics: {
        stats,
        conversionRate,
        eventCount: events.length,
        period: { startDate, endDate }
      }
    };
  } catch (error) {
    logger.logError('getBundleAnalytics', { shopId, bundleId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Pause/unpause a bundle
 */
export async function pauseBundle(shopId, bundleId, paused = true) {
  try {
    const db = await getDb();
    const result = await db.collection(collections.bundles).updateOne(
      { _id: bundleId, shopId },
      { $set: { status: paused ? 'paused' : 'active' } }
    );

    return { success: result.modifiedCount > 0 };
  } catch (error) {
    logger.logError('pauseBundle', { shopId, bundleId, error: error.message });
    return { success: false, error: error.message };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeBundleDiscount(confidenceScore) {
  // Higher confidence = higher discount (up to 20%)
  const minDiscount = 5;
  const maxDiscount = 20;
  const discount = minDiscount + (confidenceScore * (maxDiscount - minDiscount));
  return Math.round(discount * 100) / 100;
}

function getStatFieldName(eventType) {
  const mapping = {
    view: 'views',
    click: 'clicks',
    cart_add: 'adds',
    purchase: 'purchases'
  };
  return mapping[eventType] || eventType;
}
