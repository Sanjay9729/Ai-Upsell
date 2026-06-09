import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate, registerWebhooks } from "../shopify.server";

export const loader = async ({ request }) => {
  console.log(`[auth.$] Callback loader hit: ${request.url}`);
  try {
    const { session } = await authenticate.admin(request);
    console.log(`[auth.$] Authenticated successfully for shop: ${session.shop}`);

    try {
      await registerWebhooks({ session });
    } catch (err) {
      console.error("[auth.$] registerWebhooks failed (session was saved):", err?.message || err);
    }

    return null;
  } catch (error) {
    if (error instanceof Response) {
      console.log(`[auth.$] authenticate.admin threw a Response: status=${error.status}, headers=${JSON.stringify(Object.fromEntries(error.headers.entries()))}`);
    } else {
      console.error(`[auth.$] authenticate.admin failed:`, error);
    }
    throw error;
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
