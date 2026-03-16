// ─── src/services/lockService.js ─────────────────────────────────
// Simple in-memory lock manager to prevent concurrent processing.
// Works for single-instance bots. For multi-instance, use Redis.

const locks = new Map();

/**
 * Try to acquire a named lock.
 * @param {string} key  Unique lock key (e.g. "match_5", "tournament_abc123")
 * @returns {boolean} true if acquired, false if already locked
 */
export function acquireLock(key) {
  if (locks.has(key)) return false;
  locks.set(key, Date.now());
  return true;
}

/**
 * Release a named lock.
 * @param {string} key
 */
export function releaseLock(key) {
  locks.delete(key);
}

/**
 * Check if a key is locked.
 * @param {string} key
 * @returns {boolean}
 */
export function isLocked(key) {
  return locks.has(key);
}

/**
 * Clean up stale locks older than maxAge (safety net).
 * Call periodically to prevent leaks from crashed handlers.
 * @param {number} maxAgeMs  Default 5 minutes
 */
export function cleanStaleLocks(maxAgeMs = 300_000) {
  const now = Date.now();
  for (const [key, timestamp] of locks) {
    if (now - timestamp > maxAgeMs) {
      locks.delete(key);
      console.warn(`[LOCK] Cleaned stale lock: ${key}`);
    }
  }
}
