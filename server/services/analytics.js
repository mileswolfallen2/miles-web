import { badRequest } from '../lib/errors.js';
import { hashIp } from '../lib/crypto.js';
import { isLikelyBot, normalizePath, referrerDomain } from '../lib/validate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function createAnalyticsService({ db, config, now = () => new Date() }) {
  const stmts = {
    insert: db.prepare(
      'INSERT INTO pageviews (path, visitor_hash, referrer_domain, created_at) VALUES (?, ?, ?, ?)'
    ),
    recentDuplicate: db.prepare(
      'SELECT 1 AS found FROM pageviews WHERE visitor_hash = ? AND path = ? AND created_at >= ? LIMIT 1'
    ),
    total: db.prepare('SELECT COUNT(*) AS views FROM pageviews'),
    range: db.prepare(
      'SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors FROM pageviews WHERE created_at >= ? AND created_at < ?'
    ),
    daily: db.prepare(`
      SELECT substr(created_at, 1, 10) AS day,
             COUNT(*) AS views,
             COUNT(DISTINCT visitor_hash) AS visitors
      FROM pageviews
      WHERE created_at >= ? AND created_at < ?
      GROUP BY day
      ORDER BY day
    `),
    topPages: db.prepare(`
      SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
      FROM pageviews
      WHERE created_at >= ? AND created_at < ?
      GROUP BY path
      ORDER BY views DESC, path ASC
      LIMIT ?
    `),
    pageStats: db.prepare(`
      SELECT path,
             COUNT(*) AS views,
             COUNT(DISTINCT visitor_hash) AS visitors,
             MAX(created_at) AS last_seen
      FROM pageviews
      WHERE created_at >= ? AND created_at < ?
      GROUP BY path
      ORDER BY views DESC, path ASC
      LIMIT ?
    `),
    recent: db.prepare(`
      SELECT path, referrer_domain, created_at
      FROM pageviews
      ORDER BY created_at DESC
      LIMIT ?
    `),
    cleanup: db.prepare('DELETE FROM pageviews WHERE created_at < ?')
  };

  function recordHit({ path, referrer, ip, userAgent, at = now() }) {
    if (isLikelyBot(userAgent)) return { recorded: false, reason: 'bot' };
    const normalized = normalizePath(path);
    if (!normalized) throw badRequest('Invalid page path');

    const visitorHash = hashIp(config.sessionSecret, ip, { date: at, scope: 'analytics' });
    if (config.analytics.dedupeSeconds > 0) {
      const cutoff = new Date(at.getTime() - config.analytics.dedupeSeconds * 1000).toISOString();
      if (stmts.recentDuplicate.get(visitorHash, normalized, cutoff)) {
        return { recorded: false, reason: 'duplicate' };
      }
    }

    const domain = referrerDomain(referrer);
    stmts.insert.run(normalized, visitorHash, domain, at.toISOString());
    return { recorded: true, path: normalized };
  }

  function getOverview({ at = now() } = {}) {
    const today = startOfUtcDay(at);
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const sevenDays = new Date(today.getTime() - 6 * DAY_MS);
    const thirtyDays = new Date(today.getTime() - 29 * DAY_MS);

    const todayRow = stmts.range.get(today.toISOString(), tomorrow.toISOString());
    const weekRow = stmts.range.get(sevenDays.toISOString(), tomorrow.toISOString());
    const monthRow = stmts.range.get(thirtyDays.toISOString(), tomorrow.toISOString());

    const dailyRows = stmts.daily.all(thirtyDays.toISOString(), tomorrow.toISOString());
    const byDay = new Map(dailyRows.map((row) => [row.day, row]));
    const daily = [];
    for (let i = 0; i < 30; i += 1) {
      const date = new Date(thirtyDays.getTime() + i * DAY_MS);
      const key = dayKey(date);
      const row = byDay.get(key);
      daily.push({ day: key, views: row?.views || 0, visitors: row?.visitors || 0 });
    }

    const total = stmts.total.get()?.views || 0;
    const topPages = stmts.topPages.all(thirtyDays.toISOString(), tomorrow.toISOString(), 10);
    const recent = stmts.recent.all(20);

    return {
      generatedAt: at.toISOString(),
      retentionDays: config.analytics.retentionDays,
      totals: {
        pageviews: total,
        pageviewsToday: todayRow.views,
        pageviews7d: weekRow.views,
        pageviews30d: monthRow.views,
        uniqueVisitorsToday: todayRow.visitors,
        uniqueVisitors7d: weekRow.visitors,
        uniqueVisitors30d: monthRow.visitors
      },
      daily,
      topPages,
      recentActivity: recent
    };
  }

  function getPages({ at = now(), days = 30, limit = 50 } = {}) {
    const safeDays = Math.max(1, Math.min(config.analytics.retentionDays, Number(days) || 30));
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const today = startOfUtcDay(at);
    const end = new Date(today.getTime() + DAY_MS);
    const start = new Date(today.getTime() - (safeDays - 1) * DAY_MS);
    const rows = stmts.pageStats.all(start.toISOString(), end.toISOString(), safeLimit);
    const total = rows.reduce((sum, row) => sum + row.views, 0);
    return {
      generatedAt: at.toISOString(),
      range: { days: safeDays, from: start.toISOString(), to: end.toISOString() },
      totalPageviews: total,
      pages: rows.map((row) => ({
        path: row.path,
        views: row.views,
        visitors: row.visitors,
        share: total ? Math.round((row.views / total) * 10000) / 100 : 0,
        lastSeen: row.last_seen
      }))
    };
  }

  function cleanup(at = now()) {
    const cutoff = new Date(at.getTime() - config.analytics.retentionDays * DAY_MS).toISOString();
    return stmts.cleanup.run(cutoff).changes;
  }

  return { recordHit, getOverview, getPages, cleanup };
}
