import { RedirectToDashboard } from "../components/RedirectToDashboard";
import { useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  Grid,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

function fmtTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const events = await db.collection(collections.upsellEvents)
      .find({ shopId: session.shop, isUpsellEvent: true })
      .sort({ timestamp: -1 }).limit(100).toArray();

    const totalEvents = await db.collection(collections.upsellEvents)
      .countDocuments({ shopId: session.shop, isUpsellEvent: true });

    const eventTypeStats = await db.collection(collections.upsellEvents)
      .aggregate([
        { $match: { shopId: session.shop, isUpsellEvent: true } },
        { $group: { _id: "$eventType", count: { $sum: 1 } } },
      ]).toArray();

    const topUpsellProducts = await db.collection(collections.upsellEvents)
      .aggregate([
        { $match: { shopId: session.shop, isUpsellEvent: true, eventType: "cart_add" } },
        { $group: { _id: "$upsellProductId", productName: { $first: "$upsellProductName" }, count: { $sum: 1 }, totalQuantity: { $sum: "$quantity" } } },
        { $sort: { count: -1 } }, { $limit: 5 },
      ]).toArray();

    const views = eventTypeStats.find((e) => e._id === "view")?.count || 0;
    const clicks = eventTypeStats.find((e) => e._id === "click")?.count || 0;
    const cartAdds = eventTypeStats.find((e) => e._id === "cart_add")?.count || 0;

    const topTimeProducts = await db.collection(collections.productTimeEvents)
      .aggregate([
        { $match: { shop: session.shop, recordedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: "$productId", productTitle: { $first: "$productTitle" }, avgTimeSeconds: { $avg: "$timeSpentSeconds" }, totalSessions: { $sum: 1 }, totalTimeSeconds: { $sum: "$timeSpentSeconds" } } },
        { $sort: { avgTimeSeconds: -1 } }, { $limit: 10 },
      ]).toArray();

    const cartTimeStatsArr = await db.collection(collections.cartTimeEvents)
      .aggregate([
        { $match: { shop: session.shop, recordedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, avgTimeSeconds: { $avg: "$timeSpentSeconds" }, totalTimeSeconds: { $sum: "$timeSpentSeconds" }, totalSessions: { $sum: 1 }, avgItemCount: { $avg: "$cartItemCount" }, avgCartTotalPrice: { $avg: "$cartTotalPrice" } } },
      ]).toArray();

    const cartTimeStats = cartTimeStatsArr[0] || { avgTimeSeconds: 0, totalTimeSeconds: 0, totalSessions: 0, avgItemCount: 0, avgCartTotalPrice: 0 };

    const recentCartTime = await db.collection(collections.cartTimeEvents)
      .aggregate([
        { $match: { shop: session.shop } },
        { $group: { _id: "$userId", sessions: { $sum: 1 }, totalTimeSeconds: { $sum: "$timeSpentSeconds" }, avgTimeSeconds: { $avg: "$timeSpentSeconds" }, avgCartTotalPrice: { $avg: "$cartTotalPrice" }, avgCartItemCount: { $avg: "$cartItemCount" }, customerName: { $first: "$customerName" }, lastVisit: { $max: "$recordedAt" } } },
        { $sort: { lastVisit: -1 } }, { $limit: 20 },
      ]).toArray();

    return Response.json({
      success: true,
      events: events.map((e) => ({ ...e, _id: e._id.toString() })),
      stats: { total: totalEvents, recent: events.length, views, clicks, cartAdds, clickThroughRate: views > 0 ? ((clicks / views) * 100).toFixed(1) : 0, addToCartRate: clicks > 0 ? ((cartAdds / clicks) * 100).toFixed(1) : 0, overallConversionRate: views > 0 ? ((cartAdds / views) * 100).toFixed(1) : 0 },
      topProducts: topUpsellProducts, eventTypeStats, topTimeProducts, cartTimeStats,
      recentCartTime: recentCartTime.map((r) => ({ ...r, _id: r._id.toString() })),
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return Response.json({
      success: false, error: error.message, events: [],
      stats: { total: 0, recent: 0, views: 0, clicks: 0, cartAdds: 0 },
      topProducts: [], eventTypeStats: [], topTimeProducts: [],
      cartTimeStats: { avgTimeSeconds: 0, totalTimeSeconds: 0, totalSessions: 0, avgItemCount: 0, avgCartTotalPrice: 0 },
      recentCartTime: [],
    });
  }
};

function StatCard({ label, value }) {
  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="400" borderColor="border" borderWidth="025">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingLg" fontWeight="bold">{value}</Text>
      </BlockStack>
    </Box>
  );
}

function EmptyBox({ message, sub }) {
  return (
    <Box padding="800" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodyMd" tone="subdued" alignment="center">{message}</Text>
        {sub && <Text as="p" variant="bodySm" tone="subdued" alignment="center">{sub}</Text>}
      </BlockStack>
    </Box>
  );
}


export default function AnalyticsPage() {
  return <RedirectToDashboard path="/analytics" />;
}
