import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";

async function ensureScriptTag(admin) {
  if (!admin?.rest) return; // REST client not available
  const scriptSrc = `${process.env.SHOPIFY_APP_URL}/scripts/order-status-tracking.js`;
  try {
    const existing = await admin.rest.get({ path: 'script_tags', query: { src: scriptSrc } });
    if (existing?.body?.script_tags?.length > 0) return;
    await admin.rest.post({
      path: 'script_tags',
      data: { script_tag: { event: 'onload', src: scriptSrc, display_scope: 'order_status' } }
    });
    console.log('[ScriptTag] Registered order-status tracking script');
  } catch (err) {
    console.error('[ScriptTag] Registration error:', err.message);
  }
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Ensure ScriptTag is registered for this shop (idempotent)
  ensureScriptTag(admin).catch(() => {});

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/goal-setup">Goal & Guardrails</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/activity-logs">Activity Logs</s-link>
        <s-link href="/app/intelligence">Merchandising Intelligence</s-link>
        <s-link href="/app/optimization">Learning & Optimization & Bundles</s-link>
        <s-link href="/app/safety">Safety Mode</s-link>
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
