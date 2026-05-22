import { RedirectToDashboard } from "../components/RedirectToDashboard";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Divider,
  Grid,
  InlineStack,
  Layout,
  Page,
  Text,
  Toast,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ExternalIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ErrorBoundary } from "../components/ErrorBoundary";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const { getDb, collections } = await import(
      "../../backend/database/mongodb.js"
    );
    const db = await getDb();

    // Get merchant config
    const config = await db
      .collection(collections.merchantConfig)
      .findOne({ shopId: session.shop });

    // Check system health
    const [productCount, bundleCount, eventCount, safetyMode] =
      await Promise.all([
        db
          .collection(collections.products)
          .countDocuments({ shopId: session.shop }),
        db
          .collection(collections.bundles)
          .countDocuments({ shopId: session.shop }),
        db
          .collection(collections.upsellEvents)
          .countDocuments({
            shopId: session.shop,
            timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          }),
        db
          .collection("safety_mode")
          .findOne({ shopId: session.shop }),
      ]);

    return json({
      shopId: session.shop,
      config,
      systemHealth: {
        productCount,
        bundleCount,
        eventCount,
        safetyModeActive: safetyMode?.active || false,
      },
    });
  } catch (error) {
    console.error("Settings loader error:", error);
    return json({
      shopId: session.shop,
      config: null,
      systemHealth: {
        productCount: 0,
        bundleCount: 0,
        eventCount: 0,
        safetyModeActive: false,
      },
    });
  }
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const { actionType } = await request.json();

  try {
    if (actionType === "run_optimization") {
      const { learningLoopEngine } = await import(
        "../../backend/services/learningLoopEngine.js"
      );
      const result = await learningLoopEngine.runFullLearningLoop(session.shop);
      return json({
        success: result.success,
        message: "Optimization complete",
      });
    }

    return json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Settings action error:", error);
    return json({ success: false, error: error.message }, { status: 500 });
  }
};


export default function SettingsPage() {
  return <RedirectToDashboard path="/settings" />;
}
