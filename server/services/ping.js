import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function pingArgs(host, { platform = process.platform, timeoutMs = 2000 } = {}) {
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) throw new Error('Invalid ping target');
  if (platform === 'darwin') {
    return ['-n', '-c', '1', '-W', String(Math.max(1, Math.round(timeoutMs))), host];
  }
  if (platform === 'win32') {
    return ['-n', '1', '-w', String(Math.max(1, Math.round(timeoutMs))), host];
  }
  // Linux iputils accepts -W in seconds.
  return ['-n', '-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
}

export function parsePingTime(stdout) {
  const match = String(stdout || '').match(/time[=<]\s*([\d.]+)\s*ms/i);
  if (match) {
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
  }
  if (/1 packets transmitted,\s*1 received/i.test(stdout) || /1 received/i.test(stdout)) return null;
  return null;
}

export async function checkHost(
  host,
  { timeoutMs = 2000, platform = process.platform, execFileFn = execFileAsync } = {}
) {
  let args;
  try {
    args = pingArgs(host, { platform, timeoutMs });
  } catch (err) {
    return { online: false, responseMs: null, reason: 'invalid_target', error: err.message };
  }

  const started = Date.now();
  try {
    const result = await execFileFn('ping', args, {
      timeout: timeoutMs + 1500,
      maxBuffer: 64 * 1024,
      windowsHide: true
    });
    return {
      online: true,
      responseMs: parsePingTime(result.stdout) ?? Date.now() - started,
      reason: 'ok',
      error: null
    };
  } catch (err) {
    const killed = err.killed || err.signal === 'SIGTERM';
    const code = err.code;
    let reason = 'unreachable';
    if (code === 'ENOENT') reason = 'ping_unavailable';
    else if (killed) reason = 'timeout';
    else if (/timed out/i.test(String(err.message))) reason = 'timeout';
    return {
      online: false,
      responseMs: null,
      reason,
      error: String(err.message || 'ping failed').slice(0, 200)
    };
  }
}

export function getLocalIPv4s(interfaces = os.networkInterfaces()) {
  const out = [];
  if (!interfaces) return out;
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list || []) {
      if (item && item.family === 'IPv4' && !item.internal) {
        out.push({ name, address: item.address, netmask: item.netmask });
      }
    }
  }
  return out;
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function inSubnet(ip, cidr) {
  const [base, bitsRaw] = String(cidr).split('/');
  const bits = Number.parseInt(bitsRaw ?? '24', 10);
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/**
 * Heuristic: are we on the same LAN as the home servers?
 * If a subnet is explicitly configured, honor it. Otherwise infer /24s from targets.
 */
export function networkContext(
  servers,
  { interfaces = os.networkInterfaces(), subnet = null, localAddresses = null } = {}
) {
  const local = localAddresses || getLocalIPv4s(interfaces);
  const cidrs = subnet
    ? [subnet]
    : servers
        .map((s) => {
          const ip = String(s.ip);
          if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
          return ip.split('.').slice(0, 3).join('.') + '.0/24';
        })
        .filter(Boolean);

  const onHomeNetwork = local.some((entry) => cidrs.some((cidr) => inSubnet(entry.address, cidr)));
  return {
    onHomeNetwork,
    localAddresses: local.map((entry) => entry.address),
    targets: cidrs
  };
}
