// Private desktop server. The launcher owns stdin; closing it stops the server.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm', '.hdr': 'image/vnd.radiance',
};
const pages = new Set([
  'index.html', 'application.html', 'pipe.html', 'shop.html', 'connection-test.html',
  'main.js', 'pipe.js', 'shop.js', 'style.css',
]);
const server = http.createServer(async (req, res) => {
  const fail = (code, message) => res.writeHead(code, { 'Content-Type': 'text/plain' }).end(message);
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed');
  let relative;
  try {
    relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  } catch { return fail(400, 'Bad request'); }
  const file = path.resolve(root, relative);
  const segments = relative.split(/[\\/]/);
  if (!file.startsWith(root + path.sep) || segments.some(s => s.startsWith('.')) ||
      (!pages.has(relative) && !['src', 'vendor', 'assets'].includes(segments[0]))) {
    return fail(403, 'Forbidden');
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) return fail(404, 'Not found');
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch { fail(404, 'Not found'); }
});

// Keep a stable origin for saved browser settings, but never take over another server.
let fallback = false;
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && !fallback) {
    fallback = true;
    server.listen(0, '127.0.0.1');
  } else {
    console.error(error.message);
    process.exit(1);
  }
});
server.on('listening', () => console.log(`WELDING_READY http://127.0.0.1:${server.address().port}/`));
process.stdin.resume();
process.stdin.on('end', () => {
  server.close();
  server.closeAllConnections();
});
server.listen(8777, '127.0.0.1');
