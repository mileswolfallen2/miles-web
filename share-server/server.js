const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// NOTE: set ADMIN_TOKEN to a secret in your environment before running in production.
// Example:  ADMIN_TOKEN="s3cret" node server.js
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

let DB = loadData();

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    const defaults = {
      profile: {},
      timezone: { id: 'America/Chicago', label: 'Central Time (MN, USA)' },
      now: [],
      posts: []
    };
    saveData(defaults);
    return defaults;
  }
}

function saveData(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function mustAuth(req) {
  const header = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return header && safeEqual(header, ADMIN_TOKEN);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return ha.length === hb.length && crypto.timingSafeEqual(ha, hb);
}

app.use(express.json({ limit: '256kb' }));
app.use('/static', express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => {
  res.json(DB);
});

app.post('/api/data', (req, res) => {
  if (!mustAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  const body = req.body || {};
  const next = {};

  if (body.profile) next.profile = sanitizeProfile(body.profile);
  if (body.timezone) next.timezone = sanitizeTimezone(body.timezone);
  if (body.now !== undefined) next.now = sanitizeNow(body.now);
  if (body.posts !== undefined) next.posts = sanitizePosts(body.posts);

  if (Object.keys(next).length === 0) return res.status(400).json({ error: 'nothing to update' });

  DB = { ...DB, ...next };
  saveData(DB);
  res.json({ ok: true, data: DB });
});

function sanitizeProfile(p) {
  return {
    name: str(p.name, ''),
    handle: str(p.handle, ''),
    meta: str(p.meta, ''),
    bio: str(p.bio, ''),
    avatar: str(p.avatar, ''),
    website: str(p.website, '')
  };
}
function sanitizeTimezone(t) {
  return { id: str(t.id, 'America/Chicago'), label: str(t.label, '') };
}
function sanitizeNow(n) {
  if (!Array.isArray(n)) return [];
  return n
    .filter((x) => Array.isArray(x) && x.length >= 2)
    .map((x) => [str(x[0], ''),
    str(x[1], '')])
    .filter((x) => x[0] || x[1]);
}
function sanitizePosts(ps) {
  if (!Array.isArray(ps)) return [];
  return ps
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      title: str(x.title, ''),
      body: str(x.body, ''),
      date: str(x.date, ''),
      link: str(x.link, '')
    }))
    .filter((x) => x.title);
}
function str(v, dflt) {
  return typeof v === 'string' ? v.slice(0, 2000) : dflt;
}

app.get('/admin', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'admin.html'), 'utf8');
  res.set('Content-Type', 'text/html');
  res.send(html.replace('{{DATA}}', JSON.stringify(DB)));
});

app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'views', 'share.html'), 'utf8');
  res.set('Content-Type', 'text/html');
  res.send(html.replace('{{DATA}}', JSON.stringify(DB)));
});

app.listen(PORT, () => {
  console.log(`share server running on http://localhost:${PORT}`);
  console.log(`admin page:  http://localhost:${PORT}/admin`);
  console.log(`api:         http://localhost:${PORT}/api/data`);
});
