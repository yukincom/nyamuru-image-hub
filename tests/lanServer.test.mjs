import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { mkdtemp, writeFile, mkdir, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { ensureLanCertificate, lanAddresses } from '../scripts/lan-certificate.mjs';
import { startLanServer, isLocalNetworkAddress } from '../scripts/lan-server.mjs';

test('LAN address filter excludes public clients', () => {
  for (const address of ['127.0.0.1', '192.168.1.5', '10.0.0.5', '172.31.0.4', '169.254.1.1', '169.254.224.71', '::ffff:169.254.65.183', '::ffff:192.168.1.5', '::1']) assert.equal(isLocalNetworkAddress(address), true, address);
  for (const address of ['8.8.8.8', '172.32.1.5', '169.253.224.71', '169.255.224.71', '169.254.1.256', '192.168.1.999', 'evil.test']) assert.equal(isLocalNetworkAddress(address), false, address);
});
test('direct Ethernet address remains selectable alongside Wi-Fi', () => {
  const ipv4 = address => ({ address, family: 'IPv4', internal: false });
  assert.deepEqual(lanAddresses({
    en1: [ipv4('192.168.1.48')],
    lo0: [{ ...ipv4('127.0.0.1'), internal: true }],
    en0: [ipv4('169.254.224.71'), { address: 'fe80::1234', family: 'IPv6', internal: false }],
    en2: [ipv4('8.8.8.8')],
  }), ['169.254.224.71', '192.168.1.48']);
});
test('adding a direct Ethernet address renews the server certificate without changing the trusted CA', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'nyamuru-direct-lan-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const first = ensureLanCertificate(temp, ['127.0.0.1', '192.168.1.48']);
  const direct = ensureLanCertificate(temp, ['127.0.0.1', '192.168.1.48', '169.254.224.71']);
  assert.equal(direct.fingerprint, first.fingerprint);
  const cert = new X509Certificate(direct.cert);
  assert.equal(cert.checkIP('169.254.224.71'), '169.254.224.71');
  assert.equal(cert.checkIP('192.168.1.48'), '192.168.1.48');
  assert.equal(cert.verify(new X509Certificate(await readFile(direct.caPath)).publicKey), true);
});
test('LAN editor opens without a code or cookie, including after restart', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'nyamuru-lan-restart-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'public');
  await mkdir(root);
  await writeFile(join(root, 'index.html'), '<h1>Editor</h1>');
  const tls = ensureLanCertificate(join(temp, 'tls'), ['localhost', '127.0.0.1']);
  const ca = await readFile(tls.caPath);
  for (const launch of ['initial', 'restart']) {
    const gateway = await startLanServer({ host: '127.0.0.1', port: 0, root, ...tls, allowedHosts: ['localhost'], bridgeUrl: 'http://127.0.0.1:9', supervisorUrl: 'http://127.0.0.1:9' });
    try {
      const send = cookie => new Promise((resolve, reject) => {
        const req = request(`https://127.0.0.1:${gateway.server.address().port}/`, {
          ca, servername: 'localhost',
          headers: { Host: 'localhost', ...(cookie ? { Cookie: cookie } : {}) },
        }, res => {
          let text = '';
          res.on('data', chunk => { text += chunk; });
          res.on('error', reject);
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on('error', reject);
        req.end();
      });
      for (const cookie of [undefined, 'nyamuru_lan=expired-session']) {
        const opened = await send(cookie);
        assert.equal(opened.status, 200, launch);
        assert.match(opened.text, /<h1>Editor<\/h1>/);
        assert.equal(opened.headers['set-cookie'], undefined, 'no login session is required or issued');
      }
    } finally {
      await gateway.close();
    }
  }
});
test('trusted HTTPS and code-free processing retain origin and workspace/file-system boundaries', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'nyamuru-lan-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'public'); await mkdir(root); await writeFile(join(root, 'index.html'), '<h1>Editor</h1>');
  await writeFile(join(temp, 'secret.txt'), 'not public'); await symlink(join(temp, 'secret.txt'), join(root, 'escape.txt'));
  const tls = ensureLanCertificate(join(temp, 'tls'), ['127.0.0.1', 'localhost']);
  const ca = await readFile(tls.caPath);
  assert.equal(ensureLanCertificate(join(temp, 'tls'), ['127.0.0.1', 'localhost']).fingerprint, tls.fingerprint);
  const calls = [];
  const backend = createServer(async (req, res) => { let body = ''; for await (const part of req) body += part; calls.push({ path: req.url, headers: req.headers, body }); if (req.url === '/api/layout/analyze') { res.writeHead(200); res.write('partial'); setTimeout(() => res.destroy(), 10); return; } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); });
  await new Promise(done => backend.listen(0, '127.0.0.1', done)); t.after(() => new Promise(done => backend.close(done)));
  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done)); const port = probe.address().port; await new Promise(done => probe.close(done));
  const origin = `https://127.0.0.1:${port}`, upstream = `http://127.0.0.1:${backend.address().port}`;
  const gateway = await startLanServer({ host: '127.0.0.1', port, root, ...tls, bridgeUrl: upstream, supervisorUrl: upstream, allowedHosts: [`127.0.0.1:${port}`] });
  t.after(() => gateway.close());
  const send = (path, { method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
    const req = request(origin + path, { ca, servername: 'localhost', method, headers: { ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, res => {
      let text = ''; res.on('data', data => { text += data; }); res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    }); req.on('error', reject); req.end(body);
  });
  assert.match((await send('/')).text, /<h1>Editor<\/h1>/);
  const navigation = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  const linkedPage = await send('/', { headers: navigation });
  assert.equal(linkedPage.status, 200, 'opening the LAN home page from another site must reach the editor');
  assert.match(linkedPage.text, /<h1>Editor<\/h1>/);
  assert.equal(linkedPage.headers['referrer-policy'], 'same-origin');
  assert.equal(linkedPage.headers['set-cookie'], undefined);
  assert.equal((await send('/', { headers: { ...navigation, Origin: 'https://other.test' } })).status, 403);
  for (const [mode, dest] of [['navigate', 'iframe'], ['no-cors', 'image'], ['no-cors', 'script'], ['cors', 'empty'], ['', '']]) {
    assert.equal((await send('/', { headers: { ...navigation, 'Sec-Fetch-Mode': mode, 'Sec-Fetch-Dest': dest } })).status, 403, `cross-site ${mode}/${dest}`);
  }
  assert.equal((await send('/__nyamuru/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'code=obsolete' })).status, 404);
  assert.equal((await send('/__nyamuru/bridge/api/health', { headers: navigation })).status, 403);
  assert.equal((await send('/index.html', { headers: navigation })).status, 403);
  assert.equal((await send('/escape.txt')).status, 404);
  assert.equal((await send('/.git/config')).status, 404);
  const post = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', post)).status, 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.origin, upstream); assert.equal(calls[0].headers.cookie, undefined);
  for (const path of ['/api/episode-workspace/select', '/api/episode-workspace/project/save', '/api/series/directory/choose', '/api/scanner/open']) {
    assert.equal((await send('/__nyamuru/bridge' + path, post)).status, 403);
  }
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', { ...post, headers: { ...post.headers, Origin: 'https://other.test' } })).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', { ...post, headers: { ...post.headers, ...navigation } })).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', { ...post, headers: { ...post.headers, Origin: 'null', 'Sec-Fetch-Site': 'same-origin' } })).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', { ...post, headers: { ...post.headers, Host: 'other.test' } })).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', { ...post, headers: { 'Content-Type': 'application/json' } })).status, 403);
  assert.equal(calls.length, 1);
  assert.equal((await send('/__nyamuru/supervisor/api/new-creation/stop', { ...post, headers: { ...post.headers, 'Content-Type': 'text/plain;charset=UTF-8' } })).status, 200);
  assert.equal(calls.length, 2);
  // 見込み: CLIP変換も既存のOrigin境界内でローカルへ届く。
  // 合格: JSON本文が同一で転送され、外部Originは403。転送先は模擬、実変換はPython側で確認。
  const clipBody=JSON.stringify({profile:'nyamuru-clip-v1',layers:[]});
  assert.equal((await send('/__nyamuru/bridge/api/export/clip',{...post,body:clipBody})).status,200);
  assert.equal(calls.at(-1).path,'/api/export/clip');assert.equal(calls.at(-1).body,clipBody);
  assert.equal((await send('/__nyamuru/bridge/api/export/clip',{...post,headers:{...post.headers,Origin:'https://other.test'},body:clipBody})).status,403);
  // 見込み: LANでも生成画面を開き、処理を依頼し、候補を受け取って採用してから閉じられる。
  // 合格: 各本文がHTTPSで対応する処理へ届き、離脱時のtext/plainは停止だけ許可。転送先は模擬、モデルは未使用。
  const token = '0165bcda-37bb-49c7-a0ce-e29591a8f638';
  const start = '/api/image-generation/start', progress = '/api/image-generation/progress', stop = '/api/image-generation/stop';
  const client = 'd4c3692f-87a6-47b0-9f0a-d7fe07ff756a';
  const job = '974ba5d1-2d06-4275-8003-1118300384ea';
  for (const [kind, path, body, contentType = 'application/json'] of [
    ['supervisor', start, { session_token: token, comfyui_url: 'http://127.0.0.1:8188' }],
    ['supervisor', '/api/image-generation/prepare', { lease_token: token }],
    ['supervisor', '/api/image-generation/submit', { lease_token: token, payload: { job_id: job } }],
    ['supervisor', progress, { session_token: token, client_id: client, prompt_id: 'prompt' }],
    ['bridge', '/api/qwen-generation/reconcile', { job_id: job }],
    ['bridge', '/api/qwen-generation/select', { job_id: job, candidate_indices: [2, 4], adopted: true }],
    ['supervisor', stop, { session_token: token }],
    ['supervisor', stop, { session_token: token }, 'text/plain;charset=UTF-8'],
  ]) {
    const input = JSON.stringify(body);
    const response = await send(`/__nyamuru/${kind}${path}`, { ...post, headers: { ...post.headers, 'Content-Type': contentType }, body: input });
    assert.equal(response.status, 200, path);
    assert.equal(calls.at(-1).path, path);
    assert.equal(calls.at(-1).body, input);
    assert.equal(calls.at(-1).headers['content-type'], contentType);
  }
  const forwarded = calls.length;
  for (const path of [start, progress]) {
    assert.equal((await send('/__nyamuru/supervisor' + path, { ...post, headers: { ...post.headers, 'Content-Type': 'text/plain' } })).status, 415);
  }
  assert.equal((await send('/__nyamuru/supervisor' + stop, { ...post, headers: { ...post.headers, Origin: 'https://other.test', 'Content-Type': 'text/plain' } })).status, 403);
  assert.equal((await send('/__nyamuru/bridge' + start, post)).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/qwen-generation/submit', post)).status, 403);
  assert.equal(calls.length, forwarded);
  await assert.rejects(send('/__nyamuru/bridge/api/layout/analyze', post));
  assert.match((await send('/')).text, /Editor/);
  assert.equal((await send('/__nyamuru/bridge/api/health')).status, 200, 'same-origin health check does not need a cookie');
  assert.equal((await send('/__nyamuru/bridge/api/image-generation/connections', post)).status, 200);
  assert.equal((await send('/__nyamuru/bridge/api/image-generation/connections', { ...post, headers: { ...post.headers, Origin: 'https://other.test' } })).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/panel-draft/generate', post)).status, 403);
  assert.equal((await send('/__nyamuru/bridge/api/agent/status', { ...post, headers: { ...post.headers, 'Content-Length': 97 * 1024 * 1024 } })).status, 413);
});
