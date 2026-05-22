/**
 * Rate Limiting Middleware
 * Prevents abuse by limiting requests per user
 */

const rateLimitStore = new Map();

// Configuration
const RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000, // 1 minute window
  maxRequests: 100, // Max 100 requests per window
  skipSuccessfulRequests: false, // Count all requests
};

/**
 * @typedef {Object} RateLimitEntry
 * @property {number} count
 * @property {number} resetTime
 */

/**
 * Check if a request exceeds rate limit
 * @param {string} identifier - Unique identifier (shopId, userId, IP)
 * @returns {boolean} - true if within limit, false if exceeded
 */
export function checkRateLimit(identifier) {
  if (!identifier) {
    return true; // Skip if no identifier
  }

  const now = Date.now();
  const key = `ratelimit:${identifier}`;

  let entry = rateLimitStore.get(key);

  // Initialize or reset if window expired
  if (!entry || now >= entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + RATE_LIMIT_CONFIG.windowMs,
    };
  }

  // Increment counter
  entry.count++;
  rateLimitStore.set(key, entry);

  // Check if exceeded
  const isExceeded = entry.count > RATE_LIMIT_CONFIG.maxRequests;

  // Clean up old entries periodically (every 1000 calls)
  if (Math.random() < 0.001) {
    cleanupOldEntries(now);
  }

  return !isExceeded;
}

/**
 * Get remaining requests for identifier
 * @param {string} identifier
 * @returns {number} - Remaining requests in current window
 */
export function getRateLimitRemaining(identifier) {
  if (!identifier) return RATE_LIMIT_CONFIG.maxRequests;

  const key = `ratelimit:${identifier}`;
  const entry = rateLimitStore.get(key);

  if (!entry || Date.now() >= entry.resetTime) {
    return RATE_LIMIT_CONFIG.maxRequests;
  }

  return Math.max(0, RATE_LIMIT_CONFIG.maxRequests - entry.count);
}

/**
 * Get reset time for identifier
 * @param {string} identifier
 * @returns {number} - Milliseconds until rate limit resets
 */
export function getRateLimitResetTime(identifier) {
  if (!identifier) return 0;

  const key = `ratelimit:${identifier}`;
  const entry = rateLimitStore.get(key);

  if (!entry) return 0;

  const remaining = Math.max(0, entry.resetTime - Date.now());
  return Math.ceil(remaining / 1000); // Return seconds
}

/**
 * Clean up expired rate limit entries
 * @param {number} now - Current timestamp
 */
function cleanupOldEntries(now) {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now >= entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Rate limit loader helper
 * Wrap your loaders with this to enforce rate limits
 */
export function withRateLimit(loader) {
  return async (args) => {
    const { request, params, context } = args;

    // Get shop ID from session
    const { authenticate } = await import("../shopify.server.js");
    const { session } = await authenticate.admin(request);

    const isAllowed = checkRateLimit(session?.shop);

    if (!isAllowed) {
      const resetSeconds = getRateLimitResetTime(session.shop);
      return new Response("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": String(resetSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_CONFIG.maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Date.now() + resetSeconds * 1000),
        },
      });
    }

    // Call original loader
    const response = await loader(args);

    // Add rate limit headers to response
    if (response instanceof Response) {
      const remaining = getRateLimitRemaining(session?.shop);
      response.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_CONFIG.maxRequests));
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-RateLimit-Reset", String(Date.now() + RATE_LIMIT_CONFIG.windowMs));
    }

    return response;
  };
}

/**
 * Rate limit action helper
 * Wrap your actions with this to enforce rate limits
 */
export function withActionRateLimit(action) {
  return async (args) => {
    const { request } = args;

    // Get shop ID from session
    const { authenticate } = await import("../shopify.server.js");
    const { session } = await authenticate.admin(request);

    const isAllowed = checkRateLimit(session?.shop);

    if (!isAllowed) {
      const resetSeconds = getRateLimitResetTime(session.shop);
      return new Response("Too Many Requests", {
        status: 429,
        headers: {
          "Retry-After": String(resetSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_CONFIG.maxRequests),
          "X-RateLimit-Remaining": "0",
        },
      });
    }

    // Call original action
    return action(args);
  };
}

// Reset rate limit for testing
export function resetRateLimitForTesting() {
  rateLimitStore.clear();
}
