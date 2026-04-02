import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';
const enableProtectedOrdersWebhook =
  (process.env.ENABLE_PROTECTED_ORDERS_WEBHOOK || '').toLowerCase() === 'true';

async function registerOrderStatusScriptTag(admin, shop) {
  if (!admin?.rest) return; // REST client not available
  const scriptSrc = `${process.env.SHOPIFY_APP_URL}/scripts/order-status-tracking.js`;
  try {
    // Check if already registered
    const existing = await admin.rest.get({ path: 'script_tags', query: { src: scriptSrc } });
    if (existing?.body?.script_tags?.length > 0) {
      console.log(`[ScriptTag] Already registered for ${shop}`);
      return;
    }
    // Register new ScriptTag scoped to order status page only
    await admin.rest.post({
      path: 'script_tags',
      data: {
        script_tag: {
          event: 'onload',
          src: scriptSrc,
          display_scope: 'order_status',
        }
      }
    });
    console.log(`[ScriptTag] Registered order-status tracking for ${shop}`);
  } catch (err) {
    console.error(`[ScriptTag] Failed to register for ${shop}:`, err.message);
  }
}

async function ensureUpsellAutomaticDiscount(admin, shop) {
  if (!admin?.graphql) return;
  const discountTitle = "AI Upsell Automatic Discount";

  try {
    // 1) Find the product-discount function for this app (field name differs by API version)
    async function fetchFunctions() {
      const queries = [
        {
          name: "shopifyFunctions",
          query: `#graphql
            query GetFunctions {
              shopifyFunctions(first: 50) {
                nodes { id title apiType }
              }
            }`
        },
        {
          name: "appFunctions",
          query: `#graphql
            query GetFunctions {
              appFunctions(first: 50) {
                nodes { id title apiType }
              }
            }`
        }
      ];
      for (const q of queries) {
        try {
          const res = await admin.graphql(q.query);
          const data = await res.json();
          if (Array.isArray(data.errors) && data.errors.length > 0) {
            console.warn(`[Discount] ${q.name} query errors:`, data.errors);
            continue;
          }
          const nodes = data.data?.[q.name]?.nodes || [];
          if (nodes.length > 0) return nodes;
        } catch (err) {
          console.warn(`[Discount] ${q.name} query failed:`, err?.message || err);
        }
      }
      return [];
    }

    const functions = await fetchFunctions();
    const upsellFn =
      functions.find(
        (fn) =>
          String(fn?.apiType || "").toUpperCase() === "PRODUCT_DISCOUNTS" &&
          /upsell\s*discount/i.test(String(fn?.title || ""))
      ) ||
      functions.find(
        (fn) => /upsell\s*discount/i.test(String(fn?.title || ""))
      );

    if (!upsellFn?.id) {
      console.warn(`[Discount] No product discount function found for ${shop}`);
      return;
    }

    // 2) Check if the automatic discount already exists
    const existingRes = await admin.graphql(
      `#graphql
      query FindDiscount($query: String!) {
        discountNodes(first: 1, query: $query) {
          edges {
            node {
              id
              discount {
                __typename
                ... on DiscountAutomaticApp {
                  title
                  status
                  functionId
                }
              }
            }
          }
        }
      }`,
      { variables: { query: `title:${discountTitle}` } }
    );
    const existingData = await existingRes.json();
    const existingNode = existingData.data?.discountNodes?.edges?.[0]?.node;
    const existing = existingNode?.discount;

    if (existing?.__typename === "DiscountAutomaticApp") {
      const isActive = String(existing?.status || "").toUpperCase() === "ACTIVE";
      if (existing?.functionId === upsellFn.id && isActive) {
        return;
      }
      // Try to update if exists but inactive or wrong function
      try {
        const updateRes = await admin.graphql(
          `#graphql
          mutation UpdateAutomaticDiscount($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
            discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
              automaticAppDiscount { discountId }
              userErrors { field message code }
            }
          }`,
          {
            variables: {
              id: existingNode?.id,
              automaticAppDiscount: {
                title: discountTitle,
                functionId: upsellFn.id,
                startsAt: new Date().toISOString(),
                combinesWith: {
                  productDiscounts: true,
                  orderDiscounts: true,
                  shippingDiscounts: true
                }
              }
            }
          }
        );
        const updateData = await updateRes.json();
        const updateErrors =
          updateData.data?.discountAutomaticAppUpdate?.userErrors || [];
        if (updateErrors.length === 0) {
          console.log(
            `[Discount] Automatic discount updated for ${shop}: ${existingNode?.id}`
          );
          return;
        }
        console.warn(
          `[Discount] Failed to update automatic discount for ${shop}:`,
          updateErrors[0]?.message || updateErrors
        );
      } catch (err) {
        console.warn(
          `[Discount] discountAutomaticAppUpdate failed for ${shop}:`,
          err?.message || err
        );
      }
    }

    // 3) Create the automatic discount backed by the function
    const createRes = await admin.graphql(
      `#graphql
      mutation CreateAutomaticDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            discountId
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      {
        variables: {
          automaticAppDiscount: {
            title: discountTitle,
            functionId: upsellFn.id,
            startsAt: new Date().toISOString(),
            combinesWith: {
              productDiscounts: true,
              orderDiscounts: true,
              shippingDiscounts: true
            }
          }
        }
      }
    );
    const createData = await createRes.json();
    const errors =
      createData.data?.discountAutomaticAppCreate?.userErrors || [];
    if (errors.length > 0) {
      console.warn(
        `[Discount] Failed to create automatic discount for ${shop}:`,
        errors[0]?.message || errors
      );
      return;
    }
    const createdId =
      createData.data?.discountAutomaticAppCreate?.automaticAppDiscount
        ?.discountId;
    if (createdId) {
      console.log(
        `[Discount] Automatic discount created for ${shop}: ${createdId}`
      );
    }
  } catch (err) {
    console.error(
      `[Discount] ensureUpsellAutomaticDiscount failed for ${shop}:`,
      err?.message || err
    );
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(mongoUri, 'ai-upsell'),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await registerOrderStatusScriptTag(admin, session.shop);
      await ensureUpsellAutomaticDiscount(admin, session.shop);
    }
  },
  webhooks: (() => {
    const base = {
      APP_UNINSTALLED: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/app/uninstalled",
      },
      APP_SCOPES_UPDATE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/app/scopes_update",
      },
      PRODUCTS_CREATE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/products/create",
      },
      PRODUCTS_UPDATE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/products/update",
      },
      PRODUCTS_DELETE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/products/delete",
      },
      INVENTORY_LEVELS_UPDATE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/inventory_levels/update",
      },
      CUSTOMERS_DATA_REQUEST: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/compliance",
      },
      CUSTOMERS_REDACT: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/compliance",
      },
      SHOP_REDACT: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/compliance",
      },
    };

    if (enableProtectedOrdersWebhook) {
      base.ORDERS_PAID = {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/webhooks/orders/paid",
      };
    } else {
      console.warn(
        "[Webhooks] Skipping protected webhook ORDERS_PAID (ENABLE_PROTECTED_ORDERS_WEBHOOK != true)"
      );
    }

    return base;
  })(),
  future: {
    expiringOfflineAccessTokens: true,
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
