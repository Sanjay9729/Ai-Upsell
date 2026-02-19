import { getDb } from '../database/connection.js';

// Simple in-memory cache with TTL for recommendations
const recommendationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(type, shopId, productId) {
  return `${type}:${shopId}:${productId}`;
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
  async findUpsellProducts(shopId, currentProductId, limit = 4) {
    try {
      console.log(`🤖 Starting Groq AI analysis for product ${currentProductId}`);

      // Check cache first
      const cacheKey = getCacheKey('product', shopId, currentProductId);
      const cached = getFromCache(cacheKey);
      if (cached) {
        console.log(`⚡ Cache hit for product ${currentProductId}`);
        return cached;
      }

      // Get current product and all shop products in parallel
      const [currentProduct, allProducts] = await Promise.all([
        this.getProductById(shopId, currentProductId),
        this.getProductsByShop(shopId)
      ]);

      if (!currentProduct) {
        throw new Error('Current product not found');
      }

      const otherProducts = allProducts.filter(p => String(p.productId) !== String(currentProductId));

      if (otherProducts.length === 0) {
        return [];
      }

      // Use Groq to intelligently analyze and recommend products
      const recommendations = await this.analyzeWithGroq(currentProduct, otherProducts, limit);

      // Attach source product info so callers don't need to re-fetch
      recommendations._sourceProduct = currentProduct;

      console.log(`✅ Groq AI found ${recommendations.length} upsell recommendations`);

      // Cache the result
      setCache(cacheKey, recommendations);

      return recommendations;

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
  async findCartUpsellProducts(shopId, cartProductIds, limit = 4) {
    try {
      console.log(`🛒 Starting Groq AI analysis for ${cartProductIds.length} cart products`);

      // Check cache (sort IDs for consistent key)
      const sortedIds = [...cartProductIds].sort().join(',');
      const cacheKey = getCacheKey('cart', shopId, sortedIds);
      const cached = getFromCache(cacheKey);
      if (cached) {
        console.log(`⚡ Cache hit for cart [${sortedIds}]`);
        return cached;
      }

      // Fetch all products in one query — cart products + candidates come from the same collection
      const allProducts = await this.getProductsByShop(shopId);

      const cartProductIdSet = new Set(cartProductIds.map(String));
      const validCartProducts = allProducts.filter(p => cartProductIdSet.has(String(p.productId)));
      const otherProducts = allProducts.filter(p => !cartProductIdSet.has(String(p.productId)));

      if (validCartProducts.length === 0) {
        throw new Error('No valid cart products found');
      }

      if (otherProducts.length === 0) {
        return [];
      }

      // Use Groq to intelligently analyze and recommend products based on cart
      const recommendations = await this.analyzeCartWithGroq(validCartProducts, otherProducts, limit);

      // Attach cart product info so callers don't need to re-fetch
      recommendations._cartProducts = validCartProducts;

      console.log(`✅ Groq AI found ${recommendations.length} cart upsell recommendations`);

      // Cache the result
      setCache(cacheKey, recommendations);

      return recommendations;

    } catch (error) {
      console.error('❌ Groq AI Engine error for cart:', error);
      // Fallback to rule-based system if Groq fails
      return this.fallbackCartRecommendations(shopId, cartProductIds, limit);
    }
  }

  /**
   * Analyze products using Groq LLM
   */
  async analyzeWithGroq(currentProduct, candidateProducts, limit) {
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

      const prompt = this.buildAnalysisPrompt(currentProduct, productData, limit);

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

      // Post-filter: remove any different-type products the AI may have slipped in
      const filtered = results.filter(p => computeTypeScore(currentTokens, p.title) > 0);
      console.log(`🔍 Post-filter: ${results.length} → ${filtered.length} same-type results`);

      const base = filtered.length > 0 ? filtered : results;
      if (base.length >= limit) return base.slice(0, limit);

      // Pad to reach limit: first with other AI results, then same-type DB candidates, then any DB candidate
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
  async analyzeCartWithGroq(cartProducts, candidateProducts, limit) {
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

      const prompt = this.buildCartAnalysisPrompt(cartProducts, productData, limit);

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

      // Keep same-type results first, then pad to reach limit
      const filtered = results.filter(p => computeTypeScore(cartTokens, p.title) > 0);
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
  buildAnalysisPrompt(currentProduct, candidateProducts, limit) {
    const currentData = {
      title: currentProduct.title,
      category: currentProduct.aiData?.category || '',
      brand: currentProduct.aiData?.brand || '',
      price: currentProduct.aiData?.price || '0',
      keywords: currentProduct.aiData?.keywords || [],
      features: currentProduct.aiData?.features || []
    };

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
Only then fill remaining slots with products from the same broad category.

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
3. ONLY pick [SAME TYPE] products. Do NOT pick any [DIFFERENT TYPE] product under any circumstance, even if it means returning fewer than ${limit} results
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
  buildCartAnalysisPrompt(cartProducts, candidateProducts, limit) {
    const cartData = cartProducts.map(product => ({
      title: product.title,
      category: product.aiData?.category || '',
      brand: product.aiData?.brand || '',
      price: product.aiData?.price || '0',
      keywords: product.aiData?.keywords || [],
      features: product.aiData?.features || []
    }));

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

STEP 1 — Identify ALL distinct product types in the cart:
Look at each cart item's title and identify its specific type (e.g., "Bangle Bracelet" → "bracelet", "Guardian Angel Earrings" → "earrings", "Stackable Ring" → "ring"). List every distinct type.

STEP 2 — Distribute ${limit} recommendations across all cart item types:
Pick recommendations proportionally for EACH type found in Step 1. Examples:
- Cart has 1 bracelet + 1 earring → pick 2 bracelet + 2 earring recommendations
- Cart has 1 ring + 1 bracelet + 1 earring → pick at least 1 per type, fill remainder with any
Prioritize [SAME TYPE] candidates for each type.

STEP 3 — Always reach exactly ${limit} total:
If a type has no matching candidates, fill remaining slots with [SAME TYPE] products from other cart types, then any available product. NEVER return fewer than ${limit}.

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
3. Prefer [SAME TYPE] products matching each cart item type. Fill remaining slots with any available product if needed.
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