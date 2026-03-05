/**
 * Safety Mode Service — Rollback & Emergency Stop
 *
 * Provides:
 *   - getSafetyMode(shopId)         — check if safety mode is active
 *   - setSafetyMode(shopId, active) — enable / disable safety mode
 *   - snapshotConfig(shopId)        — save current merchant config as a restore point
 *   - restoreConfig(shopId)         — roll back to the most recent snapshot
 *   - getSafetyLog(shopId)          — audit log of all safety mode events
 */

import { getDb } from '../database/mongodb.js';
import { getMerchantConfig, updateMerchantConfig } from './merchantConfig.js';

const COLLECTION = 'safety_mode';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if safety mode is currently active for this shop.
 * Default is false (off). Fails safe — if DB is unreachable, returns false.
 */
export async function getSafetyMode(shopId) {
  if (!shopId) return false;
  try {
    const db = await getDb();
    const doc = await db.collection(COLLECTION).findOne({ shopId });
    return doc?.active === true;
  } catch (err) {
    console.warn('⚠️ getSafetyMode failed, defaulting to off:', err.message);
    return false;
  }
}

/**
 * Enable or disable safety mode.
 * When enabling, automatically snapshots current config as restore point.
 *
 * @param {string} shopId
 * @param {boolean} active
 * @param {string} reason  — optional human-readable reason
 */
export async function setSafetyMode(shopId, active, reason = '') {
  if (!shopId) return { success: false, error: 'Missing shopId' };
  try {
    const db = await getDb();
    const now = new Date();

    // Snapshot config before enabling (so restore works correctly)
    if (active) {
      await snapshotConfig(shopId, 'pre_safety_enable');
    }

    await db.collection(COLLECTION).updateOne(
      { shopId },
      {
        $set: {
          shopId,
          active: Boolean(active),
          updatedAt: now,
          reason: String(reason || '').trim()
        },
        $push: {
          log: {
            action: active ? 'enabled' : 'disabled',
            reason: String(reason || '').trim(),
            timestamp: now
          }
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );

    console.log(`🛡️ Safety mode ${active ? 'ENABLED' : 'DISABLED'} for ${shopId}${reason ? ` — ${reason}` : ''}`);
    return { success: true, active };
  } catch (err) {
    console.error('❌ setSafetyMode failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Save a snapshot of the current merchant config.
 * Called automatically when safety mode is enabled,
 * but can also be called manually before major changes.
 *
 * @param {string} shopId
 * @param {string} label  — optional label to identify the snapshot
 */
export async function snapshotConfig(shopId, label = 'manual') {
  if (!shopId) return { success: false, error: 'Missing shopId' };
  try {
    const config = await getMerchantConfig(shopId);
    const db = await getDb();
    const now = new Date();

    const snapshot = {
      shopId,
      label: String(label),
      config,
      createdAt: now
    };

    await db.collection('config_snapshots').insertOne(snapshot);
    console.log(`📸 Config snapshot saved for ${shopId} (label: ${label})`);
    return { success: true, snapshot };
  } catch (err) {
    console.error('❌ snapshotConfig failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Restore the most recent config snapshot for this shop.
 * Also disables safety mode after successful restore.
 */
export async function restoreConfig(shopId) {
  if (!shopId) return { success: false, error: 'Missing shopId' };
  try {
    const db = await getDb();

    const snapshot = await db.collection('config_snapshots').findOne(
      { shopId },
      { sort: { createdAt: -1 } }
    );

    if (!snapshot) {
      return { success: false, error: 'No snapshot found for this shop' };
    }

    const { config } = snapshot;
    if (!config) {
      return { success: false, error: 'Snapshot has no config data' };
    }

    // Restore — overwrite current config with snapshot values
    await updateMerchantConfig(shopId, config);

    // Disable safety mode after restore
    await setSafetyMode(shopId, false, 'restored from snapshot');

    console.log(`↩️ Config restored for ${shopId} from snapshot: ${snapshot.label} (${snapshot.createdAt})`);
    return {
      success: true,
      restoredFrom: {
        label: snapshot.label,
        createdAt: snapshot.createdAt
      }
    };
  } catch (err) {
    console.error('❌ restoreConfig failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Get all config snapshots for a shop (most recent first).
 */
export async function getSnapshots(shopId, { limit = 10 } = {}) {
  if (!shopId) return { snapshots: [] };
  try {
    const db = await getDb();
    const snapshots = await db.collection('config_snapshots')
      .find({ shopId }, { projection: { config: 0 } }) // exclude full config from list view
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 10)
      .toArray();
    return { snapshots };
  } catch (err) {
    console.warn('⚠️ getSnapshots failed:', err.message);
    return { snapshots: [] };
  }
}

/**
 * Get safety mode status + recent audit log.
 */
export async function getSafetyStatus(shopId) {
  if (!shopId) return { active: false, log: [], snapshots: [] };
  try {
    const db = await getDb();
    const [doc, snapshotResult] = await Promise.all([
      db.collection(COLLECTION).findOne({ shopId }),
      getSnapshots(shopId, { limit: 5 })
    ]);

    return {
      active: doc?.active === true,
      reason: doc?.reason || '',
      updatedAt: doc?.updatedAt || null,
      log: (doc?.log || []).slice(-20).reverse(), // last 20, newest first
      snapshots: snapshotResult.snapshots
    };
  } catch (err) {
    console.warn('⚠️ getSafetyStatus failed:', err.message);
    return { active: false, log: [], snapshots: [] };
  }
}
