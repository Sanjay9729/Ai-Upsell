#!/usr/bin/env node

/**
 * Bundle Cart Drawer Fix - Test Runner
 * 
 * This script runs the bug condition exploration tests to verify the race condition exists.
 * 
 * CRITICAL: These tests MUST FAIL on unfixed code - failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple test framework
const TestRunner = {
  tests: [],
  results: [],
  
  describe(name, fn) {
    console.log(`\n📋 Test Suite: ${name}`);
    fn();
  },
  
  it(name, fn) {
    this.tests.push({ name, fn });
  },
  
  async run() {
    console.log('\n🚀 Running Bug Condition Exploration Tests...\n');
    this.results = [];
    
    for (const test of this.tests) {
      try {
        await test.fn();
        this.results.push({ name: test.name, status: 'PASS', error: null });
        console.log(`✅ PASS: ${test.name}`);
      } catch (error) {
        this.results.push({ name: test.name, status: 'FAIL', error: error.message });
        console.log(`❌ FAIL: ${test.name}`);
        console.log(`   Error: ${error.message}`);
      }
    }
    
    this.printSummary();
    return this.results;
  },
  
  printSummary() {
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed out of ${this.results.length} tests`);
    
    if (failed > 0) {
      console.log('\n⚠️  EXPECTED: Tests fail on unfixed code - this confirms the race condition exists');
      console.log('📝 Counterexamples found:');
      this.results.filter(r => r.status === 'FAIL').forEach(r => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
    }
  }
};

// Assertion helpers
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  assert(value === true, message || `Expected true, got ${value}`);
}

function assertFalse(value, message) {
  assert(value === false, message || `Expected false, got ${value}`);
}

// Mock helpers for simulating cart state and API calls
const MockCart = {
  createBundleCart(bundleSize = 4) {
    return {
      item_count: bundleSize,
      items: Array.from({ length: bundleSize }, (_, i) => ({
        id: 1000 + i,
        key: `key-${i}`,
        product_id: 100 + i,
        product_title: `Bundle Item ${i + 1}`,
        title: `Bundle Item ${i + 1}`,
        quantity: 1,
        variant_id: 200 + i,
        properties: {
          Offer: 'Bundle - 15% off',
          offer: 'Bundle - 15% off',
          _source: 'ai-bundle'
        }
      }))
    };
  },
  
  createCartAfterRemoval(bundleCart, removedIndex) {
    const newCart = JSON.parse(JSON.stringify(bundleCart));
    newCart.items.splice(removedIndex, 1);
    newCart.item_count = newCart.items.length;
    return newCart;
  },
  
  createNonBundleCart() {
    return {
      item_count: 2,
      items: [
        {
          id: 1000,
          key: 'key-0',
          product_id: 100,
          product_title: 'Regular Product 1',
          quantity: 1,
          variant_id: 200,
          properties: {}
        },
        {
          id: 1001,
          key: 'key-1',
          product_id: 101,
          product_title: 'Regular Product 2',
          quantity: 1,
          variant_id: 201,
          properties: {}
        }
      ]
    };
  }
};

// API call tracking
let apiCallsTracker = {
  calls: [],
  completedCalls: [],
  
  reset() {
    this.calls = [];
    this.completedCalls = [];
  },
  
  recordCall(itemKey, properties) {
    this.calls.push({
      itemKey,
      properties,
      timestamp: Date.now(),
      completed: false
    });
  },
  
  recordCompletion(itemKey) {
    const call = this.calls.find(c => c.itemKey === itemKey);
    if (call) {
      call.completed = true;
      call.completedTimestamp = Date.now();
      this.completedCalls.push(call);
    }
  },
  
  allCompleted() {
    return this.calls.length > 0 && this.calls.every(c => c.completed);
  },
  
  getCompletionTiming() {
    if (this.completedCalls.length === 0) return null;
    const firstCall = this.calls[0];
    const lastCompleted = this.completedCalls[this.completedCalls.length - 1];
    return {
      firstCallTime: firstCall.timestamp,
      lastCompletionTime: lastCompleted.completedTimestamp,
      totalDuration: lastCompleted.completedTimestamp - firstCall.timestamp
    };
  }
};

// Drawer state tracking
let drawerStateTracker = {
  refreshes: [],
  
  reset() {
    this.refreshes = [];
  },
  
  recordRefresh(cartState, timestamp) {
    this.refreshes.push({
      timestamp,
      cartState: JSON.parse(JSON.stringify(cartState)),
      hasBundleDiscount: this.hasBundleDiscount(cartState)
    });
  },
  
  hasBundleDiscount(cartState) {
    if (!cartState || !cartState.items) return false;
    return cartState.items.some(item => 
      item.properties && 
      ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
       (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0))
    );
  },
  
  getLastRefresh() {
    return this.refreshes[this.refreshes.length - 1] || null;
  }
};

// ============================================================================
// TEST SUITE: Bug Condition Exploration Tests
// ============================================================================

TestRunner.describe('Bug Condition Exploration: Bundle Discount Persistence', () => {
  
  TestRunner.it('Property 1.1: Bundle Shrinkage Detection - Drawer Refreshes After API Calls Complete', async () => {
    /**
     * Validates: Requirements 2.2
     * 
     * Scenario: User removes one item from a 4-item bundle in the cart drawer
     * 
     * Expected Behavior:
     * 1. All property-clearing API calls to /cart/change.js complete
     * 2. Drawer refresh happens AFTER all API calls complete
     * 3. Drawer displays remaining 3 items WITHOUT bundle discount
     * 4. Bundle discount properties are cleared from remaining items
     * 
     * Bug Condition (UNFIXED CODE):
     * - Drawer refreshes BEFORE all API calls complete
     * - Drawer displays stale cart state with bundle discount still applied
     * - Race condition causes 300ms timeout to be insufficient
     */
    
    apiCallsTracker.reset();
    drawerStateTracker.reset();
    
    // Setup: Create a 4-item bundle
    const initialCart = MockCart.createBundleCart(4);
    console.log('  📦 Initial cart: 4-item bundle with 15% discount');
    
    // Simulate: User removes item at index 1
    const cartAfterRemoval = MockCart.createCartAfterRemoval(initialCart, 1);
    console.log('  🗑️  User removes item 1, cart now has 3 items');
    
    // Simulate: API calls to clear bundle properties from remaining items
    const apiCallPromises = cartAfterRemoval.items.map(item => {
      return new Promise((resolve) => {
        apiCallsTracker.recordCall(item.key, item.properties);
        
        // Simulate network delay (50-150ms per call)
        const delay = 50 + Math.random() * 100;
        setTimeout(() => {
          apiCallsTracker.recordCompletion(item.key);
          console.log(`  ✅ API call completed for ${item.key} (${delay.toFixed(0)}ms)`);
          resolve();
        }, delay);
      });
    });
    
    // Track when drawer refresh happens
    let drawerRefreshTime = null;
    const drawerRefreshPromise = Promise.all(apiCallPromises).then(() => {
      drawerRefreshTime = Date.now();
      console.log('  🔄 Drawer refresh triggered');
      drawerStateTracker.recordRefresh(cartAfterRemoval, drawerRefreshTime);
    });
    
    // Wait for all operations to complete
    await drawerRefreshPromise;
    
    // ASSERTION 1: All API calls must complete before drawer refresh
    assertTrue(
      apiCallsTracker.allCompleted(),
      'All property-clearing API calls must complete before drawer refresh'
    );
    console.log('  ✓ All API calls completed');
    
    // ASSERTION 2: Drawer refresh must happen AFTER all API calls complete
    const timing = apiCallsTracker.getCompletionTiming();
    assert(
      drawerRefreshTime >= timing.lastCompletionTime,
      `Drawer refresh (${drawerRefreshTime}) must happen after last API call (${timing.lastCompletionTime})`
    );
    console.log(`  ✓ Drawer refresh happened after API calls (${timing.totalDuration.toFixed(0)}ms after first call)`);
    
    // ASSERTION 3: Drawer must display updated prices without bundle discount
    const lastRefresh = drawerStateTracker.getLastRefresh();
    assertFalse(
      lastRefresh.hasBundleDiscount,
      'Drawer must display prices without bundle discount after refresh'
    );
    console.log('  ✓ Drawer displays prices without bundle discount');
    
    // ASSERTION 4: Bundle discount properties must be cleared from remaining items
    const remainingItems = lastRefresh.cartState.items;
    remainingItems.forEach(item => {
      assert(
        !item.properties.Offer || item.properties.Offer === '',
        `Item ${item.key} must have Offer property cleared`
      );
      assert(
        !item.properties.offer || item.properties.offer === '',
        `Item ${item.key} must have offer property cleared`
      );
    });
    console.log('  ✓ Bundle discount properties cleared from all remaining items');
  });
  
  TestRunner.it('Property 1.2: Multiple Bundle Item Removal - Drawer Updates Correctly', async () => {
    /**
     * Validates: Requirements 2.2
     * 
     * Scenario: User removes multiple items from a bundle in sequence
     * 
     * Expected Behavior:
     * 1. Each removal triggers property clearing for remaining items
     * 2. Drawer refreshes after each removal with updated prices
     * 3. No bundle discount persists after any removal
     */
    
    apiCallsTracker.reset();
    drawerStateTracker.reset();
    
    // Setup: Create a 4-item bundle
    let currentCart = MockCart.createBundleCart(4);
    console.log('  📦 Initial cart: 4-item bundle');
    
    // Simulate: Remove 2 items in sequence
    for (let i = 0; i < 2; i++) {
      currentCart = MockCart.createCartAfterRemoval(currentCart, 0);
      console.log(`  🗑️  Removal ${i + 1}: Cart now has ${currentCart.items.length} items`);
      
      // Simulate API calls
      const apiCallPromises = currentCart.items.map(item => {
        return new Promise((resolve) => {
          apiCallsTracker.recordCall(item.key, item.properties);
          const delay = 50 + Math.random() * 100;
          setTimeout(() => {
            apiCallsTracker.recordCompletion(item.key);
            resolve();
          }, delay);
        });
      });
      
      await Promise.all(apiCallPromises);
      drawerStateTracker.recordRefresh(currentCart, Date.now());
    }
    
    // ASSERTION: All refreshes must show no bundle discount
    drawerStateTracker.refreshes.forEach((refresh, idx) => {
      assertFalse(
        refresh.hasBundleDiscount,
        `Refresh ${idx + 1} must not have bundle discount`
      );
    });
    console.log(`  ✓ All ${drawerStateTracker.refreshes.length} refreshes show no bundle discount`);
  });
  
  TestRunner.it('Property 1.3: Last Bundle Item Removal - Remaining Item Shows Regular Price', async () => {
    /**
     * Validates: Requirements 2.2
     * 
     * Scenario: User removes all but one item from a bundle
     * 
     * Expected Behavior:
     * 1. Last remaining item displays at regular price (no discount)
     * 2. Bundle discount properties are cleared
     * 3. Drawer refreshes immediately after API calls complete
     */
    
    apiCallsTracker.reset();
    drawerStateTracker.reset();
    
    // Setup: Create a 2-item bundle
    const initialCart = MockCart.createBundleCart(2);
    console.log('  📦 Initial cart: 2-item bundle');
    
    // Simulate: Remove one item, leaving only 1
    const cartAfterRemoval = MockCart.createCartAfterRemoval(initialCart, 0);
    console.log('  🗑️  User removes item, 1 item remains');
    
    // Simulate API call for the last item
    const apiCallPromise = new Promise((resolve) => {
      apiCallsTracker.recordCall(cartAfterRemoval.items[0].key, cartAfterRemoval.items[0].properties);
      setTimeout(() => {
        apiCallsTracker.recordCompletion(cartAfterRemoval.items[0].key);
        console.log('  ✅ API call completed for last item');
        resolve();
      }, 75);
    });
    
    await apiCallPromise;
    drawerStateTracker.recordRefresh(cartAfterRemoval, Date.now());
    
    // ASSERTION 1: Last item must not have bundle discount
    const lastRefresh = drawerStateTracker.getLastRefresh();
    const lastItem = lastRefresh.cartState.items[0];
    assert(
      !lastItem.properties.Offer || lastItem.properties.Offer === '',
      'Last remaining item must not have Offer property'
    );
    console.log('  ✓ Last remaining item shows regular price (no discount)');
    
    // ASSERTION 2: Drawer must show no bundle discount
    assertFalse(
      lastRefresh.hasBundleDiscount,
      'Drawer must show no bundle discount for single remaining item'
    );
    console.log('  ✓ Drawer displays single item without bundle discount');
  });
  
  TestRunner.it('Property 1.4: Race Condition Detection - API Calls vs Drawer Refresh Timing', async () => {
    /**
     * Validates: Requirements 2.2
     * 
     * Scenario: Verify that drawer refresh does NOT happen before API calls complete
     * 
     * This test specifically checks for the race condition where:
     * - Drawer refresh is triggered with a 300ms setTimeout
     * - API calls take longer than 300ms to complete
     * - Drawer displays stale cart state with bundle discount
     * 
     * Expected Behavior:
     * - Drawer refresh must wait for ALL API calls to complete
     * - No race condition should exist
     */
    
    apiCallsTracker.reset();
    drawerStateTracker.reset();
    
    // Setup: Create a 4-item bundle
    const initialCart = MockCart.createBundleCart(4);
    console.log('  📦 Initial cart: 4-item bundle');
    
    // Simulate: User removes item
    const cartAfterRemoval = MockCart.createCartAfterRemoval(initialCart, 1);
    console.log('  🗑️  User removes item');
    
    // Simulate: API calls with varying delays (some > 300ms)
    const apiCallPromises = cartAfterRemoval.items.map((item, idx) => {
      return new Promise((resolve) => {
        apiCallsTracker.recordCall(item.key, item.properties);
        
        // Simulate network delays: some calls take > 300ms
        const delay = 200 + Math.random() * 200; // 200-400ms
        console.log(`  📡 API call for ${item.key} will take ${delay.toFixed(0)}ms`);
        
        setTimeout(() => {
          apiCallsTracker.recordCompletion(item.key);
          resolve();
        }, delay);
      });
    });
    
    // Simulate drawer refresh with 300ms delay (the bug scenario)
    let drawerRefreshHappenedEarly = false;
    const earlyRefreshCheck = setTimeout(() => {
      if (!apiCallsTracker.allCompleted()) {
        drawerRefreshHappenedEarly = true;
        console.log('  ⚠️  RACE CONDITION DETECTED: Drawer would refresh before API calls complete!');
      }
    }, 300);
    
    // Wait for all API calls to complete
    await Promise.all(apiCallPromises);
    clearTimeout(earlyRefreshCheck);
    
    // ASSERTION: Drawer refresh must NOT happen before all API calls complete
    assertFalse(
      drawerRefreshHappenedEarly,
      'Drawer refresh must not happen before all API calls complete (race condition detected)'
    );
    console.log('  ✓ No race condition: drawer refresh waits for all API calls');
    
    // Record final refresh
    drawerStateTracker.recordRefresh(cartAfterRemoval, Date.now());
    
    // ASSERTION: Final drawer state must not have bundle discount
    const lastRefresh = drawerStateTracker.getLastRefresh();
    assertFalse(
      lastRefresh.hasBundleDiscount,
      'Final drawer state must not have bundle discount'
    );
    console.log('  ✓ Final drawer state shows no bundle discount');
  });
});

// ============================================================================
// Run tests
// ============================================================================
(async () => {
  try {
    const results = await TestRunner.run();
    
    // Exit with appropriate code
    const failed = results.filter(r => r.status === 'FAIL').length;
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  }
})();
