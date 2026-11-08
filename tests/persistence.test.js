import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDatabase } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { seedConfig } from '../server/db/seed.js';
import { createAnalyticsService } from '../server/services/analytics.js';
import { createVaultService } from '../server/services/vault.js';
import { makeConfig, silentLogger } from './helpers.js';

test('migrations are idempotent and data persists across a restart', async (t) => {
  const config = makeConfig();
  t.after(() => fs.rmSync(config.tempDir, { recursive: true, force: true }));

  const first = openDatabase(config.dbPath);
  assert.equal(migrate(first), 1);
  assert.equal(migrate(first), 0);
  seedConfig(first, config);
  const analytics = createAnalyticsService({ db: first, config });
  analytics.recordHit({
    path: '/persisted',
    ip: '198.51.100.9',
    userAgent: 'Mozilla/5.0 Chrome/130 Safari/537.36',
    at: new Date('2026-11-07T12:00:00.000Z')
  });
  const vault = await createVaultService({ db: first, config, logger: silentLogger() });
  assert.equal(vault.enabled, false);
  first.close();

  const second = openDatabase(config.dbPath);
  assert.equal(migrate(second), 0);
  seedConfig(second, config);
  const rows = second.prepare('SELECT path FROM pageviews').all();
  assert.deepEqual(rows, [{ path: '/persisted' }]);
  assert.equal(second.prepare('SELECT COUNT(*) AS c FROM projects WHERE visible = 1').get().c, 1);
  assert.equal(second.prepare('SELECT COUNT(*) AS c FROM servers').get().c, 1);
  second.close();
});
