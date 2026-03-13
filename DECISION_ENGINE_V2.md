# Decision Engine V2 — Production-Grade Autonomous Optimization

## 🎯 Overview

**Decision Engine V2** is a complete rewrite of the offer decision logic with:

- ✅ **Production-grade scoring** (AI confidence + goal alignment + performance history)
- ✅ **Autonomous optimization** (auto-pause underperformers, auto-tune incentives)
- ✅ **Guardrail enforcement** (discount limits, bundle quality, offer density)
- ✅ **Full explainability** (score breakdown, automation journey, segment deep-dives)
- ✅ **Conflict resolution** (stacking strategy, placement rules)
- ✅ **Real-world edge cases** (conflicting offers, bundle composition, offer stacking)

## 📁 New Files

### Backend Services

1. **`backend/services/decisionEngineV2.js`**
   - Main decision engine with scoring + ranking
   - Guardrail enforcement
   - Conflict resolution + offer stacking
   - Score breakdown + explainability

2. **`backend/services/autonomousOptimizer.js`**
   - Auto-pause underperformers
   - Auto-tune incentives (discount adjustments)
   - Reallocate placement emphasis
   - Check guardrail violations
   - Rebalance offer allocation

3. **`backend/services/explainabilityService.js`**
   - Why each offer was selected (score breakdown)
   - Offer automation journey (timeline of actions)
   - Segment performance deep-dive
   - Context injection effectiveness
   - A/B test result tracking

### API Routes

4. **`app/routes/api.decision-engine.jsx`**
   - POST endpoint for all decision engine operations
   - Actions: `product_offers`, `cart_offers`, `explain`, `journey`, `segments`, `context`, `autonomy`

### UI Dashboard

5. **`app/routes/app.explainability.jsx`**
   - Full transparency dashboard
   - Segment performance metrics
   - Context injection analysis
   - Automation journey timeline
   - Guardrail enforcement log

## 🚀 Quick Start

### 1. Get Product Offers (Real-Time Decision)

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{
    "action": "product_offers",
    "productId": "123456789",
    "userId": "customer_id_optional",
    "limit": 4,
    "placement": "product_page"
  }'
```

**Response:**

```json
{
  "success": true,
  "offers": [
    {
      "offerId": "offer_abc123",
      "productId": "987654321",
      "upsellProductName": "Premium Bundle",
      "offerType": "bundle",
      "placement": "product_page",
      "discount": 20,
      "rank": 1,
      "explainability": {
        "whyThis": [
          "Merchant approved",
          "High match confidence",
          "Aligns with grow_aov goal"
        ],
        "score": 0.82,
        "scoreBreakdown": {
          "aiScore": 0.25,
          "controlBonus": 0.3,
          "goalBonus": 0.17,
          "perfBonus": 0.1
        }
      }
    },
    // ... more offers
  ],
  "meta": {
    "status": "ok",
    "placement": "product_page",
    "count": 2,
    "goal": "grow_aov",
    "riskTolerance": "moderate",
    "executionMs": 145,
    "trace": [
      { "step": "input_validation", "status": "ok" },
      { "step": "safety_check", "status": "ok" },
      { "step": "config_load", "status": "ok" },
      // ... complete trace
    ]
  }
}
```

### 2. Get Cart Offers

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{
    "action": "cart_offers",
    "cartProductIds": ["123", "456", "789"],
    "placement": "cart_drawer",
    "limit": 4
  }'
```

### 3. Explain Why an Offer Was Selected

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{
    "action": "explain",
    "offerId": "offer_abc123"
  }'
```

**Response:**

```json
{
  "success": true,
  "explanation": {
    "offerId": "offer_abc123",
    "offer": {
      "sourceProduct": "T-Shirt",
      "upsellProduct": "Premium Bundle",
      "type": "bundle",
      "discount": 20
    },
    "decision": {
      "timestamp": "2025-03-13T10:45:00Z",
      "decisionScore": 0.82,
      "confidence": 0.85,
      "recommendationType": "merchant_approved",
      "aiReason": "Complements source product well"
    },
    "scoreBreakdown": {
      "aiConfidence": 0.255,
      "goalAlignment": 0.2,
      "performanceHistory": 0.2,
      "merchantApproval": 0.1,
      "other": 0.2
    },
    "performance": {
      "current": {
        "views": 145,
        "clicks": 12,
        "adds": 3,
        "ctr": 0.0828,
        "conversion": 0.0207
      },
      "trend": "healthy",
      "benchmark": { "avgCTR": 0.07, "avgConversion": 0.03 }
    },
    "control": {
      "status": "approved",
      "manualTunings": []
    },
    "nextReview": "2025-03-16T10:45:00Z"
  }
}
```

### 4. Get Offer Automation Journey

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{
    "action": "journey",
    "offerId": "offer_abc123"
  }'
```

**Response:**

```json
{
  "success": true,
  "journey": {
    "offerId": "offer_abc123",
    "milestones": [
      {
        "date": "2025-03-10T14:30:00Z",
        "action": "Offer Created",
        "details": { "initialScore": 0.75, "placement": "product_page" }
      },
      {
        "date": "2025-03-12T08:45:00Z",
        "action": "Promoted",
        "reason": "Conversion rate ↑ to 2.1%"
      }
    ],
    "automationActions": [
      {
        "date": "2025-03-11T10:15:00Z",
        "action": "Auto-tune",
        "reason": "Low CTR (3.2%)",
        "change": "Discount increased 15% → 20%",
        "impact": "Expected +2% CTR"
      }
    ]
  }
}
```

### 5. Get Segment Performance

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{
    "action": "segments",
    "limit": 10,
    "sortBy": "conversion"
  }'
```

**Response:**

```json
{
  "success": true,
  "segments": [
    {
      "segment": "known_customer",
      "metrics": {
        "views": 450,
        "ctr": 8.5,
        "conversion": 3.2,
        "avgOrderValue": 125.50
      },
      "health": "good",
      "recommendation": "known_customer is performing well. Maintain current strategy."
    },
    {
      "segment": "anonymous",
      "metrics": {
        "views": 320,
        "ctr": 5.2,
        "conversion": 1.8,
        "avgOrderValue": 89.75
      },
      "health": "needs_work",
      "recommendation": "anonymous needs improvement. Consider segment-specific offers."
    }
  ]
}
```

### 6. Analyze Context Injection

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{ "action": "context" }'
```

**Response:**

```json
{
  "success": true,
  "analysis": {
    "merchant_focus": {
      "count": 45,
      "avgScore": 0.78,
      "avgConfidence": 0.82,
      "performance": {
        "views": 320,
        "conversions": 12,
        "conversionRate": 0.0375
      }
    },
    "ai_generated": {
      "count": 120,
      "avgScore": 0.72,
      "avgConfidence": 0.68,
      "performance": {
        "views": 780,
        "conversions": 15,
        "conversionRate": 0.0192
      }
    }
  }
}
```

### 7. Run Autonomous Optimization

```bash
curl -X POST http://localhost:3000/api/decision-engine \
  -H "Content-Type: application/json" \
  -d '{ "action": "autonomy" }'
```

**Response:**

```json
{
  "success": true,
  "summary": {
    "totalDuration": 3245,
    "offersPaused": 3,
    "offersPromoted": 5,
    "discountsTuned": 8,
    "placementsReallocated": 2,
    "guardrailViolations": 0
  },
  "log": {
    "shopId": "myshop.myshopify.com",
    "startedAt": "2025-03-13T10:00:00Z",
    "completedAt": "2025-03-13T10:05:25Z",
    "steps": [
      {
        "step": "placement_analysis",
        "result": { "analysis": { ... }, "recommendations": [...] }
      },
      {
        "step": "pause_underperformers",
        "result": { "paused": 3, "promoted": 5 }
      },
      // ... more steps
    ]
  }
}
```

## 🎨 Frontend Integration

### Use in Product Page

```javascript
// Client-side
async function getOffers(productId) {
  const response = await fetch('/api/decision-engine', {
    method: 'POST',
    body: JSON.stringify({
      action: 'product_offers',
      productId,
      placement: 'product_page'
    })
  });

  const { offers, meta } = await response.json();

  // Render offers
  offers.forEach(offer => {
    console.log(`${offer.upsellProductName} (${offer.explainability.whyThis.join(', ')})`);
  });
}
```

### Explainability Component

```javascript
// Show why an offer was selected
<div className="offer-explainability">
  <h4>Why we picked this</h4>
  <ul>
    {offer.explainability.whyThis.map(reason => (
      <li key={reason}>{reason}</li>
    ))}
  </ul>
  <div className="score-breakdown">
    <div>AI Confidence: {offer.explainability.scoreBreakdown.aiScore * 100}%</div>
    <div>Goal Alignment: {offer.explainability.scoreBreakdown.goalBonus * 100}%</div>
  </div>
</div>
```

## ⚙️ Configuration

### Scoring Weights (in `scoreAndRankCandidates`)

```javascript
// Current breakdown (total = 1.0):
- AI Confidence: 0.30  (base model recommendation)
- Control Status: 0.30 (approved = 0.3, guided = 0.15)
- Goal Alignment: 0.20 (grow_aov, grow_subscriptions, maximize_margin)
- Performance: 0.20   (historical CTR + conversion)
- Recommendation Type: 0.10 (merchant_focus, merchant_approved)
```

### Guardrail Limits (in constants)

```javascript
const GUARDRAILS = {
  MAX_DISCOUNT_PERCENT: 50,           // Max discount
  MAX_BUNDLE_SIZE: 5,                 // Max items in bundle
  MIN_BUNDLE_QUALITY_SCORE: 0.6,      // Quality threshold
  MAX_OFFERS_PER_PLACEMENT: 4,        // Placement limit
  MAX_OFFER_DENSITY: 0.3              // Offers per 100 views
};
```

### Performance Thresholds (for auto-pause)

```javascript
const PERFORMANCE_THRESHOLDS = {
  MIN_VIEWS_TO_PAUSE: 20,             // Need 20+ views to evaluate
  CONVERSION_FLOOR: 0.02,             // 2% min conversion
  CTR_FLOOR: 0.05,                    // 5% min CTR
  UNDERPERFORMANCE_WINDOW_DAYS: 7     // Look at last 7 days
};
```

## 🧪 Testing

### Unit Tests

```bash
# Test scoring logic
npm test -- decisionEngineV2.test.js

# Test conflict resolution
npm test -- conflictResolution.test.js

# Test guardrails
npm test -- guardrails.test.js
```

### Integration Tests

```bash
# Test full decision flow with real DB
npm run test:integration -- decision-engine
```

### Load Testing

```bash
# Test performance under concurrent requests
npm run load-test -- api/decision-engine --concurrent 100
```

## 📊 Monitoring

### Metrics to Track

1. **Decision Quality**
   - Avg offer score
   - Conversion rate by offer type
   - Click-through rate by placement

2. **Autonomy**
   - Offers auto-paused per day
   - Discounts auto-tuned
   - Placements reallocated

3. **Guardrail Violations**
   - Discount limit breaches
   - Bundle quality failures
   - Offer density violations

### Dashboard Queries

```javascript
// Get today's autonomy summary
db.collection('optimizationLogs').findOne(
  { shopId, date: today },
  { summary: 1 }
)

// Get top-performing offers
db.collection('decisionOffers').find(
  { shopId, decisionScore: { $gte: 0.8 } }
).sort({ decisionScore: -1 }).limit(10)

// Get paused offers reason
db.collection('offerControls').find(
  { shopId, status: 'paused' }
).project({ offerKey: 1, pausedReason: 1, pausedAt: 1 })
```

## 🔧 Customization

### Add Custom Goal

1. Edit `GOAL_MAPPING` in `backend/services/decisionEngineV2.js`:

```javascript
case 'my_custom_goal': {
  // Boost products matching your goal
  const boost = myCustomLogic(candidate, config);
  return Math.min(boost, 1.0);
}
```

2. Update `app/shared/merchantConfig.shared.js` to include new goal

### Add Custom Guardrail

1. In `enforceGuardrails()`, add new check:

```javascript
// Example: Limit offers to high-margin products
result = result.filter(offer => {
  const margin = offer.margin || 0;
  return margin >= 25; // 25%+ margin only
});
```

### Adjust Scoring Weights

1. In `scoreAndRankCandidates()`, adjust multipliers:

```javascript
// Increase weight of AI confidence to 0.4
const aiScore = (candidate.confidence || 0.5) * 0.4; // was 0.3
```

## 🐛 Troubleshooting

### Offers Disappearing

**Symptom:** Offers showed up, now gone.

**Check:**
1. Auto-pause log: `db.collection('offerControls').find({ status: 'paused' })`
2. Guardrail violations: `db.collection('guardrailViolations').find({ offerId })`
3. Safety mode: `await getSafetyMode(shopId)`

### Low Conversion Rates

**Symptom:** Offers getting poor performance.

**Check:**
1. Review segment analysis: `/api/decision-engine` with `action: "segments"`
2. Check score breakdown: see why they were picked
3. Verify guardrails aren't over-restrictive

### High Resource Usage

**Symptom:** Decision engine taking too long.

**Check:**
1. Database indexes on `upsellEvents`, `offerControls`
2. AI engine latency: add timing logs
3. Filter events to smaller window: change `OPTIMIZATION_WINDOW`

## 📚 API Reference

### Decision Engine Endpoints

| Endpoint | Payload | Response |
|----------|---------|----------|
| `POST /api/decision-engine` | `{ "action": "product_offers", "productId", "limit", "placement" }` | Ranked offers + explainability |
| `POST /api/decision-engine` | `{ "action": "cart_offers", "cartProductIds", "limit" }` | Cart offers |
| `POST /api/decision-engine` | `{ "action": "explain", "offerId" }` | Full explanation + performance |
| `POST /api/decision-engine` | `{ "action": "journey", "offerId" }` | Automation timeline |
| `POST /api/decision-engine` | `{ "action": "segments" }` | Segment performance breakdown |
| `POST /api/decision-engine` | `{ "action": "context" }` | Merchant vs AI effectiveness |
| `POST /api/decision-engine` | `{ "action": "autonomy" }` | Run optimization cycle |

## 🎯 Success Metrics

After enabling Decision Engine V2, track:

- ✅ **AOV lift:** Target +5-10% through bundle upsells
- ✅ **Conversion rate:** Target +2-3% through smart placement
- ✅ **Merchant effort:** 80% of tuning automated
- ✅ **Safety:** 0 guardrail violations, 100% compliance
- ✅ **Transparency:** All decisions explainable in <100ms

## 📝 Version History

- **V2.0** (2025-03-13): Production-grade with autonomous optimization
- **V1.0** (2025-02-28): Initial decision engine
