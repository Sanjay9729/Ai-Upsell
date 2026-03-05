import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { authenticate } from "../shopify.server";

async function ensureScriptTag(admin) {
  const scriptSrc = `${process.env.SHOPIFY_APP_URL}/scripts/order-status-tracking.js`;
  console.log('[ScriptTag] Checking registration for:', scriptSrc);
  try {
    // Check existing via GraphQL
    const checkRes = await admin.graphql(`
      query {
        scriptTags(first: 10) {
          edges { node { id src displayScope } }
        }
      }
    `);
    const checkData = await checkRes.json();
    const tags = checkData?.data?.scriptTags?.edges || [];
    const alreadyExists = tags.some(e => e.node.src === scriptSrc);

    if (alreadyExists) {
      console.log('[ScriptTag] Already registered');
      return;
    }

    // Create via GraphQL
    const createRes = await admin.graphql(`
      mutation {
        scriptTagCreate(input: {
          src: "${scriptSrc}",
          displayScope: ORDER_STATUS
        }) {
          scriptTag { id src }
          userErrors { field message }
        }
      }
    `);
    const createData = await createRes.json();
    const errors = createData?.data?.scriptTagCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error('[ScriptTag] Create errors:', JSON.stringify(errors));
    } else {
      console.log('[ScriptTag] Registered order-status tracking script:', createData?.data?.scriptTagCreate?.scriptTag?.id);
    }
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
