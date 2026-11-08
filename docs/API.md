# API reference

The backend serves both the static site and a JSON API from the same origin.
The default local base URL is `http://127.0.0.1:8787`.

All API responses are JSON with `Cache-Control: no-store` unless noted. There
are no API keys, cookies, or visitor-supplied URLs involved in public read
endpoints. The only cookie in the system is the Moon Vault session cookie.

## Conventions

### Authentication

Public read endpoints require no authentication. The Moon Vault endpoints set
and read a signed, HttpOnly session cookie named `miles_vault` (configurable
with `VAULT_COOKIE_NAME`).

Protected content:

- `GET /vault` — authenticated vault HTML. Redirects to `/moon-vault.html`
  with `302` when there is no valid session.
- `GET /games/*` — authenticated game files. Redirects to
  `/moon-vault.html` with `302` when there is no valid session.

### Errors

All API errors use one shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "API endpoint not found",
    "details": {}
  }
}
```

`details` is optional and is omitted for server errors. Internal errors never
include stack traces or secret values.

| Status | Typical `code` values |
| --- | --- |
| 400 | `bad_request` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found`, `github_not_found` |
| 405 | `method_not_allowed` |
| 429 | `rate_limited` (includes `Retry-After`) |
| 500 | `internal_error` |
| 503 | `unavailable` |

### CORS

Cross-origin API requests are accepted only from the configured allowlist:
`https://milesallen.site`, `https://www.milesallen.site`, local development
origins, and the request's own origin. Unknown origins receive `403`.

`OPTIONS` preflight requests receive `204` with `Access-Control-Allow-Origin`,
`Access-Control-Allow-Methods: GET, POST, OPTIONS`, and
`Access-Control-Allow-Headers: Content-Type`.

### Rate limits

Limits are per client IP and use `429` with a `Retry-After` header when
exceeded.

| Route group | Default |
| --- | --- |
| Public API | 300 requests / minute |
| `POST /api/analytics/hit` | 120 requests / minute |
| `POST /api/vault/login` | 15 requests / 15 minutes |
| Vault failed attempts | 5 / 15 minutes per hashed IP (configurable) |

When `TRUST_PROXY=true`, the client IP is read from `CF-Connecting-IP` or the
first `X-Forwarded-For` value. Leave it false when the Node process is directly
exposed, otherwise clients can spoof their IP.

### Security headers

All responses include:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Request-Id: <16 hex characters>
```

In production, `Strict-Transport-Security: max-age=31536000; includeSubDomains`
is added.

---

## Index and health

### `GET /api`

Returns service metadata and the endpoint list.

```json
{
  "name": "milesallen.site dashboard API",
  "version": "1.0.0",
  "endpoints": ["/api/status", "/api/status/servers", "..."]
}
```

### `GET /api/health`

```json
{
  "status": "ok",
  "uptimeSeconds": 123,
  "time": "2026-11-08T04:50:13.155Z"
}
```

Also accepts `HEAD`.

---

## Infrastructure and service status

### `GET /api/status`

Combined snapshot used by the dashboard.

```json
{
  "generatedAt": "2026-11-08T04:50:13.145Z",
  "overall": {
    "status": "operational",
    "counts": { "operational": 5, "degraded": 0, "offline": 0, "unknown": 0, "online": 2 },
    "total": 7,
    "healthy": 5,
    "checkedAt": "2026-11-08T04:49:21.746Z"
  },
  "network": {
    "onHomeNetwork": true,
    "monitoredSubnet": "10.0.0.0/24"
  },
  "servers": [
    {
      "id": "home-1",
      "name": "Home Server 1",
      "ip": "10.0.0.87",
      "status": "online",
      "reason": "ok",
      "networkContext": true,
      "lastCheckAt": "2026-11-08T04:49:21.000Z",
      "lastSuccessAt": "2026-11-08T04:49:21.000Z",
      "lastChangeAt": "2026-11-08T04:47:24.000Z",
      "previousStatus": null,
      "responseMs": 2.1,
      "uptime": { "24h": 100, "7d": 100, "30d": 100 },
      "checks": 120
    }
  ],
  "services": [
    {
      "id": "fedl",
      "name": "FEDL",
      "url": "https://fedl.site/",
      "status": "operational",
      "reason": "ok",
      "lastCheckAt": "2026-11-08T04:49:21.000Z",
      "lastSuccessAt": "2026-11-08T04:49:21.000Z",
      "lastChangeAt": "2026-11-08T04:47:24.000Z",
      "previousStatus": null,
      "responseMs": 180,
      "httpStatus": 200,
      "uptime": { "24h": 100, "7d": 100, "30d": 100 },
      "checks": 60
    }
  ]
}
```

Status values:

| Component | Values |
| --- | --- |
| Server | `online`, `offline`, `unknown` |
| Service | `operational`, `degraded`, `offline`, `unknown` |
| Overall | `operational`, `degraded`, `offline`, `unknown` |

Server failures are reported as `unknown` with
`reason: "not_on_home_network"` when the Node host is not on `HOME_SUBNET`.
Monitoring failures such as a missing `ping` binary are reported as `unknown`
with `reason` beginning `monitor_error:` so a broken monitor is not mistaken for
a down server.

Uptime percentages are `null` when there is no data for the window.

### `GET /api/status/servers`

```json
{
  "generatedAt": "2026-11-08T04:50:13.149Z",
  "servers": [ /* same server objects as /api/status */ ]
}
```

### `GET /api/status/services`

```json
{
  "generatedAt": "2026-11-08T04:50:13.149Z",
  "services": [ /* same service objects as /api/status */ ]
}
```

### `GET /api/status/history?days=30`

`days` is clamped to 1–90. The response always contains one entry per day for
every configured server and service.

```json
{
  "generatedAt": "2026-11-08T04:50:13.149Z",
  "days": 30,
  "servers": {
    "home-1": [
      { "day": "2026-10-10", "availability": 100, "up": 1440, "total": 1440 }
    ]
  },
  "services": {
    "fedl": [
      { "day": "2026-10-10", "availability": 100, "up": 720, "total": 720 }
    ]
  }
}
```

`availability` is `null` for a day with no checks.

---

## GitHub

Data comes from the official GitHub REST API through the server. Responses are
cached in SQLite and served stale when GitHub is unavailable or rate limited.
The token is never included in any response.

### `GET /api/github/overview`

```json
{
  "generatedAt": "2026-11-08T04:49:20.871Z",
  "username": "mileswolfallen2",
  "profile": {
    "login": "mileswolfallen2",
    "name": "wolf_reaper90",
    "avatarUrl": "https://avatars.githubusercontent.com/u/115095719?v=4",
    "bio": "A dev and 3D artist from Minnesota",
    "company": null,
    "location": "Minnesota",
    "blog": "milesallen.site",
    "followers": 16,
    "following": 42,
    "publicRepos": 165,
    "createdAt": "2022-10-05T15:02:14Z"
  },
  "rateLimit": {
    "authenticated": true,
    "remaining": 4949,
    "resetAt": "2026-11-08T05:31:15.000Z"
  },
  "totals": {
    "stars": 18,
    "forks": 2,
    "openIssues": 13,
    "trackedRepos": 14,
    "publicRepos": 165
  },
  "languages": [{ "name": "JavaScript", "count": 6 }],
  "recentCommits": [
    {
      "repo": "mileswolfallen2/miles-web",
      "project": "milesallen.site",
      "branch": "main",
      "sha": "abcdef1",
      "message": "Commit subject",
      "author": "Miles",
      "date": "2026-11-08T03:00:00Z",
      "url": "https://github.com/mileswolfallen2/miles-web/commit/abcdef1"
    }
  ],
  "recentlyUpdated": [
    { "id": "miles-web", "name": "milesallen.site", "pushedAt": "2026-11-08T03:00:00Z", "latestCommit": {} }
  ],
  "topActive": [{ "repo": "mileswolfallen2/miles-web", "events": 4, "pushes": 2, "project": "milesallen.site" }]
}
```

`recentCommits` is capped at 12 and can be empty when GitHub's public events
window has no push events for the account.

### `GET /api/github/activity`

```json
{
  "generatedAt": "2026-11-08T04:49:20.871Z",
  "username": "mileswolfallen2",
  "rateLimit": {},
  "recentCommits": [],
  "activity": {
    "days": [{ "day": "2026-11-08", "events": 2, "pushes": 1 }],
    "byRepo": [{ "repo": "mileswolfallen2/miles-web", "events": 2, "pushes": 1, "project": "milesallen.site" }]
  }
}
```

`activity.days` always contains 30 entries.

### `GET /api/github/repositories`

```json
{
  "generatedAt": "2026-11-08T04:49:20.871Z",
  "rateLimit": {},
  "repositories": [
    {
      "id": "miles-web",
      "name": "milesallen.site",
      "description": "This portfolio: static HTML, hand-written CSS, no build step.",
      "fullName": "mileswolfallen2/miles-web",
      "url": "https://github.com/mileswolfallen2/miles-web",
      "website": "https://milesallen.site",
      "language": "HTML",
      "stars": 0,
      "forks": 0,
      "openIssues": 0,
      "watchers": 0,
      "defaultBranch": "main",
      "archived": false,
      "fork": false,
      "topics": [],
      "pushedAt": "2026-11-08T03:00:00Z",
      "updatedAt": "2026-11-08T03:00:00Z",
      "createdAt": "2025-01-01T00:00:00Z",
      "latestCommit": {},
      "release": null,
      "contributors": null,
      "featured": false
    }
  ]
}
```

Only projects marked `visible` and configured with a GitHub repo are enriched.
`release` and `contributors` are populated only when `GITHUB_ENRICH=true` and a
token is configured. Per-repo enrichment failures may appear in an `errors`
array on that repository instead of failing the whole response.

---

## Projects

### `GET /api/projects`

Returns visible projects from `server/config/projects.json` (seeded into
SQLite), ordered by `display_order`.

```json
{
  "generatedAt": "2026-11-08T04:50:13.153Z",
  "projects": [
    {
      "id": "fedl",
      "name": "FEDL",
      "description": "Geometry Dash demon list ...",
      "github": {
        "owner": "mileswolfallen2",
        "repo": "fedl",
        "url": "https://github.com/mileswolfallen2/fedl"
      },
      "website": "https://fedl.site",
      "api": { "type": "fedl", "base": "https://server.fedl.site/fedl/api" },
      "featured": true,
      "health": "operational"
    }
  ]
}
```

`github` and `api` are `null` when not configured. `health` is the matching
website-check status or `null` when the project has no monitored website.

### `GET /api/projects/:id`

Returns one visible project by registry id. Returns `404` when the project does
not exist or is hidden.

```json
{
  "project": {
    "id": "fedl",
    "name": "FEDL",
    "description": "Geometry Dash demon list ...",
    "github": { "owner": "mileswolfallen2", "repo": "fedl", "url": "https://github.com/mileswolfallen2/fedl" },
    "website": "https://fedl.site",
    "api": { "type": "fedl", "base": "https://server.fedl.site/fedl/api" },
    "featured": true
  }
}
```

---

## FEDL

FEDL data is fetched only from the configured real API:

- `GET {FEDL_API_BASE}/list`
- `GET {FEDL_API_BASE}/runs`

Expected upstream shapes are `{ "items": [...] }`. The server stores snapshots,
computes diffs between the latest two snapshots, and serves the last good stats
if an upstream refresh fails.

### `GET /api/fedl/stats`

```json
{
  "generatedAt": "2026-11-08T04:46:24.485Z",
  "site": "https://fedl.site",
  "apiBase": "https://server.fedl.site/fedl/api",
  "github": { "owner": "mileswolfallen2", "repo": "fedl" },
  "totals": {
    "rankedLevels": 342,
    "records": 3841,
    "submissions": 3843,
    "rejected": 2,
    "pending": 0,
    "players": 769
  },
  "topLevels": [
    { "title": "GRIEF", "position": 1, "url": "https://youtu.be/gB8slBPlOjc" }
  ],
  "recentRecords": [
    {
      "id": "run_1",
      "playerName": "player1",
      "levelTitle": "Alpha Demon",
      "percent": "100",
      "videoUrl": "https://youtu.be/run1",
      "status": "approved",
      "notes": "",
      "submittedAt": "2026-11-01T00:00:00.000Z",
      "updatedAt": "2026-11-01T00:00:00.000Z",
      "reviewedBy": null
    }
  ],
  "latestUpdates": [],
  "changes": {
    "comparedTo": "2026-11-07T12:00:00.000Z",
    "added": [{ "title": "Delta Demon", "position": 4 }],
    "removed": [{ "title": "Gamma Demon", "position": 3 }],
    "rankChanges": [{ "title": "Beta Demon", "from": 2, "to": 1, "delta": 1 }],
    "counts": { "added": 1, "removed": 1, "rankChanges": 1 }
  },
  "stale": false
}
```

- `comparedTo` is `null` until there are at least two snapshots.
- `stale` is `true` when the served data is a cached copy after a failed
  refresh.
- `topLevels` is capped at 15, `recentRecords` at 12, and `latestUpdates` at 10.
- Diff lists are capped at 25 entries each.

### `GET /api/fedl/activity`

```json
{
  "generatedAt": "2026-11-08T04:46:24.485Z",
  "stale": false,
  "site": "https://fedl.site",
  "github": { "owner": "mileswolfallen2", "repo": "fedl" },
  "changes": {},
  "recentRecords": [],
  "latestUpdates": []
}
```

---

## Analytics

Analytics is cookieless and stores no raw IP addresses. See the privacy notes in
the README.

### `POST /api/analytics/hit`

Request:

```http
POST /api/analytics/hit
Content-Type: application/json

{
  "path": "/projects/fedl.html?utm=1#top",
  "referrer": "https://www.google.com/search?q=test"
}
```

`path` is required and must be a same-site path. Query strings and fragments are
stripped, duplicate slashes are collapsed, `/index.html` becomes `/`, and a
trailing slash is removed except for `/`. `referrer` is optional; only its
hostname is retained.

Response `202`:

```json
{ "recorded": true, "reason": null }
```

`reason` can be `"bot"` or `"duplicate"` when the hit is intentionally ignored.
An invalid path returns `400`. Bots receive `202` with
`{ "recorded": false, "reason": "bot" }` rather than an error.

### `GET /api/analytics/overview`

```json
{
  "generatedAt": "2026-11-08T04:50:13.154Z",
  "retentionDays": 30,
  "totals": {
    "pageviews": 1,
    "pageviewsToday": 1,
    "pageviews7d": 1,
    "pageviews30d": 1,
    "uniqueVisitorsToday": 1,
    "uniqueVisitors7d": 1,
    "uniqueVisitors30d": 1
  },
  "daily": [{ "day": "2026-11-08", "views": 1, "visitors": 1 }],
  "topPages": [{ "path": "/", "views": 1, "visitors": 1 }],
  "recentActivity": [
    {
      "path": "/",
      "referrer_domain": "www.google.com",
      "created_at": "2026-11-08T04:49:35.266Z"
    }
  ]
}
```

`daily` always has 30 entries. `topPages` is limited to 10 and `recentActivity`
to 20 rows.

### `GET /api/analytics/pages?days=30&limit=50`

`days` is clamped to the configured retention period (default 30). `limit` is
clamped to 1–200.

```json
{
  "generatedAt": "2026-11-08T04:50:13.155Z",
  "range": {
    "days": 30,
    "from": "2026-10-10T00:00:00.000Z",
    "to": "2026-11-09T00:00:00.000Z"
  },
  "totalPageviews": 1,
  "pages": [
    {
      "path": "/",
      "views": 1,
      "visitors": 1,
      "share": 100,
      "lastSeen": "2026-11-08T04:49:35.266Z"
    }
  ]
}
```

---

## Moon Vault

### `GET /api/vault/session`

```json
{ "enabled": true, "authenticated": false, "expiresAt": null }
```

`enabled` is false when no Argon2 hash is configured. `expiresAt` is an ISO
timestamp when authenticated.

### `POST /api/vault/login`

Request:

```http
POST /api/vault/login
Content-Type: application/json

{ "password": "the passphrase" }
```

Success `200`:

```json
{ "ok": true, "expiresAt": "2026-11-08T16:49:45.039Z" }
```

Response headers include:

```text
Set-Cookie: miles_vault=<sessionId>.<token>.<signature>; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict
```

`Secure` is appended when `COOKIE_SECURE=true`.

Failures:

- `401 unauthorized` — wrong passphrase or malformed password.
- `429 rate_limited` — too many attempts, with `Retry-After`.
- `503 vault_disabled` — no hash is configured (`VAULT_PASSWORD_HASH` missing).

The session cookie is a random server-side session id plus a random token, both
signed with `SESSION_SECRET`. Only a SHA-256 hash of the token is stored in
SQLite. The session survives server restarts until it expires.

### `POST /api/vault/logout`

```json
{ "ok": true }
```

Clears the cookie and deletes the server-side session.

---

## Static and protected pages

| Route | Behavior |
| --- | --- |
| `GET /` | Serves `index.html` with `Cache-Control: no-cache` |
| `GET /dashboard.html` | Dashboard UI |
| `GET /moon-vault.html` | Public vault lock screen; contains no passphrase |
| `GET /vault` | `200` authenticated vault HTML, otherwise `302` to `/moon-vault.html` |
| `GET /games/*` | `200` authenticated game assets, otherwise `302` to `/moon-vault.html` |
| `GET /analytics.js` | Privacy-friendly pageview beacon |
| Missing file | Serves `404.html` with status `404` |

Static serving blocks path traversal and private paths (`.env`, `.git`,
`node_modules`, `server`, `tests`, `data`, `docs`, `share-server`,
`package.json`, database files). HTML is served with `no-cache`; other files use
`public, max-age=3600`. Range requests are supported for media files.
