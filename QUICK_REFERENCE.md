# Decision Engine V2 — Quick Reference Card

## 🎯 What It Does

Autonomously ranks, optimizes, and explains upsell offers in real-time.

## 📍 Files

| File | Purpose | Lines |
|------|---------|-------|
| `backend/services/decisionEngineV2.js` | Scoring + ranking | 1,150 |
| `backend/services/autonomousOptimizer.js` | Auto-pause, auto-tune | 700 |
| `backend/services/explainabilityService.js` | Score breakdown, journey | 650 |
| `app/routes/api.decision-engine.jsx` | API endpoint | 100 |
| `app/routes/app.explainability.jsx` | Dashboard UI | 650 |

## 🚀 API Calls

### Get Offers

```bash
# Product offers
POST /api/decision-engine
{"action": "product_offers", "productId": "123", "limit": 4}

# Cart offers
POST /api/decision-engine
{"action": "cart_offers", "cartProductIds": ["1", "2"], "limit": 4}
```

### Explain Decisions

```bash
# Why was this offer selected?
POST /api/decision-engine
{"action": "explain", "offerId": "offer_123"}

# What's the automation history?
POST /api/decision-engine
{"action": "journey", "offerId": "offer_123"}

# How are segments performing?
POST /api/decision-engine
{"action": "segments"}

# Merchant context vs AI effectiveness?
POST /api/decision-engine
{"action": "context"}
```

### Run Optimization

```bash
# Auto-pause, auto-tune, reallocate
POST /api/decision-engine
{"action": "autonomy"}
```

## 📊 Scoring (0.0 - 1.0)

| Component | Weight | Formula |
|-----------|--------|---------|
| AI Confidence | 0.30 | groq_confidence × 0.3 |
| Control Status | 0.30 | approved=0.3 / guided=0.15 / auto=0 |
| Goal Alignment | 0.20 | grow_aov/subscriptions/margin boost × 0.2 |
| Performance | 0.20 | (ctr + conversion) / 2 × 0.2 |
| Type Bonus | 0.10 | merchant_focus=0.15 / approved=0.1 |

## 🛡️ Guardrails

| Rule | Limit | Action |
|------|-------|--------|
| Discount | ≤ 50% | Block if exceeded |
| Bundle Quality | ≥ 0.60 | Filter low quality |
| Offer Density | ≤ 0.30 per 100 views | Monitor |
| Per Placement | ≤ 4 offers | Trim excess |
| Subscriptions | ≤ 1 per source | Conflict resolution |

## 🤖 Autonomy Rules

| Action | Trigger | Effect |
|--------|---------|--------|
| Auto-Pause | conv < 1.5% AND ctr < 3% | status = "paused" |
| Auto-Tune Discount | conv < 2% | +5% discount |
| Auto-Tune Discount | conv > 5% | -2% discount |
| Reallocate | Placement conv < avg | Recommend shift |

## 📈 Key Metrics

| Metric | Target | Check |
|--------|--------|-------|
| Decision Time | < 200ms | API response latency |
| Guardrail Violations | 0 | `/app/explainability` |
| Offers Paused/Day | 2-5 | autonomy logs |
| Discounts Tuned/Day | 5-10 | autonomy logs |
| AOV Lift | +5-10% | analytics dashboard |
| CTR | > 5% | segment performance |
| Conversion | > 2% | segment performance |

## ✅ Deployment Checklist

- [ ] MongoDB collections created (decisionOffers, offerControls, upsellEvents, optimizationLogs)
- [ ] Indexes created (shopId, timestamp)
- [ ] Cron job scheduled (daily autonomy run)
- [ ] API route responds (POST /api/decision-engine)
- [ ] Dashboard loads (GET /app/explainability)
- [ ] Safety mode tested (all offers blocked when active)
- [ ] Guardrails tested (no violations)
- [ ] Autonomy tested (auto-pause + auto-tune working)
- [ ] Performance tested (< 200ms decision)
- [ ] Shopify integration tested (discount codes work)

## 🧪 Test Commands

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Compliance tests
npm run compliance-check

# Load test
npm run load-test -- --concurrent 100

# Debug autonomy
npm run autonomy:debug
```

## 📋 Decision Response Example

```json
{
  "success": true,
  "offers": [
    {
      "offerId": "offer_123",
      "upsellProductName": "Premium Bundle",
      "discountPercent": 20,
      "rank": 1,
      "explainability": {
        "whyThis": ["merchant_approved", "high_confidence", "goal_aligned"],
        "score": 0.82,
        "scoreBreakdown": {
          "aiScore": 0.25,
          "controlBonus": 0.30,
          "goalBonus": 0.17,
          "perfBonus": 0.10
        }
      }
    }
  ],
  "meta": {
    "status": "ok",
    "count": 2,
    "placement": "product_page",
    "executionMs": 145,
    "trace": [
      { "step": "safety_check", "status": "ok" },
      { "step": "scoring", "status": "ok", "candidatesCount": 12 },
      { "step": "guardrails", "status": "ok", "afterGuardrails": 4 }
    ]
  }
}
```

## 🔍 Debug: Why No Offers?

1. **Safety Mode On?**
   ```javascript
   await getSafetyMode(shopId) // Should be false
   ```

2. **Placement Blocked?**
   ```javascript
   // Check risk config allows placement
   riskConfig.allowedPlacements.includes(placement)
   ```

3. **AI Returned Nothing?**
   ```javascript
   // Check Groq response
   const recs = await aiEngine.findUpsellProducts(...)
   ```

4. **Guardrails Too Strict?**
   ```javascript
   // Check which offers were filtered
   // Enable verbose logging in enforceGuardrails()
   ```

5. **Conflict Resolution Removed All?**
   ```javascript
   // Check for duplicates
   const seen = new Set()
   offers.forEach(o => {
     if (seen.has(o.productId)) console.log('Duplicate:', o.productId)
     seen.add(o.productId)
   })
   ```

## 📞 Common Fixes

| Problem | Fix |
|---------|-----|
| Offers disappearing | Check auto-pause log: `db.offerControls.find({status:"paused"})` |
| Low conversion | Review segment analysis, check guardrails not too tight |
| Slow API | Check AI engine latency, enable caching |
| No autonomy actions | Verify cron running, check `optimizationLogs` |
| Shopify discount errors | Verify discount code generation, check API limits |

## 🎓 Architecture (Simple)

```
User views product
    ↓
GET /api/decision-engine → product_offers
    ↓
[AI finds matches] → [Score each] → [Filter guardrails] → [Rank]
    ↓
Return: Top 4 offers with "why" explanation
    ↓
User sees: "Premium Bundle (merchant approved, 82% match)"
```

## 🔄 Autonomy (Daily)

```
cron.daily()
    ↓
[Analyze] performance by placement + type
    ↓
[Pause] offers with conv < 1.5% (after 20+ views)
    ↓
[Tune] discounts: low conv → +5%, high conv → -2%
    ↓
[Reallocate] from bad placement to good
    ↓
[Report] # paused, # tuned, # reallocated
```

## 📚 Documentation

- **Full Guide:** `DECISION_ENGINE_V2.md` (500 lines)
- **Compliance:** `COMPLIANCE_CHECKLIST.md` (400 lines)
- **Summary:** `IMPLEMENTATION_SUMMARY.md` (600 lines)
- **API Docs:** Inside `api.decision-engine.jsx`

## 🚀 Go Live

1. Deploy code
2. Create MongoDB collections
3. Schedule autonomy cron job
4. Run `npm run compliance-check`
5. Test in staging
6. Monitor production logs
7. Collect metrics

## ✨ Success = 

✅ Offers appear in < 200ms  
✅ Guardrails enforced (0 violations)  
✅ Autonomy runs daily  
✅ Merchants see explainability  
✅ AOV lift +5-10%  
✅ Manual effort -80%

---

**Keep this card handy for quick reference!**
