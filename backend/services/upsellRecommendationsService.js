import { getDb, collections } from '../database/mongodb.js';
import { logger } from './logger.js';

/**
 * Store upsell recommendations in MongoDB
 * This separates the recommendation data from event tracking
 */
export async function storeUpsellRecommendations({
  shopId,
  sourceProductId,
  sourceProductName = null,
  recommendations,
  recommendationContext = 'product_detail', // 'product_detail' | 'cart'
  cartProductIds = [],
  metadata = {}
}) {
  try {
    console.log('📦 storeUpsellRecommendations called with:');
    console.log('   shopId:', shopId);
    console.log('   sourceProductId:', sourceProductId);
    console.log('   recommendationContext:', recommendationContext);
    console.log('   recommendations count:', recommendations?.length);
    console.log('   cartProductIds:', cartProductIds);
    
    const db = await getDb();
    
    // Ensure cartProductIds is always an array
    const safeCartProductIds = Array.isArray(cartProductIds) ? cartProductIds : [];
    
    // Ensure recommendations is always an array
    const safeRecommendations = Array.isArray(recommendations) ? recommendations : [];
    
    // Create a recommendations document
    const recommendationDoc = {
      shopId,
      sourceProductId: sourceProductId?.toString(),
      sourceProductName,
      recommendationContext, // 'product_detail' or 'cart'
      cartProductIds: safeCartProductIds.map(id => id.toString()), // Only for cart context
      recommendations: safeRecommendations.map(rec => ({
        productId: rec.id?.toString(),
        productName: rec.title,
        handle: rec.handle,
        price: rec.price,
        image: rec.image,
        recommendationType: rec.type,
        confidence: rec.confidence,
        reason: rec.reason,
        availableForSale: rec.availableForSale,
        variantId: rec.variantId?.toString(),
        url: rec.url
      })),
      metadata: {
        ...metadata,
        generatedAt: new Date(),
        totalRecommendations: safeRecommendations.length
      },
      timestamp: new Date()
    };
    
    console.log('📝 Created recommendation doc with', recommendationDoc.recommendations.length, 'recommendations');

    const result = await db.collection(collections.upsellRecommendations).insertOne(recommendationDoc);
    console.log('✅ Successfully stored recommendations with ID:', result.insertedId);

    logger.logDatabase('insert', 'upsellRecommendations', {
      shopId,
      sourceProductId,
      recommendationContext,
      recommendationCount: safeRecommendations.length,
      recommendationId: result.insertedId
    });

    return { success: true, recommendationId: result.insertedId };
  } catch (error) {
    console.error('Error storing upsell recommendations:', error);
    logger.logDatabase('insert', 'upsellRecommendations', { 
      error: error.message, 
      shopId,
      sourceProductId 
    });
    return { success: false, error: error.message };
  }
}

/**
 * Get upsell recommendations by source product and context
 */
export async function getUpsellRecommendations(shopId, sourceProductId, options = {}) {
  try {
    const db = await getDb();
    const {
      recommendationContext = null,
      limit = 10,
      startDate = null,
      endDate = null
    } = options;

    const query = {
      shopId,
      sourceProductId: sourceProductId?.toString()
    };

    if (recommendationContext) {
      query.recommendationContext = recommendationContext;
    }

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const recommendations = await db.collection(collections.upsellRecommendations)
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return { success: true, recommendations, count: recommendations.length };
  } catch (error) {
    console.error('Error getting upsell recommendations:', error);
    return { success: false, error: error.message, recommendations: [], count: 0 };
  }
}

/**
 * Get recommendation analytics (what products were recommended most often)
 */
export async function getRecommendationAnalytics(shopId, options = {}) {
  try {
    const db = await getDb();
    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default: last 30 days
      endDate = new Date(),
      recommendationContext = null
    } = options;

    const matchStage = {
      shopId,
      timestamp: { $gte: startDate, $lte: endDate }
    };

    if (recommendationContext) {
      matchStage.recommendationContext = recommendationContext;
    }

    // Most frequently recommended products
    const topRecommendedProducts = await db.collection(collections.upsellRecommendations).aggregate([
      { $match: matchStage },
      { $unwind: '$recommendations' },
      {
        $group: {
          _id: '$recommendations.productId',
          productName: { $first: '$recommendations.productName' },
          recommendationCount: { $sum: 1 },
          avgConfidence: { $avg: '$recommendations.confidence' },
          recommendationTypes: { $addToSet: '$recommendations.recommendationType' }
        }
      },
      { $sort: { recommendationCount: -1 } },
      { $limit: 20 }
    ]).toArray();

    // Recommendations by context
    const recommendationsByContext = await db.collection(collections.upsellRecommendations).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$recommendationContext',
          totalRecommendations: { $sum: { $size: '$recommendations' } },
          recommendationSessions: { $sum: 1 },
          avgRecommendationsPerSession: { $avg: { $size: '$recommendations' } }
        }
      }
    ]).toArray();

    // Daily recommendation trends
    const dailyTrends = await db.collection(collections.upsellRecommendations).aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            context: '$recommendationContext'
          },
          recommendationSessions: { $sum: 1 },
          totalRecommendations: { $sum: { $size: '$recommendations' } }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]).toArray();

    return {
      success: true,
      analytics: {
        topRecommendedProducts,
        recommendationsByContext,
        dailyTrends,
        period: {
          startDate,
          endDate
        }
      }
    };
  } catch (error) {
    console.error('Error getting recommendation analytics:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Clean up old recommendations (optional maintenance function)
 */
export async function cleanupOldRecommendations(shopId, daysToKeep = 90) {
  try {
    const db = await getDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await db.collection(collections.upsellRecommendations).deleteMany({
      shopId,
      timestamp: { $lt: cutoffDate }
    });

    console.log(`Cleaned up ${result.deletedCount} old recommendation documents for shop ${shopId}`);
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error('Error cleaning up old recommendations:', error);
    return { success: false, error: error.message };
  }
}