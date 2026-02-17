import { json } from "@remix-run/node";

/**
 * Proxy route for /apps/ai-upsell/cart
 * Forwards requests to the cart API endpoint
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  
  // Forward the request to the actual cart API
  const cartUrl = new URL(`${url.origin}/api/proxy/cart`);
  
  // Copy all search parameters
  for (const [key, value] of searchParams.entries()) {
    cartUrl.searchParams.set(key, value);
  }
  
  console.log(`🔄 Proxying cart request to: ${cartUrl.toString()}`);
  
  try {
    const response = await fetch(cartUrl.toString());
    
    if (!response.ok) {
      throw new Error(`Cart API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return json(data, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
    
  } catch (error) {
    console.error("❌ Error proxying cart upsell request:", error);
    return json({
      success: false,
      error: error.message,
      recommendations: []
    }, { 
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      }
    });
  }
};

export const OPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
};