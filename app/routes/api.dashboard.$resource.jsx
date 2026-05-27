const CORS = {
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export const loader = async ({ request, params }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const resource = params.resource;

  if (!shop) return json({ error: 'Missing shop parameter' }, 400);

  try {
    const { getDb, collections } = await import('../../backend/database/mongodb.js');
    const db = await getDb();

    switch (resource) {
      case 'analytics': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [eventTypeStats, recentEvents, topProducts] = await Promise.all([
          db.collection(collections.upsellEvents).aggregate([
            { $match: { shopId: shop, isUpsellEvent: true } },
            { $group: { _id: '$eventType', count: { $sum: 1 } } },
          ]).toArray(),
          db.collection(collections.upsellEvents)
            .find({ shopId: shop, isUpsellEvent: true })
            .sort({ timestamp: -1 }).limit(20).toArray(),
          db.collection(collections.upsellEvents).aggregate([
            { $match: { shopId: shop, isUpsellEvent: true, eventType: 'cart_add' } },
            { $group: { _id: '$upsellProductId', name: { $first: '$upsellProductName' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } }, { $limit: 5 },
          ]).toArray(),
        ]);
        const views = eventTypeStats.find(e => e._id === 'view')?.count || 0;
        const clicks = eventTypeStats.find(e => e._id === 'click')?.count || 0;
        const cartAdds = eventTypeStats.find(e => e._id === 'cart_add')?.count || 0;
        return json({
          stats: { views, clicks, cartAdds, ctr: views ? ((clicks / views) * 100).toFixed(1) : '0.0' },
          recentEvents: recentEvents.map(e => ({ ...e, _id: e._id.toString() })),
          topProducts,
        });
      }

      case 'goals': {
        const { GOAL_MAPPING, RISK_MAPPING } = await import('../shared/merchantConfig.shared.js');
        const config = await db.collection(collections.merchantConfig).findOne({ shopId: shop });
        return json({
          current: { goal: config?.goal || 'revenue_per_visitor', riskTolerance: config?.riskTolerance || 'balanced' },
          goals: Object.entries(GOAL_MAPPING).map(([id, v]) => ({ id, ...v })),
          risks: Object.entries(RISK_MAPPING).map(([id, v]) => ({ id, ...v })),
        });
      }

      case 'activity-logs': {
        const events = await db.collection(collections.upsellEvents)
          .find({ shopId: shop, isUpsellEvent: true, eventType: 'cart_add' })
          .sort({ timestamp: -1 }).limit(100).toArray();
        return json({ events: events.map(e => ({ ...e, _id: e._id.toString() })) });
      }

      case 'recommendations': {
        const [recs, total, unique] = await Promise.all([
          db.collection(collections.upsellRecommendations)
            .find({ shopId: shop }).sort({ timestamp: -1 }).limit(50).toArray(),
          db.collection(collections.upsellRecommendations).countDocuments({ shopId: shop }),
          db.collection(collections.upsellRecommendations).distinct('sourceProductId', { shopId: shop }),
        ]);
        return json({
          recommendations: recs.map(r => ({ ...r, _id: r._id.toString() })),
          stats: { total, uniqueProducts: unique.length },
        });
      }

      case 'bundles': {
        const bundles = await db.collection(collections.bundles)
          .find({ shopId: shop }).sort({ createdAt: -1 }).limit(50).toArray();
        return json({ bundles: bundles.map(b => ({ ...b, _id: b._id.toString() })) });
      }

      case 'guardrails': {
        const config = await db.collection(collections.merchantConfig).findOne({ shopId: shop });
        return json({
          guardrails: config?.guardrails || {
            maxDiscountCap: 25,
            inventoryMinThreshold: 5,
            sessionOfferLimit: 4,
            subscriptionProtection: false,
          },
        });
      }

      case 'optimization': {
        const [history, schedulerState] = await Promise.all([
          db.collection(collections.optimizationHistory || 'optimization_history')
            .find({ shopId: shop }).sort({ timestamp: -1 }).limit(10).toArray(),
          db.collection(collections.schedulerState || 'scheduler_state')
            .findOne({ shopId: shop }),
        ]);
        return json({
          history: history.map(h => ({ ...h, _id: h._id.toString() })),
          scheduler: schedulerState ? { ...schedulerState, _id: schedulerState._id.toString() } : null,
        });
      }

      case 'settings': {
        const config = await db.collection(collections.merchantConfig).findOne({ shopId: shop });
        const [products, bundles, events7d] = await Promise.all([
          db.collection(collections.products).countDocuments({ shopId: shop }),
          db.collection(collections.bundles).countDocuments({ shopId: shop }),
          db.collection(collections.upsellEvents).countDocuments({
            shopId: shop,
            timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          }),
        ]);
        return json({
          config: config ? { ...config, _id: config._id.toString() } : null,
          health: { products, bundles, events7d },
        });
      }

      default:
        return json({ error: `Unknown resource: ${resource}` }, 404);
    }
  } catch (err) {
    console.error(`[dashboard API] ${resource}:`, err);
    return json({ error: err.message }, 500);
  }
};

export const action = async ({ request }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  return json({ error: 'Method not allowed' }, 405);
};
