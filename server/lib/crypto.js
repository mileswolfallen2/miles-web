import crypto from 'node:crypto';

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function signValue(secret, value) {
  return hmacHex(secret, value);
}

export function verifySignature(secret, value, signature) {
  return safeEqualHex(signValue(secret, value), signature);
}

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Daily rotating key. Hashing an IP with this key gives a stable
 * anonymous identifier for the day, but cannot be reversed.
 */
export function dailyKey(secret, date = new Date(), scope = 'analytics') {
  return hmacHex(secret, `${scope}:${dayKey(date)}`);
}

export function hashIp(secret, ip, { date = new Date(), scope = 'analytics' } = {}) {
  const key = dailyKey(secret, date, scope);
  return hmacHex(key, String(ip || 'unknown')).slice(0, 32);
}
