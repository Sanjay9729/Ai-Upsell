import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useRevalidator, Form } from "@remix-run/react";
import { useMemo, useState, useEffect } from "react";
import { authenticate } from "../shopify.server";
import {
    getMerchantContext,
    saveMerchantContext,
    getOfferControlMap,
    setOfferControl,
    getOfferLogs
} from "../services/merchandisingIntelligence.server";
import { syncProductsWithGraphQL } from "../../backend/database/collections.js";
import {
    Page,
    Card,
    BlockStack,
    InlineStack,
    Text,
    Button,
    ButtonGroup,
    Select,
    TextField,
    Checkbox,
    Badge,
    DataTable,
    Tabs,
    EmptyState,
    Banner,
    Box,
    Divider,
    InlineGrid,
} from "@shopify/polaris";

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

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;
    const { getDb, collections } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    let getBundlesWithPerformance = async () => [];
    let getExplainabilityDashboard = async () => [];
    try {
        const p6 = await import("../../backend/services/pillar6IntelligenceService.js");
        getBundlesWithPerformance = p6.getBundlesWithPerformance;
        getExplainabilityDashboard = p6.getExplainabilityDashboard;
    } catch (err) {
        console.warn("[intelligence] pillar6 service import failed:", err.message);
    }

    const [context, offerLogResult, contextDoc, bundles, explainability] = await Promise.all([
        getMerchantContext(shopId),
        getOfferLogs(shopId, { limit: 120 }),
        db.collection(collections.merchantIntelligence).findOne(
            { shopId },
            { projection: { updatedAt: 1, createdAt: 1 } }
        ),
        getBundlesWithPerformance(shopId, 50).catch(() => []),
        getExplainabilityDashboard(shopId, 20).catch(() => []),
    ]);

    const offers = (offerLogResult.offers || []).map((offer) => ({
        offerId: offer.offerId,
        offerKey: offer.offerKey,
        contextKey: offer.contextKey,
        placement: offer.placement,
        sourceProductId: offer.sourceProductId,
        sourceProductName: offer.sourceProductName,
        upsellProductId: offer.upsellProductId,
        upsellProductName: offer.upsellProductName,
        offerType: offer.offerType,
        recommendationType: offer.recommendationType,
        confidence: offer.confidence,
        decisionScore: offer.decisionScore,
        decisionReason: offer.decisionReason,
        aiReason: offer.aiReason,
        discountPercent: offer.discountPercent,
        goal: offer.goal,
        riskTolerance: offer.riskTolerance,
        createdAt: offer.createdAt
    }));

    const offerKeys = offers.map((o) => o.offerKey).filter(Boolean);
    const controlMap = await getOfferControlMap(shopId, offerKeys);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const perfRows = await db.collection(collections.upsellEvents).aggregate([
        {
            $match: {
                shopId,
                isUpsellEvent: true,
                timestamp: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: {
                    sourceProductId: { $ifNull: ["$sourceProductId", "cart"] },
                    upsellProductId: "$upsellProductId",
                    eventType: "$eventType"
                },
                count: { $sum: 1 }
            }
        }
    ]).toArray();

    const performanceMap = {};
    for (const row of perfRows) {
        const key = `${row._id.sourceProductId}:${row._id.upsellProductId}`;
        if (!performanceMap[key]) performanceMap[key] = { views: 0, clicks: 0, cart_adds: 0 };
        if (row._id.eventType === 'view') performanceMap[key].views = row.count;
        if (row._id.eventType === 'click') performanceMap[key].clicks = row.count;
        if (row._id.eventType === 'cart_add') performanceMap[key].cart_adds = row.count;
    }

    const segmentRows = await db.collection(collections.upsellEvents).aggregate([
        {
            $match: {
                shopId,
                isUpsellEvent: true,
                timestamp: { $gte: thirtyDaysAgo }
            }
        },
        {
            $project: {
                eventType: 1,
                segment: {
                    $ifNull: [
                        "$metadata.segment",
                        {
                            $cond: [
                                { $ifNull: ["$customerId", false] },
                                "known_customer",
                                "anonymous"
                            ]
                        }
                    ]
                }
            }
        },
        {
            $group: {
                _id: { segment: "$segment", eventType: "$eventType" },
                count: { $sum: 1 }
            }
        }
    ]).toArray();

    const segmentMap = {};
    for (const row of segmentRows) {
        const seg = row._id.segment || 'unknown';
        if (!segmentMap[seg]) {
            segmentMap[seg] = { segment: seg, views: 0, clicks: 0, cartAdds: 0 };
        }
        if (row._id.eventType === 'view') segmentMap[seg].views += row.count;
        if (row._id.eventType === 'click') segmentMap[seg].clicks += row.count;
        if (row._id.eventType === 'cart_add') segmentMap[seg].cartAdds += row.count;
    }

    const loaderSegments = Object.values(segmentMap).map((s) => ({
        ...s,
        clickThroughRate: s.views > 0 ? (s.clicks / s.views) * 100 : 0,
        conversionRate: s.views > 0 ? (s.cartAdds / s.views) * 100 : 0
    }));

    return json({
        context,
        offers,
        controlMap,
        performanceMap,
        loaderSegments,
        bundles,
        explainability,
        lastSavedAt: contextDoc?.updatedAt || contextDoc?.createdAt || null
    });
};

export const action = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "save_context") {
        const priority = formData.get("priority") || "none";
        const notes = formData.get("notes") || "";
        const preferBundles = formData.get("preferBundles") === "on";
        const productsInput = formData.get("focusProducts") || "";
        const collectionsInput = formData.get("focusCollections") || "";

        const productTokens = parseDelimitedList(productsInput);
        const collectionTokens = parseDelimitedList(collectionsInput);

        const { ids: focusProductIds, handles: focusProductHandles } = splitIdsAndHandles(productTokens, {
            idRegex: /Product\/(\d+)/i
        });
        const { ids: focusCollectionIds, handles: focusCollectionHandles } = splitIdsAndHandles(collectionTokens, {
            idRegex: /Collection\/(\d+)/i
        });

        const result = await saveMerchantContext(shopId, {
            priority,
            notes,
            preferBundles,
            focusProductIds,
            focusProductHandles,
            focusCollectionIds,
            focusCollectionHandles
        });

        if (result.success) {
            const { admin } = await authenticate.admin(request);
            syncProductsWithGraphQL(shopId, admin.graphql).catch(err =>
                console.warn("[intelligence] Background sync failed:", err.message)
            );
        }

        return json({ success: result.success, error: result.error || null, intent });
    }

    if (intent === "offer_action") {
        const offerKey = formData.get("offerKey");
        const status = formData.get("status");
        const note = formData.get("note") || "";
        const sourceProductId = formData.get("sourceProductId");
        const upsellProductId = formData.get("upsellProductId");
        const contextKey = formData.get("contextKey") || "product";

        const result = await setOfferControl(shopId, {
            offerKey,
            status,
            note,
            sourceProductId,
            upsellProductId,
            contextKey
        });

        return json({ success: result.success, error: result.error || null, intent });
    }

    return json({ success: false, error: "Unknown intent", intent }, { status: 400 });
};

function statusBadge(status) {
    const toneMap = { approved: "success", paused: "critical", guided: "info", auto: undefined };
    return <Badge tone={toneMap[status]}>{status ? status.toUpperCase() : "AUTO"}</Badge>;
}

const TAB_IDS = ["intelligence", "segments", "explainability"];

export default function IntelligencePage() {
    const { context, offers, controlMap, performanceMap, loaderSegments, bundles, explainability, lastSavedAt } = useLoaderData();
    const actionData = useActionData();
    const revalidator = useRevalidator();
    const [filter, setFilter] = useState("all");
    const [selectedTab, setSelectedTab] = useState(0);
    const [preferBundles, setPreferBundles] = useState(context.preferBundles || false);
    const segments = loaderSegments;

    useEffect(() => {
        if (actionData?.success && actionData?.intent === "offer_action") {
            revalidator.revalidate();
        }
    }, [actionData, revalidator]);

    const filteredOffers = useMemo(() => {
        if (filter === "all") return offers;
        return offers.filter((o) => o.offerType === filter);
    }, [offers, filter]);

    const focusProducts = buildListText(context.focusProductIds, context.focusProductHandles);
    const focusCollections = buildListText(context.focusCollectionIds, context.focusCollectionHandles);

    const tabs = [
        { id: "intelligence", content: "Intelligence", panelID: "intelligence-panel" },
        { id: "segments", content: "Segments", panelID: "segments-panel" },
        { id: "explainability", content: "Why", panelID: "explainability-panel" },
    ];

    const activeTab = TAB_IDS[selectedTab];

    const priorityOptions = [
        { label: "No special priority", value: "none" },
        { label: "Push new collection", value: "push_new_collection" },
        { label: "Clear overstock", value: "clear_overstock" },
        { label: "Grow subscriptions", value: "grow_subscriptions" },
        { label: "Maximize margin", value: "maximize_margin" },
        { label: "Custom focus", value: "custom" },
    ];

    const segmentRows = segments.map((seg) => [
        seg.segment,
        seg.views,
        seg.cartAdds,
        seg.views > 0 ? `${seg.conversionRate.toFixed(1)}%` : "—",
    ]);

    return (
        <Page title="Merchandising Intelligence">
            <BlockStack gap="500">
                {/* Context Injection */}
                <Card>
                    <BlockStack gap="400">
                        <Text variant="headingMd" as="h2">Context Injection</Text>
                        <Text variant="bodySm" tone="subdued">
                            Provide strategic guidance. The AI treats this as a soft preference and never violates guardrails.
                        </Text>

                        <Form key={lastSavedAt || "default"} method="post">
                            <input type="hidden" name="intent" value="save_context" />
                            <BlockStack gap="400">
                                <Select
                                    label="Priority"
                                    name="priority"
                                    options={priorityOptions}
                                    value={context.priority || "none"}
                                />
                                <TextField
                                    label="Focus products (IDs or handles)"
                                    name="focusProducts"
                                    multiline={3}
                                    defaultValue={focusProducts}
                                    placeholder="e.g. 7708018999350, premium-bracelet"
                                    autoComplete="off"
                                />
                                <TextField
                                    label="Focus collections (IDs or handles)"
                                    name="focusCollections"
                                    multiline={3}
                                    defaultValue={focusCollections}
                                    placeholder="e.g. summer-collection, 123456789"
                                    autoComplete="off"
                                />
                                <TextField
                                    label="Notes"
                                    name="notes"
                                    multiline={3}
                                    defaultValue={context.notes || ""}
                                    placeholder='e.g. Push "New Arrivals" and avoid discounting premium bundles.'
                                    autoComplete="off"
                                />
                                <Checkbox
                                    label="Prefer bundle-style offers when possible"
                                    name="preferBundles"
                                    checked={preferBundles}
                                    onChange={setPreferBundles}
                                />
                                <InlineStack gap="300" align="start" blockAlign="center">
                                    <Button variant="primary" submit>Save Context</Button>
                                    {actionData?.success && actionData?.intent === "save_context" && (
                                        <Text tone="success" variant="bodySm">Saved</Text>
                                    )}
                                    {actionData?.error && actionData?.intent === "save_context" && (
                                        <Text tone="critical" variant="bodySm">{actionData.error}</Text>
                                    )}
                                    {lastSavedAt && (
                                        <Text tone="subdued" variant="bodySm">
                                            Last saved: {new Date(lastSavedAt).toLocaleString()}
                                        </Text>
                                    )}
                                </InlineStack>
                            </BlockStack>
                        </Form>
                    </BlockStack>
                </Card>

                {/* Tabs */}
                <Card padding="0">
                    <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                        <Box padding="400">
                            {/* Intelligence Tab */}
                            {activeTab === "intelligence" && (
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Bundle & Offer Review — Intelligence</Text>
                                    {bundles && bundles.length > 0 && (
                                        <Banner tone="success">
                                            {bundles.length} Bundles | Avg Conv:{" "}
                                            {(bundles.reduce((s, b) => s + b.performance.conversion, 0) / bundles.length).toFixed(1)}%
                                        </Banner>
                                    )}
                                    {bundles && bundles.map((bundle) => {
                                        const bStatus = bundle.controlStatus || "auto";
                                        const recommendedText =
                                            bundle.recommendedAction === "pause" ? "Pause — low conversion" :
                                            bundle.recommendedAction === "approve" ? "Approve — high conversion" :
                                            "Monitor — gathering data";

                                        return (
                                            <Card key={bundle.bundleId}>
                                                <BlockStack gap="300">
                                                    <InlineStack align="space-between" blockAlign="start">
                                                        <BlockStack gap="100">
                                                            <Text variant="bodyMd" fontWeight="bold">
                                                                {bundle.sourceProductName || bundle.sourceProductId || "Cart"} → {bundle.upsellProductName || bundle.upsellProductId}
                                                            </Text>
                                                            <Text variant="bodySm" tone="subdued">
                                                                Views: {bundle.performance.views} · Conv: {bundle.performance.conversion.toFixed(1)}%
                                                                {bundle.discountPercent ? ` · Discount: ${bundle.discountPercent}%` : ""}
                                                                {bundle.goal ? ` · Goal: ${bundle.goal}` : ""}
                                                            </Text>
                                                            {bundle.decisionReason && (
                                                                <Text variant="bodySm" tone="subdued">Why: {bundle.decisionReason}</Text>
                                                            )}
                                                        </BlockStack>
                                                        {statusBadge(bStatus)}
                                                    </InlineStack>

                                                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                                        <Text variant="bodySm">
                                                            <strong>Recommended:</strong> {recommendedText}
                                                        </Text>
                                                    </Box>

                                                    {bundle.segmentBreakdown && bundle.segmentBreakdown.filter(s => s.views > 0).length > 0 && (
                                                        <InlineStack gap="200" wrap>
                                                            {bundle.segmentBreakdown.filter(s => s.views > 0).map(seg => (
                                                                <Badge key={seg.segment}>{seg.segment}: {seg.conversion.toFixed(1)}% conv</Badge>
                                                            ))}
                                                        </InlineStack>
                                                    )}

                                                    <InlineStack gap="200">
                                                        <Form method="post">
                                                            <input type="hidden" name="intent" value="offer_action" />
                                                            <input type="hidden" name="offerKey" value={bundle.offerKey} />
                                                            <input type="hidden" name="status" value="approved" />
                                                            <input type="hidden" name="contextKey" value={bundle.contextKey || "product"} />
                                                            <input type="hidden" name="sourceProductId" value={bundle.sourceProductId || ""} />
                                                            <input type="hidden" name="upsellProductId" value={bundle.upsellProductId || ""} />
                                                            <Button variant="primary" tone="success" submit size="slim">Approve</Button>
                                                        </Form>
                                                        <Form method="post">
                                                            <input type="hidden" name="intent" value="offer_action" />
                                                            <input type="hidden" name="offerKey" value={bundle.offerKey} />
                                                            <input type="hidden" name="status" value="paused" />
                                                            <input type="hidden" name="contextKey" value={bundle.contextKey || "product"} />
                                                            <input type="hidden" name="sourceProductId" value={bundle.sourceProductId || ""} />
                                                            <input type="hidden" name="upsellProductId" value={bundle.upsellProductId || ""} />
                                                            <Button tone="critical" submit size="slim">Pause</Button>
                                                        </Form>
                                                    </InlineStack>
                                                </BlockStack>
                                            </Card>
                                        );
                                    })}
                                    {(!bundles || bundles.length === 0) && (
                                        <EmptyState
                                            heading="No bundle intelligence yet"
                                            image=""
                                        >
                                            <p>Bundle performance data will appear here once the AI engine has processed enough offer interactions.</p>
                                        </EmptyState>
                                    )}
                                </BlockStack>
                            )}

                            {/* Segments Tab */}
                            {activeTab === "segments" && (
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Segment Performance (Last 30 Days)</Text>
                                    {segments.length === 0 ? (
                                        <EmptyState
                                            heading="No segment data yet"
                                            image=""
                                        >
                                            <p>Segment performance will appear here automatically once customers start visiting your product pages and interacting with upsell offers.</p>
                                            <Banner>
                                                Tip: Make sure your theme embed is enabled and offers are being shown to customers.
                                            </Banner>
                                        </EmptyState>
                                    ) : (
                                        <DataTable
                                            columnContentTypes={["text", "numeric", "numeric", "text"]}
                                            headings={["Segment", "Views", "Adds", "Conversion"]}
                                            rows={segmentRows}
                                        />
                                    )}
                                </BlockStack>
                            )}

                            {/* Explainability Tab */}
                            {activeTab === "explainability" && (
                                <BlockStack gap="400">
                                    <Text variant="headingMd" as="h2">Why Each Offer Was Created</Text>
                                    {explainability && explainability.length > 0 ? (
                                        explainability.slice(0, 8).map((offer) => (
                                            <Card key={offer.offerId}>
                                                <BlockStack gap="300">
                                                    <BlockStack gap="100">
                                                        <Text variant="bodyMd" fontWeight="bold">
                                                            {offer.sourceProduct} → {offer.upsellProduct}
                                                        </Text>
                                                        <Text variant="bodySm" tone="subdued">
                                                            Score: {offer.decisionScore.toFixed(2)} | Confidence: {(offer.confidence * 100).toFixed(0)}% | {offer.offerType}
                                                        </Text>
                                                    </BlockStack>

                                                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                                        <BlockStack gap="100">
                                                            <Text variant="bodySm" fontWeight="bold">Data Signals:</Text>
                                                            {offer.dataSignals.slice(0, 3).map((s, i) => (
                                                                <Text key={i} variant="bodySm" tone="subdued">
                                                                    • {s.signal}: {typeof s.value === "number" ? s.value.toFixed(1) : s.value}
                                                                </Text>
                                                            ))}
                                                        </BlockStack>
                                                    </Box>

                                                    {offer.whyCreated.length > 0 && (
                                                        <Banner tone="info">
                                                            Why: {offer.whyCreated[0]}
                                                        </Banner>
                                                    )}
                                                </BlockStack>
                                            </Card>
                                        ))
                                    ) : (
                                        <EmptyState
                                            heading="No offer explanations yet"
                                            image=""
                                        >
                                            <p>Once the AI engine starts generating offers for your store, you'll see exactly why each offer was created — which data signals drove it, which goal it supports, and its live performance.</p>
                                            <Banner tone="success">
                                                Offers generate automatically when customers visit product or cart pages.
                                            </Banner>
                                        </EmptyState>
                                    )}
                                </BlockStack>
                            )}
                        </Box>
                    </Tabs>
                </Card>

                {/* Bundle & Offer Review */}
                <Card>
                    <BlockStack gap="400">
                        <Text variant="headingMd" as="h2">Bundle & Offer Review</Text>

                        <ButtonGroup variant="segmented">
                            <Button pressed={filter === "all"} onClick={() => setFilter("all")}>
                                All ({offers.length})
                            </Button>
                            <Button pressed={filter === "bundle"} onClick={() => setFilter("bundle")}>
                                Bundles
                            </Button>
                            <Button pressed={filter === "volume_discount"} onClick={() => setFilter("volume_discount")}>
                                Volume
                            </Button>
                            <Button pressed={filter === "subscription_upgrade"} onClick={() => setFilter("subscription_upgrade")}>
                                Subscription
                            </Button>
                            <Button pressed={filter === "addon_upsell"} onClick={() => setFilter("addon_upsell")}>
                                Add-ons
                            </Button>
                        </ButtonGroup>

                        {filteredOffers.length === 0 ? (
                            <Banner>
                                No offers logged yet. Offers will appear here after the decision engine runs.
                            </Banner>
                        ) : (
                            <BlockStack gap="300">
                                {filteredOffers.map((offer) => {
                                    const perfKey = `${offer.sourceProductId || "cart"}:${offer.upsellProductId}`;
                                    const perf = performanceMap[perfKey] || { views: 0, clicks: 0, cart_adds: 0 };
                                    const status = controlMap[offer.offerKey]?.status || "auto";
                                    const note = controlMap[offer.offerKey]?.note || "";
                                    const conv = perf.views > 0 ? `${((perf.cart_adds / perf.views) * 100).toFixed(1)}%` : "—";

                                    return (
                                        <Card key={offer.offerId}>
                                            <BlockStack gap="300">
                                                <InlineStack align="space-between" blockAlign="start">
                                                    <BlockStack gap="100">
                                                        <Text variant="bodySm" tone="subdued">Source → Offer</Text>
                                                        <Text variant="bodyMd" fontWeight="bold">
                                                            {offer.sourceProductName || offer.sourceProductId || "Cart"} → {offer.upsellProductName || offer.upsellProductId}
                                                        </Text>
                                                    </BlockStack>
                                                    {statusBadge(status)}
                                                </InlineStack>

                                                <BlockStack gap="100">
                                                    <Text variant="bodySm">
                                                        Type: <strong>{offer.offerType || "addon_upsell"}</strong> · Recommendation: {offer.recommendationType || "similar"} · Placement: {offer.placement}
                                                    </Text>
                                                    <Text variant="bodySm">
                                                        Goal: {offer.goal || "—"} · Risk: {offer.riskTolerance || "—"} · Discount: {offer.discountPercent != null ? `${offer.discountPercent}%` : "—"}
                                                    </Text>
                                                    <Text variant="bodySm">
                                                        Decision: {offer.decisionReason || "—"} · AI: {offer.aiReason || "—"}
                                                    </Text>
                                                    <Text variant="bodySm">
                                                        Confidence: {offer.confidence ?? "—"} · Score: {offer.decisionScore ?? "—"}
                                                    </Text>
                                                </BlockStack>

                                                <InlineStack gap="400">
                                                    <Text variant="bodySm" tone="subdued">Views: {perf.views}</Text>
                                                    <Text variant="bodySm" tone="subdued">Adds: {perf.cart_adds}</Text>
                                                    <Text variant="bodySm" tone="subdued">Conv: {conv}</Text>
                                                </InlineStack>

                                                <InlineStack gap="200" wrap>
                                                    <Form method="post">
                                                        <input type="hidden" name="intent" value="offer_action" />
                                                        <input type="hidden" name="offerKey" value={offer.offerKey} />
                                                        <input type="hidden" name="status" value="approved" />
                                                        <input type="hidden" name="contextKey" value={offer.contextKey || "product"} />
                                                        <input type="hidden" name="sourceProductId" value={offer.sourceProductId || ""} />
                                                        <input type="hidden" name="upsellProductId" value={offer.upsellProductId || ""} />
                                                        <Button variant="primary" tone="success" submit size="slim">Approve</Button>
                                                    </Form>
                                                    <Form method="post">
                                                        <input type="hidden" name="intent" value="offer_action" />
                                                        <input type="hidden" name="offerKey" value={offer.offerKey} />
                                                        <input type="hidden" name="status" value="paused" />
                                                        <input type="hidden" name="contextKey" value={offer.contextKey || "product"} />
                                                        <input type="hidden" name="sourceProductId" value={offer.sourceProductId || ""} />
                                                        <input type="hidden" name="upsellProductId" value={offer.upsellProductId || ""} />
                                                        <Button tone="critical" submit size="slim">Pause</Button>
                                                    </Form>
                                                    <Form method="post" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                                        <input type="hidden" name="intent" value="offer_action" />
                                                        <input type="hidden" name="offerKey" value={offer.offerKey} />
                                                        <input type="hidden" name="status" value="guided" />
                                                        <input type="hidden" name="contextKey" value={offer.contextKey || "product"} />
                                                        <input type="hidden" name="sourceProductId" value={offer.sourceProductId || ""} />
                                                        <input type="hidden" name="upsellProductId" value={offer.upsellProductId || ""} />
                                                        <input
                                                            type="text"
                                                            name="note"
                                                            placeholder="Guide (optional)"
                                                            defaultValue={note}
                                                            style={{ padding: "6px 8px", border: "1px solid #c9cccf", borderRadius: "6px", fontSize: "13px" }}
                                                        />
                                                        <Button submit size="slim">Guide</Button>
                                                    </Form>
                                                </InlineStack>
                                            </BlockStack>
                                        </Card>
                                    );
                                })}
                            </BlockStack>
                        )}
                    </BlockStack>
                </Card>
            </BlockStack>
        </Page>
    );
}
