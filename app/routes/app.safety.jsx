import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const { getSafetyStatus } = await import("../../backend/services/safetyMode.js");
  const status = await getSafetyStatus(shopId);

  return json({ shopId, status });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  const { setSafetyMode, snapshotConfig, restoreConfig } = await import("../../backend/services/safetyMode.js");

  if (intent === "enable_safety") {
    const reason = formData.get("reason") || "Manually enabled by merchant";
    const result = await setSafetyMode(shopId, true, reason);
    return json({ success: result.success, error: result.error || null, intent });
  }

  if (intent === "disable_safety") {
    const result = await setSafetyMode(shopId, false, "Manually disabled by merchant");
    return json({ success: result.success, error: result.error || null, intent });
  }

  if (intent === "snapshot") {
    const result = await snapshotConfig(shopId, "manual");
    return json({ success: result.success, error: result.error || null, intent });
  }

  if (intent === "restore") {
    const result = await restoreConfig(shopId);
    return json({
      success: result.success,
      error: result.error || null,
      restoredFrom: result.restoredFrom || null,
      intent
    });
  }

  return json({ success: false, error: "Unknown intent", intent }, { status: 400 });
};

export default function SafetyPage() {
  const { status } = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();

  const isActive = status?.active === true;

  const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const btnStyle = (variant = "default") => ({
    appearance: "none",
    border: "1px solid",
    borderRadius: "6px",
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily,
    ...(variant === "danger" ? {
      background: "#b42318", borderColor: "#b42318", color: "#fff"
    } : variant === "success" ? {
      background: "#008060", borderColor: "#007a5c", color: "#fff"
    } : variant === "warning" ? {
      background: "#f59e0b", borderColor: "#d97706", color: "#fff"
    } : {
      background: "#f6f6f7", borderColor: "#c9cccf", color: "#202223"
    })
  });

  return (
    <s-page heading="Safety Mode & Rollback">
      <style>{`* { font-family: ${fontFamily} !important; }`}</style>

      {/* Status Banner */}
      <s-section>
        <div style={{
          padding: "20px",
          borderRadius: "10px",
          background: isActive ? "#fff4f4" : "#f0faf6",
          border: `2px solid ${isActive ? "#b42318" : "#008060"}`,
          marginBottom: "16px"
        }}>
          <div style={{ fontSize: "18px", fontWeight: 700, color: isActive ? "#b42318" : "#008060", marginBottom: "6px" }}>
            {isActive ? "🛑 Safety Mode is ACTIVE" : "✅ System is Running Normally"}
          </div>
          <div style={{ fontSize: "13px", color: "#6d7175" }}>
            {isActive
              ? `All upsell offers are paused. Reason: ${status?.reason || "No reason specified"}`
              : "The AI decision engine is active and serving offers normally."}
          </div>
          {status?.updatedAt && (
            <div style={{ fontSize: "12px", color: "#8c9196", marginTop: "6px" }}>
              Last changed: {new Date(status.updatedAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Toggle Controls */}
        {isActive ? (
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="disable_safety" />
              <button type="submit" style={btnStyle("success")}>
                ▶ Resume Offers
              </button>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="restore" />
              <button type="submit" style={btnStyle("warning")}>
                ↩ Restore Last Config Snapshot
              </button>
            </fetcher.Form>
          </div>
        ) : (
          <fetcher.Form method="post" style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "480px" }}>
            <input type="hidden" name="intent" value="enable_safety" />
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#303030" }}>
              Reason (optional)
              <input
                type="text"
                name="reason"
                placeholder="e.g. High discount rate detected, reviewing offers"
                style={{
                  display: "block", marginTop: "6px", width: "100%",
                  padding: "8px 10px", borderRadius: "6px",
                  border: "1px solid #c9cccf", fontSize: "13px"
                }}
              />
            </label>
            <div>
              <button type="submit" style={btnStyle("danger")}>
                🛑 Enable Safety Mode (Pause All Offers)
              </button>
            </div>
          </fetcher.Form>
        )}

        {actionData?.error && (
          <div style={{ marginTop: "12px", color: "#b42318", fontSize: "13px" }}>
            Error: {actionData.error}
          </div>
        )}
        {actionData?.success && actionData.intent === "restore" && actionData.restoredFrom && (
          <div style={{ marginTop: "12px", color: "#008060", fontSize: "13px" }}>
            ✅ Config restored from snapshot: {actionData.restoredFrom.label} ({new Date(actionData.restoredFrom.createdAt).toLocaleString()})
          </div>
        )}
      </s-section>

      {/* Manual Snapshot */}
      <s-section heading="Config Snapshots">
        <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
          Save a snapshot of your current merchant config before making changes. You can restore to any snapshot if something goes wrong.
        </div>

        <fetcher.Form method="post" style={{ marginBottom: "20px" }}>
          <input type="hidden" name="intent" value="snapshot" />
          <button type="submit" style={btnStyle()}>
            📸 Save Current Config Snapshot
          </button>
          {actionData?.success && actionData.intent === "snapshot" && (
            <span style={{ marginLeft: "12px", fontSize: "12px", color: "#008060" }}>Snapshot saved</span>
          )}
        </fetcher.Form>

        {status?.snapshots?.length > 0 ? (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead style={{ background: "#f7f7f8" }}>
                <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}>
                  <th style={{ padding: "10px 14px" }}>Label</th>
                  <th style={{ padding: "10px 14px" }}>Saved At</th>
                </tr>
              </thead>
              <tbody>
                {status.snapshots.map((snap, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600 }}>{snap.label}</td>
                    <td style={{ padding: "10px 14px", color: "#6d7175" }}>{new Date(snap.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "16px", color: "#6d7175", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #e1e3e5" }}>
            No snapshots yet. Save your first snapshot above.
          </div>
        )}
      </s-section>

      {/* Audit Log */}
      <s-section heading="Safety Mode Audit Log">
        {status?.log?.length > 0 ? (
          <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead style={{ background: "#f7f7f8" }}>
                <tr style={{ borderBottom: "1px solid #e1e3e5", textAlign: "left" }}>
                  <th style={{ padding: "10px 14px" }}>Action</th>
                  <th style={{ padding: "10px 14px" }}>Reason</th>
                  <th style={{ padding: "10px 14px" }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {status.log.map((entry, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: entry.action === "enabled" ? "#b42318" : "#008060" }}>
                      {entry.action === "enabled" ? "🛑 Enabled" : "✅ Disabled"}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6d7175" }}>{entry.reason || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#6d7175" }}>{new Date(entry.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "16px", color: "#6d7175", background: "#f9fafb", borderRadius: "8px", border: "1px dashed #e1e3e5" }}>
            No safety mode events yet.
          </div>
        )}
      </s-section>
    </s-page>
  );
}
