import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";

// Pre-warm MongoDB connection at module load so first admin request doesn't cold-start
import("../../backend/database/mongodb.js").then(({ getDb }) => getDb()).catch(() => {});

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop };
};

export default function App() {
  const { apiKey, shop } = useLoaderData();

  // Store shop so child route redirect components can read it
  if (typeof sessionStorage !== "undefined" && shop) {
    sessionStorage.setItem("shopify_shop", shop);
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/goal-setup">Goal &amp; Guardrails</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/activity-logs">Activity Logs</s-link>
        <s-link href="/app/optimization">Optimization &amp; Bundles</s-link>
        <s-link href="/app/guardrail-monitor">Guardrail Monitor</s-link>
        <s-link href="/app/recommendations">Recommendations</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
