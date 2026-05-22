# AI Upsell App - Complete Testing Guide

**Date:** May 5, 2026  
**Purpose:** Step-by-step instructions to test all features of the AI Upsell Shopify app  
**Estimated Time:** 30-45 minutes for full walkthrough

---

## 🎯 Testing Overview

This app has 4 main workflows. We'll test them in order:

1. **Setup Phase** - Configure your business goals (5 min)
2. **Bundle Creation** - Create product bundles to offer (5 min)
3. **Analytics Review** - Check performance metrics (5 min)
4. **Optimization & Safety** - Use AI recommendations and safety controls (5 min)

---

## ✅ Pre-Test Checklist

Before you start, verify:

- [ ] App is running (`npm run dev`)
- [ ] You're logged into your Shopify store
- [ ] You can see the sidebar menu with all items
- [ ] You have at least 3-5 products in your store

---

## 📋 Phase 1: Initial Setup (Goal & Guardrails)

### Step 1: Navigate to Goal Setup

1. Click **"Goal & Guardrails"** in the sidebar
2. You should see a **4-step wizard**

### Step 2: Configure Business Goal

**Expected Screen:** "What's your primary business goal?"

- Select one of:
  - ✅ **Increase AOV** (Average Order Value) - *Recommended for testing*
  - Improve Conversion Rate
  - Boost Subscription Adoption
  - Improve Inventory Movement

**Action:** Click **"Increase AOV"** → Click **Next**

**What to verify:**
- ✅ Button click advances to next step
- ✅ Your selection is remembered if you go back

### Step 3: Set Risk Tolerance

**Expected Screen:** "How aggressive should we be?"

- Select one of:
  - Conservative (safe, smaller gains)
  - Balanced (medium risk/reward) - *Recommended for testing*
  - Aggressive (high risk, high reward)

**Action:** Click **"Balanced"** → Click **Next**

**What to verify:**
- ✅ Selection is clickable
- ✅ Advances to next step

### Step 4: Configure Guardrails (Safety Limits)

**Expected Screen:** Three sliders for discount caps

1. **Max Discount Cap**
   - Drag slider to **20%** (not too aggressive)
   - Should show: "Max 20% discount on bundles"

2. **Inventory Minimum**
   - Drag slider to **10 units**
   - Should show: "Won't show offers below 10 units"

3. **Session Offer Limit**
   - Drag slider to **3 offers**
   - Should show: "Max 3 offers per customer session"

**What to verify:**
- ✅ All three sliders work smoothly
- ✅ Values update in real-time
- ✅ Numbers display correctly

### Step 5: Protection Settings

**Expected Screen:** Two toggle switches

1. **Protect Premium SKUs**
   - Toggle **ON** (protect high-margin products)
   - Should show: "Premium products won't be discounted"

2. **Protect Subscriptions**
   - Toggle **ON** (don't bundle with subscriptions)
   - Should show: "Subscription items protected"

**What to verify:**
- ✅ Toggles switch on/off
- ✅ Messages update when toggled

### Step 6: Complete Setup

**Expected Screen:** "Setup Complete!"

- Should show a summary of your settings
- Click **"Go to Dashboard"** or **"Start Creating Bundles"**

**What to verify:**
- ✅ All your choices are displayed correctly
- ✅ Button navigates to next section

---

## 📦 Phase 2: Bundle Creation (Bundles Page)

### Step 1: Navigate to Bundles

1. Click **"Bundles"** in the sidebar
2. Should see either:
   - Empty state with **"Create Your First Bundle"** button (if no bundles exist)
   - Grid of existing bundles with **"Add New Bundle"** button

### Step 2: Create a Test Bundle

**Action:** Click **"Create New Bundle"** or **"Add New Bundle"**

**Expected Modal/Form:**

Fill in the following:

| Field | What to Enter | Why |
|-------|---------------|-----|
| **Bundle Name** | "Summer Essentials" | Descriptive name |
| **Select Products** | Pick 3-5 products from your store | Create a real bundle |
| **Discount %** | 15% | Within your guardrails |
| **Display Mode** | "Bundle" or "Volume Discount" | How customers see it |

**What to verify:**
- ✅ Can type in bundle name
- ✅ Product search/selection works
- ✅ Can add multiple products
- ✅ Discount slider enforces your guardrail (max 20%)
- ✅ Display mode can be selected
- ✅ **Save** button activates when form is valid

### Step 3: View Your Bundle

**Expected After Save:**

- Modal closes
- Bundle appears in grid with:
  - Bundle name: "Summer Essentials"
  - Products listed (3-5 items)
  - Discount shown: "15% Off"
  - Status badge: 🔥 **Hot** or 🌡️ **Warm** or ❄️ **Cold** (based on performance)
  - Action buttons: **Pause**, **Edit**, **Delete**

**What to verify:**
- ✅ Bundle appears in the grid
- ✅ All details are correct
- ✅ Status badge displays (will be "new" or "cold" initially)

### Step 4: Pause and Resume Bundle

**Action:**
1. Find your bundle
2. Click **"Pause"** button
3. Bundle should gray out and show "Paused" status
4. Click **"Resume"** to turn it back on

**What to verify:**
- ✅ Pause/Resume buttons work
- ✅ Status changes immediately
- ✅ Bundle can be toggled on/off

---

## 📊 Phase 3: Analytics Review (Analytics Page)

### Step 1: Navigate to Analytics

1. Click **"Analytics"** in the sidebar
2. Should see a date range selector at top

### Step 2: Select Time Period

**Action:** Click on date range options:
- 7 Days
- 30 Days  ← *Select this*
- 60 Days
- 90 Days

**What to verify:**
- ✅ Options are clickable
- ✅ Charts update when you change the period
- ✅ "Last 30 days" is now selected

### Step 3: Review Key Metrics

You should see 4 metric cards at the top:

| Metric | What It Shows | Expected Value |
|--------|---------------|-----------------|
| **AOV Lift** | Average order value increase | $0 initially (no data yet) |
| **Conversion Rate** | % customers who bought | 0% initially |
| **Active Bundles** | How many bundles are active | 1 (the one you created) |
| **Revenue Lifted** | Extra revenue from bundles | $0 initially |

**What to verify:**
- ✅ All 4 cards display
- ✅ Numbers update correctly
- ✅ Cards show comparison: "vs. last period"

### Step 4: Review Charts

Scroll down to see:

**Chart 1: AOV Trend**
- Line chart showing daily average order value
- Should be mostly flat (no data yet)
- **What to verify:** ✅ Chart renders, axis labels visible

**Chart 2: Conversion Rate**
- Shows baseline vs. with-offer conversion
- Two lines should be present
- **What to verify:** ✅ Legend shows, lines display

**Chart 3: Top Performing Bundles**
- Table showing bundles ranked by conversions
- Your bundle should appear here (even with 0 conversions)
- **What to verify:** ✅ Table displays, headers are clear

**Chart 4: Offer Type Performance**
- Breakdown by offer type (bundle vs. volume discount)
- **What to verify:** ✅ Table or chart renders

### Step 5: Smart Insights

Scroll to bottom to see **"🤖 Smart Insights"** section

- AI-generated recommendations based on your data
- Might show: "No significant data yet" (expected for new setup)
- **What to verify:** ✅ Section displays with insights or "no data" message

---

## 🚀 Phase 4: Optimization & Safety (Advanced Features)

### Step 1: Optimize Page

Click **"Recommendations"** or find **Optimize** section

**Expected to see:**

1. **Smart Recommendations** (colored banners)
   - Might show: "No active bundles with enough data yet"
   - Once you have sales, will show: "Scale these bundles" or "Pause these bundles"

2. **Bundle Performance Status**
   - Three cards showing:
     - 🔥 Hot Bundles: 0
     - 🌡️ Warm Bundles: 0
     - ❄️ Cold Bundles: 0

3. **How Optimization Works** (explanation)
   - 4-step process explanation
   - **What to verify:** ✅ Clear, easy to understand

---

### Step 2: Safety Mode

Click **"Safety Mode"** in the sidebar

**Expected Screen:**

1. **Status Banner**
   - Shows: "Safety Mode: Active" or "Inactive"
   - One green and one red button to toggle

2. **Safety Controls**
   - **Play Button:** Activate all bundles
   - **Pause Button:** Pause all bundles instantly

3. **Configuration Snapshots Table**
   - Shows saved backup configurations
   - Empty initially
   - Button to **"Create Snapshot Now"**

**Action: Test Emergency Pause**

1. Click the **"Pause All"** button (red)
2. All your bundles should immediately pause
3. Status should change to: "Safety Mode: Active - All offers paused"
4. Click **"Resume All"** to turn them back on

**What to verify:**
- ✅ Pause button works instantly
- ✅ Resume button re-activates bundles
- ✅ Status updates in real-time
- ✅ Explanatory text is clear

---

## 🧪 Phase 5: Full User Journey Test

Now test the complete flow without stopping:

### Journey: New Merchant Setup

**Starting Point:** Just installed the app

**Steps:**
1. ✅ See dashboard (empty state)
2. ✅ Go to Goal & Guardrails → Complete setup
3. ✅ Go to Bundles → Create 2-3 test bundles
4. ✅ Go to Analytics → View metrics (should show your bundles)
5. ✅ Go to Recommendations → See optimization tips
6. ✅ Go to Safety Mode → Understand emergency controls
7. ✅ Go back to Dashboard → See summary

**What to verify:**
- ✅ All pages load without errors
- ✅ Data persists when navigating between pages
- ✅ No broken links or missing pages
- ✅ Sidebar navigation works everywhere
- ✅ Breadcrumbs show your location (if implemented)

---

## 📱 Phase 6: UI/UX Testing

### Navigation
- [ ] Sidebar menu is always accessible
- [ ] Current page is highlighted in sidebar
- [ ] All menu items are clickable
- [ ] No items are broken/404

### Responsive Design
- [ ] Test on different screen sizes (if possible)
- [ ] Tables are readable on small screens
- [ ] Charts scale properly
- [ ] Buttons are easy to tap on mobile

### Visual Design
- [ ] Consistent Shopify Polaris styling
- [ ] Colors make sense (red = danger, green = success)
- [ ] Icons are clear and intuitive
- [ ] Text is readable (good contrast)

### Loading States
- [ ] Analytics page shows skeleton loaders while data loads
- [ ] No "flashing" or jarring transitions
- [ ] Buttons show loading state when clicked

---

## 🐛 Phase 7: Error Handling Test

Try these scenarios to test error handling:

### Test 1: Invalid Guardrail Values
1. Go to Goal & Guardrails
2. Try to set Max Discount to 95% (above guardrail)
   - **Expected:** Error message or slider max limit
   - **Verify:** ✅ Can't exceed safe limits

### Test 2: Create Bundle with No Products
1. Go to Bundles
2. Try to create bundle with 0 or 1 product
   - **Expected:** Error like "Select at least 2 products"
   - **Verify:** ✅ Validation prevents bad data

### Test 3: Pause All Bundles in Safety Mode
1. Go to Safety Mode
2. Click "Pause All"
3. Go to Bundles
   - **Expected:** All bundles show "Paused" status
   - **Verify:** ✅ Action actually paused them

---

## ✅ Final Verification Checklist

At the end of testing, verify:

- [ ] Dashboard loads and displays all sections
- [ ] Goal Setup wizard completes without errors
- [ ] Can create bundles successfully
- [ ] Bundle appears in list with correct details
- [ ] Analytics page shows metrics (even if 0)
- [ ] Charts render without errors
- [ ] Recommendations page loads
- [ ] Safety Mode pause/resume works
- [ ] All sidebar links work
- [ ] No console errors (press F12 in browser, check Console tab)
- [ ] App doesn't crash or freeze
- [ ] Data persists when navigating between pages

---

## 🎉 You've Successfully Tested the App!

**If everything above works:**
- ✅ Core functionality is working
- ✅ UI is responsive and intuitive
- ✅ Navigation is smooth
- ✅ Data persistence is working

**Next Steps:**
1. Test in your actual Shopify store (install the app for real)
2. Create real bundles with your actual products
3. Run promotions and monitor analytics
4. Use Safety Mode if you need to pause everything

---

## 📞 Troubleshooting

### "Page is blank"
- Refresh the page (Cmd+R or Ctrl+R)
- Check browser console for errors (F12)
- Verify app is still running (`npm run dev`)

### "Bundle won't save"
- Check all required fields are filled
- Verify you selected 2+ products
- Check that discount is within guardrails (max 20%)

### "Analytics shows no data"
- This is normal for a new setup
- Data accumulates as customers interact with offers
- For testing, you may need to manually create test events

### "Safety Mode won't respond"
- Refresh the page
- Check that the app is running with `npm run dev`
- Try pausing/resuming again

---

## 📝 Testing Report Template

After testing, fill this out:

```
Date Tested: ________
Tester Name: ________

✅ WORKING:
- [ ] Item 1
- [ ] Item 2

⚠️ ISSUES FOUND:
- [ ] Issue 1: ____________
- [ ] Issue 2: ____________

💡 SUGGESTIONS:
- [ ] Suggestion 1: ____________
- [ ] Suggestion 2: ____________

Overall Status: __ PASS / __ NEEDS FIXES
```

---

**Happy Testing! 🚀**
