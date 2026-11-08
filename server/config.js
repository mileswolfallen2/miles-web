import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { clampInt, parseBoolean } from './lib/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read ${label} config at ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label} config at ${file}: ${err.message}`);
  }
}

function resolvePath(value, fallback) {
  const target = value || fallback;
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function normalizeOrigins(values, fallback) {
  const list = values && values.length ? values : fallback;
  const out = new Set();
  for (const value of list) {
    if (!value) continue;
    try {
      out.add(new URL(String(value).trim()).origin);
    } catch {
      throw new Error(`Invalid origin in ALLOWED_ORIGINS: ${value}`);
    }
  }
  return out;
}

function envKey(id, suffix) {
  return `SERVICE_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${suffix}`;
}

function loadProjects(env) {
  const file = resolvePath(env.PROJECTS_CONFIG_PATH, path.join(HERE, 'config', 'projects.json'));
  const raw = readJson(file, 'projects');
  if (!raw || !Array.isArray(raw.projects)) throw new Error('projects.json must contain a "projects" array');
  const seen = new Set();
  return raw.projects
    .map((p, index) => {
      if (!p || typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) {
        throw new Error(`Invalid project id at index ${index}`);
      }
      if (seen.has(p.id)) throw new Error(`Duplicate project id: ${p.id}`);
      seen.add(p.id);
      const github = p.github && p.github.owner && p.github.repo
        ? { owner: String(p.github.owner), repo: String(p.github.repo) }
        : null;
      return {
        id: p.id,
        name: String(p.name || p.id),
        description: p.description ? String(p.description) : '',
        github,
        website: p.website ? String(p.website) : null,
        api: p.api && p.api.type ? { type: String(p.api.type), base: p.api.base ? String(p.api.base) : null } : null,
        order: Number.isFinite(p.order) ? p.order : index,
        visible: p.visible !== false,
        featured: p.featured === true
      };
    })
    .sort((a, b) => a.order - b.order);
}

function loadServices(env) {
  const file = resolvePath(env.SERVICES_CONFIG_PATH, path.join(HERE, 'config', 'services.json'));
  const raw = readJson(file, 'services');
  if (!raw || !Array.isArray(raw.services)) throw new Error('services.json must contain a "services" array');
  const seen = new Set();
  return raw.services
    .map((s, index) => {
      if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) {
        throw new Error(`Invalid service id at index ${index}`);
      }
      if (seen.has(s.id)) throw new Error(`Duplicate service id: ${s.id}`);
      seen.add(s.id);
      const url = env[envKey(s.id, 'URL')] || s.url;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
      } catch {
        throw new Error(`Invalid URL for service ${s.id}: ${url}`);
      }
      return {
        id: s.id,
        name: String(s.name || s.id),
        url: String(url),
        order: Number.isFinite(s.order) ? s.order : index,
        enabled: parseBoolean(env[envKey(s.id, 'ENABLED')], s.enabled !== false)
      };
    })
    .sort((a, b) => a.order - b.order);
}

function loadServers(env) {
  const file = resolvePath(env.SERVERS_CONFIG_PATH, path.join(HERE, 'config', 'servers.json'));
  const raw = readJson(file, 'servers');
  if (!raw || !Array.isArray(raw.servers)) throw new Error('servers.json must contain a "servers" array');
  const seen = new Set();
  return raw.servers
    .map((s, index) => {
      if (!s || typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) {
        throw new Error(`Invalid server id at index ${index}`);
      }
      if (seen.has(s.id)) throw new Error(`Duplicate server id: ${s.id}`);
      seen.add(s.id);
      const n = index + 1;
      const name = env[`SERVER_${n}_NAME`] || s.name || s.id;
      const ip = env[`SERVER_${n}_IP`] || s.ip;
      if (!ip || !/^[A-Za-z0-9.:_-]+$/.test(String(ip))) {
        throw new Error(`Invalid IP/hostname for server ${s.id}: ${ip}`);
      }
      return {
        id: s.id,
        name: String(name),
        ip: String(ip),
        order: Number.isFinite(s.order) ? s.order : index,
        enabled: parseBoolean(env[`SERVER_${n}_ENABLED`], s.enabled !== false)
      };
    })
    .sort((a, b) => a.order - b.order);
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const warnings = [];

  const port = clampInt(env.PORT, 8787, 1, 65535);
  const host = env.HOST || '127.0.0.1';
  const publicOrigin = (() => {
    const value = env.PUBLIC_ORIGIN || (production ? 'https://milesallen.site' : `http://localhost:${port}`);
    try {
      return new URL(value).origin;
    } catch {
      throw new Error(`Invalid PUBLIC_ORIGIN: ${value}`);
    }
  })();

  const productionOrigins = ['https://milesallen.site', 'https://www.milesallen.site'];
  const defaultOrigins = production
    ? [publicOrigin, ...productionOrigins]
    : [
        publicOrigin,
        ...productionOrigins,
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ];
  const allowedOrigins = normalizeOrigins(
    env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : null,
    defaultOrigins
  );
  allowedOrigins.add(publicOrigin);

  let sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret) {
    if (production) throw new Error('SESSION_SECRET is required in production');
    sessionSecret = crypto.randomBytes(32).toString('hex');
    warnings.push('SESSION_SECRET is not set; generated an ephemeral development secret. Sessions and analytics identifiers reset on restart.');
  }
  if (sessionSecret.length < 32 && production) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }

  const vaultPasswordHash = env.VAULT_PASSWORD_HASH || null;
  const vaultPassword = env.VAULT_PASSWORD || null;
  if (!vaultPasswordHash && !vaultPassword) {
    warnings.push('Moon Vault is disabled: set VAULT_PASSWORD_HASH (recommended) or VAULT_PASSWORD in .env.');
  }

  const projects = loadProjects(env);
  const services = loadServices(env);
  const servers = loadServers(env);

  const fedlProject = projects.find((p) => p.id === 'fedl' && p.api?.type === 'fedl');
  const fedlApiBase = env.FEDL_API_BASE || fedlProject?.api?.base || 'https://server.fedl.site/fedl/api';

  const config = {
    env: nodeEnv,
    production,
    host,
    port,
    siteRoot: resolvePath(env.SITE_ROOT, process.cwd()),
    dbPath: resolvePath(env.DB_PATH, './data/dashboard.db'),
    publicOrigin,
    allowedOrigins,
    sessionSecret,
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    cookie: {
      name: env.VAULT_COOKIE_NAME || 'miles_vault',
      secure: parseBoolean(env.COOKIE_SECURE, production),
      sameSite: 'Strict',
      ttlMs: clampInt(env.VAULT_SESSION_HOURS, 12, 1, 24 * 30) * 60 * 60 * 1000
    },
    vault: {
      passwordHash: vaultPasswordHash,
      password: vaultPassword,
      maxAttempts: clampInt(env.VAULT_MAX_ATTEMPTS, 5, 1, 100),
      windowMs: clampInt(env.VAULT_ATTEMPT_WINDOW_MINUTES, 15, 1, 1440) * 60 * 1000
    },
    monitor: {
      servers,
      services,
      serverIntervalMs: clampInt(env.SERVER_CHECK_INTERVAL_MS, 60_000, 10_000, 24 * 60 * 60 * 1000),
      pingTimeoutMs: clampInt(env.PING_TIMEOUT_MS, 2_000, 200, 30_000),
      serviceIntervalMs: clampInt(env.SERVICE_CHECK_INTERVAL_MS, 120_000, 15_000, 24 * 60 * 60 * 1000),
      httpTimeoutMs: clampInt(env.HTTP_CHECK_TIMEOUT_MS, 5_000, 500, 30_000),
      retentionDays: clampInt(env.MONITOR_RETENTION_DAYS, 90, 7, 3650),
      expectedSubnet: env.HOME_SUBNET || null
    },
    github: {
      username: env.GITHUB_USERNAME || 'mileswolfallen2',
      token: env.GITHUB_TOKEN || '',
      apiBase: env.GITHUB_API_BASE || 'https://api.github.com',
      refreshMs: clampInt(env.GITHUB_REFRESH_MS, 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
      timeoutMs: clampInt(env.GITHUB_TIMEOUT_MS, 10_000, 1_000, 60_000),
      enrich: parseBoolean(env.GITHUB_ENRICH, false)
    },
    fedl: {
      apiBase: fedlApiBase,
      siteUrl: env.FEDL_SITE_URL || 'https://fedl.site',
      github: fedlProject?.github || { owner: 'mileswolfallen2', repo: 'fedl' },
      refreshMs: clampInt(env.FEDL_REFRESH_MS, 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
      timeoutMs: clampInt(env.FEDL_TIMEOUT_MS, 15_000, 1_000, 60_000)
    },
    analytics: {
      retentionDays: clampInt(env.ANALYTICS_RETENTION_DAYS, 30, 1, 365),
      dedupeSeconds: clampInt(env.ANALYTICS_DEDUPE_SECONDS, 10, 0, 3600)
    },
    rateLimits: {
      api: {
        limit: clampInt(env.API_RATE_LIMIT, 300, 10, 100_000),
        windowMs: 60_000
      },
      analytics: {
        limit: clampInt(env.ANALYTICS_RATE_LIMIT, 120, 5, 100_000),
        windowMs: 60_000
      },
      login: {
        limit: clampInt(env.LOGIN_RATE_LIMIT, 15, 1, 1000),
        windowMs: 15 * 60 * 1000
      }
    },
    http: {
      requestTimeoutMs: clampInt(env.REQUEST_TIMEOUT_MS, 30_000, 1_000, 300_000),
      bodyLimitBytes: clampInt(env.BODY_LIMIT_BYTES, 16_384, 512, 1024 * 1024)
    },
    logLevel: env.LOG_LEVEL || 'info',
    projects,
    services,
    servers,
    warnings
  };

  return config;
}
