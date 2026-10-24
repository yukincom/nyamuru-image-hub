// Manual browser regression: node tests/lanAccess.browser.mjs; stop with Ctrl+C.
// A loopback HTTP entry proxies to the real HTTPS gateway with CA verification.
// Only the fixture's own Origin is translated; "null" and foreign origins stay unchanged.
import { createServer } from 'node:http';
import { request } from 'node:https';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureLanCertificate } from '../scripts/lan-certificate.mjs';
import { startLanServer } from '../scripts/lan-server.mjs';

const temp = await mkdtemp(join(tmpdir(), 'nyamuru-lan-access-'));
const root = join(temp, 'public');
await mkdir(root);
await writeFile(join(root, 'index.html'), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>LAN接続検証</title><h1>接続コードなしで開けました</h1><p>接続コードの入力やログイン画面を通らずに表示しています。</p><p>これは検証専用画面です。作品・LLMには接続していません。</p></html>');
const tls = ensureLanCertificate(join(temp, 'tls'), ['localhost', '127.0.0.1']);
const ca = await readFile(tls.caPath);
const gateway = await startLanServer({
  host: '127.0.0.1', port: 0, root, ...tls,
  bridgeUrl: 'http://127.0.0.1:9', supervisorUrl: 'http://127.0.0.1:9', allowedHosts: ['localhost'],
});
const upstream = `https://127.0.0.1:${gateway.server.address().port}`;
let origin;
const proxy = createServer((req, res) => {
  if (req.url === '/__test/entry') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>LAN接続検証入口</title><h1>別サイトから開く検証</h1><a href="${origin}/">にゃむるを開く</a></html>`);
  }
  const headers = { ...req.headers, host: 'localhost' };
  if (headers.origin === origin) headers.origin = 'https://localhost';
  const outgoing = request(upstream + req.url, { ca, servername: 'localhost', method: req.method, headers }, incoming => {
    console.log(JSON.stringify({ method: req.method, path: req.url, origin: req.headers.origin, site: req.headers['sec-fetch-site'], mode: req.headers['sec-fetch-mode'], dest: req.headers['sec-fetch-dest'], status: incoming.statusCode }));
    res.writeHead(incoming.statusCode, incoming.headers);
    incoming.on('error', () => res.destroy());
    incoming.pipe(res);
  });
  outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Test gateway unavailable'); });
  req.pipe(outgoing);
});
await new Promise((done, fail) => { proxy.once('error', fail); proxy.listen(0, '127.0.0.1', done); });
const port = proxy.address().port;
origin = `http://127.0.0.1:${port}`;
console.log(JSON.stringify({ pid: process.pid, entry: `http://localhost:${port}/__test/entry`, origin, upstream }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise(done => proxy.close(done));
  proxy.closeAllConnections();
  await closed;
  await gateway.close();
  await rm(temp, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
setTimeout(() => { void stop(); }, 10 * 60_000).unref();
