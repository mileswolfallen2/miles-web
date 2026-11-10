# Settings reference

Every setting in this repository, where it lives, who edits it, what it changes,
and what you must do for it to take effect.

There are four independent layers. They do not read each other:

| Layer | Lives in | Edited by | Applies to |
| --- | --- | --- | --- |
| Process environment | `/opt/websites/miles-web/.env` + systemd `EnvironmentFile` | you, on the server | Node backend |
| Registries | `server/config/projects.json`, `services.json`, `servers.json` | you, in the repo | Node backend (seeded into SQLite on startup) |
| Browser config | `site-config.js`, HTML `<meta>` tags, `dashboard.js` | you, in the repo | Static site in the visitor's browser |
| Hosting | systemd unit, Cloudflare Tunnel, DNS, cache rules | you, as root / in Cloudflare | how traffic reaches Node |

## Precedence and how to apply changes

1. Environment variables override registry values (for example
   `SERVER_1_NAME` beats `server/config/servers.json`).
2. Under systemd, `EnvironmentFile=` exports `.env` into `process.env` first.
   The app's `loadEnv()` then fills only keys that are **not already set**.
3. Never put the same key twice in `.env`. When run under systemd the **last**
   duplicate wins; when run directly with `npm start` the **first** duplicate
   wins. Both are confusing, so keep exactly one line per key.
4. `.env` changes: `sudo systemctl restart miles-dashboard`.
5. JSON registry changes: restart (startup runs `seedConfig`, which upserts the
   rows). `sudo -u miles npm run db:migrate` also seeds without starting the
   server.
6. Frontend changes: deploy, then purge Cloudflare and hard-refresh. No restart.
7. systemd unit changes: `sudo systemctl daemon-reload && sudo systemctl restart miles-dashboard`.
8. Cloudflare Tunnel changes: `sudo systemctl restart cloudflared`.

`.env` must be owned by `miles`, mode `600`, and is never committed.

---

## 1. Runtime

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` | Enables production checks, Secure cookies, HSTS, and requires `SESSION_SECRET` | `.env`, restart |
| `HOST` | `127.0.0.1` | bind address | Interface the HTTP server listens on. Keep loopback behind a proxy | `.env`, restart |
| `PORT` | `8787` | 1–65535 | Local HTTP port | `.env`, restart |
| `PUBLIC_ORIGIN` | code: `https://milesallen.site` in production, `http://localhost:<PORT>` otherwise | absolute URL | Canonical origin, added to CORS automatically | `.env`, restart |
| `ALLOWED_ORIGINS` | code: `PUBLIC_ORIGIN` + `https://milesallen.site`, `https://www.milesallen.site`, `https://api.milesallen.site` (+ localhost in development) | comma-separated origins | Cross-origin allowlist for `/api/*`. Anything else gets `403` | `.env`, restart |
| `TRUST_PROXY` | `false` | boolean | Trust `CF-Connecting-IP` / `X-Forwarded-For` for client IPs and rate limits. Enable only behind Cloudflare/Caddy | `.env`, restart |
| `SITE_ROOT` | process working directory | absolute path | Root of the static site served by Node | `.env`, restart |
| `DB_PATH` | `./data/dashboard.db` | absolute path | SQLite file. Production uses `/var/lib/miles-dashboard/dashboard.db` | `.env`, restart |

Booleans accept `1`, `true`, `yes`, `on` (case-insensitive); everything else is false.

---

## 2. Sessions and Moon Vault

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `SESSION_SECRET` | none; random at startup in development | 32+ characters in production | Signs vault session cookies and salts analytics IP hashes. Rotating it logs everyone out and resets analytics identity | `.env`, restart |
| `VAULT_PASSWORD_HASH` | none | Argon2id hash starting `$argon2id$` | Passphrase check. If absent and `VAULT_PASSWORD` absent, the vault is disabled | `.env`, restart |
| `VAULT_PASSWORD` | none | plaintext | Development convenience. Hashed at startup with a warning. Do not use in production | `.env`, restart |
| `VAULT_SESSION_HOURS` | `12` | 1–720 | Session lifetime | `.env`, restart |
| `VAULT_MAX_ATTEMPTS` | `5` | 1–100 | Failed logins per IP hash before lockout | `.env`, restart |
| `VAULT_ATTEMPT_WINDOW_MINUTES` | `15` | 1–1440 | Lockout counting window | `.env`, restart |
| `VAULT_COOKIE_NAME` | `miles_vault` | cookie name | Session cookie name | `.env`, restart |
| `COOKIE_SECURE` | `true` in production, `false` otherwise | boolean | `Secure` flag. Must be true on HTTPS | `.env`, restart |

Not configurable (code): cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/`.
Generate a hash with `npm run hash-password`; generate the secret with
`openssl rand -hex 32`.

---

## 3. GitHub

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `GITHUB_USERNAME` | `mileswolfallen2` | GitHub login | Account fetched by the dashboard | `.env`, restart |
| `GITHUB_TOKEN` | empty | classic token | Server-only API token; never sent to the browser | `.env`, restart |
| `GITHUB_ENRICH` | `false` | boolean | Fetch extra per-repo detail (slower, more API calls) | `.env`, restart |
| `GITHUB_REFRESH_MS` | `1800000` (30 min) | 60000–86400000 | Background refresh interval | `.env`, restart |
| `GITHUB_TIMEOUT_MS` | `10000` | 1000–60000 | Upstream request timeout | `.env`, restart |
| `GITHUB_API_BASE` | `https://api.github.com` | URL | API base (for GitHub Enterprise or tests) | `.env`, restart |

---

## 4. FEDL

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `FEDL_API_BASE` | `api.base` of the `fedl` project in `projects.json`, else `https://server.fedl.site/fedl/api` | URL | FEDL API base | `.env`, restart |
| `FEDL_SITE_URL` | `https://fedl.site` | URL | Link target shown in the UI | `.env`, restart |
| `FEDL_REFRESH_MS` | `900000` (15 min) | 60000–86400000 | Background refresh interval | `.env`, restart |
| `FEDL_TIMEOUT_MS` | `15000` | 1000–60000 | Upstream request timeout | `.env`, restart |

---

## 5. Monitoring

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `HOME_SUBNET` | empty | CIDR, e.g. `10.0.0.0/24` | Subnet used to decide "on home network". When off-network, failed pings report `unknown` instead of `offline` | `.env`, restart |
| `SERVER_CHECK_INTERVAL_MS` | `60000` | 10000–86400000 | Ping loop interval | `.env`, restart |
| `SERVICE_CHECK_INTERVAL_MS` | `120000` | 15000–86400000 | Website check loop interval | `.env`, restart |
| `PING_TIMEOUT_MS` | `2000` | 200–30000 | Ping timeout | `.env`, restart |
| `HTTP_CHECK_TIMEOUT_MS` | `5000` | 500–30000 | Website check timeout | `.env`, restart |
| `MONITOR_RETENTION_DAYS` | `90` | 7–3650 | How long server/service check history is kept | `.env`, restart |

### Server entries (`server/config/servers.json` + env overrides)

Each entry:

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | Stable slug (`^[a-z0-9][a-z0-9-]*$`). Changing it orphans history |
| `name` | no | Display name, defaults to `id` |
| `ip` | yes | IP or hostname to ping (not exposed by the API) |
| `order` | no | Sort order (defaults to array index) |
| `enabled` | no | `false` disables checks (defaults to true) |

Environment overrides use the **1-based position in the file**:

```dotenv
SERVER_1_NAME=Main Server
SERVER_1_IP=10.0.0.87
SERVER_1_ENABLED=true
SERVER_2_NAME=FEDL Server
SERVER_2_IP=10.0.0.119
SERVER_2_ENABLED=true
```

`SERVER_n_*` wins over the JSON value. Restart to apply; the seed upserts names
and IPs into SQLite.

### Service entries (`server/config/services.json` + env overrides)

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | Stable slug. Also used to derive env override names |
| `name` | no | Display name |
| `url` | yes | HTTP(S) URL checked by the monitor |
| `order` | no | Sort order |
| `enabled` | no | `false` disables checks |

Override names are `SERVICE_<ID>_URL` and `SERVICE_<ID>_ENABLED`, where `<ID>`
is uppercased with every non-alphanumeric character replaced by `_`:

```dotenv
SERVICE_FEDL_URL=https://fedl.site/
SERVICE_FEDL_ENABLED=true
```

---

## 6. Analytics

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `ANALYTICS_RETENTION_DAYS` | `30` | 1–365 | Pageview retention | `.env`, restart |
| `ANALYTICS_DEDUPE_SECONDS` | `10` | 0–3600 | Ignore repeat hits from the same IP hash on the same path within this window | `.env`, restart |

Not configurable (code): no cookies, no storage IDs, query strings/fragments are
stripped, referrer is reduced to a domain, bots are filtered, the IP is hashed
with a daily rotating secret. The skip list (`/dashboard`, `/vault`,
`/moon-vault`, `/games/*`, `/api`, `/404`) lives in `analytics.js`.

---

## 7. Limits, timeouts, logging

| Setting | Default | Range / format | What it does | Change |
| --- | --- | --- | --- | --- |
| `API_RATE_LIMIT` | `300` | 10–100000 | Requests per IP per **60 s** for `/api/*` | `.env`, restart |
| `ANALYTICS_RATE_LIMIT` | `120` | 5–100000 | Hits per IP per **60 s** on `/api/analytics/hit` | `.env`, restart |
| `LOGIN_RATE_LIMIT` | `15` | 1–1000 | Login attempts per IP per **15 min** | `.env`, restart |
| `REQUEST_TIMEOUT_MS` | `30000` | 1000–300000 | HTTP request timeout | `.env`, restart |
| `BODY_LIMIT_BYTES` | `16384` | 512–1048576 | Maximum JSON request body | `.env`, restart |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` | Log verbosity | `.env`, restart |

Not configurable (code): rate-limit windows are fixed at 60 s (API, analytics)
and 15 min (login); retention cleanup runs every 6 hours; keep-alive is 65 s.

---

## 8. Registry path overrides

| Setting | Default | What it does | Change |
| --- | --- | --- | --- |
| `PROJECTS_CONFIG_PATH` | `server/config/projects.json` | Alternate projects registry | `.env`, restart |
| `SERVICES_CONFIG_PATH` | `server/config/services.json` | Alternate services registry | `.env`, restart |
| `SERVERS_CONFIG_PATH` | `server/config/servers.json` | Alternate servers registry | `.env`, restart |

Relative paths resolve against the process working directory.

### Project entries (`server/config/projects.json`)

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | Stable slug |
| `name` | no | Display name (defaults to `id`) |
| `description` | no | Card text |
| `github` | no | `{ "owner": "...", "repo": "..." }`; enables GitHub enrichment |
| `website` | no | Public link |
| `api` | no | `{ "type": "fedl", "base": "https://..." }`; drives FEDL integration |
| `order` | no | Sort order |
| `visible` | no | `false` hides it from `/api/projects` |
| `featured` | no | `true` marks it featured |

Projects are upserted into SQLite on startup; the JSON file is the source of truth.

---

## 9. Browser-side settings

These run on the visitor's machine and are independent of `.env`.

| Setting | File | Default | What it does | Apply |
| --- | --- | --- | --- | --- |
| `window.MILES_API_BASE` | set before `site-config.js` loads | empty | Explicit API origin, e.g. `https://api.milesallen.site` | Deploy + purge |
| `<meta name="miles-api-base" content="...">` | HTML `<head>` | none | Same as above, via markup | Deploy + purge |
| `hostname` mapping | `site-config.js` | `milesallen.site` / `www.milesallen.site` → `https://api.milesallen.site` | Production API detection. Any other host (including `api.milesallen.site`) stays same-origin | Deploy + purge |
| `window.MILES_API_URL` | derived by `site-config.js` | `<base>/api` or `/api` | API base used by dashboard, vault, analytics | Deploy + purge |
| `window.MILES_VAULT_URL` | derived by `site-config.js` | `<base>/vault` or `/vault` | Where the lock page redirects after login | Deploy + purge |
| `data-api` attribute | `<html data-api="...">` | none | Highest-priority dashboard API override | Deploy + purge |
| `<meta name="miles-analytics-endpoint" content="...">` | HTML `<head>` | derived | Forces the analytics endpoint. Required on any domain other than `milesallen.site` | Deploy + purge |
| Analytics skip list | `analytics.js` | see §6 | Paths that are never tracked | Code edit + deploy |
| Dashboard refresh | `dashboard.js` (`REFRESH_SECONDS`) | `60` | Auto-refresh interval in seconds | Code edit + deploy |
| Analytics loader | `projects/script.js` | `/analytics.js` | Injects the beacon on every page | Code edit + deploy |

The static host must publish `site-config.js`, `dashboard.html`, `dashboard.js`,
`analytics.js`, and `moon-vault.html` whenever they change. Purge Cloudflare or
hard-refresh, because static responses are cached for 4 hours.

---

## 10. systemd unit (`/etc/systemd/system/miles-dashboard.service`)

Root-owned; edit manually, then `daemon-reload` and restart.

| Directive | Value | Why |
| --- | --- | --- |
| `User` / `Group` | `miles` | Unprivileged service account |
| `WorkingDirectory` | `/opt/websites/miles-web` | Resolves relative config paths |
| `EnvironmentFile` | `/opt/websites/miles-web/.env` | Loads settings |
| `ExecStart` | `/usr/bin/node server/index.js` | Start command |
| `Restart` / `RestartSec` | `on-failure` / `5` | Crash recovery |
| `TimeoutStopSec` | `20` | Graceful shutdown budget |
| `KillSignal` | `SIGTERM` | Allows DB close |
| `ProtectSystem=strict` | on | Read-only system except `ReadWritePaths` |
| `ReadWritePaths` | `/var/lib/miles-dashboard` | Only writable path (SQLite) |
| `NoNewPrivileges`, `PrivateTmp`, `ProtectHome` | on | Hardening |
| `CapabilityBoundingSet` / `AmbientCapabilities` | `CAP_NET_RAW` | Lets the ping child send ICMP without root |

`ExecStart` must point at the real Node binary (`command -v node`). Verify with
`sudo systemctl show miles-dashboard -p EnvironmentFiles -p ExecStart`.

---

## 11. Cloudflare Tunnel and DNS

Manual, external, not in the repo.

| Setting | Value | Where |
| --- | --- | --- |
| Tunnel hostname | `api.milesallen.site` | Cloudflare Zero Trust / `config.yml` |
| Tunnel service | `http://127.0.0.1:8787` | `config.yml` |
| Catch-all | `http_status: 404` | `config.yml` |
| DNS | `api` CNAME to the tunnel | Cloudflare DNS |
| TLS | Cloudflare-managed, Full (strict) | Cloudflare SSL/TLS |
| Cache | purge changed files after deploy | Cloudflare Caching |
| Firewall | do not expose 8787/80/443 for the tunnel path | host firewall |

The static host (`milesallen.site`) is separate from this Node process. It must
serve the current frontend files and call `api.milesallen.site`.

---

## 12. Filesystem and permissions

| Path | Purpose | Owner / mode |
| --- | --- | --- |
| `/opt/websites/miles-web` | repo, site, backend | `miles:miles` |
| `/opt/websites/miles-web/.env` | secrets and settings | `miles:miles`, `600` |
| `/var/lib/miles-dashboard/dashboard.db` | SQLite | `miles:miles` |
| `/var/lib/miles-dashboard/dashboard.db-wal` / `-shm` | SQLite WAL | `miles:miles` |
| `/var/backups/miles-dashboard/` | backups | `miles:miles` |
| `/etc/systemd/system/miles-dashboard.service` | unit | `root:root`, `644` |
| `/etc/cloudflared/config.yml` | tunnel | `root:root` |

SQLite runs in WAL mode; back up with `sqlite3 .backup`, not by copying only the
main file while the service runs.

---

## 13. Commands and script-only variables

| Command | What it does |
| --- | --- |
| `npm start` | Start the server in the foreground |
| `npm run dev` | Start with `--watch` |
| `npm test` | Run the `node:test` suite |
| `npm run db:migrate` | Apply migrations and seed registries |
| `npm run preflight` | Check `.env`, paths, permissions, modules, `ping` |
| `npm run hash-password` | Print an Argon2id hash for `VAULT_PASSWORD_HASH` |
| `npm run smoke` | Hit local endpoints and record one test pageview |

| Variable | Used by | What it does |
| --- | --- | --- |
| `SMOKE_BASE_URL` | `npm run smoke` | Base URL to test (default `http://127.0.0.1:<PORT>`) |
| `VAULT_PASSWORD` | `npm run hash-password` | Accepts the passphrase from the environment instead of argv |

---

## 14. What to do after changing what

| You changed | Required action |
| --- | --- |
| `.env` | `sudo systemctl restart miles-dashboard` |
| `server/config/*.json` | restart (seed upserts on startup) |
| Frontend `.html`, `.js`, `.css` | deploy, purge Cloudflare, hard-refresh |
| systemd unit | `sudo systemctl daemon-reload && sudo systemctl restart miles-dashboard` |
| Cloudflare Tunnel config | `sudo cloudflared tunnel ingress validate && sudo systemctl restart cloudflared` |
| DNS / cache rules | nothing on the host |
| Vault passphrase | `npm run hash-password`, update, restart |
| `SESSION_SECRET` | restart; all sessions are invalidated |
| New file under the static site | deploy and purge, 404s are cached for 4 hours |
