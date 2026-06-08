import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate, registerWebhooks } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    await registerWebhooks({ session });
    return null;
  } catch (error) {
    // Re-throw 3xx redirects only — those are expected library control flow
    if (error instanceof Response && error.status >= 300 && error.status < 400) {
      throw error;
    }

    // On OAuth callback failure (state mismatch from concurrent background requests),
    // restart OAuth from scratch. The second attempt succeeds because the background
    // request that caused the race condition has already been handled.
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const isCallback = url.searchParams.has("code");

    if (shop && isCallback) {
      const appUrl = process.env.SHOPIFY_APP_URL || "";
      throw Response.redirect(`${appUrl}/auth?shop=${encodeURIComponent(shop)}`);
    }

    throw error;
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
