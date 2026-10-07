// Static HTTPS server for running the trainer on a headset over Wi-Fi.
//
// WebXR only works in a secure context. localhost counts as one, so a plain
// http server is fine when the headset is tethered through Link -- but a
// wireless Quest reaches the PC by LAN IP, which does not. Hence HTTPS with a
// self-signed certificate: the browser will warn once, and after you accept it
// the origin is a secure context and `Enter VR` lights up.
//
//   node serve.mjs            # https on 8443, all interfaces
//   node serve.mjs --port 9000
//   node serve.mjs --http     # plain http, for localhost / Link only
//
// The certificate is generated on first run (openssl required, which Git for
// Windows ships) and regenerated whenever the machine's LAN address changes.
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const CERT_DIR = path.join(ROOT, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const FINGERPRINT_FILE = path.join(CERT_DIR, 'hosts.txt');

const args = process.argv.slice(2);
const useHttp = args.includes('--http');
const portIndex = args.indexOf('--port');
const PORT = portIndex >= 0 ? Number(args[portIndex + 1]) : useHttp ? 8777 : 8443;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.hdr': 'image/vnd.radiance',
};

/** Every non-loopback IPv4 address this machine answers on. */
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

async function ensureCertificate(hosts) {
  const want = hosts.join(',');
  try {
    const have = await fs.readFile(FINGERPRINT_FILE, 'utf8');
    if (have.trim() === want) {
      await fs.access(CERT_FILE);
      await fs.access(KEY_FILE);
      return;
    }
  } catch {
    // no usable certificate yet; fall through and make one
  }

  await fs.mkdir(CERT_DIR, { recursive: true });
  // Windows OpenSSL installations may not ship a default openssl.cnf.
  const configFile = path.join(CERT_DIR, 'openssl.cnf');
  await fs.writeFile(configFile, '[req]\ndistinguished_name = dn\n[dn]\n');
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...hosts.map((h) => `IP:${h}`)].join(',');
  console.log(`[cert] generating self-signed certificate for ${san}`);
  execFileSync(
    'openssl',
    [
      'req', '-x509',
      '-config', configFile,
      '-newkey', 'rsa:2048',
      '-nodes',
      '-keyout', KEY_FILE,
      '-out', CERT_FILE,
      '-days', '825',
      '-subj', '/CN=welding-xr-demo',
      '-addext', `subjectAltName=${san}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  );
  await fs.writeFile(FINGERPRINT_FILE, want);
}

async function handle(req, res) {
  if (args.includes('--diagnostic')) {
    console.log(`[request] ${req.socket.remoteAddress} ${req.method} ${req.url}`);
  }
  const requested = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const filePath = path.join(ROOT, relative);

  // Never serve outside the project directory, however the path is spelled.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: requested.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const hosts = lanAddresses();

let server;
if (useHttp) {
  server = createHttpServer(handle);
} else {
  await ensureCertificate(hosts);
  const [key, cert] = await Promise.all([
    fs.readFile(KEY_FILE),
    fs.readFile(CERT_FILE),
  ]);
  server = createHttpsServer({ key, cert }, handle);
}

if (args.includes('--diagnostic')) {
  server.on('connection', socket => {
    console.log(`[connection] ${socket.remoteAddress}:${socket.remotePort}`);
  });
  server.on('tlsClientError', (error, socket) => {
    console.log(`[tls-error] ${socket.remoteAddress ?? 'unknown'} ${error.message}`);
  });
}
server.listen(PORT, '0.0.0.0', () => {
  const scheme = useHttp ? 'http' : 'https';
  console.log(`\n  ${scheme}://localhost:${PORT}/    (this PC / Quest Link)`);
  for (const host of hosts) {
    console.log(`  ${scheme}://${host}:${PORT}/   <- open this in the Quest browser`);
  }
  if (!useHttp) {
    console.log(
      '\n  The certificate is self-signed, so the Quest browser will show a warning.' +
        '\n  Tap Advanced -> Proceed. After that WebXR works and "Enter VR" appears.'
    );
  }
  console.log('\n  This serves the project folder to anything on your network. Ctrl+C to stop.\n');
});
