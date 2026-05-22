import { RedirectToDashboard } from "../components/RedirectToDashboard";
import { useActionData, useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Divider,
  InlineStack,
  Layout,
  Page,
  RangeSlider,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getMerchantConfig, saveMerchantConfig } from "../services/merchantConfig.server";
import { GOAL_MAPPING, RISK_MAPPING } from "../shared/merchantConfig.shared";

// ─── Loader ────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await getMerchantConfig(session.shop);
  console.log("[goal-setup loader] shop:", session.shop, "config:", JSON.stringify(config));

  const { getDb, collections } = await import("../../backend/database/mongodb.js");
  const db = await getDb();
  const rawConfig = await db.collection(collections.merchantConfig).findOne({ shopId: session.shop });

  return Response.json({ ...config, offerDisplayMode: rawConfig?.offerDisplayMode || "both" });
};

// ─── Action ────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const received = Object.fromEntries(formData.entries());
  console.log("[goal-setup action] shop:", session.shop, "received:", JSON.stringify(received));

  const debug = formData.get("__debug");
  if (debug === "1") {
    console.log("[goal-setup action][debug]", {
      debugClickId: formData.get("__debugClickId"),
      debugReason: formData.get("__debugReason"),
      debugDetails: formData.get("__debugDetails"),
    });
    return Response.json({ success: true, debug: true });
  }

  const goal = formData.get("goal");
  const riskTolerance = formData.get("riskTolerance");
  const offerDisplayMode = formData.get("offerDisplayMode") || "both";
  const maxDiscountCap = parseInt(formData.get("maxDiscountCap") || "20", 10);
  const inventoryMinThreshold = parseInt(formData.get("inventoryMinThreshold") || "0", 10);
  const sessionOfferLimit = parseInt(formData.get("sessionOfferLimit") || "3", 10);
  const premiumSkuProtection = formData.get("premiumSkuProtection") === "on";
  const subscriptionProtection = formData.get("subscriptionProtection") === "on";
  const excludedProductsInput = formData.get("excludedProducts") || "";
  const excludedCollectionsInput = formData.get("excludedCollections") || "";

  const productTokens = parseDelimitedList(excludedProductsInput);
  const collectionTokens = parseDelimitedList(excludedCollectionsInput);
  const { ids: excludedProductIds, handles: excludedProductHandles } = splitIdsAndHandles(productTokens, {
    idRegex: /Product\/(\d+)/i,
  });
  const { ids: excludedCollectionIds, handles: excludedCollectionHandles } = splitIdsAndHandles(collectionTokens, {
    idRegex: /Collection\/(\d+)/i,
  });

  console.log("[goal-setup action] parsed values:", {
    goal, riskTolerance, maxDiscountCap, inventoryMinThreshold, sessionOfferLimit,
    premiumSkuProtection, subscriptionProtection,
    excludedProductIds, excludedProductHandles, excludedCollectionIds, excludedCollectionHandles,
  });

  try {
    const result = await saveMerchantConfig(session.shop, {
      goal,
      riskTolerance,
      guardrails: {
        maxDiscountCap,
        inventoryMinThreshold,
        sessionOfferLimit,
        premiumSkuProtection,
        subscriptionProtection,
        excludedProductIds,
        excludedProductHandles,
        excludedCollectionIds,
        excludedCollectionHandles,
      },
    });

    console.log("[goal-setup action] saveMerchantConfig result:", JSON.stringify(result));

    if (!result.success) {
      return Response.json({ success: false, errors: result.errors }, { status: 400 });
    }

    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    await db.collection(collections.merchantConfig).updateOne(
      { shopId: session.shop },
      { $set: { offerDisplayMode } },
      { upsert: true }
    );

    await db.collection("upsell_response_cache").deleteMany({ shopId: session.shop });
    console.log(`[goal-setup action] Cache cleared for shop: ${session.shop}`);

    return Response.json({ success: true });
  } catch (err) {
    console.error("[goal-setup action] unexpected error:", err);
    return Response.json(
      { success: false, errors: [String(err?.message || "Unexpected server error.")] },
      { status: 500 }
    );
  }
};

// ─── Static Data ───────────────────────────────────────────────────────────

const GOALS = [
  {
    value: "increase_aov",
    label: "Increase AOV",
    desc: "Maximise average order value through bundles and add-ons.",
  },
  {
    value: "revenue_per_visitor",
    label: "Revenue per Visitor",
    desc: "Convert more visitors into buyers with targeted offers.",
  },
  {
    value: "subscription_adoption",
    label: "Subscription Adoption",
    desc: "Grow recurring revenue by promoting subscription upgrades.",
  },
  {
    value: "inventory_movement",
    label: "Inventory Movement",
    desc: "Clear slow-moving stock with intelligent discounting.",
  },
];

const RISKS = [
  {
    value: "conservative",
    label: "Conservative",
    desc: "Fewer offers, lower discounts, minimal disruption.",
  },
  {
    value: "balanced",
    label: "Balanced",
    desc: "Moderate offer frequency and incentives. Recommended for most stores.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    desc: "High offer frequency and stronger incentives to maximise conversion.",
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function validateForm({ maxDiscountCap, inventoryMinThreshold, sessionOfferLimit }) {
  const errors = [];
  if (isNaN(maxDiscountCap) || maxDiscountCap < 0 || maxDiscountCap > 90)
    errors.push("Max discount cap must be between 0 and 90.");
  if (isNaN(inventoryMinThreshold) || inventoryMinThreshold < 0 || inventoryMinThreshold > 10000)
    errors.push("Inventory minimum must be between 0 and 10,000.");
  if (isNaN(sessionOfferLimit) || sessionOfferLimit < 1 || sessionOfferLimit > 10)
    errors.push("Session offer limit must be between 1 and 10.");
  return errors;
}

function parseDelimitedList(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function splitIdsAndHandles(tokens, { idRegex } = {}) {
  const ids = [];
  const handles = [];
  const gidRegex = idRegex || /(Product|Collection)\/(\d+)/i;
  for (const raw of tokens || []) {
    const token = String(raw).trim();
    if (!token) continue;
    const gidMatch = token.match(gidRegex);
    if (gidMatch?.[2]) { ids.push(gidMatch[2]); continue; }
    if (/^\d+$/.test(token)) { ids.push(token); continue; }
    handles.push(token.toLowerCase());
  }
  return { ids: Array.from(new Set(ids)), handles: Array.from(new Set(handles)) };
}

function buildListText(ids = [], handles = []) {
  const items = [];
  if (Array.isArray(ids)) items.push(...ids.map(String));
  if (Array.isArray(handles)) items.push(...handles.map(String));
  return items.join(", ");
}

// ─── Selection Card (goal / risk) ─────────────────────────────────────────

function SelectionCard({ selected, onClick, label, desc }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={{
        border: selected ? "2px solid #005bd3" : "1px solid #e1e3e5",
        borderRadius: "10px",
        padding: "14px 16px",
        cursor: "pointer",
        backgroundColor: selected ? "#f0f5ff" : "#ffffff",
        transition: "border-color 0.15s, background 0.15s",
        outline: "none",
      }}
    >
      <BlockStack gap="100">
        <InlineStack gap="200" blockAlign="center">
          <div
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "50%",
              flexShrink: 0,
              border: selected ? "5px solid #005bd3" : "2px solid #8c9196",
              transition: "border 0.15s",
            }}
          />
          <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
        </InlineStack>
        <Box paddingInlineStart="600">
          <Text as="p" variant="bodySm" tone="subdued">{desc}</Text>
        </Box>
      </BlockStack>
    </div>
  );
}

// ─── AI Callout ────────────────────────────────────────────────────────────

function AICallout({ children }) {
  return (
    <Box
      background="bg-surface-info"
      borderRadius="200"
      padding="300"
      borderColor="border-info"
      borderWidth="025"
    >
      {children}
    </Box>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────


export default function GoalSetup() {
  return <RedirectToDashboard path="/goals" />;
}
