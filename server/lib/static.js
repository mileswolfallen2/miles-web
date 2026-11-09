import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.unityweb': 'application/octet-stream',
  '.mem': 'application/octet-stream',
  '.pck': 'application/octet-stream',
  '.zip': 'application/zip'
}));

const DENY_SEGMENTS = new Set([
  '.git',
  '.github',
  'node_modules',
  'server',
  'tests',
  'data',
  'docs',
  'share-server'
]);

const DENY_FILES = new Set([
  '.env',
  '.env.local',
  '.env.example',
  '.DS_Store',
  'package.json',
  'package-lock.json'
]);

function contentType(file) {
  return MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
}

function cacheControl(file) {
  return path.extname(file).toLowerCase() === '.html'
    ? 'no-cache'
    : 'public, max-age=3600';
}

export async function resolveStaticPath(root, rawPathname, { decodedPath = false } = {}) {
  let pathname;
  if (decodedPath) {
    pathname = rawPathname;
  } else {
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch {
      return { error: 400 };
    }
  }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) {
    return { error: 400 };
  }
  if (pathname.length > 2048) return { error: 414 };

  const normalized = path.posix.normalize(pathname);
  if (normalized.includes('..')) return { error: 403 };

  let relative = normalized.replace(/^\/+/, '');
  if (!relative || normalized.endsWith('/')) relative = path.posix.join(relative, 'index.html');

  const segments = relative.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment.startsWith('.') || DENY_SEGMENTS.has(segment)) return { error: 403 };
  }
  if (DENY_FILES.has(segments[segments.length - 1])) return { error: 403 };
  if (/\.(db|db-wal|db-shm|sqlite|sqlite3)$/i.test(relative)) return { error: 403 };

  const resolved = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) return { error: 403 };

  try {
    const realRoot = await fsp.realpath(root);
    const realFile = await fsp.realpath(resolved);
    const realRootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
    if (realFile !== realRoot && !realFile.startsWith(realRootWithSep)) return { error: 403 };
    const stat = await fsp.stat(realFile);
    if (stat.isDirectory()) {
      const indexFile = path.join(realFile, 'index.html');
      const indexStat = await fsp.stat(indexFile);
      return { file: indexFile, stat: indexStat };
    }
    return { file: realFile, stat };
  } catch {
    return { error: 404 };
  }
}

function parseRange(header, size) {
  if (!header) return null;
  const match = String(header).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };
  const [, startRaw, endRaw] = match;
  let start = startRaw === '' ? null : Number.parseInt(startRaw, 10);
  let end = endRaw === '' ? null : Number.parseInt(endRaw, 10);
  if (start === null && end === null) return { invalid: true };
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start < 0 || start >= size || end < start) return { invalid: true };
  return { start, end };
}

export async function sendFile(req, res, file, stat, { status = 200, cache = null, contentTypeOverride = null } = {}) {
  const type = contentTypeOverride || contentType(file);
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': cache || cacheControl(file),
    'Accept-Ranges': 'bytes'
  };

  const range = parseRange(req.headers.range, stat.size);
  if (range?.invalid) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Length': length,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

export async function serveStatic(req, res, { root, pathname, notFoundFile = null, cache = null, decodedPath = false }) {
  const result = await resolveStaticPath(root, pathname, { decodedPath });
  if (result.error === 404) {
    if (notFoundFile) {
      try {
        const stat = await fsp.stat(notFoundFile);
        await sendFile(req, res, notFoundFile, stat, { status: 404, cache: 'no-store' });
        return true;
      } catch {
        // fall through
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
    return true;
  }
  if (result.error) {
    res.writeHead(result.error, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(result.error === 403 ? 'Forbidden' : 'Bad request');
    return true;
  }
  await sendFile(req, res, result.file, result.stat, { cache });
  return true;
}
