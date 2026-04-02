import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { getMerchantConfig, saveMerchantConfig } from "../services/merchantConfig.server";
import { GOAL_MAPPING, RISK_MAPPING } from "../shared/merchantConfig.shared";

// ─── Loader ────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await getMerchantConfig(session.shop);
  console.log("[goal-setup loader] shop:", session.shop, "config:", JSON.stringify(config));

  // Load offerDisplayMode separately
  const { getDb, collections } = await import("../../backend/database/mongodb.js");
  const db = await getDb();
  const rawConfig = await db.collection(collections.merchantConfig).findOne({ shopId: session.shop });

  return json({ ...config, offerDisplayMode: rawConfig?.offerDisplayMode || 'both' });
};

// ─── Action ────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Log everything received so the server terminal shows what's coming in
  const received = Object.fromEntries(formData.entries());
  console.log("[goal-setup action] shop:", session.shop, "received:", JSON.stringify(received));

  const debug = formData.get("__debug");
  if (debug === "1") {
    const debugClickId = formData.get("__debugClickId");
    const debugReason = formData.get("__debugReason");
    const debugDetails = formData.get("__debugDetails");
    console.log("[goal-setup action][debug]", {
      debugClickId,
      debugReason,
      debugDetails,
    });
    return json({ success: true, debug: true });
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
    idRegex: /Product\/(\d+)/i
  });
  const { ids: excludedCollectionIds, handles: excludedCollectionHandles } = splitIdsAndHandles(collectionTokens, {
    idRegex: /Collection\/(\d+)/i
  });

  console.log("[goal-setup action] parsed values:", {
    goal, riskTolerance, maxDiscountCap, inventoryMinThreshold, sessionOfferLimit,
    premiumSkuProtection, subscriptionProtection,
    excludedProductIds, excludedProductHandles, excludedCollectionIds, excludedCollectionHandles
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
      return json({ success: false, errors: result.errors }, { status: 400 });
    }

    // Save offerDisplayMode and invalidate response cache so changes show immediately
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();
    await db.collection(collections.merchantConfig).updateOne(
      { shopId: session.shop },
      { $set: { offerDisplayMode } },
      { upsert: true }
    );

    // Clear cached upsell responses so the new goal/display settings take effect instantly
    await db.collection('upsell_response_cache').deleteMany({ shopId: session.shop });
    console.log(`[goal-setup action] Cache cleared for shop: ${session.shop}`);

    return json({ success: true });
  } catch (err) {
    console.error("[goal-setup action] unexpected error:", err);
    return json({ success: false, errors: [String(err?.message || "Unexpected server error.")] }, { status: 500 });
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

// ─── Client-side validation ────────────────────────────────────────────────

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
    .map((token) => token.trim())
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
    if (gidMatch?.[2]) {
      ids.push(gidMatch[2]);
      continue;
    }
    if (/^\d+$/.test(token)) {
      ids.push(token);
      continue;
    }
    handles.push(token.toLowerCase());
  }

  return {
    ids: Array.from(new Set(ids)),
    handles: Array.from(new Set(handles)),
  };
}

function buildListText(ids = [], handles = []) {
  const items = [];
  if (Array.isArray(ids)) items.push(...ids.map(String));
  if (Array.isArray(handles)) items.push(...handles.map(String));
  return items.join(", ");
}

// ─── Shared styles ─────────────────────────────────────────────────────────

const font =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const numInputStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  padding: "7px 10px",
  fontSize: "14px",
  fontFamily: font,
  color: "#303030",
  width: "110px",
};

const unitStyle = { fontSize: "14px", color: "#6d7175", fontFamily: font };
const textAreaStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  padding: "8px 10px",
  fontSize: "13px",
  fontFamily: font,
  color: "#303030",
  width: "100%",
  minHeight: "70px",
  resize: "vertical",
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function GoalSetup() {
  const data = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const [selectedGoal, setSelectedGoal] = useState(data.goal);
  const [selectedRisk, setSelectedRisk] = useState(data.riskTolerance);
  const [offerDisplayMode, setOfferDisplayMode] = useState(data.offerDisplayMode || 'both');
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

  // Track last saved time locally since useFetcher does not revalidate the loader
  const [lastSavedAt, setLastSavedAt] = useState(data.savedAt);
  const [isDefault, setIsDefault] = useState(data.isDefault);

  const [clientErrors, setClientErrors] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);


  // Watch fetcher result and show toast
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!fetcher.data) return;
    const result = fetcher.data;
    if (result?.success === false) {
      setToast({ message: (result.errors || ["Save failed."]).join(" | "), type: "error" });
    } else if (result?.success === true) {
      const now = new Date().toISOString();
      setLastSavedAt(now);
      setIsDefault(false);
      setToast({ message: "Settings saved successfully.", type: "success" });
      setTimeout(() => setToast(null), 4000);
    }
  }, [fetcher.state, fetcher.data]);

  function handleSave() {
    const errors = validateForm({
      maxDiscountCap: Number(maxDiscountCap),
      inventoryMinThreshold: Number(inventoryMin),
      sessionOfferLimit: Number(sessionLimit),
    });

    if (errors.length > 0) {
      setClientErrors(errors);
      return;
    }
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
    <>
    <s-page heading="Goal & Guardrails">
      <style>{`
        * { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; }
        input[type="radio"] { accent-color: #005bd3; }
        input[type="checkbox"] { accent-color: #005bd3; width: 16px; height: 16px; cursor: pointer; }
        input[type="number"]:focus { border-color: #005bd3 !important; box-shadow: 0 0 0 2px #d9e8ff; outline: none; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: "fixed",
          top: "20px",
          right: "24px",
          zIndex: 9999,
          padding: "12px 18px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: "500",
          fontFamily: font,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          backgroundColor: toast.type === "success" ? "#166534" : "#b91c1c",
          color: "#ffffff",
          animation: "fadeIn 0.2s ease",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          maxWidth: "360px",
        }}>
          <span style={{ fontSize: "16px" }}>{toast.type === "success" ? "✓" : "✕"}</span>
          <span>{toast.message}</span>
          <span
            style={{ marginLeft: "auto", cursor: "pointer", opacity: 0.7, fontSize: "16px" }}
            onClick={() => setToast(null)}
          >×</span>
        </div>
      )}

      {/* ── Client errors (persistent) ── */}
      {clientErrors.length > 0 && (
        <div style={{
          margin: "0 0 16px",
          padding: "12px 16px",
          borderRadius: "8px",
          backgroundColor: "#fff5f5",
          border: "1px solid #fecaca",
          fontSize: "13px",
          color: "#b91c1c",
          fontFamily: font,
        }}>
          {clientErrors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* ── Server errors (persistent, shows ALL errors) ── */}
      {actionData?.errors?.length > 0 && (
        <div style={{
          margin: "0 0 16px",
          padding: "12px 16px",
          borderRadius: "8px",
          backgroundColor: "#fff5f5",
          border: "1px solid #fecaca",
          fontSize: "13px",
          color: "#b91c1c",
          fontFamily: font,
        }}>
          <strong style={{ display: "block", marginBottom: "4px" }}>Could not save settings:</strong>
          {actionData.errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}

      {/* ── Section 1: Business Goal ── */}
      <s-section heading="Business Goal">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px", fontFamily: font }}>
          Choose the primary outcome you want the AI to optimise for. This drives all offer generation and placement decisions.
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "12px",
          marginBottom: "12px",
        }}>
          {GOALS.map((g) => {
            const selected = selectedGoal === g.value;
            return (
              <label
                key={g.value}
                onClick={() => setSelectedGoal(g.value)}
                style={{
                  display: "block",
                  border: selected ? "2px solid #005bd3" : "1px solid #e1e3e5",
                  borderRadius: "10px",
                  padding: "14px 16px",
                  cursor: "pointer",
                  backgroundColor: selected ? "#f0f5ff" : "#ffffff",
                  fontFamily: font,
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <div style={{
                    width: "16px", height: "16px", borderRadius: "50%",
                    border: selected ? "5px solid #005bd3" : "2px solid #8c9196",
                    flexShrink: 0,
                    transition: "border 0.15s",
                  }} />
                  <div style={{ fontSize: "14px", fontWeight: "600", color: "#303030", fontFamily: font }}>
                    {g.label}
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: "#6d7175", lineHeight: "1.5", fontFamily: font, paddingLeft: "24px" }}>
                  {g.desc}
                </div>
              </label>
            );
          })}
        </div>

        {activeGoalConfig && (
          <div style={{
            padding: "10px 14px",
            backgroundColor: "#f7f9ff",
            borderRadius: "8px",
            border: "1px solid #d9e8ff",
            fontSize: "12px",
            color: "#1d4ed8",
            fontFamily: font,
            lineHeight: "1.6",
          }}>
            <strong>How the AI uses this:</strong> {activeGoalConfig.description}
            <br />
            <span style={{ color: "#6d7175" }}>
              Offer priority: {activeGoalConfig.offerPriority.join(" → ")}
            </span>
          </div>
        )}
      </s-section>

      {/* ── Section 2: Risk Tolerance ── */}
      <s-section heading="Risk Tolerance">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "16px", fontFamily: font }}>
          Controls how frequently offers are shown and how aggressive the incentives are.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "12px" }}>
          {RISKS.map((r) => {
            const selected = selectedRisk === r.value;
            return (
              <label
                key={r.value}
                onClick={() => setSelectedRisk(r.value)}
                style={{
                  display: "block",
                  border: selected ? "2px solid #005bd3" : "1px solid #e1e3e5",
                  borderRadius: "10px",
                  padding: "14px 16px",
                  cursor: "pointer",
                  backgroundColor: selected ? "#f0f5ff" : "#ffffff",
                  fontFamily: font,
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    width: "16px", height: "16px", borderRadius: "50%",
                    border: selected ? "5px solid #005bd3" : "2px solid #8c9196",
                    flexShrink: 0,
                    transition: "border 0.15s",
                  }} />
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: "#303030", fontFamily: font }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px", fontFamily: font }}>
                      {r.desc}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {activeRiskConfig && (
          <div style={{
            padding: "10px 14px",
            backgroundColor: "#f7f9ff",
            borderRadius: "8px",
            border: "1px solid #d9e8ff",
            fontSize: "12px",
            color: "#1d4ed8",
            fontFamily: font,
            lineHeight: "1.6",
          }}>
            <strong>How the AI uses this:</strong> {activeRiskConfig.description}
            <br />
            <span style={{ color: "#6d7175" }}>
              Placements enabled: {activeRiskConfig.allowedPlacements.join(", ")}
              {" · "}
              Max {activeRiskConfig.maxOfferFrequency} offer{activeRiskConfig.maxOfferFrequency > 1 ? "s" : ""} per view
            </span>
          </div>
        )}
      </s-section>

      {/* ── Section 3: Guardrails ── */}
      <s-section heading="Guardrails">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "20px", fontFamily: font }}>
          Hard limits the system will never violate, regardless of goal or risk setting.
        </div>

        <GuardrailField label="Maximum Discount Cap" hint="The highest discount % the system is allowed to offer. Max: 90%.">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="number"
              min="0"
              max="90"
              value={maxDiscountCap}
              onChange={(e) => setMaxDiscountCap(Number(e.target.value))}
              style={numInputStyle}
            />
            <span style={unitStyle}>%</span>
          </div>
        </GuardrailField>

        <GuardrailField label="Inventory Minimum Threshold" hint="Never offer a product with stock below this level. Max: 10,000 units.">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="number"
              min="0"
              max="10000"
              value={inventoryMin}
              onChange={(e) => setInventoryMin(Number(e.target.value))}
              style={numInputStyle}
            />
            <span style={unitStyle}>units</span>
          </div>
        </GuardrailField>

        <GuardrailField label="Session Offer Limit" hint="Maximum number of offers shown to a customer in a single session. Range: 1–10.">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="number"
              min="1"
              max="10"
              value={sessionLimit}
              onChange={(e) => setSessionLimit(Number(e.target.value))}
              style={numInputStyle}
            />
            <span style={unitStyle}>offers</span>
          </div>
        </GuardrailField>

        <div style={{ marginTop: "8px" }}>
          <ToggleRow
            label="Premium SKU Protection"
            hint="Prevent the system from discounting high-value items."
            checked={premiumSkuProtection}
            onChange={(v) => setPremiumSkuProtection(v)}
          />
          <ToggleRow
            label="Subscription Product Protection"
            hint="Never apply conflicting offers to subscription products."
            checked={subscriptionProtection}
            onChange={(v) => setSubscriptionProtection(v)}
            last
          />
        </div>

        <GuardrailField
          label="Excluded Products"
          hint="Comma-separated product IDs or handles to never include in offers. Example: 123456789, my-product-handle"
        >
          <textarea
            value={excludedProducts}
            onChange={(e) => setExcludedProducts(e.target.value)}
            style={textAreaStyle}
            placeholder="e.g. 123456789, gift-card"
          />
        </GuardrailField>

        <GuardrailField
          label="Excluded Collections"
          hint="Comma-separated collection IDs or handles to never include in offers. Example: 987654321, summer-sale"
        >
          <textarea
            value={excludedCollections}
            onChange={(e) => setExcludedCollections(e.target.value)}
            style={textAreaStyle}
            placeholder="e.g. 987654321, clearance"
          />
        </GuardrailField>
      </s-section>

      {/* ── Offer Display Mode — only for AOV & Inventory goals ── */}
      {(selectedGoal === 'increase_aov' || selectedGoal === 'inventory_movement') && <s-section heading="Offer Display Mode">
        <p style={{ fontSize: "14px", color: "#6d7175", marginBottom: "16px", fontFamily: font }}>
          Choose which type of offer to show customers on the product page.
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {[
            { value: "bundle", label: "Bundle & Save", desc: "Show only bundle offers" },
            { value: "volume_discount", label: "Buy More, Save More", desc: "Show only volume discount offers" },
          ].map((opt) => (
            <label
              key={opt.value}
              onClick={() => setOfferDisplayMode(opt.value)}
              style={{
                display: "flex", alignItems: "flex-start", gap: "10px",
                padding: "12px 16px", border: `2px solid ${offerDisplayMode === opt.value ? "#005bd3" : "#c9cccf"}`,
                borderRadius: "8px", cursor: "pointer",
                backgroundColor: offerDisplayMode === opt.value ? "#e8f0fe" : "#fff",
                flex: "1", minWidth: "160px",
              }}
            >
              <input
                type="radio"
                name="offerDisplayMode"
                value={opt.value}
                checked={offerDisplayMode === opt.value}
                onChange={() => setOfferDisplayMode(opt.value)}
                style={{ marginTop: "2px" }}
              />
              <div>
                <div style={{ fontWeight: "600", fontSize: "14px", fontFamily: font }}>{opt.label}</div>
                <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px", fontFamily: font }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </s-section>}

    </s-page>

    {/* ── Save bar — outside <s-page> so React onClick works (shadow DOM doesn't block it) ── */}
    <div style={{
      padding: "16px 24px",
      borderTop: "1px solid #e1e3e5",
      backgroundColor: "#ffffff",
      display: "flex",
      alignItems: "center",
      gap: "16px",
      flexWrap: "wrap",
    }}>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          backgroundColor: saving ? "#8c9196" : "#111111",
          color: "#ffffff",
          border: "none",
          borderRadius: "6px",
          padding: "10px 22px",
          fontSize: "14px",
          fontWeight: "600",
          cursor: saving ? "default" : "pointer",
          fontFamily: font,
          transition: "background 0.15s",
        }}
      >
        {saving ? "Saving…" : "Save Settings"}
      </button>

      {lastSavedAt && !saving && (
        <span style={{ fontSize: "12px", color: "#8c9196", fontFamily: font }}>
          Last saved: {new Date(lastSavedAt).toLocaleString()}
        </span>
      )}

      {isDefault && !saving && (
        <span style={{
          fontSize: "12px",
          color: "#6d7175",
          fontFamily: font,
          padding: "4px 8px",
          backgroundColor: "#f7f7f8",
          borderRadius: "4px",
          border: "1px solid #e1e3e5",
        }}>
          Using defaults — save to apply your choices
        </span>
      )}
    </div>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function GuardrailField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ fontSize: "13px", fontWeight: "600", color: "#303030", marginBottom: "3px", fontFamily: font }}>
        {label}
      </div>
      <div style={{ fontSize: "12px", color: "#6d7175", marginBottom: "8px", fontFamily: font }}>
        {hint}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, last }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 0",
      borderBottom: last ? "none" : "1px solid #f1f2f3",
      fontFamily: font,
    }}>
      <div>
        <div style={{ fontSize: "14px", fontWeight: "500", color: "#303030", fontFamily: font }}>{label}</div>
        <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "2px", fontFamily: font }}>{hint}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "#005bd3", width: "16px", height: "16px", cursor: "pointer" }}
      />
    </div>
  );
}
