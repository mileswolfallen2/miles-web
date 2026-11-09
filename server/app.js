import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError, badRequest, forbidden, notFound, tooManyRequests } from './lib/errors.js';
import {
  applySecurityHeaders,
  corsFor,
  getClientIp,
  readBody,
  sendError,
  sendJson,
  sendText
} from './lib/http.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { sendFile } from './lib/static.js';
import { serveStatic } from './lib/static.js';

const PUBLIC_API_PREFIX = '/api';
const VAULT_PAGE = '/vault';
const VAULT_VIEW = 'server/views/vault.html';

/**
 * Decode and normalize a request path once for routing and access gates.
 * Repeated decoding prevents bypasses such as /games%2Fdino.html or
 * /%67ames/dino.html from reaching protected static files.
 */
function canonicalPathname(rawPathname) {
  let value = rawPathname || '/';
  for (let round = 0; round < 4; round += 1) {
    const decoded = decodeURIComponent(value);
    if (decoded === value) break;
    value = decoded;
  }
  value = path.posix.normalize(value);
  if (!value.startsWith('/')) value = `/${value}`;
  return value;
}

function methodNotAllowed(res, allowed) {
  sendJson(
    res,
    405,
    { error: { code: 'method_not_allowed', message: 'Method not allowed' } },
    { Allow: allowed.join(', ') }
  );
}

function parseProjectId(pathname) {
  const match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function requestId() {
  return crypto.randomBytes(8).toString('hex');
}

export function createApp({ config, db, logger, services, now = () => new Date() }) {
  const limiter = createRateLimiter();
  const vaultViewPath = path.join(config.siteRoot, VAULT_VIEW);
  let handled = 0;

  function originAllowed(req, origin) {
    if (!origin) return false;
    if (config.allowedOrigins.has(origin)) return true;
    // Same-origin requests are always acceptable. This keeps LAN access working
    // without weakening the explicit cross-origin allowlist.
    const host = req.headers.host;
    if (!host) return false;
    return origin === `http://${host}` || origin === `https://${host}`;
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    if (!origin) return { allowed: true, headers: {} };
    if (!originAllowed(req, origin)) {
      return { allowed: false, headers: {} };
    }
    return { allowed: true, headers: corsFor(origin, new Set([origin])) || {} };
  }

  function requireVault(req, res) {
    const session = services.vault.getSession(req.headers.cookie, now());
    if (session) return session;

    const wantsJson =
      req.headers.accept?.includes('application/json') ||
      String(req.headers['x-requested-with'] || '').toLowerCase() === 'fetch';
    if (wantsJson) {
      sendJson(res, 401, {
        error: { code: 'unauthorized', message: 'Moon Vault session required' }
      });
    } else {
      res.writeHead(302, {
        Location: '/moon-vault.html',
        'Cache-Control': 'no-store'
      });
      res.end();
    }
    return null;
  }

  async function route(req, res, url, context, pathname) {
    const method = req.method || 'GET';

    if (pathname === '/api' || pathname === '/api/') {
      return sendJson(res, 200, {
        name: 'milesallen.site dashboard API',
        version: '1.0.0',
        endpoints: [
          '/api/status',
          '/api/status/servers',
          '/api/status/services',
          '/api/status/history',
          '/api/github/overview',
          '/api/github/activity',
          '/api/github/repositories',
          '/api/projects',
          '/api/projects/:id',
          '/api/fedl/stats',
          '/api/fedl/activity',
          '/api/analytics/hit',
          '/api/analytics/overview',
          '/api/analytics/pages',
          '/api/vault/login',
          '/api/vault/logout',
          '/api/vault/session',
          '/api/health'
        ]
      });
    }

    if (pathname === '/api/health') {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, ['GET', 'HEAD']);
      return sendJson(res, 200, {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        time: now().toISOString()
      });
    }

    if (pathname === '/api/status') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, services.status.getStatus());
    }

    if (pathname === '/api/status/servers') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, {
        generatedAt: now().toISOString(),
        servers: services.status.getServers()
      });
    }

    if (pathname === '/api/status/services') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, {
        generatedAt: now().toISOString(),
        services: services.status.getServices()
      });
    }

    if (pathname === '/api/status/history') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      const days = Number.parseInt(url.searchParams.get('days') || '30', 10);
      return sendJson(res, 200, services.status.getHistory(days));
    }

    if (pathname === '/api/github/overview') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, await services.github.getOverview());
    }

    if (pathname === '/api/github/activity') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, await services.github.getActivity());
    }

    if (pathname === '/api/github/repositories') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, await services.github.getRepositories());
    }

    if (pathname === '/api/projects') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      const rows = db
        .prepare('SELECT * FROM projects WHERE visible = 1 ORDER BY display_order, id')
        .all();
      const statuses = new Map(services.status.getServices().map((s) => [s.url, s]));
      return sendJson(res, 200, {
        generatedAt: now().toISOString(),
        projects: rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          github: row.github_owner
            ? { owner: row.github_owner, repo: row.github_repo, url: `https://github.com/${row.github_owner}/${row.github_repo}` }
            : null,
          website: row.website_url,
          api: row.api_type ? { type: row.api_type, base: row.api_base } : null,
          featured: Boolean(row.featured),
          health: row.website_url && statuses.has(row.website_url) ? statuses.get(row.website_url).status : null
        }))
      });
    }

    const projectId = parseProjectId(pathname);
    if (projectId !== null) {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      const row = db
        .prepare('SELECT * FROM projects WHERE id = ? AND visible = 1')
        .get(projectId);
      if (!row) throw notFound('Project not found');
      return sendJson(res, 200, {
        project: {
          id: row.id,
          name: row.name,
          description: row.description,
          github: row.github_owner
            ? { owner: row.github_owner, repo: row.github_repo, url: `https://github.com/${row.github_owner}/${row.github_repo}` }
            : null,
          website: row.website_url,
          api: row.api_type ? { type: row.api_type, base: row.api_base } : null,
          featured: Boolean(row.featured)
        }
      });
    }

    if (pathname === '/api/fedl/stats') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, await services.fedl.getStats());
    }

    if (pathname === '/api/fedl/activity') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, await services.fedl.getActivity());
    }

    if (pathname === '/api/analytics/hit') {
      if (method !== 'POST') return methodNotAllowed(res, ['POST']);
      const analyticsLimit = limiter.hit(`analytics:${context.ip}`, {
        limit: config.rateLimits.analytics.limit,
        windowMs: config.rateLimits.analytics.windowMs
      });
      if (!analyticsLimit.allowed) {
        throw tooManyRequests('Too many analytics requests', analyticsLimit.retryAfterMs);
      }
      const body = await readBody(req, {
        limitBytes: config.http.bodyLimitBytes,
        timeoutMs: Math.min(10_000, config.http.requestTimeoutMs)
      });
      const payload = body.json || {};
      const result = services.analytics.recordHit({
        path: payload.path,
        referrer: payload.referrer ?? req.headers.referer,
        ip: context.ip,
        userAgent: req.headers['user-agent'],
        at: now()
      });
      return sendJson(res, 202, {
        recorded: result.recorded,
        reason: result.reason || null
      });
    }

    if (pathname === '/api/analytics/overview') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(res, 200, services.analytics.getOverview({ at: now() }));
    }

    if (pathname === '/api/analytics/pages') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      return sendJson(
        res,
        200,
        services.analytics.getPages({
          at: now(),
          days: Number.parseInt(url.searchParams.get('days') || '30', 10),
          limit: Number.parseInt(url.searchParams.get('limit') || '50', 10)
        })
      );
    }

    if (pathname === '/api/vault/session') {
      if (method !== 'GET') return methodNotAllowed(res, ['GET']);
      const session = services.vault.getSession(req.headers.cookie, now());
      return sendJson(res, 200, {
        enabled: services.vault.enabled,
        authenticated: Boolean(session),
        expiresAt: session?.expiresAt || null
      });
    }

    if (pathname === '/api/vault/login') {
      if (method !== 'POST') return methodNotAllowed(res, ['POST']);
      if (!services.vault.enabled) {
        throw new AppError(
          503,
          'vault_disabled',
          'Moon Vault is not configured. Set VAULT_PASSWORD_HASH on the server.',
          undefined,
          true
        );
      }
      const loginLimit = limiter.hit(`login:${context.ip}`, {
        limit: config.rateLimits.login.limit,
        windowMs: config.rateLimits.login.windowMs
      });
      if (!loginLimit.allowed) {
        throw tooManyRequests('Too many login attempts', loginLimit.retryAfterMs);
      }
      const body = await readBody(req, {
        limitBytes: Math.min(config.http.bodyLimitBytes, 4096),
        timeoutMs: Math.min(10_000, config.http.requestTimeoutMs)
      });
      const password = body.json?.password;
      const at = now();
      const result = await services.vault.login({
        password,
        ipHash: services.vault.ipHashFor(context.ip, at),
        at
      });
      res.setHeader('Set-Cookie', result.cookie);
      return sendJson(res, 200, {
        ok: true,
        expiresAt: result.expiresAt
      });
    }

    if (pathname === '/api/vault/logout') {
      if (method !== 'POST') return methodNotAllowed(res, ['POST']);
      const cookie = services.vault.logout(req.headers.cookie);
      res.setHeader('Set-Cookie', cookie);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) {
      throw notFound('API endpoint not found');
    }

    return null;
  }

  return async function handler(req, res) {
    const id = requestId();
    const started = Date.now();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    res.setHeader('X-Request-Id', id);
    applySecurityHeaders(res, { production: config.production });

    let pathname;
    try {
      pathname = canonicalPathname(url.pathname);
    } catch {
      return sendText(res, 400, 'Bad request');
    }

    const isApi = pathname === PUBLIC_API_PREFIX || pathname.startsWith(`${PUBLIC_API_PREFIX}/`);
    const cors = applyCors(req, res);
    if (isApi) {
      for (const [key, value] of Object.entries(cors.headers)) res.setHeader(key, value);
      if (!cors.allowed) {
        return sendError(res, forbidden('Origin is not allowed'), cors.headers);
      }
      if (method === 'OPTIONS') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }
      const limit = limiter.hit(`api:${getClientIp(req, { trustProxy: config.trustProxy })}`, {
        limit: config.rateLimits.api.limit,
        windowMs: config.rateLimits.api.windowMs
      });
      if (!limit.allowed) {
        return sendError(
          res,
          tooManyRequests('Too many API requests', limit.retryAfterMs),
          cors.headers
        );
      }
    }

    res.on('finish', () => {
      const durationMs = Date.now() - started;
      const fields = {
        requestId: id,
        method,
        path: pathname,
        status: res.statusCode,
        durationMs
      };
      if (isApi) logger.info('request', fields);
      else logger.debug('request', fields);
    });

    handled += 1;
    if (handled % 500 === 0) limiter.cleanup();

    try {
      const context = {
        ip: getClientIp(req, { trustProxy: config.trustProxy })
      };

      const apiResult = await route(req, res, url, context, pathname);
      if (apiResult !== null) return;

      if (pathname === VAULT_PAGE || pathname === `${VAULT_PAGE}/`) {
        if (!requireVault(req, res)) return;
        let stat;
        try {
          stat = fs.statSync(vaultViewPath);
        } catch {
          logger.error('vault view missing', { path: vaultViewPath });
          return sendText(res, 500, 'Vault view is missing');
        }
        return sendFile(req, res, vaultViewPath, stat, { cache: 'no-store' });
      }

      const protectedPath = pathname.toLowerCase();
      if (protectedPath === '/games' || protectedPath.startsWith('/games/')) {
        if (!requireVault(req, res)) return;
        return serveStatic(req, res, {
          root: config.siteRoot,
          pathname,
          // Never let a browser cache vault-protected content: a cached game
          // must not remain viewable after logout or session expiry.
          cache: 'no-store',
          decodedPath: true
        });
      }

      if (pathname === '/dashboard' || pathname === '/dashboard/') {
        return serveStatic(req, res, {
          root: config.siteRoot,
          pathname: '/dashboard.html',
          notFoundFile: path.join(config.siteRoot, '404.html'),
          decodedPath: true
        });
      }

      if (method !== 'GET' && method !== 'HEAD') {
        return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      }

      return serveStatic(req, res, {
        root: config.siteRoot,
        pathname,
        notFoundFile: path.join(config.siteRoot, '404.html'),
        decodedPath: true
      });
    } catch (err) {
      if (err instanceof AppError) {
        return sendError(res, err, isApi ? cors.headers : {});
      }
      if (err?.message === 'Body too large' || err?.code === 'ERR_BODY_PARSE') {
        return sendError(res, badRequest('Invalid request body'), isApi ? cors.headers : {});
      }
      logger.error('unhandled request error', {
        requestId: id,
        method,
        path: pathname,
        error: err?.message || String(err),
        stack: config.env === 'development' ? err?.stack : undefined
      });
      return sendError(res, new AppError(500, 'internal_error', 'Internal server error'), isApi ? cors.headers : {});
    }
  };
}
