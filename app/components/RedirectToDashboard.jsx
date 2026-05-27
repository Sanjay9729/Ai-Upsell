import { useState, useMemo } from "react";

const DASHBOARD = "https://upselldashboard.netlify.app";

export function RedirectToDashboard({ path }) {
  const [loading, setLoading] = useState(true);

  const url = useMemo(() => {
    if (typeof window === "undefined") return `${DASHBOARD}${path}`;
    const shop =
      (typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem("shopify_shop")) ||
      new URLSearchParams(window.location.search).get("shop") ||
      "";
    return `${DASHBOARD}${path}${shop ? `?shop=${shop}` : ""}`;
  }, [path]);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "#6b7280", fontSize: "14px" }}>
          Loading dashboard…
        </div>
      )}
      <iframe
        src={url}
        onLoad={() => setLoading(false)}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: loading ? "none" : "block",
        }}
        title="AI Upsell Dashboard"
      />
    </div>
  );
}
