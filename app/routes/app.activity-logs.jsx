import { RedirectToDashboard } from "../components/RedirectToDashboard";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    const recentConversions = await db.collection(collections.upsellEvents)
      .find({ shopId: session.shop, isUpsellEvent: true, eventType: "cart_add" })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    return Response.json({
      success: true,
      recentConversions: recentConversions.map((e) => ({ ...e, _id: e._id.toString() })),
    });
  } catch (error) {
    console.error("Error fetching activity logs:", error);
    return Response.json({ success: false, error: error.message, recentConversions: [] });
  }
};


export default function ActivityLogsPage() {
  return <RedirectToDashboard path="/activity-logs" />;
}
