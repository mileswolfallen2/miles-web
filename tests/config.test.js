import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

const secret = 'a'.repeat(48);

test('config loads local defaults and project registry', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    SESSION_SECRET: secret,
    VAULT_PASSWORD: 'a local passphrase'
  });

  assert.equal(config.port, 8787);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.production, false);
  assert.ok(config.allowedOrigins.has('http://localhost:8787'));
  assert.ok(config.allowedOrigins.has('https://milesallen.site'));
  assert.ok(config.projects.length > 5);
  assert.equal(config.projects.find((p) => p.id === 'fedl').featured, true);
  assert.equal(config.services.length, 5);
  assert.equal(config.servers[0].ip, '10.0.0.87');
  assert.equal(config.servers[0].name, 'Main Server');
  assert.equal(config.servers[1].name, 'FEDL Server');
});

test('config honors environment overrides without changing code', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    SESSION_SECRET: secret,
    VAULT_PASSWORD: 'a local passphrase',
    PORT: '9001',
    HOST: '0.0.0.0',
    SERVER_1_NAME: 'Rack One',
    SERVER_1_IP: '192.168.1.50',
    SERVICE_FEDL_URL: 'https://fedl.example.test/',
    SERVICE_FEDL_ENABLED: 'false',
    HOME_SUBNET: '192.168.1.0/24'
  });

  assert.equal(config.port, 9001);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.servers[0].name, 'Rack One');
  assert.equal(config.servers[0].ip, '192.168.1.50');
  assert.equal(config.services.find((s) => s.id === 'fedl').url, 'https://fedl.example.test/');
  assert.equal(config.services.find((s) => s.id === 'fedl').enabled, false);
  assert.equal(config.monitor.expectedSubnet, '192.168.1.0/24');
});

test('production split-origin config allows the API and main site origins', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: secret,
    VAULT_PASSWORD: 'a local passphrase',
    PUBLIC_ORIGIN: 'https://api.milesallen.site',
    ALLOWED_ORIGINS: 'https://milesallen.site,https://www.milesallen.site'
  });

  assert.equal(config.publicOrigin, 'https://api.milesallen.site');
  assert.ok(config.allowedOrigins.has('https://milesallen.site'));
  assert.ok(config.allowedOrigins.has('https://www.milesallen.site'));
  assert.ok(config.allowedOrigins.has('https://api.milesallen.site'));
  assert.equal(config.cookie.sameSite, 'Strict');
  assert.equal(config.cookie.secure, true);
});

test('production refuses missing or short session secrets', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', VAULT_PASSWORD: 'a local passphrase' }),
    /SESSION_SECRET is required/
  );
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short', VAULT_PASSWORD: 'a local passphrase' }),
    /at least 32 characters/
  );
});

test('invalid origins and service URLs are rejected at startup', () => {
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      SESSION_SECRET: secret,
      VAULT_PASSWORD: 'x',
      ALLOWED_ORIGINS: 'not a url'
    }),
    /Invalid origin/
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      SESSION_SECRET: secret,
      VAULT_PASSWORD: 'x',
      SERVICE_FEDL_URL: 'javascript:alert(1)'
    }),
    /Invalid URL/
  );
});
