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

  return Response.json({
    ...config,
    offerDisplayMode: rawConfig?.offerDisplayMode || "both",
    shop: session.shop,
    dashboardUrl: process.env.DASHBOARD_URL || "http://localhost:5173",
  });
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
  const data = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const { shop, dashboardUrl } = data;

  const [selectedGoal, setSelectedGoal] = useState(data.goal);
  const [selectedRisk, setSelectedRisk] = useState(data.riskTolerance);
  const [offerDisplayMode, setOfferDisplayMode] = useState(data.offerDisplayMode || "both");
  const [maxDiscountCap, setMaxDiscountCap] = useState(data.guardrails.maxDiscountCap);
  const [inventoryMin, setInventoryMin] = useState(data.guardrails.inventoryMinThreshold);
  const [sessionLimit, setSessionLimit] = useState(data.guardrails.sessionOfferLimit);
  const [premiumSkuProtection, setPremiumSkuProtection] = useState(data.guardrails.premiumSkuProtection);
  const [subscriptionProtection, setSubscriptionProtection] = useState(data.guardrails.subscriptionProtection);
  const [excludedProducts, setExcludedProducts] = useState(
    buildListText(data.guardrails.excludedProductIds, data.guardrails.excludedProductHandles)
  );
  const [excludedCollections, setExcludedCollections] = useState(
    buildListText(data.guardrails.excludedCollectionIds, data.guardrails.excludedCollectionHandles)
  );
  const [lastSavedAt, setLastSavedAt] = useState(data.savedAt);
  const [isDefault, setIsDefault] = useState(data.isDefault);
  const [clientErrors, setClientErrors] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!fetcher.data) return;
    const result = fetcher.data;
    if (result?.success === false) {
      setToast({ message: (result.errors || ["Save failed."]).join(" | "), error: true });
    } else if (result?.success === true) {
      setLastSavedAt(new Date().toISOString());
      setIsDefault(false);
      setToast({ message: "Settings saved successfully.", error: false });
      setTimeout(() => setToast(null), 4000);
      window.open(`${dashboardUrl}/guardrails`, "_blank");
    }
  }, [fetcher.state, fetcher.data]);

  function handleSave() {
    const errors = validateForm({
      maxDiscountCap: Number(maxDiscountCap),
      inventoryMinThreshold: Number(inventoryMin),
      sessionOfferLimit: Number(sessionLimit),
    });
    if (errors.length > 0) { setClientErrors(errors); return; }
    setClientErrors([]);
    fetcher.submit(
      {
        goal: selectedGoal,
        riskTolerance: selectedRisk,
        maxDiscountCap: String(maxDiscountCap),
        inventoryMinThreshold: String(inventoryMin),
        sessionOfferLimit: String(sessionLimit),
        premiumSkuProtection: premiumSkuProtection ? "on" : "off",
        subscriptionProtection: subscriptionProtection ? "on" : "off",
        excludedProducts: excludedProducts || "",
        excludedCollections: excludedCollections || "",
        offerDisplayMode,
      },
      { method: "POST" }
    );
  }

  const activeGoalConfig = GOAL_MAPPING[selectedGoal];
  const activeRiskConfig = RISK_MAPPING[selectedRisk];

  return (
    <Page title="Goal & Guardrails">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">

            {/* Notices */}
            {isDefault && !saving && (
              <Banner tone="info">
                <Text as="p" variant="bodyMd">Using defaults — save to apply your choices</Text>
              </Banner>
            )}
            {clientErrors.length > 0 && (
              <Banner tone="critical" title="Please fix the following errors:">
                <BlockStack gap="100">
                  {clientErrors.map((e, i) => <Text key={i} as="p" variant="bodyMd">{e}</Text>)}
                </BlockStack>
              </Banner>
            )}
            {actionData?.errors?.length > 0 && (
              <Banner tone="critical" title="Could not save settings:">
                <BlockStack gap="100">
                  {actionData.errors.map((e, i) => <Text key={i} as="p" variant="bodyMd">• {e}</Text>)}
                </BlockStack>
              </Banner>
            )}

            {/* ── Step 1: Business Goal ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 1: Set Business Goal</Text>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 10px", backgroundColor: "#fff3cd", borderRadius: "6px", fontSize: "12px", fontWeight: "600", color: "#856404" }}>Required</div>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose the primary outcome you want the AI to optimise for. This drives all offer generation and placement decisions.
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
                  {GOALS.map((g) => (
                    <SelectionCard
                      key={g.value}
                      selected={selectedGoal === g.value}
                      onClick={() => setSelectedGoal(g.value)}
                      label={g.label}
                      desc={g.desc}
                    />
                  ))}
                </div>
                {activeGoalConfig && (
                  <AICallout>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="info">
                        <strong>How the AI uses this:</strong> {activeGoalConfig.description}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Offer priority: {activeGoalConfig.offerPriority.join(" → ")}
                      </Text>
                    </BlockStack>
                  </AICallout>
                )}
              </BlockStack>
            </Card>

            {/* ── Step 2: Risk Tolerance ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 2: Set Risk Tolerance</Text>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 10px", backgroundColor: "#fff3cd", borderRadius: "6px", fontSize: "12px", fontWeight: "600", color: "#856404" }}>Required</div>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Controls how frequently offers are shown and how aggressive the incentives are.
                </Text>
                <BlockStack gap="300">
                  {RISKS.map((r) => (
                    <SelectionCard
                      key={r.value}
                      selected={selectedRisk === r.value}
                      onClick={() => setSelectedRisk(r.value)}
                      label={r.label}
                      desc={r.desc}
                    />
                  ))}
                </BlockStack>
                {activeRiskConfig && (
                  <AICallout>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="info">
                        <strong>How the AI uses this:</strong> {activeRiskConfig.description}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Placements enabled: {activeRiskConfig.allowedPlacements.join(", ")}
                        {" · "}
                        Max {activeRiskConfig.maxOfferFrequency} offer{activeRiskConfig.maxOfferFrequency > 1 ? "s" : ""} per view
                      </Text>
                    </BlockStack>
                  </AICallout>
                )}
              </BlockStack>
            </Card>

            {/* ── Step 3: Guardrails ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">Step 3: Set Guardrails (Safety Limits)</Text>
                  <div style={{ display: "flex", alignItems: "center", padding: "4px 10px", backgroundColor: "#d1fae5", borderRadius: "6px", fontSize: "12px", fontWeight: "600", color: "#065f46" }}>Recommended</div>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Hard limits the system will never violate, regardless of goal or risk setting.
                </Text>

                <RangeSlider
                  label={
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Maximum Discount Cap:</Text>
                      <div style={{ padding: "2px 8px", backgroundColor: "#d1fae5", borderRadius: "4px", fontSize: "12px", fontWeight: "600", color: "#065f46" }}>{maxDiscountCap}%</div>
                    </InlineStack>
                  }
                  min={0}
                  max={90}
                  value={maxDiscountCap}
                  onChange={(v) => setMaxDiscountCap(v)}
                  helpText="The highest discount % the system is allowed to offer. Max: 90%."
                />

                <RangeSlider
                  label={
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Inventory Minimum:</Text>
                      <div style={{ padding: "2px 8px", backgroundColor: "#d1fae5", borderRadius: "4px", fontSize: "12px", fontWeight: "600", color: "#065f46" }}>{inventoryMin} units</div>
                    </InlineStack>
                  }
                  min={0}
                  max={10000}
                  value={inventoryMin}
                  onChange={(v) => setInventoryMin(v)}
                  helpText="Never offer a product with stock below this level. Max: 10,000 units."
                />

                <RangeSlider
                  label={
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">Session Offer Limit:</Text>
                      <div style={{ padding: "2px 8px", backgroundColor: "#d1fae5", borderRadius: "4px", fontSize: "12px", fontWeight: "600", color: "#065f46" }}>{sessionLimit} offers</div>
                    </InlineStack>
                  }
                  min={1}
                  max={10}
                  value={sessionLimit}
                  onChange={(v) => setSessionLimit(v)}
                  helpText="Maximum number of offers shown to a customer in a single session. Range: 1–10."
                />

                <Divider />

                <Checkbox
                  label="Premium SKU Protection"
                  helpText="Prevent the system from discounting high-value items."
                  checked={premiumSkuProtection}
                  onChange={(v) => setPremiumSkuProtection(v)}
                />
                <Checkbox
                  label="Subscription Product Protection"
                  helpText="Never apply conflicting offers to subscription products."
                  checked={subscriptionProtection}
                  onChange={(v) => setSubscriptionProtection(v)}
                />

                <Divider />

                <TextField
                  label="Excluded Products"
                  helpText="Comma-separated product IDs or handles to never include in offers. Example: 123456789, my-product-handle"
                  value={excludedProducts}
                  onChange={setExcludedProducts}
                  multiline={3}
                  placeholder="e.g. 123456789, gift-card"
                  autoComplete="off"
                />

                <TextField
                  label="Excluded Collections"
                  helpText="Comma-separated collection IDs or handles to never include in offers. Example: 987654321, summer-sale"
                  value={excludedCollections}
                  onChange={setExcludedCollections}
                  multiline={3}
                  placeholder="e.g. 987654321, clearance"
                  autoComplete="off"
                />
              </BlockStack>
            </Card>

            {/* ── Offer Display Mode (AOV & Inventory only) ── */}
            {(selectedGoal === "increase_aov" || selectedGoal === "inventory_movement") && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Offer Display Mode</Text>
                  <Divider />
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Choose which type of offer to show customers on the product page.
                  </Text>
                  <ChoiceList
                    title=""
                    choices={[
                      { label: "Bundle & Save", value: "bundle", helpText: "Show only bundle offers" },
                      { label: "Buy More, Save More", value: "volume_discount", helpText: "Show only volume discount offers" },
                    ]}
                    selected={[offerDisplayMode]}
                    onChange={(vals) => setOfferDisplayMode(vals[0])}
                  />
                </BlockStack>
              </Card>
            )}

            {/* ── Save bar ── */}
            <Card>
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="400" blockAlign="center">
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    loading={saving}
                  >
                    Save Settings
                  </Button>
                  {lastSavedAt && !saving && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      Last saved: {new Date(lastSavedAt).toLocaleString()}
                    </Text>
                  )}
                </InlineStack>
                {isDefault && !saving && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Using defaults — save to apply your choices
                  </Text>
                )}
              </InlineStack>
            </Card>

          </BlockStack>
        </Layout.Section>
      </Layout>

      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </Page>
  );
}
