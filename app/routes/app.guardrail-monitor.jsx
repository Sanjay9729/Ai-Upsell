import { RedirectToDashboard } from "../components/RedirectToDashboard";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

const GUARDRAIL_LABELS = {
  safety_mode_active:  { label: "Safety Mode Active",  tone: "critical" },
  placement_blocked:   { label: "Placement Blocked",   tone: "warning" },
  placement_shifted:   { label: "Placement Shifted",   tone: "attention" },
  session_offer_limit: { label: "Session Offer Limit", tone: "info" },
  paused_offer:        { label: "Offer Paused",        tone: "info" },
  low_confidence:      { label: "Low Confidence",      tone: "info" },
  no_candidates:       { label: "No Candidates",       tone: undefined },
  seen_in_session:     { label: "Already Seen",        tone: "success" },
};

function guardrailMeta(type) {
  return GUARDRAIL_LABELS[type] || { label: type, tone: undefined };
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
}

function buildDetails(ev) {
  const lines = [];
  if (ev.productId) lines.push(`Product: ${ev.productId}`);
  if (ev.productTitle) lines.push(`"${ev.productTitle}"`);
  if (ev.cartProductCount != null) lines.push(`Cart items: ${ev.cartProductCount}`);
  if (ev.contextKey) lines.push(`Context: ${ev.contextKey}`);
  if (ev.sessionOfferLimit != null) lines.push(`Session limit: ${ev.sessionOfferLimit}`);
  if (ev.seenCount != null) lines.push(`Already seen: ${ev.seenCount}`);
  if (ev.confidence != null) lines.push(`Confidence: ${(ev.confidence * 100).toFixed(0)}% (min: ${(ev.minAcceptance * 100).toFixed(0)}%)`);
  if (ev.shiftFrom && ev.shiftTo) lines.push(`Shift: ${ev.shiftFrom} → ${ev.shiftTo}`);
  return lines.length > 0 ? lines : ["—"];
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  try {
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const { analyzeGuardrailTriggers } = await import("../../backend/services/optimizationEngine.js");
    const db = await getDb();

    const [events, counts, guardrailAnalysis, autoTunings] = await Promise.all([
      db.collection(collections.guardrailEvents).find({ shopId: session.shop }).sort({ timestamp: -1 }).limit(100).toArray(),
      db.collection(collections.guardrailEvents).aggregate([
        { $match: { shopId: session.shop } },
        { $group: { _id: "$guardrailType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      analyzeGuardrailTriggers(session.shop),
      db.collection(collections.optimizationLogs).find({
        shopId: session.shop, type: "learning_loop",
        "results.actions.tunings.sessionOfferLimit": { $exists: true },
      }).sort({ timestamp: -1 }).limit(10).toArray(),
    ]);

    return Response.json({
      success: true,
      events: events.map((e) => ({ ...e, _id: e._id.toString() })),
      counts,
      guardrailRate: guardrailAnalysis.success ? guardrailAnalysis.guardrailRate : null,
      totalDecisions: guardrailAnalysis.success ? guardrailAnalysis.totalDecisions : null,
      autoTunings: autoTunings.map((log) => ({ _id: log._id.toString(), timestamp: log.timestamp, tuning: log.results?.actions?.tunings?.sessionOfferLimit ?? null })).filter((t) => t.tuning !== null),
    });
  } catch (error) {
    console.error("Error loading guardrail events:", error);
    return Response.json({ success: false, error: error.message, events: [], counts: [], guardrailRate: null, totalDecisions: null, autoTunings: [] });
  }
};


export default function GuardrailMonitorPage() {
  return <RedirectToDashboard path="/guardrails" />;
}
