import { useEffect } from "react";

const DASHBOARD = "https://upselldashboard.netlify.app";

export function RedirectToDashboard({ path }) {
  useEffect(() => {
    const shop =
      (typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem("shopify_shop")) ||
      new URLSearchParams(window.location.search).get("shop") ||
      "";
    const url = `${DASHBOARD}${path}${shop ? `?shop=${shop}` : ""}`;
    window.top.location.href = url;
  }, [path]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "#6b7280", fontSize: "14px" }}>
      Opening dashboard…
    </div>
  );
}
