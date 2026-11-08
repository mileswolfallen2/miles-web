const base = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;

const checks = [
  ['health', '/api/health', 200],
  ['status', '/api/status', 200],
  ['servers', '/api/status/servers', 200],
  ['services', '/api/status/services', 200],
  ['github overview', '/api/github/overview', 200],
  ['github activity', '/api/github/activity', 200],
  ['projects', '/api/projects', 200],
  ['fedl stats', '/api/fedl/stats', 200],
  ['fedl activity', '/api/fedl/activity', 200],
  ['analytics overview', '/api/analytics/overview', 200],
  ['analytics pages', '/api/analytics/pages', 200],
  ['vault session', '/api/vault/session', 200],
  ['home page', '/', 200],
  ['dashboard', '/dashboard.html', 200],
  ['vault lock', '/moon-vault.html', 200],
  ['vault content gate', '/vault', 302]
];

let failures = 0;
for (const [name, path, expected] of checks) {
  const started = Date.now();
  try {
    const response = await fetch(base + path, { redirect: 'manual' });
    const ok = response.status === expected;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(20)} ${response.status} (${Date.now() - started}ms)`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name.padEnd(20)} ${err.message}`);
  }
}

try {
  const response = await fetch(base + '/api/analytics/hit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 smoke-test'
    },
    body: JSON.stringify({ path: '/smoke-test?ignored=1', referrer: 'https://example.com/page' })
  });
  const body = await response.json();
  const ok = response.status === 202 && body.recorded === true && body.path === undefined;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${'analytics hit'.padEnd(20)} ${response.status} recorded=${body.recorded}`);
} catch (err) {
  failures += 1;
  console.log(`FAIL ${'analytics hit'.padEnd(20)} ${err.message}`);
}

process.exit(failures ? 1 : 0);
