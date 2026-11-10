const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [
  ['24h', DAY_MS],
  ['7d', 7 * DAY_MS],
  ['30d', 30 * DAY_MS]
];

function pct(up, total) {
  if (!total) return null;
  return Math.round((up / total) * 10000) / 100;
}

function iso(date) {
  return date.toISOString();
}

export function deriveServerStatus(check) {
  if (!check) return { status: 'unknown', reason: 'no_data', networkContext: null };
  if (check.reason?.startsWith('monitor_error:')) {
    return { status: 'unknown', reason: check.reason, networkContext: null };
  }
  if (check.online) return { status: 'online', reason: check.reason || 'ok', networkContext: true };
  if (!check.on_home_network) {
    return { status: 'unknown', reason: 'not_on_home_network', networkContext: false };
  }
  return { status: 'offline', reason: check.reason || 'unreachable', networkContext: true };
}

export function deriveServiceStatus(check) {
  if (!check) return { status: 'unknown', reason: 'no_data' };
  return { status: check.status, reason: check.error || 'ok' };
}

export function createStatusService({ db, config, now = () => new Date() }) {
  const stmts = {
    servers: db.prepare('SELECT * FROM servers WHERE enabled = 1 ORDER BY display_order, id'),
    services: db.prepare('SELECT * FROM services WHERE enabled = 1 ORDER BY display_order, id'),
    latestServerCheck: db.prepare(
      'SELECT * FROM server_checks WHERE server_id = ? ORDER BY checked_at DESC LIMIT 1'
    ),
    latestServiceCheck: db.prepare(
      'SELECT * FROM service_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT 1'
    ),
    lastServerSuccess: db.prepare(
      'SELECT MAX(checked_at) AS at FROM server_checks WHERE server_id = ? AND online = 1'
    ),
    lastServiceSuccess: db.prepare(
      "SELECT MAX(checked_at) AS at FROM service_checks WHERE service_id = ? AND status IN ('operational','degraded')"
    ),
    recentServerChecks: db.prepare(
      'SELECT checked_at, online, on_home_network, reason FROM server_checks WHERE server_id = ? ORDER BY checked_at DESC LIMIT 500'
    ),
    recentServiceChecks: db.prepare(
      'SELECT checked_at, status, error FROM service_checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT 500'
    ),
    serverUptime: db.prepare(
      'SELECT COUNT(*) AS total, COALESCE(SUM(online), 0) AS up FROM server_checks WHERE server_id = ? AND checked_at >= ? AND on_home_network = 1'
    ),
    serviceUptime: db.prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status IN ('operational','degraded') THEN 1 ELSE 0 END), 0) AS up FROM service_checks WHERE service_id = ? AND checked_at >= ?"
    ),
    serverHistory: db.prepare(
      'SELECT substr(checked_at, 1, 10) AS day, COUNT(*) AS total, COALESCE(SUM(online), 0) AS up FROM server_checks WHERE server_id = ? AND checked_at >= ? AND on_home_network = 1 GROUP BY day'
    ),
    serviceHistory: db.prepare(
      "SELECT substr(checked_at, 1, 10) AS day, COUNT(*) AS total, COALESCE(SUM(CASE WHEN status IN ('operational','degraded') THEN 1 ELSE 0 END), 0) AS up FROM service_checks WHERE service_id = ? AND checked_at >= ? GROUP BY day"
    ),
    lastCheckTime: db.prepare(
      'SELECT MAX(checked_at) AS at FROM (SELECT checked_at FROM server_checks UNION ALL SELECT checked_at FROM service_checks)'
    )
  };

  function uptimeWindows(rows, at) {
    const out = {};
    for (const [label, span] of WINDOWS) {
      const row = rows.get(at - span) || { total: 0, up: 0 };
      out[label] = pct(row.up, row.total);
    }
    return out;
  }

  function currentRun(rows, derive) {
    if (!rows.length) return { since: null, previous: null };
    const current = derive(rows[0]).status;
    let since = rows[0].checked_at;
    let previous = null;
    for (let i = 1; i < rows.length; i += 1) {
      const status = derive(rows[i]).status;
      if (status === current) since = rows[i].checked_at;
      else {
        previous = status;
        break;
      }
    }
    return { since, previous, current };
  }

  function serverStatus(server, at) {
    const latest = stmts.latestServerCheck.get(server.id);
    const derived = deriveServerStatus(latest);
    const recent = stmts.recentServerChecks.all(server.id);
    const run = currentRun(recent, deriveServerStatus);
    const success = stmts.lastServerSuccess.get(server.id)?.at || null;
    const windows = {};

    for (const [label, span] of WINDOWS) {
      const row = stmts.serverUptime.get(server.id, iso(new Date(at - span)));
      windows[label] = pct(row.up, row.total);
    }

    return {
      id: server.id,
      name: server.name,
      status: derived.status,
      reason: derived.reason,
      networkContext: derived.networkContext,
      lastCheckAt: latest?.checked_at || null,
      lastSuccessAt: success,
      lastChangeAt: run.since,
      previousStatus: run.previous,
      responseMs: latest?.response_ms ?? null,
      uptime: windows,
      checks: recent.length
    };
  }

  function serviceStatus(service, at) {
    const latest = stmts.latestServiceCheck.get(service.id);
    const derived = deriveServiceStatus(latest);
    const recent = stmts.recentServiceChecks.all(service.id);
    const run = currentRun(recent, deriveServiceStatus);
    const success = stmts.lastServiceSuccess.get(service.id)?.at || null;
    const windows = {};

    for (const [label, span] of WINDOWS) {
      const row = stmts.serviceUptime.get(service.id, iso(new Date(at - span)));
      windows[label] = pct(row.up, row.total);
    }

    return {
      id: service.id,
      name: service.name,
      url: service.url,
      status: derived.status,
      reason: derived.reason,
      lastCheckAt: latest?.checked_at || null,
      lastSuccessAt: success,
      lastChangeAt: run.since,
      previousStatus: run.previous,
      responseMs: latest?.response_ms ?? null,
      httpStatus: latest?.http_status ?? null,
      uptime: windows,
      checks: recent.length
    };
  }

  function overallStatus(servers, services) {
    const all = [...servers.map((s) => s.status), ...services.map((s) => s.status)];
    const counts = { operational: 0, degraded: 0, offline: 0, unknown: 0 };
    for (const status of all) counts[status] = (counts[status] || 0) + 1;

    let status = 'unknown';
    if (counts.offline > 0) status = 'offline';
    else if (counts.degraded > 0) status = 'degraded';
    else if (counts.operational > 0) status = 'operational';

    return {
      status,
      counts,
      total: all.length,
      healthy: counts.operational,
      checkedAt: stmts.lastCheckTime.get()?.at || null
    };
  }

  function getServers(at = now().getTime()) {
    return stmts.servers.all().map((server) => serverStatus(server, at));
  }

  function getServices(at = now().getTime()) {
    return stmts.services.all().map((service) => serviceStatus(service, at));
  }

  function onHomeNetwork(servers) {
    const contexts = servers.map((s) => s.networkContext).filter((v) => v !== null);
    if (!contexts.length) return null;
    return contexts.some(Boolean);
  }

  function getStatus(at = now().getTime()) {
    const servers = getServers(at);
    const services = getServices(at);
    const overall = overallStatus(servers, services);
    return {
      generatedAt: new Date(at).toISOString(),
      overall,
      network: {
        onHomeNetwork: onHomeNetwork(servers),
        monitoredSubnet: config.monitor.expectedSubnet || 'inferred /24'
      },
      servers,
      services
    };
  }

  function historyFor(days) {
    const at = now().getTime();
    const span = Math.max(1, Math.min(90, days)) * DAY_MS;
    const start = new Date(at - span + DAY_MS);
    const startIso = start.toISOString();
    const dayKeys = [];
    for (let i = 0; i < Math.max(1, Math.min(90, days)); i += 1) {
      dayKeys.push(new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10));
    }

    function series(rows) {
      const map = new Map(rows.map((row) => [row.day, row]));
      return dayKeys.map((day) => {
        const row = map.get(day);
        return {
          day,
          availability: row ? pct(row.up, row.total) : null,
          up: row?.up ?? 0,
          total: row?.total ?? 0
        };
      });
    }

    const servers = {};
    for (const server of stmts.servers.all()) {
      servers[server.id] = series(stmts.serverHistory.all(server.id, startIso));
    }
    const services = {};
    for (const service of stmts.services.all()) {
      services[service.id] = series(stmts.serviceHistory.all(service.id, startIso));
    }

    return { generatedAt: new Date(at).toISOString(), days: dayKeys.length, servers, services };
  }

  return { getStatus, getServers, getServices, getHistory: historyFor };
}
