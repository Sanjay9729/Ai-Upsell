function corsHeaders() {
  return {};
}

function checkAuth(request) {
  const apiKey = process.env.DASHBOARD_API_KEY;
  if (!apiKey) return true;
  return request.headers.get("X-Dashboard-Key") === apiKey;
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return Response.json({ error: "Missing shop parameter" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const { getSafetyStatus } = await import("../../backend/services/safetyMode.js");
    const status = await getSafetyStatus(shop);
    return Response.json({ status }, { headers: corsHeaders() });
  } catch (err) {
    console.error("[api.dashboard.safety GET]", err);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders() });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return Response.json({ error: "Missing shop parameter" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const body = await request.json();
    const { intent, reason } = body;
    const { setSafetyMode, snapshotConfig, restoreConfig } = await import("../../backend/services/safetyMode.js");

    if (intent === "enable_safety") {
      const result = await setSafetyMode(shop, true, reason || "Manually enabled by merchant");
      return Response.json({ success: result.success, error: result.error || null }, { headers: corsHeaders() });
    }
    if (intent === "disable_safety") {
      const result = await setSafetyMode(shop, false, "Manually disabled by merchant");
      return Response.json({ success: result.success, error: result.error || null }, { headers: corsHeaders() });
    }
    if (intent === "snapshot") {
      const result = await snapshotConfig(shop, "manual");
      return Response.json({ success: result.success, error: result.error || null }, { headers: corsHeaders() });
    }
    if (intent === "restore") {
      const result = await restoreConfig(shop);
      return Response.json({
        success: result.success,
        error: result.error || null,
        restoredFrom: result.restoredFrom || null,
      }, { headers: corsHeaders() });
    }

    return Response.json({ error: "Unknown intent" }, { status: 400, headers: corsHeaders() });
  } catch (err) {
    console.error("[api.dashboard.safety POST]", err);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders() });
  }
};
