import { json } from "@remix-run/node";

/**
 * Proxy route for /apps/ai-upsell
 * Forwards requests to the appropriate API endpoints
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  
  // Extract product ID from the request
  const productIdParam = searchParams.get("id");
  
  if (!productIdParam) {
    return json({ error: "Product ID is required" }, { status: 400 });
  }
  
  // Extract numeric product ID from gid://shopify/Product/123 format
  const productIdMatch = productIdParam.match(/Product\/(\d+)/);
  if (!productIdMatch) {
    return json({ error: "Invalid product ID format" }, { status: 400 });
  }
  
  const productId = productIdMatch[1];
  const shop = searchParams.get("shop") || "shreyatestdemo.myshopify.com";
  
  console.log(`🔄 Proxying request for product ID: ${productId}`);
  
  try {
    // Forward to the actual API endpoint
    const response = await fetch(`${url.origin}/api/upsell/${productId}?shop=${shop}`);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
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
    console.error("❌ Error proxying upsell request:", error);
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