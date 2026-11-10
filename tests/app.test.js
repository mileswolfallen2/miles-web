import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import argon2 from 'argon2';
import { createApp } from '../server/app.js';
import { createStatusService } from '../server/services/status.js';
import { createAnalyticsService } from '../server/services/analytics.js';
import { createVaultService } from '../server/services/vault.js';
import { resolveStaticPath } from '../server/lib/static.js';
import { createTestContext, silentLogger } from './helpers.js';

async function buildServer(t, overrides = {}) {
  const ctx = createTestContext(t, overrides);
  const hash = await argon2.hash('test-passphrase', {
    type: argon2.argon2id,
    timeCost: 1,
    memoryCost: 8192,
    parallelism: 1,
    hashLength: 32
  });
  ctx.config.vault.passwordHash = hash;
  const logger = silentLogger();
  const status = createStatusService({ db: ctx.db, config: ctx.config });
  const analytics = createAnalyticsService({ db: ctx.db, config: ctx.config });
  const vault = await createVaultService({ db: ctx.db, config: ctx.config, logger });
  const github = {
    getOverview: async () => ({ generatedAt: new Date().toISOString(), totals: { stars: 1 } }),
    getActivity: async () => ({ generatedAt: new Date().toISOString(), activity: { days: [] } }),
    getRepositories: async () => ({ generatedAt: new Date().toISOString(), repositories: [] })
  };
  const fedl = {
    getStats: async () => ({
      generatedAt: new Date().toISOString(),
      totals: { rankedLevels: 2, records: 1 },
      topLevels: [],
      changes: { comparedTo: null, counts: {} }
    }),
    getActivity: async () => ({ generatedAt: new Date().toISOString(), changes: {} })
  };
  const app = createApp({
    config: ctx.config,
    db: ctx.db,
    logger,
    services: { status, analytics, vault, github, fedl, monitor: {} }
  });
  const server = http.createServer((req, res) => app(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...ctx, app, server, base, vault };
}

test('HTTP app exposes documented APIs, security headers, and CORS allowlist', async (t) => {
  const { base } = await buildServer(t);

  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.ok(health.headers.get('x-request-id'));
  const healthBody = await health.json();
  assert.equal(healthBody.status, 'ok');

  const status = await fetch(base + '/api/status');
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.servers.length, 1);
  assert.equal(statusBody.servers[0].name, 'Home Server');
  assert.equal('ip' in statusBody.servers[0], false, 'public status must not expose server IPs');
  assert.equal(statusBody.services.length, 1);

  const preflight = await fetch(base + '/api/status', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://milesallen.site',
      'Access-Control-Request-Method': 'GET'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://milesallen.site');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

  const apiPreflight = await fetch(base + '/api/status', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://api.milesallen.site',
      'Access-Control-Request-Method': 'GET'
    }
  });
  assert.equal(apiPreflight.status, 204);
  assert.equal(apiPreflight.headers.get('access-control-allow-origin'), 'https://api.milesallen.site');
  assert.equal(apiPreflight.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(apiPreflight.headers.get('access-control-expose-headers'), 'Retry-After');

  const blocked = await fetch(base + '/api/status', {
    headers: { Origin: 'https://evil.example' }
  });
  assert.equal(blocked.status, 403);

  const siteConfig = await fetch(base + '/site-config.js');
  assert.equal(siteConfig.status, 200);
  assert.match(await siteConfig.text(), /api\.milesallen\.site/);

  const missing = await fetch(base + '/api/nope');
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, 'not_found');

  const wrongMethod = await fetch(base + '/api/status', { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
});

test('Moon Vault content is server-gated and the old passphrase is gone from public files', async (t) => {
  const { base } = await buildServer(t);

  const lockResponse = await fetch(base + '/moon-vault.html');
  assert.equal(lockResponse.status, 200);
  const lockHtml = await lockResponse.text();
  assert.equal(/password\s*===/.test(lockHtml), false, 'no client-side password comparison');
  assert.equal(lockHtml.includes('localStorage'), false);
  assert.equal(lockHtml.includes('sessionStorage'), false);

  const gate = await fetch(base + '/vault', { redirect: 'manual' });
  assert.equal(gate.status, 302);
  assert.equal(gate.headers.get('location'), '/moon-vault.html');

  const deniedGame = await fetch(base + '/games/dino.html', { redirect: 'manual' });
  assert.equal(deniedGame.status, 302);

  for (const encoded of [
    '/games%2Fdino.html',
    '/%67ames/dino.html',
    '/games/%2564ino.html',
    '/GAMES/dino.html',
    '/Games/dino.html'
  ]) {
    const bypass = await fetch(base + encoded, { redirect: 'manual' });
    assert.equal(bypass.status, 302, `protected path must stay gated: ${encoded}`);
  }

  const badLogin = await fetch(base + '/api/vault/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' })
  });
  assert.equal(badLogin.status, 401);

  const login = await fetch(base + '/api/vault/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-passphrase' })
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];

  const session = await fetch(base + '/api/vault/session', { headers: { Cookie: cookie } });
  const sessionBody = await session.json();
  assert.equal(sessionBody.enabled, true);
  assert.equal(sessionBody.authenticated, true);
  assert.ok(sessionBody.expiresAt);

  const vault = await fetch(base + '/vault', { headers: { Cookie: cookie } });
  assert.equal(vault.status, 200);
  const vaultHtml = await vault.text();
  assert.match(vaultHtml, /MOON VAULT/);
  assert.match(vaultHtml, /data-no-design-picker/, 'vault page must not auto-open the site-wide design picker');
  assert.equal(/password\s*===/.test(vaultHtml), false, 'vault content is not gated in client code');

  const game = await fetch(base + '/games/dino.html', { headers: { Cookie: cookie } });
  assert.equal(game.status, 200);
  assert.equal(game.headers.get('cache-control'), 'no-store', 'protected games must not be cached');

  const encodedGame = await fetch(base + '/games%2Fdino.html', {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(encodedGame.status, 200, 'encoded protected paths work for authenticated sessions');

  const logout = await fetch(base + '/api/vault/logout', {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  const afterLogout = await fetch(base + '/vault', {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(afterLogout.status, 302);
});

test('analytics endpoint records normalized hits and rejects oversized bodies', async (t) => {
  const { base, db } = await buildServer(t, { http: { bodyLimitBytes: 2048 } });
  const response = await fetch(base + '/api/analytics/hit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 Chrome/130 Safari/537.36'
    },
    body: JSON.stringify({ path: '/hello?secret=1', referrer: 'https://example.com/x' })
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { recorded: true, reason: null });
  const row = db.prepare('SELECT path, referrer_domain FROM pageviews').get();
  assert.equal(row.path, '/hello');
  assert.equal(row.referrer_domain, 'example.com');

  const huge = await fetch(base + '/api/analytics/hit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"path":"/' + 'a'.repeat(3000) + '"}'
  });
  assert.equal(huge.status, 400);
});

test('login rate limiting returns 429 with Retry-After', async (t) => {
  const { base } = await buildServer(t, {
    rateLimits: {
      api: { limit: 1000, windowMs: 60_000 },
      analytics: { limit: 1000, windowMs: 60_000 },
      login: { limit: 1, windowMs: 60_000 }
    }
  });
  const first = await fetch(base + '/api/vault/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' })
  });
  assert.equal(first.status, 401);
  const second = await fetch(base + '/api/vault/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' })
  });
  assert.equal(second.status, 429);
  assert.ok(second.headers.get('retry-after'));
});

test('static resolver blocks traversal and private server files', async () => {
  const root = process.cwd();
  assert.deepEqual(await resolveStaticPath(root, '/../package.json'), { error: 403 });
  assert.deepEqual(await resolveStaticPath(root, '/server/config.js'), { error: 403 });
  assert.deepEqual(await resolveStaticPath(root, '/.env'), { error: 403 });
  assert.deepEqual(await resolveStaticPath(root, '/data/dashboard.db'), { error: 403 });
  assert.deepEqual(await resolveStaticPath(root, '/node_modules/argon2/package.json'), { error: 403 });

  const index = await resolveStaticPath(root, '/');
  assert.equal(index.file.endsWith('index.html'), true);
});
