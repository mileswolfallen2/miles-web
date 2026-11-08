import { unavailable } from '../lib/errors.js';

function normalizeLevel(item) {
  if (!item || typeof item.title !== 'string') return null;
  const position = Number.parseInt(item.position, 10);
  return {
    title: item.title,
    position: Number.isFinite(position) ? position : null,
    url: typeof item.url === 'string' ? item.url : null
  };
}

function normalizeRun(item) {
  if (!item || typeof item.id !== 'string') return null;
  return {
    id: item.id,
    playerName: typeof item.playerName === 'string' ? item.playerName : 'unknown',
    levelTitle: typeof item.levelTitle === 'string' ? item.levelTitle : 'unknown',
    percent: typeof item.percent === 'string' ? item.percent : String(item.percent ?? ''),
    videoUrl: typeof item.videoUrl === 'string' ? item.videoUrl : null,
    status: typeof item.status === 'string' ? item.status : 'unknown',
    notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : '',
    submittedAt: typeof item.submittedAt === 'string' ? item.submittedAt : null,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
    reviewedBy: typeof item.reviewedBy === 'string' ? item.reviewedBy : null
  };
}

function levelKey(level) {
  return String(level.title || '').trim().toLowerCase();
}

// Snapshots were originally stored as the full API object ({ items: [...] })
// and are now stored as the items array. Accept both shapes so upgrades do
// not silently lose the previous list and report every level as "added".
export function parseSnapshotItems(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return items.map(normalizeLevel).filter(Boolean);
}

function computeChanges(previous, current) {
  if (!previous) {
    return {
      comparedTo: null,
      added: [],
      removed: [],
      rankChanges: [],
      counts: { added: 0, removed: 0, rankChanges: 0 }
    };
  }

  const prevMap = new Map(previous.items.map((item) => [levelKey(item), item]));
  const currentMap = new Map(current.items.map((item) => [levelKey(item), item]));

  const added = current.items
    .filter((item) => !prevMap.has(levelKey(item)))
    .slice(0, 25)
    .map((item) => ({ title: item.title, position: item.position }));
  const removed = previous.items
    .filter((item) => !currentMap.has(levelKey(item)))
    .slice(0, 25)
    .map((item) => ({ title: item.title, position: item.position }));

  const rankChanges = [];
  for (const [key, item] of currentMap) {
    const before = prevMap.get(key);
    if (!before || !Number.isFinite(before.position) || !Number.isFinite(item.position)) continue;
    const delta = before.position - item.position;
    if (delta !== 0) {
      rankChanges.push({
        title: item.title,
        from: before.position,
        to: item.position,
        delta
      });
    }
  }
  rankChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.title.localeCompare(b.title));

  return {
    comparedTo: previous.fetchedAt,
    added,
    removed,
    rankChanges: rankChanges.slice(0, 25),
    counts: { added: added.length, removed: removed.length, rankChanges: rankChanges.length }
  };
}

function buildStats({ list, runs, fetchedAt, previous, config }) {
  const levels = (Array.isArray(list) ? list : [])
    .map(normalizeLevel)
    .filter(Boolean)
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));

  const records = (Array.isArray(runs) ? runs : []).map(normalizeRun).filter(Boolean);
  const approved = records.filter((run) => run.status === 'approved');
  const rejected = records.filter((run) => run.status === 'rejected');
  const pending = records.filter((run) => run.status !== 'approved' && run.status !== 'rejected');
  const players = new Set(approved.map((run) => run.playerName.toLowerCase()));

  const recentRecords = [...approved]
    .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
    .slice(0, 12);
  const latestUpdates = [...records]
    .sort((a, b) => String(b.updatedAt || b.submittedAt || '').localeCompare(String(a.updatedAt || a.submittedAt || '')))
    .slice(0, 10);

  return {
    generatedAt: fetchedAt,
    site: config.fedl.siteUrl,
    apiBase: config.fedl.apiBase,
    github: config.fedl.github,
    totals: {
      rankedLevels: levels.length,
      records: approved.length,
      submissions: records.length,
      rejected: rejected.length,
      pending: pending.length,
      players: players.size
    },
    topLevels: levels.slice(0, 15),
    recentRecords,
    latestUpdates,
    changes: computeChanges(previous, { items: levels })
  };
}

export function createFedlService({
  config,
  db,
  logger,
  fetchFn = globalThis.fetch,
  now = () => new Date()
}) {
  const stmts = {
    insertSnapshot: db.prepare(
      'INSERT INTO fedl_snapshots (fetched_at, list_json, runs_json) VALUES (?, ?, ?)'
    ),
    latestSnapshot: db.prepare('SELECT * FROM fedl_snapshots ORDER BY id DESC LIMIT 1'),
    previousSnapshot: db.prepare('SELECT * FROM fedl_snapshots ORDER BY id DESC LIMIT 1 OFFSET 1'),
    getStats: db.prepare('SELECT * FROM fedl_stats WHERE id = 1'),
    upsertStats: db.prepare(`
      INSERT INTO fedl_stats (id, stats_json, fetched_at, snapshot_id)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        stats_json = excluded.stats_json,
        fetched_at = excluded.fetched_at,
        snapshot_id = excluded.snapshot_id
    `),
    pruneSnapshots: db.prepare(`
      DELETE FROM fedl_snapshots
      WHERE id NOT IN (SELECT id FROM fedl_snapshots ORDER BY id DESC LIMIT 50)
    `)
  };

  let refreshPromise = null;
  let timer = null;

  async function fetchJson(url) {
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(config.fedl.timeoutMs),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'milesallen-dashboard/1.0'
      }
    });
    if (!response.ok) throw new Error(`FEDL API ${response.status} for ${url}`);
    return response.json();
  }

  function readStats() {
    const row = stmts.getStats.get();
    if (!row) return null;
    try {
      return { stats: JSON.parse(row.stats_json), fetchedAt: row.fetched_at, snapshotId: row.snapshot_id };
    } catch {
      return null;
    }
  }

  function isStale(fetchedAt) {
    const at = new Date(fetchedAt).getTime();
    return !Number.isFinite(at) || now().getTime() - at > config.fedl.refreshMs;
  }

  async function doRefresh({ force = false } = {}) {
    const existing = readStats();
    if (existing && !force && !isStale(existing.fetchedAt)) {
      return existing.stats;
    }

    const started = Date.now();
    const base = config.fedl.apiBase.replace(/\/+$/, '');
    try {
      const [list, runs] = await Promise.all([
        fetchJson(`${base}/list`),
        fetchJson(`${base}/runs`)
      ]);
      if (!list || !Array.isArray(list.items)) throw new Error('FEDL /list returned an unexpected shape');
      if (!runs || !Array.isArray(runs.items)) throw new Error('FEDL /runs returned an unexpected shape');

      const fetchedAt = now().toISOString();
      const previousRow = stmts.latestSnapshot.get();
      const previous = previousRow
        ? {
            fetchedAt: previousRow.fetched_at,
            items: parseSnapshotItems(previousRow.list_json)
          }
        : null;

      const snapshot = stmts.insertSnapshot.run(
        fetchedAt,
        JSON.stringify(list.items),
        JSON.stringify(runs.items)
      );
      const stats = buildStats({ list: list.items, runs: runs.items, fetchedAt, previous, config });
      stmts.upsertStats.run(JSON.stringify(stats), fetchedAt, snapshot.lastInsertRowid);
      stmts.pruneSnapshots.run();

      logger.info('FEDL refresh complete', {
        levels: stats.totals.rankedLevels,
        records: stats.totals.records,
        additions: stats.changes.counts.added,
        removals: stats.changes.counts.removed,
        rankChanges: stats.changes.counts.rankChanges,
        durationMs: Date.now() - started
      });
      return stats;
    } catch (err) {
      if (existing) {
        logger.warn('FEDL refresh failed; serving cached stats', { error: err.message });
        return existing.stats;
      }
      throw unavailable(`FEDL data is unavailable: ${err.message}`);
    }
  }

  function refresh(options = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = doRefresh(options).finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function ensure() {
    const existing = readStats();
    if (existing) {
      if (isStale(existing.fetchedAt) && !refreshPromise) refresh().catch(() => {});
      return { stats: existing.stats, stale: isStale(existing.fetchedAt) };
    }
    const stats = await refresh();
    return { stats, stale: false };
  }

  async function getStats() {
    const { stats, stale } = await ensure();
    return { ...stats, stale };
  }

  async function getActivity() {
    const { stats, stale } = await ensure();
    return {
      generatedAt: stats.generatedAt,
      stale,
      site: stats.site,
      github: stats.github,
      changes: stats.changes,
      recentRecords: stats.recentRecords,
      latestUpdates: stats.latestUpdates
    };
  }

  function start() {
    const existing = readStats();
    if (!existing || isStale(existing.fetchedAt)) {
      refresh().catch((err) => logger.error('FEDL refresh failed', { error: err.message }));
    }
    timer = setInterval(() => {
      refresh().catch((err) => logger.error('FEDL refresh failed', { error: err.message }));
    }, config.fedl.refreshMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { refresh, getStats, getActivity, start, stop };
}
