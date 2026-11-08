import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsService } from '../server/services/analytics.js';
import { createTestContext } from './helpers.js';

test('analytics records normalized, deduplicated, non-bot pageviews', (t) => {
  const { config, db } = createTestContext(t);
  let at = new Date('2026-11-07T12:00:00.000Z');
  const service = createAnalyticsService({ db, config, now: () => at });
  const userAgent = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36';

  const first = service.recordHit({
    path: '/projects/fedl.html?utm=1#top',
    referrer: 'https://www.google.com/search?q=test',
    ip: '203.0.113.9',
    userAgent,
    at
  });
  assert.equal(first.recorded, true);
  assert.equal(first.path, '/projects/fedl.html');

  const duplicate = service.recordHit({
    path: '/projects/fedl.html',
    referrer: null,
    ip: '203.0.113.9',
    userAgent,
    at
  });
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.reason, 'duplicate');

  const bot = service.recordHit({
    path: '/',
    referrer: null,
    ip: '203.0.113.9',
    userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
    at
  });
  assert.equal(bot.recorded, false);
  assert.equal(bot.reason, 'bot');

  at = new Date(at.getTime() + 11 * 1000);
  const afterDedupe = service.recordHit({
    path: '/',
    referrer: null,
    ip: '203.0.113.9',
    userAgent,
    at
  });
  assert.equal(afterDedupe.recorded, true);

  const rows = db.prepare('SELECT path, visitor_hash, referrer_domain FROM pageviews ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].path, '/projects/fedl.html');
  assert.equal(rows[0].referrer_domain, 'www.google.com');
  assert.equal(rows[1].path, '/');
  assert.notEqual(rows[0].visitor_hash, '203.0.113.9');
  assert.equal(rows[0].visitor_hash.length, 32);

  const columns = db.prepare('PRAGMA table_info(pageviews)').all().map((row) => row.name);
  assert.equal(columns.includes('ip'), false);
  assert.equal(columns.includes('ip_address'), false);
});

test('analytics returns correct totals, daily series, pages, and recent activity', (t) => {
  const { config, db } = createTestContext(t);
  const at = new Date('2026-11-07T12:00:00.000Z');
  const service = createAnalyticsService({ db, config, now: () => at });
  const ua = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36';

  const insert = service.recordHit.bind(service);
  insert({ path: '/', ip: '198.51.100.1', userAgent: ua, at: new Date('2026-11-01T10:00:00.000Z') });
  insert({ path: '/projects/fedl.html', ip: '198.51.100.1', userAgent: ua, at: new Date('2026-11-06T10:00:00.000Z') });
  insert({ path: '/', ip: '198.51.100.2', userAgent: ua, at: new Date('2026-11-07T09:00:00.000Z') });
  insert({ path: '/', ip: '198.51.100.3', userAgent: ua, at: new Date('2026-11-07T10:00:00.000Z') });

  const overview = service.getOverview({ at });
  assert.equal(overview.totals.pageviews, 4);
  assert.equal(overview.totals.pageviewsToday, 2);
  assert.equal(overview.totals.uniqueVisitorsToday, 2);
  assert.equal(overview.totals.pageviews7d, 4);
  assert.equal(overview.daily.length, 30);
  assert.equal(overview.daily.find((day) => day.day === '2026-11-07').views, 2);
  assert.equal(overview.topPages[0].path, '/');
  assert.equal(overview.topPages[0].views, 3);
  assert.equal(overview.recentActivity.length, 4);

  const pages = service.getPages({ at, days: 7, limit: 10 });
  assert.equal(pages.totalPageviews, 4);
  assert.equal(pages.pages.find((page) => page.path === '/').share, 75);
});

test('analytics hashing rotates daily and retention cleanup removes old rows', (t) => {
  const { config, db } = createTestContext(t);
  const dayOne = new Date('2026-11-07T12:00:00.000Z');
  const dayTwo = new Date('2026-11-08T12:00:00.000Z');
  const service = createAnalyticsService({ db, config, now: () => dayOne });
  const ua = 'Mozilla/5.0 Chrome/130 Safari/537.36';

  service.recordHit({ path: '/one', ip: '198.51.100.5', userAgent: ua, at: dayOne });
  service.recordHit({ path: '/two', ip: '198.51.100.5', userAgent: ua, at: dayTwo });
  const hashes = db.prepare('SELECT visitor_hash FROM pageviews ORDER BY id').all().map((row) => row.visitor_hash);
  assert.notEqual(hashes[0], hashes[1], 'daily salt must rotate visitor hashes');

  const removed = service.cleanup(new Date('2026-12-10T12:00:00.000Z'));
  assert.equal(removed, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pageviews').get().c, 0);
});
