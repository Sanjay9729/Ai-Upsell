import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate, registerWebhooks } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    await registerWebhooks({ session });
    return null;
  } catch (error) {
    // Re-throw Response objects (redirects) — those are expected control flow
    if (error instanceof Response) throw error;

    // OAuth state mismatch: the background iframe overwrote the state cookie.
    // Restart OAuth from scratch so the user gets a clean install flow.
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    if (shop) {
      const appUrl = process.env.SHOPIFY_APP_URL || "";
      return Response.redirect(
        `${appUrl}/auth?shop=${encodeURIComponent(shop)}`
      );
    }

    throw error;
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
