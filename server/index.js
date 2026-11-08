import http from 'node:http';
import { loadEnv } from './lib/env.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { openDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seedConfig } from './db/seed.js';
import { createStatusService } from './services/status.js';
import { createAnalyticsService } from './services/analytics.js';
import { createVaultService } from './services/vault.js';
import { createGitHubService } from './services/github.js';
import { createFedlService } from './services/fedl.js';
import { createMonitor } from './services/monitor.js';
import { createApp } from './app.js';

loadEnv();

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'milesallen-dashboard' });

for (const warning of config.warnings) logger.warn(warning);

const db = openDatabase(config.dbPath);
const appliedMigrations = migrate(db);
if (appliedMigrations > 0) logger.info('database migrations applied', { count: appliedMigrations });
seedConfig(db, config);

const status = createStatusService({ db, config });
const analytics = createAnalyticsService({ db, config });
const vault = await createVaultService({ db, config, logger });
const github = createGitHubService({ db, config, logger });
const fedl = createFedlService({ db, config, logger });
const monitor = createMonitor({ db, config, logger });

const handler = createApp({
  config,
  db,
  logger,
  services: { status, analytics, vault, github, fedl, monitor }
});

const server = http.createServer((req, res) => {
  handler(req, res).catch((err) => {
    logger.error('request handler rejected', { error: err?.message || String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Internal server error' } }));
    } else {
      res.destroy();
    }
  });
});

server.requestTimeout = config.http.requestTimeoutMs;
server.headersTimeout = Math.max(5_000, Math.min(20_000, config.http.requestTimeoutMs));
server.keepAliveTimeout = 65_000;

const monitorRetention = db.prepare(`DELETE FROM server_checks WHERE checked_at < ?`);
const serviceRetention = db.prepare(`DELETE FROM service_checks WHERE checked_at < ?`);

function cleanup() {
  try {
    const cutoff = new Date(
      Date.now() - config.monitor.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const servers = monitorRetention.run(cutoff).changes;
    const services = serviceRetention.run(cutoff).changes;
    const views = analytics.cleanup();
    const sessions = vault.cleanup();
    logger.info('retention cleanup', {
      serverChecks: servers,
      serviceChecks: services,
      pageviews: views,
      sessions: sessions.sessions,
      attempts: sessions.attempts
    });
  } catch (err) {
    logger.error('retention cleanup failed', { error: err?.message || String(err) });
  }
}

const cleanupTimer = setInterval(cleanup, 6 * 60 * 60 * 1000);
cleanupTimer.unref();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  clearInterval(cleanupTimer);
  monitor.stop();
  github.stop();
  fedl.stop();
  server.close(() => {
    try {
      db.close();
    } catch (err) {
      logger.warn('database close failed', { error: err?.message || String(err) });
    }
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', { error: reason?.message || String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught exception', { error: err?.message || String(err), stack: err?.stack });
});

server.listen(config.port, config.host, () => {
  logger.info('dashboard listening', {
    url: `http://${config.host}:${config.port}`,
    env: config.env,
    database: config.dbPath,
    vault: vault.enabled ? 'enabled' : 'disabled',
    github: config.github.token ? 'authenticated' : 'anonymous',
    githubEnrich: config.github.enrich,
    servers: config.servers.length,
    services: config.services.length
  });
  monitor.start();
  github.start();
  fedl.start();
});

server.on('error', (err) => {
  logger.error('server error', { error: err?.message || String(err), code: err?.code });
  process.exitCode = 1;
});
