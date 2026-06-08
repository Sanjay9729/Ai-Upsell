import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate, registerWebhooks } from "../shopify.server";

// Prevents the Shopify Admin background frame from starting a concurrent OAuth begin
// that overwrites the state cookie and causes "Invalid OAuth callback" errors.
const oauthBeginLocks = new Map();
const LOCK_TTL_MS = 30_000;

function acquireOAuthLock(shop) {
  const now = Date.now();
  const last = oauthBeginLocks.get(shop);
  if (last && now - last < LOCK_TTL_MS) return false;
  oauthBeginLocks.set(shop, now);
  return true;
}

function releaseOAuthLock(shop) {
  if (shop) oauthBeginLocks.delete(shop);
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const isCallback = url.searchParams.has("code");
  const shop = url.searchParams.get("shop");

  if (!isCallback && shop) {
    if (!acquireOAuthLock(shop)) {
      // A concurrent OAuth begin is already in progress for this shop.
      // Return 200 so this background request does NOT overwrite the state cookie.
      return new Response(null, { status: 200 });
    }
  }

  try {
    const { session } = await authenticate.admin(request);
    await registerWebhooks({ session });
    releaseOAuthLock(shop);
    return null;
  } catch (error) {
    // Re-throw 3xx redirects (OAuth begin, login) — expected library control flow
    if (error instanceof Response && error.status >= 300 && error.status < 400) {
      throw error;
    }

    // On callback failure, release lock so a fresh OAuth can start
    if (shop && isCallback) {
      releaseOAuthLock(shop);
      const appUrl = process.env.SHOPIFY_APP_URL || "";
      throw Response.redirect(`${appUrl}/auth?shop=${encodeURIComponent(shop)}`);
    }

    releaseOAuthLock(shop);
    throw error;
  }
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
