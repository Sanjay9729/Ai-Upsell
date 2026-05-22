import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";

// Pre-warm MongoDB connection at module load so first admin request doesn't cold-start
import("../../backend/database/mongodb.js").then(({ getDb }) => getDb()).catch(() => {});

const DASHBOARD_BASE = "https://upselldashboard.netlify.app";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop };
};

export default function App() {
  const { apiKey, shop } = useLoaderData();
  const dash = (path) => `${DASHBOARD_BASE}${path}?shop=${shop}`;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href={dash("/")}>Home</s-link>
        <s-link href={dash("/goals")}>Goal &amp; Guardrails</s-link>
        <s-link href={dash("/analytics")}>Analytics</s-link>
        <s-link href={dash("/activity-logs")}>Activity Logs</s-link>
        <s-link href={dash("/optimization")}>Optimization &amp; Bundles</s-link>
        <s-link href={dash("/guardrails")}>Guardrail Monitor</s-link>
        <s-link href={dash("/recommendations")}>Recommendations</s-link>
        <s-link href={dash("/settings")}>Settings</s-link>
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
