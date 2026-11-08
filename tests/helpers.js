import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { seedConfig } from '../server/db/seed.js';

export const repoRoot = process.cwd();

export function makeConfig(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-dashboard-test-'));
  const projects = overrides.projects || [
    {
      id: 'alpha',
      name: 'Alpha',
      description: 'Test project',
      github: { owner: 'octocat', repo: 'alpha' },
      website: 'https://alpha.test/',
      api: null,
      order: 1,
      visible: true,
      featured: true
    }
  ];
  const services = overrides.services || [
    {
      id: 'alpha',
      name: 'Alpha',
      url: 'https://alpha.test/',
      order: 1,
      enabled: true
    }
  ];
  const servers = overrides.servers || [
    {
      id: 'home-1',
      name: 'Home Server',
      ip: '10.0.0.87',
      order: 1,
      enabled: true
    }
  ];

  const config = {
    env: 'test',
    production: false,
    host: '127.0.0.1',
    port: 0,
    siteRoot: repoRoot,
    dbPath: path.join(tempDir, 'dashboard.db'),
    tempDir,
    publicOrigin: 'http://localhost:8787',
    allowedOrigins: new Set(['http://localhost:8787', 'https://milesallen.site']),
    sessionSecret: 'test-session-secret-that-is-long-enough-0123456789',
    trustProxy: false,
    cookie: {
      name: 'miles_vault',
      secure: false,
      sameSite: 'Strict',
      ttlMs: 60 * 60 * 1000
    },
    vault: {
      passwordHash: null,
      password: null,
      maxAttempts: 3,
      windowMs: 15 * 60 * 1000
    },
    monitor: {
      servers,
      services,
      serverIntervalMs: 60_000,
      pingTimeoutMs: 2_000,
      serviceIntervalMs: 120_000,
      httpTimeoutMs: 5_000,
      retentionDays: 90,
      expectedSubnet: '10.0.0.0/24'
    },
    github: {
      username: 'octocat',
      token: '',
      apiBase: 'https://api.github.com',
      refreshMs: 30 * 60 * 1000,
      timeoutMs: 5_000,
      enrich: false
    },
    fedl: {
      apiBase: 'https://fedl.test/api',
      siteUrl: 'https://fedl.test',
      github: { owner: 'octocat', repo: 'alpha' },
      refreshMs: 15 * 60 * 1000,
      timeoutMs: 5_000
    },
    analytics: { retentionDays: 30, dedupeSeconds: 10 },
    rateLimits: {
      api: { limit: 1000, windowMs: 60_000 },
      analytics: { limit: 1000, windowMs: 60_000 },
      login: { limit: 100, windowMs: 60_000 }
    },
    http: { requestTimeoutMs: 10_000, bodyLimitBytes: 16_384 },
    logLevel: 'error',
    projects,
    services,
    servers,
    warnings: []
  };

  return {
    ...config,
    ...overrides,
    cookie: { ...config.cookie, ...(overrides.cookie || {}) },
    vault: { ...config.vault, ...(overrides.vault || {}) },
    monitor: { ...config.monitor, ...(overrides.monitor || {}) },
    github: { ...config.github, ...(overrides.github || {}) },
    fedl: { ...config.fedl, ...(overrides.fedl || {}) },
    analytics: { ...config.analytics, ...(overrides.analytics || {}) },
    rateLimits: { ...config.rateLimits, ...(overrides.rateLimits || {}) },
    http: { ...config.http, ...(overrides.http || {}) },
    projects,
    services,
    servers
  };
}

export function createTestContext(t, overrides = {}) {
  const config = makeConfig(overrides);
  const db = openDatabase(config.dbPath);
  migrate(db);
  seedConfig(db, config);
  t.after(() => {
    try { db.close(); } catch {}
    fs.rmSync(config.tempDir, { recursive: true, force: true });
  });
  return { config, db };
}

export function silentLogger() {
  return {
    error() {},
    warn() {},
    info() {},
    debug() {},
    child() { return this; }
  };
}

export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}
