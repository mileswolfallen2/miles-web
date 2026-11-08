import argon2 from 'argon2';
import { tooManyRequests, unavailable, unauthorized } from '../lib/errors.js';
import { hashIp, randomHex, safeEqualHex, sha256Hex, signValue, verifySignature } from '../lib/crypto.js';
import { clearCookie, parseCookies, serializeCookie } from '../lib/cookies.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32
};

export async function createVaultService({ config, db, logger, now = () => new Date() }) {
  let passwordHash = config.vault.passwordHash;
  if (!passwordHash && config.vault.password) {
    passwordHash = await argon2.hash(config.vault.password, ARGON2_OPTIONS);
    logger.warn('VAULT_PASSWORD was hashed at startup; prefer VAULT_PASSWORD_HASH for production');
  }
  if (passwordHash && !passwordHash.startsWith('$argon2')) {
    throw new Error('VAULT_PASSWORD_HASH must be an Argon2 hash (generate one with: npm run hash-password)');
  }

  const enabled = Boolean(passwordHash);

  const stmts = {
    insertSession: db.prepare(`
      INSERT INTO vault_sessions (id, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    getSession: db.prepare('SELECT * FROM vault_sessions WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM vault_sessions WHERE id = ?'),
    touchSession: db.prepare('UPDATE vault_sessions SET last_seen_at = ? WHERE id = ?'),
    cleanupSessions: db.prepare('DELETE FROM vault_sessions WHERE expires_at < ?'),
    failures: db.prepare(`
      SELECT COUNT(*) AS count, MIN(attempted_at) AS first
      FROM vault_attempts
      WHERE ip_hash = ? AND success = 0 AND attempted_at >= ?
    `),
    insertAttempt: db.prepare(
      'INSERT INTO vault_attempts (ip_hash, attempted_at, success) VALUES (?, ?, ?)'
    ),
    cleanupAttempts: db.prepare('DELETE FROM vault_attempts WHERE attempted_at < ?')
  };

  function cookieAttributes() {
    return {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      path: '/',
      maxAge: Math.floor(config.cookie.ttlMs / 1000)
    };
  }

  function makeCookie(sessionId, token) {
    const payload = `${sessionId}.${token}`;
    const signature = signValue(config.sessionSecret, `vault:${payload}`);
    return serializeCookie(config.cookie.name, `${payload}.${signature}`, cookieAttributes());
  }

  function readSessionCookie(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const raw = cookies[config.cookie.name];
    if (!raw) return null;
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [id, token, signature] = parts;
    if (!/^[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(signature)) {
      return null;
    }
    if (!verifySignature(config.sessionSecret, `vault:${id}.${token}`, signature)) return null;
    return { id, token };
  }

  function getSession(cookieHeader, at = now()) {
    if (!enabled) return null;
    const parsed = readSessionCookie(cookieHeader);
    if (!parsed) return null;
    const row = stmts.getSession.get(parsed.id);
    if (!row) return null;
    if (!safeEqualHex(row.token_hash, sha256Hex(parsed.token))) return null;
    const expires = new Date(row.expires_at);
    if (!Number.isFinite(expires.getTime()) || expires <= at) {
      stmts.deleteSession.run(row.id);
      return null;
    }
    const lastSeen = new Date(row.last_seen_at);
    if (!Number.isFinite(lastSeen.getTime()) || at.getTime() - lastSeen.getTime() > 5 * 60 * 1000) {
      stmts.touchSession.run(at.toISOString(), row.id);
    }
    return { sessionId: row.id, expiresAt: row.expires_at };
  }

  async function login({ password, ipHash, at = now() }) {
    if (!enabled) throw unavailable('Moon Vault is not configured');
    if (typeof password !== 'string' || password.length < 1 || password.length > 512) {
      throw unauthorized('Invalid credentials');
    }

    const windowStart = new Date(at.getTime() - config.vault.windowMs).toISOString();
    const failures = stmts.failures.get(ipHash, windowStart);
    if (failures.count >= config.vault.maxAttempts) {
      const first = new Date(failures.first);
      const retryAfterMs = Math.max(1000, first.getTime() + config.vault.windowMs - at.getTime());
      throw tooManyRequests('Too many failed attempts. Try again later.', retryAfterMs);
    }

    let ok = false;
    try {
      ok = await argon2.verify(passwordHash, password);
    } catch (err) {
      logger.error('argon2 verification failed', { error: err.message });
      ok = false;
    }

    stmts.insertAttempt.run(ipHash, at.toISOString(), ok ? 1 : 0);
    if (!ok) throw unauthorized('Invalid credentials');

    const sessionId = randomHex(16);
    const token = randomHex(32);
    const expiresAt = new Date(at.getTime() + config.cookie.ttlMs).toISOString();
    stmts.insertSession.run(sessionId, sha256Hex(token), at.toISOString(), expiresAt, at.toISOString());

    return {
      cookie: makeCookie(sessionId, token),
      expiresAt,
      sessionId
    };
  }

  function logout(cookieHeader) {
    const parsed = readSessionCookie(cookieHeader);
    if (parsed) stmts.deleteSession.run(parsed.id);
    return clearCookie(config.cookie.name, {
      httpOnly: true,
      secure: config.cookie.secure,
      sameSite: config.cookie.sameSite,
      path: '/'
    });
  }

  function cleanup(at = now()) {
    const sessions = stmts.cleanupSessions.run(at.toISOString()).changes;
    const attempts = stmts.cleanupAttempts.run(
      new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString()
    ).changes;
    return { sessions, attempts };
  }

  function ipHashFor(ip, at = now()) {
    return hashIp(config.sessionSecret, ip, { date: at, scope: 'vault' });
  }

  return {
    enabled,
    cookieName: config.cookie.name,
    ttlMs: config.cookie.ttlMs,
    login,
    logout,
    getSession,
    cleanup,
    ipHashFor
  };
}

export { ARGON2_OPTIONS };
