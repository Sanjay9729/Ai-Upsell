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
    console.error(`[auth.$] authenticate.admin failed:`, error.message);
    if (error.stack) console.error(error.stack);
    throw error;
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
