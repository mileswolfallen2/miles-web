# Deployment guide — Debian 13

This guide describes how to run the backend on a Debian 13 host behind Caddy or
Cloudflare Tunnel. It is written to be followed and verified step by step. The
repository does not perform the deployment for you.

The app is a single Node.js process that serves the static site and the API from
the same origin. SQLite is the only database. There is no Docker, external
database, or frontend build step.

## 1. Target layout

| Path | Purpose |
| --- | --- |
| `/opt/miles-web` | Repository, static site, backend, `.env` |
| `/var/lib/miles-dashboard/dashboard.db` | SQLite database |
| `/var/backups/miles-dashboard/` | SQLite backups |
| `/etc/systemd/system/miles-dashboard.service` | systemd unit |
| `/etc/caddy/Caddyfile` | Caddy reverse proxy (if used) |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnel config (if used) |

Use Caddy **or** Cloudflare Tunnel as the public entry point. Running both is
possible but adds a second moving part; if you do, point the tunnel at Caddy and
do not expose the Node process directly.

## 2. Prerequisites

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential python3 iputils-ping sqlite3
```

Check `ping` exists:

```bash
command -v ping
ping -c 1 10.0.0.87
```

### Node.js 20 or newer

Debian's `nodejs` package may be old enough to be a problem. Verify:

```bash
node -v
```

If it is below 20, install Node 20 LTS from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Do not use `sudo npm`. Install dependencies as the service user.

## 3. Service user and directories

```bash
sudo useradd --system --create-home \
  --home-dir /var/lib/miles-dashboard \
  --shell /usr/sbin/nologin miles
sudo mkdir -p /opt/miles-web /var/lib/miles-dashboard /var/backups/miles-dashboard
sudo chown -R miles:miles /opt/miles-web /var/lib/miles-dashboard /var/backups/miles-dashboard
```

Clone the repository into `/opt/miles-web` (the directory must be empty):

```bash
sudo -u miles git clone <YOUR_REPOSITORY_URL> /opt/miles-web
cd /opt/miles-web
sudo -u miles npm ci --omit=dev
```

If you are deploying from a checkout rather than a remote, copy the files and
then run `npm ci --omit=dev` as `miles`.

### If native modules fail to build

`better-sqlite3` and `argon2` compile native code. If installation fails:

```bash
sudo apt install -y build-essential python3
cd /opt/miles-web
sudo -u miles npm rebuild better-sqlite3 argon2
```

## 4. Environment file

```bash
cd /opt/miles-web
sudo -u miles cp .env.example .env
sudo -u miles chmod 600 .env
sudo -u miles editor .env
```

Production values to set:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
PUBLIC_ORIGIN=https://milesallen.site
TRUST_PROXY=true
DB_PATH=/var/lib/miles-dashboard/dashboard.db
SITE_ROOT=/opt/miles-web
COOKIE_SECURE=true
GITHUB_USERNAME=mileswolfallen2
GITHUB_TOKEN=<server-only token>
VAULT_PASSWORD_HASH=<argon2id hash>
```

Generate the session secret:

```bash
openssl rand -hex 32
```

Put the output in `SESSION_SECRET`. It must be at least 32 characters in
production. Do not reuse the development secret.

Generate the vault hash without putting the passphrase in shell history:

```bash
read -rsp "Vault passphrase: " VAULT_PASS; echo
printf '%s' "$VAULT_PASS" | sudo -u miles npm run hash-password
unset VAULT_PASS
```

Copy the printed `VAULT_PASSWORD_HASH=...` line into `.env`.

Notes:

- `HOST=127.0.0.1` is correct when Caddy or Cloudflare Tunnel runs on the same
  host. Do not bind `0.0.0.0` unless you intend to expose port 8787 directly.
- `TRUST_PROXY=true` is safe only behind a trusted local proxy that overwrites
  `CF-Connecting-IP` or `X-Forwarded-For`. On a directly exposed listener it
  would let clients spoof their IP.
- `COOKIE_SECURE=true` requires HTTPS in the browser. Use it in production.
- `GITHUB_TOKEN` is optional for public data but raises the rate limit. A
  classic token with no scopes is sufficient. Never put it in frontend files.
- `VAULT_PASSWORD_HASH` must start with `$argon2`. If it is missing, the vault
  is disabled and refuses logins.

## 5. Initialize the database

```bash
cd /opt/miles-web
sudo -u miles npm run db:migrate
```

Expected output includes the database path and the table list. The directory
`/var/lib/miles-dashboard` must be writable by `miles`.

SQLite runs in WAL mode. The app creates `dashboard.db`, `dashboard.db-wal`,
and `dashboard.db-shm`. Back up all three safely with the SQLite backup command
in section 9; do not copy only the main file while the service is running.

## 6. systemd service

Create `/etc/systemd/system/miles-dashboard.service`:

```ini
[Unit]
Description=milesallen.site dashboard
Documentation=https://github.com/mileswolfallen2/miles-web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=miles
Group=miles
WorkingDirectory=/opt/miles-web
EnvironmentFile=/opt/miles-web/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
KillSignal=SIGTERM
StandardOutput=journal
StandardError=journal

# Hardening. /opt/miles-web is read-only to the service; the DB directory is
# the only writable path.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/miles-dashboard
CapabilityBoundingSet=CAP_NET_RAW
AmbientCapabilities=CAP_NET_RAW

[Install]
WantedBy=multi-user.target
```

`CAP_NET_RAW` lets the child `ping` process send ICMP without running the whole
service as root. If your host's `ping` works through unprivileged ICMP sockets
and you prefer not to grant any capability, remove the two capability lines and
verify monitoring still works. If pings fail only under systemd, see
[Troubleshooting](#12-troubleshooting).

Reload and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now miles-dashboard
sudo systemctl status miles-dashboard --no-pager
sudo journalctl -u miles-dashboard -n 100 --no-pager
```

Expected log line:

```text
dashboard listening  url=http://127.0.0.1:8787 env=production vault=enabled github=authenticated
```

Verify locally:

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/status | head -c 500
```

The smoke script is intended for local verification. On a production database
it records one synthetic `/smoke-test` analytics pageview:

```bash
cd /opt/miles-web
sudo -u miles npm run smoke
```

## 7. Reverse proxy with Caddy

Install Caddy from the official repository:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Replace `/etc/caddy/Caddyfile`:

```caddyfile
milesallen.site, www.milesallen.site {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8787
}
```

Caddy obtains and renews TLS certificates automatically. Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -n 50 --no-pager
```

Make sure DNS points `milesallen.site` and `www.milesallen.site` at the host
before Caddy tries to issue certificates. Open only the ports you need:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do **not** expose port 8787.

With Caddy in front:

- `TRUST_PROXY=true`
- `COOKIE_SECURE=true`
- `PUBLIC_ORIGIN=https://milesallen.site`
- Keep `HOST=127.0.0.1`

Caddy sets `X-Forwarded-For`; the app reads it only when `TRUST_PROXY=true`.

## 8. Cloudflare Tunnel alternative

Use this instead of public ports and Caddy. The origin can stay on loopback and
no inbound 80/443 is required.

Install `cloudflared` using Cloudflare's current Debian instructions, then:

```bash
cloudflared tunnel login
cloudflared tunnel create miles-dashboard
cloudflared tunnel route dns miles-dashboard milesallen.site
cloudflared tunnel route dns miles-dashboard www.milesallen.site
```

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: milesallen.site
    service: http://127.0.0.1:8787
  - hostname: www.milesallen.site
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Validate and install the service:

```bash
sudo cloudflared tunnel ingress validate
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

Keep `HOST=127.0.0.1`, set `TRUST_PROXY=true` (Cloudflare sets
`CF-Connecting-IP`), and keep `COOKIE_SECURE=true`. No `ufw` rule for 8787,
80, or 443 is needed for the tunnel path.

## 9. Persistence, backups, and restore

### What persists

- `projects`, `services`, and `servers` are seeded from the JSON registry on
  every startup.
- Checks, pageviews, cache entries, FEDL snapshots, and vault sessions live in
  `dashboard.db`.
- `.env` holds secrets and deployment configuration. It is not in git.

### Retention enforced by the app

A cleanup pass runs every six hours and at startup:

- Analytics rows older than `ANALYTICS_RETENTION_DAYS` (default 30).
- Monitor checks older than `MONITOR_RETENTION_DAYS` (default 90).
- FEDL snapshots are pruned to the newest 50.
- Expired vault sessions and vault attempts older than 24 hours.

### Online SQLite backup

```bash
sudo mkdir -p /var/backups/miles-dashboard
sudo sqlite3 /var/lib/miles-dashboard/dashboard.db \
  ".backup '/var/backups/miles-dashboard/dashboard-$(date +%F-%H%M).db'"
```

This is safe while the service is running. Verify the backup:

```bash
sudo sqlite3 /var/backups/miles-dashboard/dashboard-YYYY-MM-DD-HHMM.db \
  "PRAGMA integrity_check; SELECT COUNT(*) FROM pageviews;"
```

Daily cron example (`/etc/cron.d/miles-dashboard-backup`):

```cron
17 3 * * * miles /usr/bin/sqlite3 /var/lib/miles-dashboard/dashboard.db ".backup '/var/backups/miles-dashboard/dashboard-$(date +\%F).db'" && find /var/backups/miles-dashboard -name 'dashboard-*.db' -mtime +14 -delete
```

The `%` characters must be escaped as `\%` in cron.

### Restore

```bash
sudo systemctl stop miles-dashboard
sudo rm -f /var/lib/miles-dashboard/dashboard.db-wal /var/lib/miles-dashboard/dashboard.db-shm
sudo cp /var/lib/miles-dashboard/dashboard.db /var/lib/miles-dashboard/dashboard.db.before-restore
sudo cp /var/backups/miles-dashboard/dashboard-YYYY-MM-DD.db /var/lib/miles-dashboard/dashboard.db
sudo chown miles:miles /var/lib/miles-dashboard/dashboard.db
sudo systemctl start miles-dashboard
curl -fsS http://127.0.0.1:8787/api/health
```

## 10. Upgrades

```bash
cd /opt/miles-web
sudo -u miles git pull --ff-only
sudo -u miles npm ci --omit=dev
sudo -u miles npm run db:migrate
sudo systemctl restart miles-dashboard
sudo journalctl -u miles-dashboard -n 50 --no-pager
```

Run `npm test` on a development machine before deploying changes. Migrations are
idempotent and tracked in `schema_migrations`.

After a Node major-version upgrade, rebuild native modules if needed:

```bash
cd /opt/miles-web
sudo -u miles npm rebuild better-sqlite3 argon2
sudo systemctl restart miles-dashboard
```

## 11. Verification checklist

Run these after deployment:

```bash
# Process and logs
sudo systemctl status miles-dashboard --no-pager
sudo journalctl -u miles-dashboard -n 50 --no-pager

# Local health
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/status

# Public site through the proxy
curl -fsS https://milesallen.site/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' https://milesallen.site/
curl -fsS -o /dev/null -w '%{http_code}\n' https://milesallen.site/dashboard.html

# Vault is locked without a session
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://milesallen.site/vault
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://milesallen.site/games/dino.html

# Private files are not served
curl -s -o /dev/null -w '%{http_code}\n' https://milesallen.site/.env
curl -s -o /dev/null -w '%{http_code}\n' https://milesallen.site/server/config.js
curl -s -o /dev/null -w '%{http_code}\n' https://milesallen.site/data/dashboard.db
```

Expected result for the private-file checks is `403`. The vault and game checks
should return `302` to `/moon-vault.html` before login.

Then verify in a browser:

- The dashboard loads and shows live values (or explicit unavailable states).
- Home-server checks are `online` when the server is on the home LAN.
- The vault login works with the production passphrase; the session survives a
  server restart; logout returns to the lock page.
- A game loads only after login.
- The analytics totals increase after a page view (allow for deduplication and
  bot filtering).

## 12. Troubleshooting

### `better-sqlite3` or `argon2` fails to install

```bash
sudo apt install -y build-essential python3
cd /opt/miles-web
sudo -u miles npm rebuild better-sqlite3 argon2
```

### Servers show `unknown` with `monitor_error:ping_unavailable`

The monitor could not run `ping`. Check:

```bash
command -v ping
ping -c 1 10.0.0.87
getcap "$(command -v ping)" 2>/dev/null || true
sysctl net.ipv4.ping_group_range
```

Fix options, in order of preference:

1. Allow unprivileged ICMP for the service group by setting
   `net.ipv4.ping_group_range` appropriately.
2. Keep the systemd `AmbientCapabilities=CAP_NET_RAW` and
   `CapabilityBoundingSet=CAP_NET_RAW` lines.
3. Remove `NoNewPrivileges=yes` temporarily to test whether it is blocking a
   setuid/capability-based `ping`, then choose a narrower fix.

Never make the Node process run as root just to ping two hosts.

### Servers show `unknown` with `not_on_home_network`

The host's local addresses do not match `HOME_SUBNET`. Set it to the real
subnet (for example `HOME_SUBNET=10.0.0.0/24`) and restart. This is intentional:
a failed ping from a remote network is not reported as a home-server outage.

### Website checks all fail

Check outbound HTTPS and DNS from the server:

```bash
curl -I https://milesallen.site/
curl -I https://fedl.site/
curl -I https://server.fedl.site/fedl/api/list
```

The app only checks configured URLs. It never accepts a visitor-supplied URL.

### Vault is disabled

The log says `vault: disabled` or the API returns `503 vault_disabled` when no
`VAULT_PASSWORD_HASH` is set. Generate one with `npm run hash-password`, add it
to `.env`, and restart. The hash must start with `$argon2`.

### Login succeeds but the browser is not authenticated

- If serving over plain HTTP with `COOKIE_SECURE=true`, the browser discards
  the cookie. Use HTTPS or set `COOKIE_SECURE=false` for local-only testing.
- Confirm the browser is using the same origin as `PUBLIC_ORIGIN`.
- Confirm `SESSION_SECRET` did not change and the database was not wiped.
- Check that `TRUST_PROXY` matches the actual proxy setup.

### API returns `403 forbidden` cross-origin

The request origin is not in the allowlist. Set `PUBLIC_ORIGIN` and
`ALLOWED_ORIGINS` to the real HTTPS origins. Same-origin requests are always
accepted.

### `SQLITE_BUSY` or database locked

Run one service instance only. The app uses WAL mode and short statements; a
second process writing the same file is the usual cause. Do not run
`npm run dev` and the systemd service against the same database.

### GitHub data is stale or missing

- Check the token and rate limit: `curl -H "Authorization: Bearer $TOKEN" https://api.github.com/rate_limit`.
- Without a token, the anonymous limit is low and the dashboard will serve
  cached data.
- `GITHUB_ENRICH=true` requires a token and makes more API calls.

### FEDL data is stale

The dashboard sets `stale: true` and serves the last good snapshot when the FEDL
API is unreachable. Check the upstream API directly:

```bash
curl -fsS https://server.fedl.site/fedl/api/list | head -c 200
curl -fsS https://server.fedl.site/fedl/api/runs | head -c 200
```

## 13. Security checklist

- [ ] `.env` is mode `600`, owned by the service user, and not in git.
- [ ] `SESSION_SECRET` is a fresh 32+ byte random value.
- [ ] `VAULT_PASSWORD_HASH` is Argon2id and the plaintext passphrase is not in
      any file, git history, or shell history.
- [ ] `HOST=127.0.0.1` and port 8787 is not reachable from the internet.
- [ ] `COOKIE_SECURE=true` and the public site is HTTPS.
- [ ] `TRUST_PROXY=true` only behind Caddy/Cloudflare Tunnel.
- [ ] GitHub token is server-only, minimal scope, and never in frontend code.
- [ ] Backups are enabled and a restore has been tested.
- [ ] `/vault` and `/games/*` redirect without a session.
- [ ] Vault and game responses send `Cache-Control: no-store`, so protected
      content is not replayed from browser cache after logout.
- [ ] `/.env`, `/server/`, and `/data/` return `403`.
- [ ] `npm test` passes on the deployed revision.
- [ ] Node.js receives security updates.
