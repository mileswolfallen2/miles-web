import test from 'node:test';
import assert from 'node:assert/strict';
import argon2 from 'argon2';
import { createVaultService } from '../server/services/vault.js';
import { createTestContext, silentLogger } from './helpers.js';

async function passwordHash(password = 'correct horse battery staple') {
  return argon2.hash(password, {
    type: argon2.argon2id,
    timeCost: 1,
    memoryCost: 8192,
    parallelism: 1,
    hashLength: 32
  });
}

test('vault issues signed HttpOnly sessions and rejects bad credentials', async (t) => {
  const hash = await passwordHash();
  const { config, db } = createTestContext(t, {
    vault: { passwordHash: hash, maxAttempts: 3, windowMs: 60_000 }
  });
  const at = new Date('2026-11-07T12:00:00.000Z');
  const vault = await createVaultService({ config, db, logger: silentLogger(), now: () => at });
  assert.equal(vault.enabled, true);

  const ipHash = vault.ipHashFor('203.0.113.8', at);
  assert.notEqual(ipHash, '203.0.113.8');
  await assert.rejects(
    () => vault.login({ password: 'wrong', ipHash, at }),
    (err) => err.status === 401 && /Invalid credentials/.test(err.message)
  );

  const result = await vault.login({ password: 'correct horse battery staple', ipHash, at });
  assert.match(result.cookie, /^miles_vault=[a-f0-9.]+\.[a-f0-9.]+\.[a-f0-9]+;/);
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /SameSite=Strict/);
  assert.doesNotMatch(result.cookie, /Secure/);

  const session = vault.getSession(result.cookie, at);
  assert.equal(session.sessionId.length, 32);
  assert.equal(session.expiresAt, new Date(at.getTime() + config.cookie.ttlMs).toISOString());

  // A restart must not invalidate a signed, unexpired database-backed session.
  const restarted = await createVaultService({ config, db, logger: silentLogger(), now: () => at });
  assert.ok(restarted.getSession(result.cookie, at));

  const tampered = result.cookie.replace(/([a-f0-9])\./g, (match, char) => {
    return (char === 'a' ? 'b' : 'a') + '.';
  });
  assert.equal(vault.getSession(tampered, at), null);

  assert.equal(vault.getSession(result.cookie, new Date(at.getTime() + config.cookie.ttlMs + 1000)), null);
  assert.equal(vault.getSession(result.cookie, at), null, 'expired session row should be deleted');

  const loggedOut = vault.logout(result.cookie);
  assert.match(loggedOut, /Max-Age=0/);
});

test('vault brute-force protection uses database-backed attempt counts', async (t) => {
  const hash = await passwordHash('only password');
  const { config, db } = createTestContext(t, {
    vault: { passwordHash: hash, maxAttempts: 2, windowMs: 60_000 }
  });
  const at = new Date('2026-11-07T12:00:00.000Z');
  const vault = await createVaultService({ config, db, logger: silentLogger(), now: () => at });
  const ipHash = vault.ipHashFor('198.51.100.7', at);

  await assert.rejects(() => vault.login({ password: 'a', ipHash, at }), /Invalid credentials/);
  await assert.rejects(() => vault.login({ password: 'b', ipHash, at }), /Invalid credentials/);
  await assert.rejects(
    () => vault.login({ password: 'only password', ipHash, at }),
    (err) => err.status === 429 && err.code === 'rate_limited'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM vault_attempts WHERE ip_hash = ? AND success = 0').get(ipHash).c,
    2
  );
});

test('vault reports disabled state without accepting any password', async (t) => {
  const { config, db } = createTestContext(t);
  const vault = await createVaultService({ config, db, logger: silentLogger() });
  assert.equal(vault.enabled, false);
  await assert.rejects(
    () => vault.login({ password: 'anything', ipHash: 'x', at: new Date() }),
    (err) => err.status === 503 && err.code === 'unavailable'
  );
});
