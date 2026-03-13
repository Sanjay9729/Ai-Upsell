# Learning Loop Implementation — Pillar 5

## Overview

The Learning Loop is the autonomous optimization engine of the platform. It continuously monitors performance, identifies underperformers, and autonomously adjusts the system without human intervention.

**Files:**
- `backend/services/learningLoopEngine.js` — Core learning loop logic
- `backend/routes/cron.js` — Cron endpoints for scheduling
- `backend/services/schedulerService.js` — Scheduler state management

## What the Learning Loop Does

### 1. **Analyzes Performance**
- Tracks views, clicks, and cart additions per offer type
- Measures click-through rate (CTR) and conversion rate
- Analyzes discount elasticity (which discounts work best)
- Monitors guardrail trigger rates

### 2. **Identifies Underperformers**
Offers are flagged as underperforming if:
- CTR < 2%
- Conversion rate < 1%
- Negative AOV impact (reducing average order value)

### 3. **Auto-Pauses Low Performers**
- Automatically pauses offers with low CTR/conversion
- Pause duration: 7 days (then re-evaluates)
- Marked as `autoManaged: true` so merchants can see it was automatic
- Stored in `offerControls` collection with status `paused`

### 4. **Reallocates Placements**
- Identifies best-performing placements (product page, cart, checkout)
- Shifts high-converting offer types to high-performing placements
- Moves low-performing offers away from prime locations

### 5. **Tunes Incentives**
- Analyzes discount elasticity across 6 discount brackets:
  - 0%, 1–5%, 6–10%, 11–15%, 16–20%, 21%+
- Finds optimal discount bracket (highest conversion rate)
- Gradually adjusts discount levels by ±5% per learning cycle

### 6. **Monitors Guardrails**
- Tracks how often guardrails are triggered
- If guardrail rate > 35%, reduces session offer limit
- Prevents system from becoming too aggressive

### 7. **Tracks AOV Impact**
- Compares orders with vs without upsells
- Measures AOV lift percentage
- Calculates incremental revenue

## API Endpoints

### Trigger Learning Loop (Manual or Cron)

**POST /api/cron/optimize**
```bash
# Optimize all shops
curl -X POST http://localhost:3000/api/cron/optimize

# Optimize single shop
curl -X POST http://localhost:3000/api/cron/optimize \
  -H "Content-Type: application/json" \
  -d '{"shopId": "gid://shopify/Shop/123456"}'
```

**POST /api/cron/learning-loop**
```bash
# Run full learning loop for all shops
curl -X POST http://localhost:3000/api/cron/learning-loop

# Run for single shop
curl -X POST http://localhost:3000/api/cron/learning-loop \
  -H "Content-Type: application/json" \
  -d '{"shopId": "gid://shopify/Shop/123456"}'
```

### Check Learning Loop Status

**GET /api/cron/health**
```bash
curl http://localhost:3000/api/cron/health
```

## Configuration

In `learningLoopEngine.js`:

```javascript
const LEARNING_CONFIG = {
  minViewsForEvaluation: 10,        // Min views before evaluating
  lowCTRThreshold: 0.02,            // <2% = low
  lowConversionThreshold: 0.01,     // <1% = low
  highGuardrailRate: 0.35,          // >35% trigger = reduce frequency
  pauseDurationDays: 7,             // Auto-pause for 7 days
  discountTuningRate: 0.05          // Adjust by ±5%
};
```

## Scheduling

### Option 1: External Cron (Recommended for Production)

Use a service like EasyCron, AWS EventBridge, or GitHub Actions:

```bash
# Every 24 hours
0 0 * * * curl -X POST https://your-app.com/api/cron/optimize
```

### Option 2: Manual Trigger

Trigger from the admin dashboard when a merchant clicks "Run Optimization Now".

### Option 3: Lazy Evaluation

The decision engine can lazy-trigger optimization if overdue (in `schedulerService.js`).

## Data Flow

```
┌─────────────────────────────────────────────┐
│  Event Stream (upsell_events collection)    │
│  - views, clicks, cart_adds                 │
│  - placement, offer type, discount %        │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Analyze Performance (24 hour lookback)     │
│  - CTR by offer type                        │
│  - Conversion by placement                  │
│  - Discount elasticity                      │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Identify Underperformers                   │
│  - Low CTR/conversion                       │
│  - Negative AOV impact                      │
└────────────────┬────────────────────────────┘
                 │
          ┌──────┴──────┐
          │             │
          ▼             ▼
    ┌──────────┐   ┌──────────────┐
    │ Auto-    │   │ Reallocate   │
    │ Pause    │   │ Placements   │
    └──┬───────┘   └──┬───────────┘
       │               │
       ▼               ▼
┌─────────────────────────────────────────────┐
│  Update Merchant Config (MongoDB)           │
│  - guardrails.sessionOfferLimit             │
│  - guardrails.baseDiscountPercent           │
│  - optimization.topPlacement                │
└─────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  Next Decision Engine Run                   │
│  Uses updated config automatically          │
└─────────────────────────────────────────────┘
```

## Monitoring & Debugging

### Check if Learning Loop Ran
```javascript
const result = await getLearningLoopStatus(shopId);
console.log(result.status.recentActions);
```

### View Auto-Paused Offers
```bash
db.offer_controls.find({ shopId, status: 'paused', autoManaged: true })
```

### View Optimization Logs
```bash
db.optimization_logs.find({ shopId, type: 'learning_loop' }).sort({ timestamp: -1 })
```

## Guardrails

The learning loop **respects all merchant guardrails**:
- Cannot exceed `maxDiscountCap`
- Cannot offer excluded products
- Cannot violate inventory minimums
- Cannot exceed session offer limit
- Cannot discount subscription products (if protection enabled)

## Tuning for Your Store

Adjust `LEARNING_CONFIG` based on your merchant's business:

```javascript
// Conservative (small store, low traffic)
lowCTRThreshold: 0.03,              // 3% CTR threshold
lowConversionThreshold: 0.015,      // 1.5% conversion threshold
pauseDurationDays: 14,              // Longer pause before retry

// Aggressive (high traffic, high volume)
lowCTRThreshold: 0.01,              // 1% CTR threshold
lowConversionThreshold: 0.005,      // 0.5% conversion threshold
pauseDurationDays: 3,               // Shorter pause, iterate faster
```

## Next Steps

1. **Wire Cron Job**: Set up external cron to POST to `/api/cron/learning-loop` every 24 hours
2. **Monitor Dashboard**: Add UI card showing recent learning loop actions
3. **A/B Test Tuning**: Run parallel configs for different segments
4. **Advanced Optimization**: Implement multi-armed bandit algorithm for discount testing

## Troubleshooting

**Learning loop runs but no changes made?**
- Check event volume: need minimum 20 events in lookback window
- Check if performance metrics meet thresholds
- Review logs: `db.optimization_logs.findOne({ shopId })`

**Offers paused unexpectedly?**
- Normal. Check `pausedReason` in offer_controls
- Offers auto-resume after 7 days
- Merchants can manually approve/unpause in dashboard

**Guardrail rate too high?**
- System is reducing session offer limit
- Check merchant has appropriate guardrails configured
- May need to adjust `highGuardrailRate` threshold
