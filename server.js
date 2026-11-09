// TikTok Presenter: a small local server with no dependencies beyond Node.
//   /presenter  the control screen (topics, thumbnails, Previous / Next, import)
//   /present    the broadcast screen for the OBS Browser Source (the slide only)

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary, IMAGE_TYPES, LibraryError } from './lib/library.js';
import { createLive } from './lib/live.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 7272;
const HOST = process.env.HOST || '127.0.0.1';
const SLIDES_DIR = path.resolve(ROOT, process.env.SLIDES_DIR || 'slides');
const REMOVED_DIR = path.resolve(ROOT, process.env.REMOVED_DIR || 'removed');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 40) * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const PAGES = { '/presenter': 'presenter.html', '/present': 'present.html' };

await fsp.mkdir(SLIDES_DIR, { recursive: true });
const library = createLibrary({ slidesDir: SLIDES_DIR, removedDir: REMOVED_DIR });
const live = createLive({ library, stateFile: path.join(ROOT, '.presenter-state.json') });
await live.load();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new LibraryError(`That file is larger than ${Math.round(limit / 1024 / 1024)} MB.`, 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString('utf8') || '{}');
  } catch (error) {
    if (error instanceof LibraryError) throw error;
    throw new LibraryError('The request could not be read.');
  }
}

function sendFile(req, res, file, type, cacheControl) {
  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const etag = `"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl,
      ETag: etag,
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', …]
  const route = `${req.method} /${parts.slice(1).map((p, i) => (i === 1 || i === 3 ? ':' : p)).join('/')}`;

  switch (route) {
    case 'GET /events':
      return live.connect(res, { wantsLibrary: url.searchParams.get('view') === 'presenter' });

    case 'GET /library':
      return sendJson(res, 200, await live.snapshot());

    case 'POST /go': {
      const body = await readJson(req);
      const current =
        typeof body.step === 'number' ? await live.step(body.step) : await live.go(body.topic, body.file);
      return sendJson(res, 200, current);
    }

    case 'POST /topics': {
      const body = await readJson(req);
      const topic = await library.createTopic(body.name ?? '');
      await live.go(topic.id);
      return sendJson(res, 201, topic);
    }

    case 'POST /topics/:/slides': {
      const buffer = await readBody(req, MAX_UPLOAD_BYTES);
      const file = await library.addSlide(parts[2], url.searchParams.get('name') || 'slide', buffer);
      await live.broadcast();
      return sendJson(res, 201, { file });
    }

    case 'PUT /topics/:/order': {
      const body = await readJson(req);
      await library.reorder(parts[2], body.files);
      await live.broadcast();
      return sendJson(res, 200, { ok: true });
    }

    case 'DELETE /topics/:/slides/:': {
      await library.removeSlide(parts[2], parts[4]);
      await live.broadcast();
      return sendJson(res, 200, { ok: true });
    }

    default:
      return sendJson(res, 404, { error: 'Unknown request.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);

    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/presenter' }).end();
      return;
    }

    if (PAGES[url.pathname]) {
      return sendFile(req, res, path.join(PUBLIC_DIR, PAGES[url.pathname]), STATIC_TYPES['.html'], 'no-cache');
    }

    if (url.pathname.startsWith('/slides/')) {
      const [, , topic, file] = url.pathname.split('/').map(decodeURIComponent);
      const full = await library.slidePath(topic, file);
      if (!full) return sendJson(res, 404, { error: 'Slide not found.' });
      // Slide URLs carry the file's modified time, so a changed file gets a new URL.
      const cache = url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return sendFile(req, res, full, IMAGE_TYPES[path.extname(full).toLowerCase()], cache);
    }

    if (url.pathname.startsWith('/assets/')) {
      const full = path.join(PUBLIC_DIR, path.normalize(url.pathname.slice('/assets/'.length)));
      const type = STATIC_TYPES[path.extname(full)];
      if (!full.startsWith(PUBLIC_DIR + path.sep) || !type) return sendJson(res, 404, { error: 'Not found.' });
      return sendFile(req, res, full, type, 'no-cache');
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof LibraryError) {
      sendJson(res, error.status, { error: error.message });
    } else {
      console.error(`${req.method} ${url.pathname} failed:`, error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. See the Terminal window for details.' });
      else res.end();
    }
  }
});

// Images added, renamed or deleted in Finder show up in the Presenter View on their own.
let rescan;
fs.watch(SLIDES_DIR, { recursive: true }, (event, name) => {
  if (name && path.basename(String(name)).startsWith('.')) return;
  clearTimeout(rescan);
  rescan = setTimeout(() => live.broadcast().catch((error) => console.error('Rescan failed:', error)), 300);
});

server.listen(PORT, HOST, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`\nTikTok Presenter is running.\n`);
  console.log(`  Presenter View (you):  ${base}/presenter`);
  console.log(`  OBS Browser Source:    ${base}/present   (1080 × 1920)`);
  console.log(`  Slides folder:         ${SLIDES_DIR}\n`);
  console.log('Keep this window open during the stream. Press Ctrl+C to stop.\n');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. TikTok Presenter may already be running: open http://localhost:${PORT}/presenter`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
