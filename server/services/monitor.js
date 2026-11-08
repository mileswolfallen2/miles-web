import { checkHost, networkContext } from './ping.js';
import { checkHttp } from './http-check.js';

const MONITORING_ERRORS = new Set(['ping_unavailable', 'invalid_target']);

export function createMonitor({
  config,
  db,
  logger,
  deps = {},
  now = () => new Date()
}) {
  const pingHost = deps.pingHost || checkHost;
  const httpCheck = deps.checkHttp || checkHttp;
  const getNetworkContext =
    deps.getNetworkContext ||
    (() =>
      networkContext(config.monitor.servers, {
        subnet: config.monitor.expectedSubnet || null
      }));

  const insertServerCheck = db.prepare(`
    INSERT INTO server_checks (server_id, checked_at, online, response_ms, reason, on_home_network)
    VALUES (@serverId, @at, @online, @responseMs, @reason, @onHomeNetwork)
  `);
  const insertServiceCheck = db.prepare(`
    INSERT INTO service_checks (service_id, checked_at, status, response_ms, http_status, error)
    VALUES (@serviceId, @at, @status, @responseMs, @httpStatus, @error)
  `);

  const timers = [];
  const running = { servers: false, services: false };

  async function runServers() {
    if (running.servers) return { skipped: true };
    running.servers = true;
    const started = Date.now();
    let online = 0;
    let checked = 0;
    try {
      const context = getNetworkContext();
      for (const server of config.monitor.servers) {
        if (!server.enabled) continue;
        const result = await pingHost(server.ip, {
          timeoutMs: config.monitor.pingTimeoutMs,
          platform: deps.platform
        });
        const monitoringError = MONITORING_ERRORS.has(result.reason);
        const onHomeNetwork = monitoringError ? 0 : context.onHomeNetwork ? 1 : 0;
        let reason;
        if (monitoringError) reason = `monitor_error:${result.reason}`;
        else if (result.online) reason = 'ok';
        else if (!context.onHomeNetwork) reason = 'not_on_home_network';
        else reason = result.reason || 'unreachable';

        insertServerCheck.run({
          serverId: server.id,
          at: now().toISOString(),
          online: result.online ? 1 : 0,
          responseMs: result.responseMs,
          reason,
          onHomeNetwork
        });
        checked += 1;
        if (result.online) online += 1;
        logger.debug('server check', {
          server: server.id,
          ip: server.ip,
          online: result.online,
          reason,
          responseMs: result.responseMs,
          onHomeNetwork: Boolean(onHomeNetwork)
        });
      }
      logger.info('server monitor pass', {
        checked,
        online,
        onHomeNetwork: context.onHomeNetwork,
        durationMs: Date.now() - started
      });
      return { checked, online, onHomeNetwork: context.onHomeNetwork };
    } finally {
      running.servers = false;
    }
  }

  async function runServices() {
    if (running.services) return { skipped: true };
    running.services = true;
    const started = Date.now();
    const counts = { operational: 0, degraded: 0, offline: 0, unknown: 0 };
    let checked = 0;
    try {
      for (const service of config.services) {
        if (!service.enabled) continue;
        const result = await httpCheck(service.url, {
          timeoutMs: config.monitor.httpTimeoutMs
        });
        insertServiceCheck.run({
          serviceId: service.id,
          at: now().toISOString(),
          status: result.status,
          responseMs: result.responseMs,
          httpStatus: result.httpStatus,
          error: result.error
        });
        counts[result.status] = (counts[result.status] || 0) + 1;
        checked += 1;
        logger.debug('service check', {
          service: service.id,
          url: service.url,
          status: result.status,
          httpStatus: result.httpStatus,
          responseMs: result.responseMs,
          error: result.error
        });
      }
      logger.info('website monitor pass', { checked, ...counts, durationMs: Date.now() - started });
      return { checked, ...counts };
    } finally {
      running.services = false;
    }
  }

  function start() {
    runServers().catch((err) => logger.error('server monitor failed', { error: err.message }));
    runServices().catch((err) => logger.error('website monitor failed', { error: err.message }));

    timers.push(
      setInterval(() => {
        runServers().catch((err) => logger.error('server monitor failed', { error: err.message }));
      }, config.monitor.serverIntervalMs)
    );
    timers.push(
      setInterval(() => {
        runServices().catch((err) => logger.error('website monitor failed', { error: err.message }));
      }, config.monitor.serviceIntervalMs)
    );
  }

  function stop() {
    while (timers.length) clearInterval(timers.pop());
  }

  async function runOnce(kind = 'all') {
    if (kind === 'servers') return runServers();
    if (kind === 'services') return runServices();
    return { servers: await runServers(), services: await runServices() };
  }

  return { start, stop, runOnce, runServers, runServices };
}
