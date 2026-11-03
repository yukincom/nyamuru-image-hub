import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

// Only processing APIs are exposed. Workspace, catalog and native file-picker APIs stay on the Mac.
export const BRIDGE_PATHS = new Set([
  '/api/health', '/api/agent/chat', '/api/agent/status', '/api/voice/transcribe', '/api/voice/classify',
  '/api/human-pose/catalog', '/api/human-pose/scene', '/api/layout/analyze',
  '/api/figure-performance/analyze', '/api/character-reference/analyze',
  '/api/character-reference/analyze-set', '/api/character-match/analyze', '/api/panel-actions/suggest',
  '/api/qwen-generation/prepare', '/api/qwen-generation/reconcile', '/api/qwen-generation/list',
  '/api/qwen-generation/delete', '/api/layer-generation/cache/list', '/api/layer-generation/cache/delete',
  '/api/qwen-generation/select', '/api/qwen-generation/cancel',
  '/api/comfy-workflows/list', '/api/comfy-workflows/save', '/api/comfy-workflows/delete',
  '/api/comfy-workflows/check', '/api/comfy-workflows/info',
  '/api/image-generation/connections',
]);
export const SUPERVISOR_PATHS = new Set([
  '/api/manga-finish',
  '/api/new-creation/start', '/api/new-creation/stop', '/api/panel-actions/prepare',
  '/api/image-generation/start', '/api/image-generation/prepare', '/api/image-generation/submit',
  '/api/image-generation/progress', '/api/image-generation/stop',
]);
const MAX_BODY = 96 * 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' };
export function isLocalNetworkAddress(address = '') {
  const value = address.replace(/^::ffff:/, '');
  if (value === '::1' || /^f[cd][0-9a-f]{2}:/i.test(value) || /^fe[89ab][0-9a-f]:/i.test(value)) return true;
  const parts = value.split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (parts[0] === 127 || parts[0] === 10 || parts[0] === 192 && parts[1] === 168
      || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
      || parts[0] === 169 && parts[1] === 254); // IPv4 link-local: Macs connected directly by Ethernet.
}
function loopbackTarget(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('LANの内部接続先はloopback HTTPに限定します');
  return url;
}
function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
export async function startLanServer({ host, port, cert, key, root, bridgeUrl, supervisorUrl, allowedHosts }) {
  const targets = { bridge: loopbackTarget(bridgeUrl), supervisor: loopbackTarget(supervisorUrl) };
  const directory = await realpath(root);
  const hosts = new Set(allowedHosts.map(value => new URL(`https://${value}`).host.toLowerCase()));
  const upstreams = new Set();
  const server = createServer({ cert, key, minVersion: 'TLSv1.2' }, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Preserve same-origin request metadata while omitting external referrers.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (!isLocalNetworkAddress(req.socket.remoteAddress)) return reply(res, 403, { error: 'LAN内から接続してください' });
      const authority = req.headers.host ? new URL(`https://${req.headers.host}`).host.toLowerCase() : null;
      if (!authority || !hosts.has(authority)) return reply(res, 403, { error: '接続先アドレスが一致しません' });
      const origin = new URL(`https://${authority}`).origin;
      const url = new URL(req.url, origin);
      if (url.origin !== origin || url.search || /%2f|%5c|%00/i.test(req.url)) return reply(res, 400, { error: '接続URLが正しくありません' });
      // A normal link may open the editor; cross-site API calls remain blocked.
      const homeNavigation = req.method === 'GET' && url.pathname === '/'
        && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
      if ((req.headers.origin && req.headers.origin !== origin)
        || (req.headers['sec-fetch-site'] === 'cross-site' && !homeNavigation)) {
        return reply(res, 403, { error: '別のサイトからの操作は許可されていません' });
      }
      if (req.method === 'POST' && !req.headers.origin) return reply(res, 403, { error: '操作元を確認できません' });
      const match = /^\/__nyamuru\/(bridge|supervisor)(\/api\/[a-z0-9/-]+)$/.exec(url.pathname);
      if (match) {
        const [, kind, path] = match;
        const allowed = kind === 'bridge' ? BRIDGE_PATHS : SUPERVISOR_PATHS;
        if (!allowed.has(path) || req.method !== (path === '/api/health' ? 'GET' : 'POST')) return reply(res, 403, { error: 'この操作はLAN接続では使えません。作品は編集PCに保存してください' });
        const length = Number(req.headers['content-length'] ?? 0);
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY || req.headers['transfer-encoding']) return reply(res, 413, { error: 'リクエストが大きすぎます' });
        const contentType = req.headers['content-type'] ?? '';
        const stopBeacon = kind === 'supervisor' && ['/api/new-creation/stop', '/api/image-generation/stop'].includes(path)
          && /^text\/plain(?:;|$)/i.test(contentType);
        if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(contentType) && !stopBeacon) return reply(res, 415, { error: 'JSON形式で送信してください' });
        const target = targets[kind];
        const upstream = httpRequest(new URL(path, target), {
          method: req.method, headers: { Origin: target.origin, 'Content-Type': contentType, 'Content-Length': length },
        }, incoming => {
          res.writeHead(incoming.statusCode ?? 502, { 'Content-Type': 'application/json; charset=utf-8' });
          incoming.on('error', () => res.destroy());
          incoming.on('aborted', () => res.destroy());
          incoming.pipe(res);
        });
        upstreams.add(upstream);
        upstream.on('close', () => upstreams.delete(upstream));
        // Batch VLM analysis already permits 950 seconds in the editor.
        upstream.setTimeout(960_000, () => upstream.destroy(new Error('timeout')));
        upstream.on('error', () => { if (!res.headersSent) reply(res, 502, { error: 'Mac Studioの処理サービスに接続できませんでした' }); else res.destroy(); });
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
        req.pipe(upstream);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method) || url.pathname.startsWith('/__nyamuru')) return reply(res, 404, { error: 'Not found' });
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.split('/').some(part => part.startsWith('.')) || decoded.includes('\\')) return reply(res, 404, { error: 'Not found' });
      let path = await realpath(resolve(directory, `.${decoded}${decoded.endsWith('/') ? 'index.html' : ''}`)).catch(() => null);
      if (!path || !path.startsWith(directory + sep) || !(await stat(path)).isFile()) return reply(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) reply(res, 400, { error: 'リクエストを処理できませんでした' }); else res.destroy(); }
  });
  server.requestTimeout = 360_000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, () => { server.off('error', fail); done(); }); });
  return {
    server,
    async close() {
      for (const request of upstreams) request.destroy();
      const closed = new Promise(done => server.close(done));
      server.closeAllConnections();
      await closed;
    },
  };
}
