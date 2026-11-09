import { badRequest, tooManyRequests } from './errors.js';

export function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

export function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(text);
}

export function sendError(res, error, extraHeaders = {}) {
  const status = error.status || 500;
  const payload = {
    error: {
      code: error.code || 'internal_error',
      message: error.expose === false ? 'Internal server error' : error.message || 'Internal server error'
    }
  };
  if (error.details && error.expose !== false) payload.error.details = error.details;
  const headers = { ...extraHeaders };
  if (status === 429 && error.details?.retryAfterMs) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(error.details.retryAfterMs / 1000)));
  }
  sendJson(res, status, payload, headers);
}

export function getClientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function applySecurityHeaders(res, { production = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (production) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function corsFor(origin, allowedOrigins) {
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  };
}

/**
 * Read and parse a request body with a hard size limit.
 * Supports JSON and (for the vault login form) urlencoded bodies.
 */
export function readBody(req, { limitBytes = 16384, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared && declared > limitBytes) {
      reject(badRequest('Request body too large'));
      return;
    }

    let size = 0;
    const chunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(tooManyRequests('Request body timeout'));
    }, timeoutMs);

    function finish(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    }

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        finish(() => {
          req.destroy();
          reject(badRequest('Request body too large'));
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', (err) => finish(() => reject(err)));
    req.on('end', () => {
      finish(() => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({ raw: '', json: {}, type: 'empty' });
        const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (contentType === 'application/x-www-form-urlencoded') {
          return resolve({ raw, json: Object.fromEntries(new URLSearchParams(raw)), type: 'form' });
        }
        if (contentType !== 'application/json' && contentType !== 'text/json') {
          return reject(badRequest('Expected application/json'));
        }
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return reject(badRequest('Expected a JSON object'));
          }
          resolve({ raw, json: parsed, type: 'json' });
        } catch {
          reject(badRequest('Malformed JSON'));
        }
      });
    });
  });
}
