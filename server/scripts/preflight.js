import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnv } from '../lib/env.js';
import { loadConfig } from '../config.js';

const checks = [];
function pass(label, detail = '') { checks.push({ level: 'pass', label, detail }); }
function warn(label, detail = '') { checks.push({ level: 'warn', label, detail }); }
function fail(label, detail = '') { checks.push({ level: 'fail', label, detail }); }

function check(condition, label, detail, { fatal = true } = {}) {
  if (condition) pass(label, detail);
  else if (fatal) fail(label, detail);
  else warn(label, detail);
}

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function dirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const envPath = path.resolve(process.cwd(), '.env');
  const envExists = fileExists(envPath);
  check(envExists, '.env exists', envPath);
  if (envExists) {
    const mode = fs.statSync(envPath).mode & 0o777;
    check((mode & 0o077) === 0, '.env permissions are private', `mode ${mode.toString(8)}`, { fatal: false });
  }

  loadEnv(envPath);
  const config = loadConfig();

  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  check(major >= 20, 'Node.js version >= 20', process.versions.node);

  check(config.production, 'NODE_ENV is production', config.env, { fatal: false });
  check(
    config.production ? config.sessionSecret.length >= 32 : true,
    'SESSION_SECRET is long enough',
    `${config.sessionSecret.length} chars`
  );
  check(
    config.production ? config.cookie.secure : true,
    'COOKIE_SECURE is enabled in production',
    String(config.cookie.secure)
  );
  check(config.publicOrigin.startsWith('https://'), 'PUBLIC_ORIGIN uses HTTPS', config.publicOrigin, {
    fatal: config.production
  });
  for (const origin of ['https://milesallen.site', 'https://www.milesallen.site']) {
    check(config.allowedOrigins.has(origin), `CORS origin allowed: ${origin}`, 'allowed');
  }
  check(path.isAbsolute(config.siteRoot), 'SITE_ROOT is absolute', config.siteRoot);
  check(path.isAbsolute(config.dbPath), 'DB_PATH is absolute', config.dbPath);

  check(dirExists(config.siteRoot), 'SITE_ROOT directory exists', config.siteRoot);
  for (const relative of ['index.html', 'dashboard.html', 'moon-vault.html', 'site-config.js', 'projects/style.css']) {
    check(fileExists(path.join(config.siteRoot, relative)), `site file present: ${relative}`);
  }
  check(dirExists(path.join(config.siteRoot, 'games')), 'games directory present', path.join(config.siteRoot, 'games'));

  const dbDir = path.dirname(config.dbPath);
  check(canWriteDir(dbDir), 'database directory is writable', dbDir);

  const vaultHash = config.vault.passwordHash || '';
  check(
    vaultHash.startsWith('$argon2id$'),
    'VAULT_PASSWORD_HASH is an Argon2id hash',
    vaultHash ? 'hash present' : 'not set'
  );
  check(!config.vault.password, 'plaintext VAULT_PASSWORD is not used', config.vault.password ? 'remove it' : 'ok', {
    fatal: false
  });

  check(Boolean(config.github.token), 'GITHUB_TOKEN is set', config.github.token ? 'present' : 'anonymous API limits', {
    fatal: false
  });

  try {
    execFileSync('ping', ['-c', '1', '-W', '2', '127.0.0.1'], { stdio: 'ignore' });
    pass('ping command works', 'localhost probe');
  } catch (err) {
    warn('ping command check failed', err?.code === 'ENOENT' ? 'ping not installed' : 'probe failed');
  }

  try {
    await import('better-sqlite3');
    pass('better-sqlite3 loads');
  } catch (err) {
    fail('better-sqlite3 loads', err.message);
  }
  try {
    await import('argon2');
    pass('argon2 loads');
  } catch (err) {
    fail('argon2 loads', err.message);
  }

  for (const warning of config.warnings) warn('config warning', warning);

  const width = Math.max(...checks.map((c) => c.label.length));
  for (const entry of checks) {
    const tag = entry.level === 'pass' ? 'PASS' : entry.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${tag}  ${entry.label.padEnd(width)}  ${entry.detail}`);
  }

  const failures = checks.filter((c) => c.level === 'fail').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  console.log(`\n${checks.length - failures - warnings} passed, ${warnings} warnings, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`preflight failed: ${err.message}`);
  process.exitCode = 1;
});
