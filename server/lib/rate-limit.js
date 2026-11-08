/**
 * Small in-memory sliding-window rate limiter.
 * Single-process by design; the vault login also has a DB-backed limit
 * so brute-force protection survives restarts.
 */
export function createRateLimiter({ now = () => Date.now(), maxEntries = 20000 } = {}) {
  const buckets = new Map();

  function hit(key, { limit, windowMs }) {
    const t = now();
    const cutoff = t - windowMs;
    let hits = buckets.get(key) || [];
    hits = hits.filter((ts) => ts > cutoff);

    if (hits.length >= limit) {
      buckets.set(key, hits);
      const retryAfterMs = Math.max(0, hits[0] + windowMs - t);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    hits.push(t);
    buckets.set(key, hits);

    if (buckets.size > maxEntries) {
      for (const [k, list] of buckets) {
        if (!list.length || list[list.length - 1] <= cutoff) buckets.delete(k);
      }
    }

    return { allowed: true, remaining: Math.max(0, limit - hits.length), retryAfterMs: 0 };
  }

  function reset(key) {
    buckets.delete(key);
  }

  function cleanup() {
    const cutoff = now() - 60 * 60 * 1000;
    for (const [key, list] of buckets) {
      const kept = list.filter((ts) => ts > cutoff);
      if (kept.length) buckets.set(key, kept);
      else buckets.delete(key);
    }
  }

  return { hit, reset, cleanup, buckets };
}
