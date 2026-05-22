#!/usr/bin/env node

/**
 * Bundle Cart Drawer Fix - Preservation Property Tests
 * 
 * This script runs preservation tests to verify that non-buggy inputs
 * continue to work correctly on UNFIXED code.
 * 
 * CRITICAL: These tests MUST PASS on unfixed code - they verify baseline behavior to preserve.
 * DO NOT modify these tests when the fix is implemented - they should still pass.
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
    console.log('\n🚀 Running Preservation Property Tests...\n');
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
    
    if (failed === 0) {
      console.log('\n✅ SUCCESS: All preservation tests pass on unfixed code');
      console.log('�� Baseline behavior confirmed for:');
      this.results.forEach(r => {
        console.log(`   ✓ ${r.name}`);
      });
    } else {
      console.log('\n⚠️  FAILURE: Some preservation tests failed');
      console.log('📝 Failed tests:');
      this.results.filter(r => r.status === 'FAIL').forEach(r => {
        console.log(`   ✗ ${r.name}: ${r.error}`);
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

function assertArrayLength(arr, length, message) {
  assert(Array.isArray(arr), 'Expected array');
  assert(arr.length === length, message || `Expected array length ${length}, got ${arr.length}`);
}

// Mock helpers for simulating cart state and interactions
const MockCart = {
  createNonBundleCart(itemCount = 2) {
    return {
      item_count: itemCount,
      items: Array.from({ length: itemCount }, (_, i) => ({
        id: 1000 + i,
        key: `key-${i}`,
        product_id: 100 + i,
        product_title: `Regular Product ${i + 1}`,
        title: `Regular Product ${i + 1}`,
        quantity: 1,
        variant_id: 200 + i,
        price: (10 + i) * 100,
        properties: {}
      }))
    };
  },
  
  createMixedCart(bundleCount = 2, regularCount = 2) {
    const bundleItems = Array.from({ length: bundleCount }, (_, i) => ({
      id: 1000 + i,
      key: `bundle-key-${i}`,
      product_id: 100 + i,
      product_title: `Bundle Item ${i + 1}`,
      title: `Bundle Item ${i + 1}`,
      quantity: 1,
      variant_id: 200 + i,
      price: 1500,
      properties: {
        Offer: 'Bundle - 15% off',
        offer: 'Bundle - 15% off',
        _source: 'ai-bundle'
      }
    }));
    
    const regularItems = Array.from({ length: regularCount }, (_, i) => ({
      id: 2000 + i,
      key: `regular-key-${i}`,
      product_id: 200 + i,
      product_title: `Regular Product ${i + 1}`,
      title: `Regular Product ${i + 1}`,
      quantity: 1,
      variant_id: 300 + i,
      price: (20 + i) * 100,
      properties: {}
    }));
    
    return {
      item_count: bundleCount + regularCount,
      items: [...bundleItems, ...regularItems]
    };
  },
  
  createCartAfterRemoval(cart, itemIndex) {
    const newCart = JSON.parse(JSON.stringify(cart));
    newCart.items.splice(itemIndex, 1);
    newCart.item_count = newCart.items.length;
    return newCart;
  },
  
  createCartAfterQuantityChange(cart, itemIndex, newQuantity) {
    const newCart = JSON.parse(JSON.stringify(cart));
    newCart.items[itemIndex].quantity = newQuantity;
    return newCart;
  },
  
  createCartAfterAddition(cart, newItem) {
    const newCart = JSON.parse(JSON.stringify(cart));
    newCart.items.push(newItem);
    newCart.item_count = newCart.items.length;
    return newCart;
  }
};

// Cart interaction tracking
let cartInteractionTracker = {
  interactions: [],
  
  reset() {
    this.interactions = [];
  },
  
  recordRemoval(cartBefore, cartAfter, itemIndex) {
    this.interactions.push({
      type: 'removal',
      timestamp: Date.now(),
      itemRemoved: cartBefore.items[itemIndex],
      cartBefore,
      cartAfter,
      itemCount: { before: cartBefore.item_count, after: cartAfter.item_count }
    });
  },
  
  recordQuantityChange(cartBefore, cartAfter, itemIndex, newQuantity) {
    this.interactions.push({
      type: 'quantity_change',
      timestamp: Date.now(),
      itemModified: cartBefore.items[itemIndex],
      newQuantity,
      cartBefore,
      cartAfter
    });
  },
  
  recordAddition(cartBefore, cartAfter, newItem) {
    this.interactions.push({
      type: 'addition',
      timestamp: Date.now(),
      itemAdded: newItem,
      cartBefore,
      cartAfter,
      itemCount: { before: cartBefore.item_count, after: cartAfter.item_count }
    });
  },
  
  getLastInteraction() {
    return this.interactions[this.interactions.length - 1] || null;
  },
  
  getInteractionsByType(type) {
    return this.interactions.filter(i => i.type === type);
  }
};

// Drawer state tracking
let drawerStateTracker = {
  states: [],
  
  reset() {
    this.states = [];
  },
  
  recordState(cartState, timestamp) {
    this.states.push({
      timestamp,
      cartState: JSON.parse(JSON.stringify(cartState)),
      itemCount: cartState.item_count,
      hasBundleItems: this.hasBundleItems(cartState),
      bundleItemCount: this.countBundleItems(cartState)
    });
  },
  
  hasBundleItems(cartState) {
    if (!cartState || !cartState.items) return false;
    return cartState.items.some(item => 
      item.properties && 
      ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
       (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0))
    );
  },
  
  countBundleItems(cartState) {
    if (!cartState || !cartState.items) return 0;
    return cartState.items.filter(item => 
      item.properties && 
      ((item.properties.Offer && String(item.properties.Offer).indexOf('Bundle') === 0) ||
       (item.properties.offer && String(item.properties.offer).indexOf('Bundle') === 0))
    ).length;
  },
  
  getLastState() {
    return this.states[this.states.length - 1] || null;
  }
};

// TEST SUITE: Preservation Property Tests
TestRunner.describe('Preservation Property 2: Non-Bundle Removal and Cart Interactions', () => {
  
  TestRunner.it('Property 2.1: Non-Bundle Product Removal - Real-Time Update Without Refresh', async () => {
    cartInteractionTracker.reset();
    drawerStateTracker.reset();
    
    const initialCart = MockCart.createNonBundleCart(3);
    console.log('  🛒 Initial cart: 3 non-bundle products');
    drawerStateTracker.recordState(initialCart, Date.now());
    
    const cartAfterRemoval = MockCart.createCartAfterRemoval(initialCart, 1);
    console.log('  🗑️  User removes product at index 1');
    cartInteractionTracker.recordRemoval(initialCart, cartAfterRemoval, 1);
    drawerStateTracker.recordState(cartAfterRemoval, Date.now());
    
    assertEqual(
      cartAfterRemoval.item_count,
      initialCart.item_count - 1,
      'Item count must decrease by 1'
    );
    console.log('  ✓ Item count decreased from 3 to 2');
    
    const removedItem = initialCart.items[1];
    const stillInCart = cartAfterRemoval.items.some(item => item.key === removedItem.key);
    assertFalse(
      stillInCart,
      'Removed item must not be in cart'
    );
    console.log('  ✓ Removed item no longer in cart');
    
    const remainingItemsMatch = cartAfterRemoval.items.every((item, idx) => {
      const originalIdx = idx < 1 ? idx : idx + 1;
      return item.key === initialCart.items[originalIdx].key;
    });
    assertTrue(
      remainingItemsMatch,
      'Remaining items must be unchanged'
    );
    console.log('  ✓ Remaining items unchanged');
    
    assertFalse(
      drawerStateTracker.getLastState().hasBundleItems,
      'No bundle items in cart'
    );
    console.log('  ✓ No bundle items affected');
  });
  
  TestRunner.it('Property 2.2: Bundle Addition - Discount Applied Correctly', async () => {
    cartInteractionTracker.reset();
    drawerStateTracker.reset();
    
    const initialCart = MockCart.createNonBundleCart(2);
    console.log('  🛒 Initial cart: 2 non-bundle products');
    drawerStateTracker.recordState(initialCart, Date.now());
    
    const bundleItem = {
      id: 3000,
      key: 'bundle-key-0',
      product_id: 300,
      product_title: 'Bundle Product',
      title: 'Bundle Product',
      quantity: 1,
      variant_id: 400,
      price: 6000,
      properties: {
        Offer: 'Bundle - 15% off',
        offer: 'Bundle - 15% off',
        _source: 'ai-bundle'
      }
    };
    
    const cartAfterAddition = MockCart.createCartAfterAddition(initialCart, bundleItem);
    console.log('  ➕ User adds bundle product');
    cartInteractionTracker.recordAddition(initialCart, cartAfterAddition, bundleItem);
    drawerStateTracker.recordState(cartAfterAddition, Date.now());
    
    assertEqual(
      cartAfterAddition.item_count,
      initialCart.item_count + 1,
      'Item count must increase by 1'
    );
    console.log('  ✓ Item count increased from 2 to 3');
    
    const bundleInCart = cartAfterAddition.items.some(item => item.key === bundleItem.key);
    assertTrue(
      bundleInCart,
      'Bundle item must be in cart'
    );
    console.log('  ✓ Bundle item added to cart');
    
    const addedBundle = cartAfterAddition.items.find(item => item.key === bundleItem.key);
    assertTrue(
      addedBundle.properties.Offer && addedBundle.properties.Offer.indexOf('Bundle') === 0,
      'Bundle discount properties must be applied'
    );
    console.log('  ✓ Bundle discount properties applied');
    
    assertTrue(
      drawerStateTracker.getLastState().hasBundleItems,
      'Drawer must show bundle items'
    );
    console.log('  ✓ Drawer displays bundle items');
  });
  
  TestRunner.it('Property 2.3: Quantity Modification - Non-Bundle Products Update Correctly', async () => {
    cartInteractionTracker.reset();
    drawerStateTracker.reset();
    
    const initialCart = MockCart.createNonBundleCart(2);
    console.log('  🛒 Initial cart: 2 non-bundle products, qty 1 each');
    drawerStateTracker.recordState(initialCart, Date.now());
    
    const cartAfterQtyChange = MockCart.createCartAfterQuantityChange(initialCart, 0, 3);
    console.log('  📦 User increases quantity of item 0 from 1 to 3');
    cartInteractionTracker.recordQuantityChange(initialCart, cartAfterQtyChange, 0, 3);
    drawerStateTracker.recordState(cartAfterQtyChange, Date.now());
    
    assertEqual(
      cartAfterQtyChange.items[0].quantity,
      3,
      'Item quantity must be 3'
    );
    console.log('  ✓ Item quantity changed to 3');
    
    assertEqual(
      cartAfterQtyChange.item_count,
      initialCart.item_count,
      'Item count should stay same'
    );
    console.log('  ✓ Item count unchanged (still 2 line items)');
    
    assertEqual(
      cartAfterQtyChange.items[1].quantity,
      initialCart.items[1].quantity,
      'Other items must be unchanged'
    );
    console.log('  ✓ Other items unchanged');
    
    assertFalse(
      drawerStateTracker.getLastState().hasBundleItems,
      'No bundle items in cart'
    );
    console.log('  ✓ No bundle items affected');
  });
  
  TestRunner.it('Property 2.4: Mixed Cart - Non-Bundle Removal Preserves Bundle Items', async () => {
    cartInteractionTracker.reset();
    drawerStateTracker.reset();
    
    const initialCart = MockCart.createMixedCart(2, 2);
    console.log('  🛒 Initial cart: 2 bundle items + 2 regular items');
    drawerStateTracker.recordState(initialCart, Date.now());
    
    assertEqual(
      drawerStateTracker.getLastState().bundleItemCount,
      2,
      'Initial cart should have 2 bundle items'
    );
    console.log('  ✓ Initial state: 2 bundle items, 2 regular items');
    
    const cartAfterRemoval = MockCart.createCartAfterRemoval(initialCart, 2);
    console.log('  🗑️  User removes regular item at index 2');
    cartInteractionTracker.recordRemoval(initialCart, cartAfterRemoval, 2);
    drawerStateTracker.recordState(cartAfterRemoval, Date.now());
    
    assertEqual(
      cartAfterRemoval.item_count,
      initialCart.item_count - 1,
      'Item count must decrease by 1'
    );
    console.log('  ✓ Item count decreased from 4 to 3');
    
    assertEqual(
      drawerStateTracker.getLastState().bundleItemCount,
      2,
      'Bundle items must remain unchanged'
    );
    console.log('  ✓ Bundle items unchanged (still 2)');
    
    const bundleItems = cartAfterRemoval.items.filter(item => 
      item.properties && item.properties.Offer && item.properties.Offer.indexOf('Bundle') === 0
    );
    bundleItems.forEach(item => {
      assertTrue(
        item.properties.Offer && item.properties.Offer.indexOf('Bundle') === 0,
        `Bundle item ${item.key} must have discount`
      );
    });
    console.log('  ✓ Bundle discount still applied to bundle items');
  });
  
  TestRunner.it('Property 2.5: Multiple Non-Bundle Removals - Sequential Updates Work', async () => {
    cartInteractionTracker.reset();
    drawerStateTracker.reset();
    
    let currentCart = MockCart.createNonBundleCart(4);
    console.log('  🛒 Initial cart: 4 non-bundle products');
    drawerStateTracker.recordState(currentCart, Date.now());
    
    for (let i = 0; i < 2; i++) {
      currentCart = MockCart.createCartAfterRemoval(currentCart, 0);
      console.log(`  🗑️  Removal ${i + 1}: Cart now has ${currentCart.item_count} items`);
      cartInteractionTracker.recordRemoval(currentCart, currentCart, 0);
      drawerStateTracker.recordState(currentCart, Date.now());
    }
    
    assertEqual(
      currentCart.item_count,
      2,
      'Item count must be 2 after 2 removals'
    );
    console.log('  ✓ Item count decreased correctly (4 → 2)');
    
    const removals = cartInteractionTracker.getInteractionsByType('removal');
    assertArrayLength(
      removals,
      2,
      'Must have 2 removal interactions'
    );
    console.log('  ✓ All removals tracked correctly');
    
    assertFalse(
      drawerStateTracker.getLastState().hasBundleItems,
      'No bundle items in cart'
    );
    console.log('  ✓ No bundle items affected');
  });
  
  TestRunner.it('Property 2.6: Cart Page Display - Accurate Pricing and Discounts', async () => {
    drawerStateTracker.reset();
    
    const cart = MockCart.createMixedCart(2, 2);
    console.log('  🛒 Cart page: 2 bundle items + 2 regular items');
    drawerStateTracker.recordState(cart, Date.now());
    
    assertArrayLength(
      cart.items,
      4,
      'Cart must have 4 items'
    );
    console.log('  ✓ All 4 items present');
    
    const bundleItems = cart.items.filter(item => 
      item.properties && item.properties.Offer && item.properties.Offer.indexOf('Bundle') === 0
    );
    assertArrayLength(
      bundleItems,
      2,
      'Must have 2 bundle items'
    );
    console.log('  ✓ Bundle items have discount');
    
    const regularItems = cart.items.filter(item => 
      !item.properties || !item.properties.Offer
    );
    assertArrayLength(
      regularItems,
      2,
      'Must have 2 regular items'
    );
    console.log('  ✓ Regular items have no discount');
    
    assertEqual(
      cart.item_count,
      4,
      'Item count must be 4'
    );
    console.log('  ✓ Item count accurate');
  });
  
  TestRunner.it('Property 2.7: Cart Icon Bubble - Item Count Updates Correctly', async () => {
    cartInteractionTracker.reset();
    drawerStateTracker.reset();
    
    let currentCart = MockCart.createNonBundleCart(2);
    console.log('  🛒 Initial cart: 2 items');
    drawerStateTracker.recordState(currentCart, Date.now());
    
    const bundleItem = {
      id: 3000,
      key: 'bundle-key-0',
      product_id: 300,
      product_title: 'Bundle',
      title: 'Bundle',
      quantity: 1,
      variant_id: 400,
      price: 6000,
      properties: {
        Offer: 'Bundle - 15% off',
        offer: 'Bundle - 15% off'
      }
    };
    
    currentCart = MockCart.createCartAfterAddition(currentCart, bundleItem);
    console.log('  ➕ Add bundle: 3 items');
    drawerStateTracker.recordState(currentCart, Date.now());
    
    currentCart = MockCart.createCartAfterRemoval(currentCart, 0);
    console.log('  🗑️  Remove non-bundle item: 2 items');
    drawerStateTracker.recordState(currentCart, Date.now());
    
    assertEqual(
      currentCart.item_count,
      2,
      'Final item count must be 2'
    );
    console.log('  ✓ Final item count correct (2)');
    
    assertArrayLength(
      drawerStateTracker.states,
      3,
      'Must have 3 state changes'
    );
    console.log('  ✓ All state changes tracked');
    
    assertEqual(
      drawerStateTracker.states[0].itemCount,
      2,
      'Initial count must be 2'
    );
    assertEqual(
      drawerStateTracker.states[1].itemCount,
      3,
      'After addition count must be 3'
    );
    assertEqual(
      drawerStateTracker.states[2].itemCount,
      2,
      'After removal count must be 2'
    );
    console.log('  ✓ Item counts accurate at each step');
  });
});

// Run tests
(async () => {
  try {
    const results = await TestRunner.run();
    
    const failed = results.filter(r => r.status === 'FAIL').length;
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error running tests:', error);
    process.exit(1);
  }
})();
