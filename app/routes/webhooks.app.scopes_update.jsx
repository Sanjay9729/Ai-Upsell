import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`✅ Received ${topic} webhook for ${shop}`);

  // MongoDB session storage automatically handles scope updates
  // No manual update needed as the Shopify SDK manages this

  return new Response();
};
