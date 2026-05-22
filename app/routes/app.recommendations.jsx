import { RedirectToDashboard } from "../components/RedirectToDashboard";
import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Divider,
  InlineStack,
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
    const recommendations = await db.collection(collections.upsellRecommendations)
      .find({ shopId: session.shop })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    const totalRecommendations = await db.collection(collections.upsellRecommendations)
      .countDocuments({ shopId: session.shop });
    const uniqueProducts = await db.collection(collections.upsellRecommendations)
      .distinct("sourceProductId", { shopId: session.shop });
    return Response.json({
      success: true,
      recommendations: recommendations.map((r) => ({ ...r, _id: r._id.toString() })),
      stats: { total: totalRecommendations, uniqueProducts: uniqueProducts.length, recent: recommendations.length },
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return Response.json({ success: false, error: error.message, recommendations: [], stats: { total: 0, uniqueProducts: 0, recent: 0 } });
  }
};


export default function RecommendationsPage() {
  return <RedirectToDashboard path="/recommendations" />;
}
