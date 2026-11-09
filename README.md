# miles-web

The personal site for Miles Wolf Allen: a hand-written static portfolio plus a
small Node.js + SQLite backend that serves it locally, monitors infrastructure,
tracks development activity, records privacy-friendly analytics, and protects
the Moon Vault behind server-side authentication.

The static HTML/CSS site is unchanged in spirit and still has no build step.
The backend is plain JavaScript on Node.js with two native dependencies
(`better-sqlite3` and `argon2`); there is no Docker, Go, Rust, Python, or
frontend framework involved.

### Split-origin deployment

The static site can stay on `https://milesallen.site` while the Node backend is
exposed on `https://api.milesallen.site` through a Cloudflare Tunnel. Both
hostnames are under `milesallen.site`, so the vault cookie keeps
`SameSite=Strict` and still works across them. `site-config.js` holds the
API hostname; the dashboard, vault lock page, and analytics beacon use it
and fall back to same-origin when it is empty (local development).

The server's CORS allowlist includes `https://milesallen.site`,
`https://www.milesallen.site`, and `https://api.milesallen.site`. The JSON API
and the vault/game pages are served by the Node process; the main static site
can remain on its current host.

## What is included

| Area | What it does |
| --- | --- |
| Infrastructure | ICMP ping checks for `10.0.0.87` and `10.0.0.119`, HTTP health checks for five sites, uptime history, and honest network context |
| GitHub | Official REST API data for `mileswolfallen2` with server-side caching, ETags, rate-limit handling, and no token exposure |
| FEDL | Real data from `https://server.fedl.site/fedl/api/list` and `/runs`, with snapshot diffs for additions, removals, and rank changes |
| Analytics | Cookieless, IP-hash-only pageviews with bot filtering, deduplication, path normalization, and 30-day retention |
| Moon Vault | Argon2id passphrase verification, signed HttpOnly sessions, login rate limiting, logout, and server-gated content |
| Dashboard | `/dashboard.html` renders every panel from the local API and labels unavailable data instead of inventing values |

## Requirements

- Node.js **20 or newer** (tested locally on Node 26)
- npm
- A C toolchain for the native modules (`better-sqlite3`, `argon2`), which is
  normally present on macOS and can be installed on Debian with
  `build-essential` and `python3`
- `ping` available on the host for server monitoring (`iputils-ping` on Debian)

## Local quick start

```bash
npm install
cp .env.example .env
```

Edit `.env` for local use. At minimum set a session secret:

```bash
# macOS/Linux
openssl rand -hex 32
# put the output in SESSION_SECRET
```

Enable the Moon Vault by generating a hash for a local passphrase:

```bash
npm run hash-password -- "a long local passphrase"
# copy the printed VAULT_PASSWORD_HASH=... line into .env
```

Then initialize the database and start the server:

```bash
npm run db:migrate
npm run dev
```

Open <http://127.0.0.1:8787>. The dashboard is at
<http://127.0.0.1:8787/dashboard.html> and the vault lock page is at
<http://127.0.0.1:8787/moon-vault.html>.

For local development, use these overrides in `.env` so cookies work over
plain HTTP:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=8787
PUBLIC_ORIGIN=http://localhost:8787
COOKIE_SECURE=false
TRUST_PROXY=false
DB_PATH=./data/dashboard.db
```

Do not reuse a development passphrase in production, and never commit `.env`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the server with Node's watch mode |
| `npm start` | Start the server without watch mode |
| `npm test` | Run the full automated test suite with `node:test` |
| `npm run db:migrate` | Apply migrations and seed the project/service/server registries |
| `npm run preflight` | Validate `.env`, paths, permissions, native modules, and `ping` before deployment |
| `npm run hash-password -- "passphrase"` | Print an Argon2id hash to put in `.env` |
| `npm run smoke` | Check a running local server's APIs and vault gates |

`npm run smoke` uses `SMOKE_BASE_URL` if set, otherwise
`http://127.0.0.1:${PORT:-8787}`.

## Configuration

Environment variables are documented in [`.env.example`](.env.example). The
project registry, monitored services, and home servers are JSON files:

- `server/config/projects.json` — id, name, description, GitHub repo, website,
  API integration, order, visibility, and featured flag
- `server/config/services.json` — website health-check targets
- `server/config/servers.json` — home-network ping targets

The JSON files are the defaults. Environment variables can override service
URLs/enabled flags and server name/IP/enabled flags without editing code. The
registries are seeded into SQLite on startup and can be re-seeded by running
`npm run db:migrate`.

### API hostname

`site-config.js` contains the browser-facing API base. In production it maps
`https://milesallen.site` and `https://www.milesallen.site` to
`https://api.milesallen.site`. Override it per deployment by setting
`window.MILES_API_BASE` before the script runs, or by adding a
`<meta name="miles-api-base" content="https://api.example.com">` tag. When the
value is empty, all API calls stay same-origin, which is what local development
uses.

### Adding a project

Add an object to `server/config/projects.json`:

```json
{
  "id": "my-project",
  "name": "My Project",
  "description": "What it does.",
  "github": { "owner": "mileswolfallen2", "repo": "my-project" },
  "website": "https://example.milesallen.site",
  "api": null,
  "order": 21,
  "visible": true,
  "featured": false
}
```

Use `"visible": false` to hide an entry without deleting it. Reorder with
`order`. Restart the server (or run `npm run db:migrate`) after editing.

### Adding a monitored website

Add an entry to `server/config/services.json`:

```json
{
  "id": "my-site",
  "name": "My Site",
  "url": "https://my-site.milesallen.site/",
  "order": 6,
  "enabled": true
}
```

Only server-side configured URLs are checked. The API never accepts a URL from
a visitor, which avoids SSRF.

## Moon Vault

The public `moon-vault.html` page is now only a lock screen. The authenticated
content lives in `server/views/vault.html` and is served at `/vault` only with a
valid server-side session. Files under `/games/*` are also gated by the same
session.

The old plaintext passphrase has been removed from the public HTML. The server
stores only an Argon2id hash in `.env`, sessions are signed and stored in
SQLite, and cookies are HttpOnly, SameSite=Strict, path `/`, and Secure when
`COOKIE_SECURE=true` (the production default). Failed login attempts are rate
limited per hashed IP and persisted in the database.

If `VAULT_PASSWORD_HASH` is not set, the vault reports itself as unconfigured
and refuses logins; it does not fall back to a default password.

## Privacy and security notes

- Analytics does not set cookies and never stores a raw IP address. The backend
  hashes the request IP with a daily rotating secret scoped to analytics, then
  stores only the hash, normalized path, referrer domain, and timestamp.
- Query strings and fragments are stripped from recorded paths. Bot user agents
  are ignored. Repeat hits on the same path within the dedupe window are
  dropped. Rows older than the retention period are deleted.
- GitHub and FEDL calls happen on the server. The GitHub token is never included
  in API responses or frontend code.
- CORS is an explicit allowlist: `https://milesallen.site`,
  `https://www.milesallen.site`, `https://api.milesallen.site`, local
  development origins, and same-origin requests. Unknown cross-origin API
  requests are rejected.
- Request bodies have a hard size limit, API and login routes are rate limited,
  request timeouts are enforced, and errors returned to clients do not expose
  stack traces or secrets.
- Static file serving blocks path traversal and private paths such as `.env`,
  `server/`, `data/`, and `node_modules/`.
- Security headers include `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, and HSTS in production.

## Testing

```bash
npm test
```

The suite uses Node's built-in test runner. Each test gets an isolated temporary
SQLite database; network calls are mocked. There are tests for configuration,
ping/network context, HTTP checks, monitor persistence and uptime, GitHub
caching and fallbacks, FEDL snapshot diffs and fallbacks, analytics privacy and
retention, vault auth and brute-force protection, CORS/security headers, static
traversal protection, and database persistence across restarts.

Live smoke test against a running local server:

```bash
npm run dev          # terminal 1
npm run smoke        # terminal 2
```

The smoke script checks every public API, the static pages, the unauthenticated
vault/game redirects, and that an analytics hit is accepted.

## Project layout

```text
analytics.js                 Privacy-friendly pageview beacon
site-config.js               Browser-facing API hostname for split-origin
dashboard.html/.css/.js      API-driven developer dashboard
moon-vault.html              Public vault lock screen
server/
  app.js                     HTTP router, CORS, security headers, gates
  index.js                   Startup, background refresh, cleanup, shutdown
  config.js                  Environment and registry loading
  config/*.json              Projects, services, servers
  db/                        SQLite connection, migrations, seed
  lib/                       Env, cookies, crypto, errors, HTTP, logging, limits
  services/                  Ping, HTTP checks, status, monitor, GitHub, FEDL,
                             analytics, vault
  scripts/                   migrate, preflight, hash-password, smoke
  views/vault.html           Authenticated vault content
  migrations/001_init.sql    Schema and indexes
tests/                       node:test suite and isolated fixtures
docs/API.md                  API reference
docs/DEPLOYMENT.md           Debian deployment and operations guide
```

## Documentation

- [API reference](docs/API.md)
- [Deployment guide for Debian 13](docs/DEPLOYMENT.md)

## Contacts

- Email: mileswa1q2@gmail.com
- GitHub: <https://github.com/mileswolfallen2>
- Personal site: <https://milesallen.site>

## Notes

- The backend is designed to run locally without any production SSH, DNS,
  Cloudflare Tunnel, Caddy, or remote access. Those are deployment choices, not
  local requirements.
- Production deployment is documented but not performed by this repository.
  Follow `docs/DEPLOYMENT.md` and verify each step on the target host.
