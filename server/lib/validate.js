const BOT_RE = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pagespeed|curl\/|wget\/|python-requests|go-http-client|httpclient|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baiduspider|duckduckbot|applebot|archive\.org/i;
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function limitString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Normalize a page path for analytics. Returns null for anything that is
 * not a safe, same-site path.
 */
export function normalizePath(raw) {
  if (typeof raw !== 'string' || raw.length > 1024) return null;
  let value = raw.trim().split('#')[0].split('?')[0];
  if (!value.startsWith('/')) return null;
  if (value.includes('\\') || value.includes('\0')) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return null;
  if (!PATH_RE.test(decoded)) return null;

  decoded = decoded.replace(/\/{2,}/g, '/');
  if (decoded === '/index.html') decoded = '/';
  if (decoded.length > 1) decoded = decoded.replace(/\/+$/, '');
  if (!decoded.startsWith('/')) decoded = '/' + decoded;
  return decoded;
}

export function referrerDomain(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (!HOST_RE.test(host)) return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

export function isLikelyBot(userAgent) {
  if (!userAgent) return true;
  return BOT_RE.test(userAgent);
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}
