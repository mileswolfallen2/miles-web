import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHost, parsePingTime, pingArgs, inSubnet, networkContext } from '../server/services/ping.js';
import { checkHttp, classifyHttpStatus } from '../server/services/http-check.js';
import { createStatusService } from '../server/services/status.js';
import { createMonitor } from '../server/services/monitor.js';
import { createTestContext, silentLogger } from './helpers.js';

test('ping arguments adapt to macOS and Linux', () => {
  assert.deepEqual(pingArgs('10.0.0.87', { platform: 'darwin', timeoutMs: 2000 }), [
    '-n', '-c', '1', '-W', '2000', '10.0.0.87'
  ]);
  assert.deepEqual(pingArgs('10.0.0.87', { platform: 'linux', timeoutMs: 2000 }), [
    '-n', '-c', '1', '-W', '2', '10.0.0.87'
  ]);
  assert.throws(() => pingArgs('10.0.0.87; rm -rf /', { platform: 'linux' }), /Invalid ping target/);
});

test('ping output parsing and failure reasons are honest', async () => {
  assert.equal(parsePingTime('64 bytes from 10.0.0.87: icmp_seq=0 ttl=64 time=2.34 ms'), 2.34);
  assert.equal(parsePingTime('64 bytes from 10.0.0.87: icmp_seq=0 ttl=64 time<1 ms'), 1);
  assert.equal(parsePingTime('1 packets transmitted, 0 received'), null);

  const online = await checkHost('10.0.0.87', {
    execFileFn: async () => ({ stdout: '64 bytes from 10.0.0.87: time=4.2 ms' })
  });
  assert.equal(online.online, true);
  assert.equal(online.responseMs, 4.2);

  const timeout = await checkHost('10.0.0.87', {
    execFileFn: async () => {
      const err = new Error('process timed out');
      err.killed = true;
      throw err;
    }
  });
  assert.equal(timeout.online, false);
  assert.equal(timeout.reason, 'timeout');
});

test('network context distinguishes home LAN from remote networks', () => {
  assert.equal(inSubnet('10.0.0.131', '10.0.0.0/24'), true);
  assert.equal(inSubnet('192.168.1.20', '10.0.0.0/24'), false);
  const local = networkContext(
    [{ ip: '10.0.0.87' }],
    {
      localAddresses: [{ address: '10.0.0.131', name: 'en0' }]
    }
  );
  assert.equal(local.onHomeNetwork, true);

  const remote = networkContext(
    [{ ip: '10.0.0.87' }],
    { localAddresses: [{ address: '172.16.0.8', name: 'en0' }] }
  );
  assert.equal(remote.onHomeNetwork, false);
});

test('HTTP checks classify status and timeouts', async () => {
  assert.equal(classifyHttpStatus(200), 'operational');
  assert.equal(classifyHttpStatus(301), 'operational');
  assert.equal(classifyHttpStatus(404), 'degraded');
  assert.equal(classifyHttpStatus(503), 'offline');

  const ok = await checkHttp('https://alpha.test/', {
    fetchFn: async () => new Response('hello', { status: 200 })
  });
  assert.equal(ok.status, 'operational');
  assert.equal(ok.httpStatus, 200);

  const fail = await checkHttp('https://alpha.test/', {
    fetchFn: async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    }
  });
  assert.equal(fail.status, 'offline');
  assert.match(fail.error, /timeout/);
});

test('monitor stores server and service checks, and remote failures become unknown', async (t) => {
  const { config, db } = createTestContext(t);
  const fixed = new Date('2026-11-07T12:00:00.000Z');
  let call = 0;
  const monitor = createMonitor({
    config,
    db,
    logger: silentLogger(),
    now: () => fixed,
    deps: {
      platform: 'linux',
      pingHost: async () => {
        call += 1;
        return { online: true, responseMs: 3.5, reason: 'ok', error: null };
      },
      checkHttp: async () => ({
        status: 'operational',
        responseMs: 42,
        httpStatus: 200,
        error: null
      }),
      getNetworkContext: () => ({ onHomeNetwork: true, localAddresses: ['10.0.0.131'] })
    }
  });

  const result = await monitor.runOnce('all');
  assert.equal(result.servers.online, 1);
  assert.equal(result.services.checked, 1);
  assert.equal(call, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM server_checks').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM service_checks').get().c, 1);

  const status = createStatusService({ db, config, now: () => fixed });
  const snapshot = status.getStatus();
  assert.equal(snapshot.servers[0].status, 'online');
  assert.equal(snapshot.services[0].status, 'operational');
  assert.equal(snapshot.network.onHomeNetwork, true);

  // The same offline result must not be called an outage when the laptop is remote.
  const remote = createTestContext(t);
  const remoteMonitor = createMonitor({
    config: remote.config,
    db: remote.db,
    logger: silentLogger(),
    now: () => fixed,
    deps: {
      pingHost: async () => ({ online: false, responseMs: null, reason: 'unreachable', error: 'no route' }),
      checkHttp: async () => ({ status: 'offline', responseMs: 1, httpStatus: null, error: 'timeout' }),
      getNetworkContext: () => ({ onHomeNetwork: false, localAddresses: ['172.16.0.5'] })
    }
  });
  await remoteMonitor.runServers();
  const remoteStatus = createStatusService({ db: remote.db, config: remote.config, now: () => fixed });
  const remoteSnapshot = remoteStatus.getStatus();
  assert.equal(remoteSnapshot.servers[0].status, 'unknown');
  assert.equal(remoteSnapshot.servers[0].reason, 'not_on_home_network');
});

test('uptime windows are computed from stored history', (t) => {
  const { config, db } = createTestContext(t);
  const now = new Date('2026-11-07T12:00:00.000Z');
  const insert = db.prepare(`
    INSERT INTO server_checks (server_id, checked_at, online, response_ms, reason, on_home_network)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  insert.run('home-1', new Date(now.getTime() - 30 * 60 * 1000).toISOString(), 0, null, 'unreachable');
  insert.run('home-1', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), 1, 2.1, 'ok');
  insert.run('home-1', new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(), 1, 1.9, 'ok');
  insert.run('home-1', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(), 1, 3.1, 'ok');

  const status = createStatusService({ db, config, now: () => now });
  const server = status.getServers()[0];
  assert.equal(server.status, 'offline');
  assert.equal(server.uptime['24h'], 66.67);
  assert.equal(server.uptime['7d'], 66.67);
  assert.equal(server.uptime['30d'], 75);
  assert.equal(server.lastChangeAt, new Date(now.getTime() - 30 * 60 * 1000).toISOString());

  const history = status.getHistory(30);
  assert.equal(history.days, 30);
  assert.equal(history.servers['home-1'].length, 30);
});
