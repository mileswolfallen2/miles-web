CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE server_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  online INTEGER NOT NULL,
  response_ms REAL,
  reason TEXT NOT NULL DEFAULT 'ok',
  on_home_network INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_server_checks_lookup ON server_checks (server_id, checked_at DESC);
CREATE INDEX idx_server_checks_time ON server_checks (checked_at);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE service_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'offline', 'unknown')),
  response_ms REAL,
  http_status INTEGER,
  error TEXT
);
CREATE INDEX idx_service_checks_lookup ON service_checks (service_id, checked_at DESC);
CREATE INDEX idx_service_checks_time ON service_checks (checked_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  github_owner TEXT,
  github_repo TEXT,
  website_url TEXT,
  api_type TEXT,
  api_base TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  etag TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE fedl_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT NOT NULL,
  list_json TEXT NOT NULL,
  runs_json TEXT NOT NULL
);
CREATE INDEX idx_fedl_snapshots_time ON fedl_snapshots (fetched_at DESC);

CREATE TABLE fedl_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stats_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  snapshot_id INTEGER REFERENCES fedl_snapshots(id) ON DELETE SET NULL
);

CREATE TABLE pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer_domain TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pageviews_time ON pageviews (created_at DESC);
CREATE INDEX idx_pageviews_path_time ON pageviews (path, created_at DESC);
CREATE INDEX idx_pageviews_visitor_time ON pageviews (visitor_hash, created_at DESC);
CREATE INDEX idx_pageviews_dedupe ON pageviews (visitor_hash, path, created_at DESC);

CREATE TABLE vault_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_vault_sessions_expiry ON vault_sessions (expires_at);

CREATE TABLE vault_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL
);
CREATE INDEX idx_vault_attempts_lookup ON vault_attempts (ip_hash, attempted_at DESC);
CREATE INDEX idx_vault_attempts_time ON vault_attempts (attempted_at);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
