import { getDb } from '../database/connection.js';

// Simple in-memory cache with TTL for recommendations
const recommendationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(type, shopId, productId, userId) {
  return `${type}:${shopId}:${productId}:${userId || 'anon'}`;
}

function getFromCache(key) {
  const entry = recommendationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    recommendationCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  // Prevent unbounded growth — evict oldest entries if cache exceeds 500
  if (recommendationCache.size > 500) {
    const firstKey = recommendationCache.keys().next().value;
    recommendationCache.delete(firstKey);
  }
  recommendationCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Clear the cached recommendation for a specific user+product.
 * Called after new time-tracking data is saved so the next visit
 * gets a fresh, profile-aware Groq call instead of a stale cache hit.
 */
export function clearUserProductCache(shopId, productId, userId) {
  const key = getCacheKey('product', shopId, String(productId), userId);
  const deleted = recommendationCache.delete(key);
  if (deleted) {
    console.log(`🗑️ Cache invalidated for userId=${userId} product=${productId}`);
  }
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','with','in','for','of','to','at','by','from',
  'is','its','it','this','that','on','as','be','my','our','your'
]);

/**
 * Extract meaningful type tokens from a product title.
 * e.g. "7 Shakra Bracelet" → ["shakra", "bracelet"]
 */
function getTitleTokens(title) {
  if (!title) return [];
  return title.toLowerCase()
    .split(/[\s\-_/]+/)
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Score a candidate by how many tokens from sourceTitleTokens appear in its title.
 * Higher score = more likely same product type.
 */
function computeTypeScore(sourceTitleTokens, candidateTitle) {
  const lower = candidateTitle.toLowerCase();
  return sourceTitleTokens.filter(t => lower.includes(t)).length;
}


/**
 * AI Engine powered by Groq LLM for intelligent upsell recommendations
 * Uses Groq's fast inference for real-time product suggestions
 */
export class GroqAIEngine {
  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    // Use llama-3.1-70b-versatile or llama-3.3-70b-versatile for better compatibility
    this.groqModel = 'llama-3.3-70b-versatile';
    this.groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
  }

  /**
   * Find upsell products using Groq LLM intelligence
   * Implements Steps 3-4 of the AI Upsell Flow
   */
  async findUpsellProducts(shopId, currentProductId, limit = 4, userId = null) {
    try {
      console.log(`🤖 Starting Groq AI analysis for product ${currentProductId} (userId: ${userId || 'anonymous'})`);

      // Check cache first (per-user cache key)
      const cacheKey = getCacheKey('product', shopId, currentProductId, userId);
      const cached = getFromCache(cacheKey);
      if (cached) {
        console.log(`⚡ Cache hit for product ${currentProductId}`);
        return cached;
      }

      // Fetch current product, all shop products, user interest profile, and cart history in parallel
      const [currentProduct, allProducts, userProfile, rawCartHistory] = await Promise.all([
        this.getProductById(shopId, currentProductId),
        this.getProductsByShop(shopId),
        this.getUserInterestProfile(userId, shopId),
        this.getUserCartHistory(userId, shopId)
      ]);

      if (!currentProduct) {
        throw new Error('Current product not found');
      }

      const otherProducts = allProducts.filter(p => String(p.productId) !== String(currentProductId));

      if (otherProducts.length === 0) {
        return [];
      }

      // Enrich cart history with product titles from allProducts
      const allProductsMap = new Map(allProducts.map(p => [String(p.productId), p]));
      const cartHistory = rawCartHistory
        .map(ch => {
          const product = allProductsMap.get(ch.productId);
          return product ? { ...ch, productTitle: product.title } : null;
        })
        .filter(Boolean);

      if (userProfile.length > 0) {
        console.log(`👤 User profile loaded: ${userProfile.map(p => `${p.productTitle}(${p.totalTimeSeconds}s)`).join(', ')}`);
      }
      if (cartHistory.length > 0) {
        console.log(`🛒 Cart history loaded: ${cartHistory.map(c => `${c.productTitle}(x${c.count})`).join(', ')}`);
      }

      const historyCandidates = this.buildHistoryCandidates(
        allProducts,
        userProfile,
        cartHistory,
        new Set([String(currentProductId)])
      );

      let recommendations;
      try {
        recommendations = await this.analyzeWithGroq(currentProduct, otherProducts, limit, userProfile, cartHistory);
        if (!recommendations || recommendations.length === 0) {
          console.warn(`⚠️ No AI recommendations for product ${currentProductId}; using fallback`);
          recommendations = await this.fallbackRecommendations(shopId, currentProductId, limit);
        }
      } catch (groqError) {
        console.warn(`⚠️ Groq failed for product ${currentProductId}; using fallback`, groqError?.message || groqError);
        recommendations = await this.fallbackRecommendations(shopId, currentProductId, limit);
      }

      const merged = this.mergeHistoryWithRecommendations(recommendations, historyCandidates, limit);

      // Apply engagement boost: re-rank by confidence + time-spent signal
      const boostMap = await this.getEngagementBoosts(shopId, merged.map(r => r.productId));
      const boosted = this.applyEngagementBoosts([...merged], boostMap);

      // Attach source product info so callers don't need to re-fetch
      boosted._sourceProduct = currentProduct;

      console.log(`✅ Groq AI found ${boosted.length} upsell recommendations (personalized for userId: ${userId || 'anonymous'})`);

      // Cache the result
      setCache(cacheKey, boosted);

      return boosted;

    } catch (error) {
      console.error('❌ Groq AI Engine error:', error);
      // Fallback to rule-based system if Groq fails
      return this.fallbackRecommendations(shopId, currentProductId, limit);
    }
  }

  /**
   * Find cart-based upsell products using Groq LLM intelligence
   * Analyzes multiple products in cart to suggest complementary items
   */
  async findCartUpsellProducts(shopId, cartProductIds, limit = 4, userId = null) {
    try {
      console.log(`🛒 Starting Groq AI analysis for ${cartProductIds.length} cart products`);

      // Check cache (sort IDs for consistent key, include userId for per-user caching)
      const sortedIds = [...cartProductIds].sort().join(',');
      const cacheKey = getCacheKey('cart', shopId, `${sortedIds}:${userId || 'anon'}`);
      const cached = getFromCache(cacheKey);
      if (cached) {
        console.log(`⚡ Cache hit for cart [${sortedIds}] userId=${userId || 'anon'}`);
        return cached;
      }

      // Fetch all products, user profile, and cart history in parallel
      const [allProducts, userProfile, rawCartHistory] = await Promise.all([
        this.getProductsByShop(shopId),
        this.getUserInterestProfile(userId, shopId),
        this.getUserCartHistory(userId, shopId)
      ]);

      if (userProfile.length > 0) {
        console.log(`👤 Cart upsell: user profile loaded (${userProfile.length} products) for userId=${userId}`);
      }

      const cartProductIdSet = new Set(cartProductIds.map(String));
      const validCartProducts = allProducts.filter(p => cartProductIdSet.has(String(p.productId)));
      const otherProducts = allProducts.filter(p => !cartProductIdSet.has(String(p.productId)));

      // Enrich cart history with product titles, exclude products already in current cart
      const allProductsMap = new Map(allProducts.map(p => [String(p.productId), p]));
      const cartHistory = rawCartHistory
        .filter(ch => !cartProductIdSet.has(ch.productId))
        .map(ch => {
          const product = allProductsMap.get(ch.productId);
          return product ? { ...ch, productTitle: product.title } : null;
        })
        .filter(Boolean);

      if (cartHistory.length > 0) {
        console.log(`🛒 Cart history loaded: ${cartHistory.map(c => `${c.productTitle}(x${c.count})`).join(', ')}`);
      }

      if (validCartProducts.length === 0) {
        throw new Error('No valid cart products found');
      }

      if (otherProducts.length === 0) {
        return [];
      }

      const historyCandidates = this.buildHistoryCandidates(
        allProducts,
        userProfile,
        cartHistory,
        new Set(cartProductIds.map(String))
      );

      let recommendations;
      try {
        recommendations = await this.analyzeCartWithGroq(validCartProducts, otherProducts, limit, userProfile, cartHistory);
        if (!recommendations || recommendations.length === 0) {
          console.warn(`⚠️ No AI cart recommendations; using fallback`);
          recommendations = await this.fallbackCartRecommendations(shopId, cartProductIds, limit);
        }
      } catch (groqError) {
        console.warn(`⚠️ Groq failed for cart; using fallback`, groqError?.message || groqError);
        recommendations = await this.fallbackCartRecommendations(shopId, cartProductIds, limit);
      }

      const merged = this.mergeHistoryWithRecommendations(recommendations, historyCandidates, limit);

      // Apply engagement boost: re-rank by confidence + time-spent signal
      const boostMap = await this.getEngagementBoosts(shopId, merged.map(r => r.productId));
      const boosted = this.applyEngagementBoosts([...merged], boostMap);

      // Attach cart product info so callers don't need to re-fetch
      boosted._cartProducts = validCartProducts;

      console.log(`✅ Groq AI found ${boosted.length} cart upsell recommendations (engagement boost applied)`);

      // Cache the result
      setCache(cacheKey, boosted);

      return boosted;

    } catch (error) {
      console.error('❌ Groq AI Engine error for cart:', error);
      // Fallback to rule-based system if Groq fails
      return this.fallbackCartRecommendations(shopId, cartProductIds, limit);
    }
  }

  /**
   * Analyze products using Groq LLM
   */
  async analyzeWithGroq(currentProduct, candidateProducts, limit, userProfile = [], cartHistory = []) {
    try {
      // Validate API key
      if (!this.groqApiKey) {
        throw new Error('GROQ_API_KEY is not configured in environment variables');
      }

      // Pre-score candidates by title-word overlap with current product
      const currentTokens = getTitleTokens(currentProduct.title);
      const productData = candidateProducts.map(product => ({
        id: product.productId,
        title: product.title,
        category: product.aiData?.category || '',
        brand: product.aiData?.brand || '',
        price: product.aiData?.price || '0',
        keywords: product.aiData?.keywords || [],
        features: product.aiData?.features || [],
        sameType: computeTypeScore(currentTokens, product.title) > 0
      }));

      // Sort: same-type candidates first, then others
      productData.sort((a, b) => (b.sameType ? 1 : 0) - (a.sameType ? 1 : 0));

      const prompt = this.buildAnalysisPrompt(currentProduct, productData, limit, userProfile, cartHistory);

      console.log(`🤖 Calling Groq API with model: ${this.groqModel}`);

      const response = await fetch(this.groqUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.groqModel,
          messages: [
            {
              role: 'system',
              content: 'You are an AI shopping assistant specialized in product recommendations. Analyze products and provide intelligent upsell suggestions.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3, // Lower temperature for more consistent recommendations
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ Groq API Response:', errorBody);
        throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const data = await response.json();
      const aiResponse = data.choices[0]?.message?.content;

      if (!aiResponse) {
        console.error('❌ No AI response in data:', JSON.stringify(data));
        throw new Error('No AI response received from Groq');
      }
      
      const results = this.parseGroqRecommendations(aiResponse, candidateProducts);

      // Post-filter: when user has a profile, Groq intentionally picks cross-type products
      // (interest-based slots), so allow all results through.
      // When no profile, enforce same-type matching to prevent irrelevant suggestions.
      let base;
      if (userProfile.length > 0) {
        base = results;
        console.log(`🔍 Personalized mode: keeping all ${results.length} Groq results (cross-type allowed)`);
      } else {
        const filtered = results.filter(p => computeTypeScore(currentTokens, p.title) > 0);
        console.log(`🔍 Post-filter: ${results.length} → ${filtered.length} same-type results`);
        base = filtered.length > 0 ? filtered : results;
      }

      if (base.length >= limit) return base.slice(0, limit);

      // Pad to reach limit: first with same-type DB candidates, then any DB candidate
      const usedIds = new Set(base.map(p => String(p.productId)));
      const combined = [...base, ...results.filter(p => !usedIds.has(String(p.productId)))];

      if (combined.length < limit) {
        const combinedIds = new Set(combined.map(p => String(p.productId)));
        const dbSameType = candidateProducts
          .filter(p => !combinedIds.has(String(p.productId)) && computeTypeScore(currentTokens, p.title) > 0)
          .slice(0, limit - combined.length)
          .map(p => ({ ...p, aiReason: 'Similar product you might like', confidence: 0.65, recommendationType: 'similar' }));
        combined.push(...dbSameType);
      }

      if (combined.length < limit) {
        const combinedIds = new Set(combined.map(p => String(p.productId)));
        const dbAny = candidateProducts
          .filter(p => !combinedIds.has(String(p.productId)))
          .slice(0, limit - combined.length)
          .map(p => ({ ...p, aiReason: 'You might also like', confidence: 0.5, recommendationType: 'similar' }));
        combined.push(...dbAny);
      }

      console.log(`🔍 Product final: ${Math.min(combined.length, limit)} results`);
      return combined.slice(0, limit);

    } catch (error) {
      console.error('❌ Groq analysis error:', error);
      throw error;
    }
  }

  /**
   * Analyze cart products using Groq LLM for cart-based recommendations
   */
  async analyzeCartWithGroq(cartProducts, candidateProducts, limit, userProfile = [], cartHistory = []) {
    try {
      // Validate API key
      if (!this.groqApiKey) {
        throw new Error('GROQ_API_KEY is not configured in environment variables');
      }

      // Pre-score candidates by title-word overlap with cart products
      const cartTokens = [...new Set(cartProducts.flatMap(p => getTitleTokens(p.title)))];
      const productData = candidateProducts.map(product => ({
        id: product.productId,
        title: product.title,
        category: product.aiData?.category || '',
        brand: product.aiData?.brand || '',
        price: product.aiData?.price || '0',
        keywords: product.aiData?.keywords || [],
        features: product.aiData?.features || [],
        sameType: computeTypeScore(cartTokens, product.title) > 0
      }));

      // Sort: same-type candidates first, then others
      productData.sort((a, b) => (b.sameType ? 1 : 0) - (a.sameType ? 1 : 0));

      const prompt = this.buildCartAnalysisPrompt(cartProducts, productData, limit, userProfile, cartHistory);

      console.log(`🤖 Calling Groq API for cart analysis with model: ${this.groqModel}`);

      const response = await fetch(this.groqUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.groqModel,
          messages: [
            {
              role: 'system',
              content: 'You are an AI shopping assistant specialized in cart-based product recommendations. Analyze cart contents and provide intelligent cross-sell and upsell suggestions.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ Groq API Response:', errorBody);
        throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const aiResponse = data.choices[0]?.message?.content;

      if (!aiResponse) {
        throw new Error('No AI response received from Groq');
      }

      const results = this.parseGroqRecommendations(aiResponse, candidateProducts);

      // When user profile exists, trust Groq's personalized picks (cross-type allowed)
      // When no profile, keep same-type filter to ensure cart-relevant results
      const filtered = userProfile.length > 0
        ? results
        : results.filter(p => computeTypeScore(cartTokens, p.title) > 0);
      console.log(`🔍 Cart post-filter: ${results.length} → ${filtered.length} same-type results`);

      if (filtered.length >= limit) return filtered.slice(0, limit);

      // Pad: first with other AI results, then same-type DB candidates, then any DB candidate
      const usedIds = new Set(filtered.map(p => String(p.productId)));
      const combined = [...filtered, ...results.filter(p => !usedIds.has(String(p.productId)))];

      if (combined.length < limit) {
        const combinedIds = new Set(combined.map(p => String(p.productId)));
        const dbSameType = candidateProducts
          .filter(p => !combinedIds.has(String(p.productId)) && computeTypeScore(cartTokens, p.title) > 0)
          .slice(0, limit - combined.length)
          .map(p => ({ ...p, aiReason: 'Related to your cart items', confidence: 0.65, recommendationType: 'similar' }));
        combined.push(...dbSameType);
      }

      if (combined.length < limit) {
        const combinedIds = new Set(combined.map(p => String(p.productId)));
        const dbAny = candidateProducts
          .filter(p => !combinedIds.has(String(p.productId)))
          .slice(0, limit - combined.length)
          .map(p => ({ ...p, aiReason: 'You might also like', confidence: 0.5, recommendationType: 'similar' }));
        combined.push(...dbAny);
      }

      console.log(`🔍 Cart final: ${Math.min(combined.length, limit)} results`);
      return combined.slice(0, limit);

    } catch (error) {
      console.error('❌ Groq cart analysis error:', error);
      throw error;
    }
  }

  /**
   * Build comprehensive prompt for Groq analysis
   */
  buildAnalysisPrompt(currentProduct, candidateProducts, limit, userProfile = [], cartHistory = []) {
    const currentData = {
      title: currentProduct.title,
      category: currentProduct.aiData?.category || '',
      brand: currentProduct.aiData?.brand || '',
      price: currentProduct.aiData?.price || '0',
      keywords: currentProduct.aiData?.keywords || [],
      features: currentProduct.aiData?.features || []
    };

    // When the user has a browsing history or cart history, use a personalized split-slot prompt
    if (userProfile.length > 0 || cartHistory.length > 0) {
      const sameTypeSlots = Math.ceil(limit / 2);
      const interestSlots = Math.floor(limit / 2);

      const browsingSection = userProfile.length > 0
        ? `CUSTOMER BROWSING HISTORY (products they spent time on):\n` +
          userProfile.map((p, i) => {
            const mins = Math.floor(p.totalTimeSeconds / 60);
            const secs = p.totalTimeSeconds % 60;
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${p.totalTimeSeconds}s`;
            return `${i + 1}. ${p.productTitle || `Product ${p.productId}`} (${timeStr})`;
          }).join('\n')
        : '';

      const cartSection = cartHistory.length > 0
        ? `PREVIOUSLY IN CART (products this customer added to cart before):\n` +
          cartHistory.map((c, i) => `${i + 1}. ${c.productTitle} (added ${c.count}x)`).join('\n')
        : '';

      const interestContext = [browsingSection, cartSection].filter(Boolean).join('\n\n');

      return `
You are recommending upsell products for a customer based on their current product AND interest profile.

${interestContext}

CURRENT PRODUCT (what they are viewing now):
- Title: ${currentData.title}
- Category: ${currentData.category}
- Brand: ${currentData.brand}
- Price: $${currentData.price}

TASK: Select exactly ${limit} upsell products using this split:
- ${sameTypeSlots} products of the SAME TYPE as "${currentData.title}" (labeled [SAME TYPE] below)
- ${interestSlots} products that relate to or complement the customer's browsing history and cart history above

If you cannot find enough products for one group, fill all ${limit} slots from the other group.

CANDIDATE PRODUCTS:
${candidateProducts.map((p, i) => `
${i + 1}. ProductID: ${p.id} ${p.sameType ? '[SAME TYPE]' : '[DIFFERENT TYPE]'}
   Title: ${p.title}
   Category: ${p.category || 'N/A'}
   Brand: ${p.brand || 'N/A'}
   Price: $${p.price}
`).join('\n')}

CRITICAL INSTRUCTIONS:
1. You MUST use the EXACT ProductID numbers shown above (they are large numbers like 7708018999350)
2. The productId field MUST be a NUMBER, not a string or undefined
3. Do NOT make up product IDs - only use IDs from the list above
4. Return exactly ${limit} products total

Return ONLY a valid JSON array in this EXACT format:
[
  {
    "productId": 7708018999350,
    "reason": "Brief explanation why this is recommended",
    "confidence": 0.85,
    "recommendationType": "similar"
  }
]

Valid recommendationType values: "complementary", "similar", "upgrade", "bundle"
Return ONLY the JSON array, nothing else. Do not include any text before or after the JSON.
`;
    }

    // No user profile — use strict same-type focused prompt
    return `
You are recommending upsell products for the current product below.

CURRENT PRODUCT:
- Title: ${currentData.title}
- Category: ${currentData.category}
- Brand: ${currentData.brand}
- Price: $${currentData.price}
- Keywords: ${currentData.keywords.join(', ')}
- Features: ${currentData.features.join(', ')}

STEP 1 — Identify the specific product type:
Look at the current product's title and determine its exact type (e.g., "Bangle Bracelet" → type is "bracelet", "Leather Wallet" → type is "wallet", "Running Shoes" → type is "shoes"). Use the title, not the category field, since category may be generic.

STEP 2 — Select candidates of the SAME type:
From the candidate list below, select ONLY products whose title contains the SAME specific product type you identified in Step 1. For example, if the type is "bracelet", only pick other bracelets (gold bracelet, silver bracelet, leather bracelet, etc.). Do NOT pick necklaces, rings, chokers, or any other type.

STEP 3 — If fewer than ${limit} same-type products exist:
Fill remaining slots with products from the same broad category. If still not enough, fill with any available products.

CANDIDATE PRODUCTS - labeled [SAME TYPE] or [DIFFERENT TYPE] based on title similarity:
${candidateProducts.map((p, i) => `
${i + 1}. ProductID: ${p.id} ${p.sameType ? '[SAME TYPE]' : '[DIFFERENT TYPE]'}
   Title: ${p.title}
   Category: ${p.category || 'N/A'}
   Brand: ${p.brand || 'N/A'}
   Price: $${p.price}
`).join('\n')}

CRITICAL INSTRUCTIONS:
1. You MUST use the EXACT ProductID numbers shown above (they are large numbers like 7708018999350)
2. The productId field MUST be a NUMBER, not a string or undefined
3. Prefer [SAME TYPE] products. If not enough, use same-category products, then any available products to reach exactly ${limit}
4. Do NOT make up product IDs - only use IDs from the list above

Return ONLY a valid JSON array in this EXACT format (productId must be a NUMBER):
[
  {
    "productId": 7708018999350,
    "reason": "Brief explanation why this is recommended",
    "confidence": 0.85,
    "recommendationType": "similar"
  }
]

Valid recommendationType values: "complementary", "similar", "upgrade", "bundle"
Return ONLY the JSON array, nothing else. Do not include any text before or after the JSON.
`;
  }

  /**
   * Build comprehensive prompt for cart-based Groq analysis
   */
  buildCartAnalysisPrompt(cartProducts, candidateProducts, limit, userProfile = [], cartHistory = []) {
    const cartData = cartProducts.map(product => ({
      title: product.title,
      category: product.aiData?.category || '',
      brand: product.aiData?.brand || '',
      price: product.aiData?.price || '0',
      keywords: product.aiData?.keywords || [],
      features: product.aiData?.features || []
    }));

    const hasProfile = userProfile.length > 0 || cartHistory.length > 0;

    let profileSection = '';
    if (userProfile.length > 0) {
      profileSection += `\nUSER BROWSING HISTORY (products this customer previously viewed by time spent):\n` +
        userProfile.map((p, i) => `${i + 1}. ${p.productTitle || p.productId} (${p.totalTimeSeconds}s)`).join('\n') + '\n';
    }
    if (cartHistory.length > 0) {
      profileSection += `\nPREVIOUSLY IN CART (products this customer added to cart in past sessions):\n` +
        cartHistory.map((c, i) => `${i + 1}. ${c.productTitle} (added ${c.count}x)`).join('\n') + '\n';
    }
    if (profileSection) {
      profileSection += `Use both signals to further personalize suggestions alongside the current cart contents.\n`;
    }

    const sameTypeSlots = Math.ceil(limit / 2);
    const interestSlots = Math.floor(limit / 2);

    const taskSection = hasProfile
      ? `TASK: Select exactly ${limit} upsell products using this split:\n` +
        `- ${sameTypeSlots} products that complement or match the CART CONTENTS above\n` +
        `- ${interestSlots} products that relate to the customer's BROWSING HISTORY and PAST CART HISTORY above\n` +
        `If interest signals overlap with cart types, still fill all ${limit} slots with the best complementary picks.`
      : `STEP 1 — Identify ALL distinct product types in the cart:\n` +
        `Look at each cart item's title and identify its specific type (e.g., "Bangle Bracelet" → "bracelet", "Guardian Angel Earrings" → "earrings", "Stackable Ring" → "ring"). List every distinct type.\n\n` +
        `STEP 2 — Distribute ${limit} recommendations across all cart item types:\n` +
        `Pick recommendations proportionally for EACH type found in Step 1. Examples:\n` +
        `- Cart has 1 bracelet + 1 earring → pick 2 bracelet + 2 earring recommendations\n` +
        `- Cart has 1 ring + 1 bracelet + 1 earring → pick at least 1 per type, fill remainder with any\n` +
        `Prioritize [SAME TYPE] candidates for each type.\n\n` +
        `STEP 3 — Always reach exactly ${limit} total:\n` +
        `If a type has no matching candidates, fill remaining slots with [SAME TYPE] products from other cart types, then any available product. NEVER return fewer than ${limit}.`;

    return `
You are recommending upsell products based on the customer's cart contents.

CART CONTENTS (${cartProducts.length} items):
${cartData.map((p, i) => `
${i + 1}. ${p.title}
   - Category: ${p.category}
   - Brand: ${p.brand}
   - Price: $${p.price}
   - Keywords: ${p.keywords.join(', ')}
`).join('\n')}
${profileSection}
${taskSection}

CANDIDATE PRODUCTS - labeled [SAME TYPE] or [DIFFERENT TYPE] based on title similarity to cart items:
${candidateProducts.map((p, i) => `
${i + 1}. ProductID: ${p.id} ${p.sameType ? '[SAME TYPE]' : '[DIFFERENT TYPE]'}
   Title: ${p.title}
   Category: ${p.category || 'N/A'}
   Brand: ${p.brand || 'N/A'}
   Price: $${p.price}
`).join('\n')}

CRITICAL INSTRUCTIONS:
1. You MUST use the EXACT ProductID numbers shown above
2. The productId field MUST be a NUMBER, not a string
3. Prefer products matching the cart types and browsing history. Fill remaining slots with any available product if needed.
4. Do NOT make up product IDs - only use IDs from the list above
5. ALWAYS return exactly ${limit} products — never fewer

Return ONLY a valid JSON array in this EXACT format (productId must be a NUMBER):
[
  {
    "productId": 7708018999350,
    "reason": "Brief explanation why this complements the cart",
    "confidence": 0.85,
    "recommendationType": "similar"
  }
]

Valid recommendationType values: "complementary", "similar", "upgrade", "bundle"
Return ONLY the JSON array, nothing else. Do not include any text before or after the JSON.
`;
  }

  /**
   * Parse Groq's AI recommendations
   */
  parseGroqRecommendations(aiResponse, candidateProducts) {
    try {
      console.log('🔍 AI Response to parse:', aiResponse.substring(0, 500));

      // Extract JSON from AI response
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('❌ No JSON found in AI response. Full response:', aiResponse);
        throw new Error('No JSON found in AI response');
      }

      console.log('📝 Extracted JSON:', jsonMatch[0].substring(0, 300));
      const recommendations = JSON.parse(jsonMatch[0]);

      console.log(`✅ Parsed ${recommendations.length} recommendations from AI`);

      // Map back to actual product objects
      return recommendations.map(rec => {
        // Try to match by converting both to same type
        const product = candidateProducts.find(p =>
          String(p.productId) === String(rec.productId) ||
          p.productId === rec.productId
        );
        if (!product) {
          console.warn(`⚠️ Product ${rec.productId} not found in candidates`);
          return null;
        }
        
        return {
          ...product,
          aiReason: rec.reason,
          confidence: rec.confidence,
          recommendationType: rec.recommendationType
        };
      }).filter(Boolean);

    } catch (error) {
      console.error('❌ Error parsing Groq recommendations:', error);
      throw error;
    }
  }

  /**
   * Fallback to rule-based system if Groq fails
   */
  async fallbackRecommendations(shopId, currentProductId, limit) {
    console.log('🔄 Using fallback rule-based recommendations');

    // Simple rule-based similarity (your original implementation)
    const db = await getDb();
    const productsCollection = db.collection('products');

    const currentProduct = await productsCollection.findOne({ shopId, productId: currentProductId });

    if (!currentProduct) {
      console.log('⚠️ Current product not found in fallback, returning random products');
      const randomProducts = await productsCollection.find({ shopId }).limit(limit).toArray();
      return randomProducts.map(product => ({
        ...product,
        aiReason: 'You might also like this product',
        confidence: 0.5,
        recommendationType: 'similar'
      }));
    }

    const allProducts = await productsCollection.find({ shopId }).toArray();
    const otherProducts = allProducts.filter(p => String(p.productId) !== String(currentProductId));

    // Calculate similarity scores
    const productsWithScores = otherProducts.map(product => ({
      ...product,
      similarityScore: this.calculateSimilarity(currentProduct, product)
    })).sort((a, b) => b.similarityScore - a.similarityScore);

    return productsWithScores.slice(0, limit).map(product => ({
      ...product,
      aiReason: 'Recommended based on product similarity',
      confidence: product.similarityScore / 100,
      recommendationType: 'similar'
    }));
  }

  /**
   * Fallback to rule-based system for cart recommendations if Groq fails
   */
  async fallbackCartRecommendations(shopId, cartProductIds, limit) {
    console.log('🔄 Using fallback rule-based cart recommendations');

    const db = await getDb();
    const productsCollection = db.collection('products');

    // Get cart products
    const cartProducts = await productsCollection.find({
      shopId,
      productId: { $in: cartProductIds }
    }).toArray();

    if (cartProducts.length === 0) {
      console.log('⚠️ No cart products found in fallback, returning random products');
      const randomProducts = await productsCollection.find({ shopId }).limit(limit).toArray();
      return randomProducts.map(product => ({
        ...product,
        aiReason: 'You might also like this product',
        confidence: 0.5,
        recommendationType: 'complementary'
      }));
    }

    // Get all products except those in cart
    const allProducts = await productsCollection.find({ shopId }).toArray();
    const otherProducts = allProducts.filter(p => !cartProductIds.includes(p.productId));

    // Calculate aggregate similarity scores across all cart items
    const productsWithScores = otherProducts.map(product => {
      // Calculate average similarity across all cart products
      const totalScore = cartProducts.reduce((sum, cartProduct) => {
        return sum + this.calculateSimilarity(cartProduct, product);
      }, 0);
      const averageScore = totalScore / cartProducts.length;

      return {
        ...product,
        similarityScore: averageScore
      };
    }).sort((a, b) => b.similarityScore - a.similarityScore);

    return productsWithScores.slice(0, limit).map(product => ({
      ...product,
      aiReason: 'Complements your cart items',
      confidence: Math.min(product.similarityScore / 100, 0.9),
      recommendationType: 'complementary'
    }));
  }

  /**
   * Calculate similarity score (fallback method)
   */
  calculateSimilarity(product1, product2) {
    // Handle null products
    if (!product1 || !product2) return 0;

    let score = 0;

    // Category similarity
    if (product1.aiData?.category && product2.aiData?.category) {
      if (product1.aiData.category === product2.aiData.category) score += 40;
    }

    // Brand similarity
    if (product1.aiData?.brand && product2.aiData?.brand) {
      if (product1.aiData.brand === product2.aiData.brand) score += 25;
    }

    // Color similarity
    if (product1.aiData?.color && product2.aiData?.color) {
      if (product1.aiData.color === product2.aiData.color) score += 15;
    }

    // Keyword overlap
    const keywords1 = product1.aiData?.keywords || [];
    const keywords2 = product2.aiData?.keywords || [];
    const overlap = keywords1.filter(k => keywords2.includes(k)).length;
    score += Math.min(overlap * 5, 20);

    return score;
  }

  /**
   * Get product by ID from MongoDB
   */
  async getProductById(shopId, productId) {
    const db = await getDb();
    const productsCollection = db.collection('products');
    return await productsCollection.findOne({ shopId, productId });
  }

  /**
   * Get all products for a shop
   */
  async getProductsByShop(shopId) {
    const db = await getDb();
    const productsCollection = db.collection('products');
    return await productsCollection.find({ shopId }).toArray();
  }

  /**
   * Build a per-user interest profile from their time-tracking history.
   * Returns top 5 products this specific user spent the most time on (last 30 days).
   */
  async getUserInterestProfile(userId, shopId) {
    if (!userId) return [];
    try {
      const db = await getDb();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await db.collection('product_time_events')
        .aggregate([
          { $match: { userId, shop: shopId, recordedAt: { $gte: thirtyDaysAgo } } },
          {
            $group: {
              _id: '$productId',
              productTitle: { $first: '$productTitle' },
              totalTimeSeconds: { $sum: '$timeSpentSeconds' }
            }
          },
          { $sort: { totalTimeSeconds: -1 } },
          { $limit: 5 }
        ])
        .toArray();

      return rows.map(r => ({
        productId: r._id,
        productTitle: r.productTitle,
        totalTimeSeconds: r.totalTimeSeconds
      }));
    } catch (err) {
      console.warn('⚠️ getUserInterestProfile failed (non-critical):', err.message);
      return [];
    }
  }

  /**
   * Build a per-user cart history profile from past cart sessions.
   * Returns top products this user most frequently had in their cart (last 30 days).
   */
  async getUserCartHistory(userId, shopId) {
    if (!userId) return [];
    try {
      const db = await getDb();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await db.collection('cart_time_events')
        .aggregate([
          { $match: { userId, shop: shopId, cartProductIds: { $exists: true, $ne: [] }, recordedAt: { $gte: thirtyDaysAgo } } },
          { $unwind: '$cartProductIds' },
          { $group: { _id: '$cartProductIds', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 }
        ])
        .toArray();

      return rows.map(r => ({ productId: String(r._id), count: r.count }));
    } catch (err) {
      console.warn('⚠️ getUserCartHistory failed (non-critical):', err.message);
      return [];
    }
  }

  /**
   * Build history-based candidate products from time and cart history.
   * Ensures we can deterministically include history items in the final list.
   */
  buildHistoryCandidates(allProducts, userProfile = [], cartHistory = [], excludeIds = new Set()) {
    const productMap = new Map(allProducts.map(p => [String(p.productId), p]));
    const excludeSet = excludeIds instanceof Set
      ? excludeIds
      : new Set(Array.from(excludeIds || []).map(String));

    const timeItems = [];
    for (const p of userProfile || []) {
      const pid = String(p.productId);
      if (excludeSet.has(pid)) continue;
      const product = productMap.get(pid);
      if (!product) continue;
      timeItems.push({
        ...product,
        aiReason: "Based on your browsing history",
        confidence: 0.6,
        recommendationType: "complementary",
        historySource: "time",
        historyScore: p.totalTimeSeconds || 0
      });
    }
    timeItems.sort((a, b) => (b.historyScore || 0) - (a.historyScore || 0));

    const cartItems = [];
    for (const c of cartHistory || []) {
      const pid = String(c.productId);
      if (excludeSet.has(pid)) continue;
      const product = productMap.get(pid);
      if (!product) continue;
      cartItems.push({
        ...product,
        aiReason: "Based on your past cart activity",
        confidence: 0.62,
        recommendationType: "complementary",
        historySource: "cart",
        historyScore: c.count || 0
      });
    }
    cartItems.sort((a, b) => (b.historyScore || 0) - (a.historyScore || 0));

    const combined = [...timeItems, ...cartItems];
    combined.sort((a, b) => (b.historyScore || 0) - (a.historyScore || 0));

    return { time: timeItems, cart: cartItems, all: combined };
  }

  /**
   * Merge AI recommendations with history candidates to guarantee history coverage.
   */
  mergeHistoryWithRecommendations(recommendations, historyCandidates, limit) {
    const safeRecs = Array.isArray(recommendations) ? recommendations : [];
    const history = historyCandidates || { time: [], cart: [], all: [] };
    const final = [];
    const added = new Set();

    const add = (rec) => {
      if (!rec) return;
      const id = String(rec.productId);
      if (!id || added.has(id)) return;
      added.add(id);
      final.push(rec);
    };

    // Ensure at least one from time history and one from cart history (when available)
    const required = [];
    if (history.time?.length > 0) required.push(history.time[0]);
    if (history.cart?.length > 0) required.push(history.cart[0]);

    for (const rec of required) {
      if (final.length >= limit) break;
      add(rec);
    }

    // Aim to dedicate up to half of slots to history, without exceeding limit
    const targetHistoryCount = Math.min(limit, Math.max(final.length, Math.floor(limit / 2)));
    const historyPool = (history.all || []).filter(h => !added.has(String(h.productId)));
    for (const rec of historyPool) {
      if (final.length >= targetHistoryCount) break;
      add(rec);
    }

    // Fill the rest with AI recommendations
    for (const rec of safeRecs) {
      if (final.length >= limit) break;
      add(rec);
    }

    // If still short, fill with remaining history
    for (const rec of historyPool) {
      if (final.length >= limit) break;
      add(rec);
    }

    return final.slice(0, limit);
  }

  /**
   * Fetch per-product engagement bonuses from time-tracking data.
   * Returns a map: { productId (string) → bonus (0.0 – 0.15) }
   *
   * Logic:
   *   bonus = (min(avgTimeSeconds, 300) / 300) * 0.15
   *   Only applied when a product has ≥ 2 tracked sessions (avoids noise).
   */
  async getEngagementBoosts(shopId, productIds) {
    try {
      const db = await getDb();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const pidStrings = productIds.map(String);

      const rows = await db.collection('product_time_events')
        .aggregate([
          {
            $match: {
              shop: shopId,
              productId: { $in: pidStrings },
              recordedAt: { $gte: thirtyDaysAgo }
            }
          },
          {
            $group: {
              _id: '$productId',
              avgTimeSeconds: { $avg: '$timeSpentSeconds' },
              sessions: { $sum: 1 }
            }
          }
        ])
        .toArray();

      const MAX_BOOST = 0.15;   // max +15% confidence
      const CAP_SECONDS = 300;  // 5 minutes = full boost
      const MIN_SESSIONS = 2;   // need ≥ 2 sessions to be statistically useful

      const boostMap = {};
      for (const row of rows) {
        if (row.sessions < MIN_SESSIONS) continue;
        const bonus = (Math.min(row.avgTimeSeconds, CAP_SECONDS) / CAP_SECONDS) * MAX_BOOST;
        boostMap[row._id] = parseFloat(bonus.toFixed(4));
      }

      console.log(`⚡ Engagement boosts loaded for ${Object.keys(boostMap).length}/${pidStrings.length} products`);
      return boostMap;
    } catch (err) {
      // Non-critical — if this fails, recommendations still work (just without the boost)
      console.warn('⚠️ Engagement boost fetch failed (non-critical):', err.message);
      return {};
    }
  }

  /**
   * Apply engagement boosts to an array of recommendations and re-sort by confidence.
   */
  applyEngagementBoosts(recommendations, boostMap) {
    if (!boostMap || Object.keys(boostMap).length === 0) return recommendations;

    const boosted = recommendations.map(rec => {
      const bonus = boostMap[String(rec.productId)] || 0;
      if (bonus === 0) return rec;
      return {
        ...rec,
        confidence: parseFloat(Math.min((rec.confidence || 0.5) + bonus, 1.0).toFixed(4)),
        engagementBoost: bonus
      };
    });

    // Re-sort so highest-confidence (boosted) products come first
    boosted.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return boosted;
  }

  /**
   * Generate product embeddings using Groq (for future vector similarity)
   */
  async generateProductEmbedding(product) {
    try {
      const prompt = `Generate a concise embedding description for this product for similarity matching:
      
Product: ${product.title}
Category: ${product.aiData?.category || 'N/A'}
Brand: ${product.aiData?.brand || 'N/A'}
Features: ${(product.aiData?.features || []).join(', ')}

Return a brief vector description (50 words max):`;

      const response = await fetch(this.groqUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.groqModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 100
        })
      });

      const data = await response.json();
      return data.choices[0]?.message?.content || '';
      
    } catch (error) {
      console.error('❌ Error generating embedding:', error);
      return '';
    }
  }
}
