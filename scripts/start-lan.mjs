import { build } from 'astro';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLanCertificate, lanAddresses, lanNames } from './lan-certificate.mjs';
import { startLanServer } from './lan-server.mjs';
import { selectLocalBridgeTarget, startLocalBridgeSupervisor } from './local-bridge-supervisor.mjs';
import { claimRunState, signalExitCode, watchInitialParent } from './process-lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const addresses = lanAddresses();
let host = process.env.NYAMURU_LAN_HOST || addresses[0];
let port = Number(process.env.NYAMURU_LAN_PORT || 4322);
for (let i = 0; i < process.argv.slice(2).length; i++) {
  const args = process.argv.slice(2), arg = args[i];
  if (arg === '--host') host = args[++i];
  else if (arg === '--port') port = Number(args[++i]);
  else if (arg === '--help') { console.log('npm run lan -- [--host MacのLANアドレス] [--port 4322]\n作品は編集PCへ保存。接続用CA証明書は起動時に表示します。\n接続コードは不要です。自宅のLAN内から直接開けます。'); process.exit(0); }
  else throw new Error(`未対応の引数です: ${arg}`);
}
if (!host || !['127.0.0.1', '0.0.0.0', ...addresses].includes(host)) throw new Error('MacのLANアドレスを --host で指定してください');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('LANポート番号が正しくありません');
const release = claimRunState(resolve(root, '.astro/nyamuru-lan-process.json'), 'Nyamuru LANサーバー');
let gateway, supervisor, stopWatching = () => {}, stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  stopWatching();
  try { await gateway?.close(); await supervisor?.close(); }
  catch (error) { console.error('LANサーバーの停止に失敗しました:', error.message); code ||= 1; }
  finally { release(); process.exit(code); }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) process.on(signal, () => { void stop(signalExitCode(signal)); });
process.once('exit', release);
stopWatching = watchInitialParent(() => { void stop(); });
try {
  const names = [...new Set(['127.0.0.1', ...addresses, ...lanNames()])];
  let tls;
  if (process.env.NYAMURU_LAN_CERT || process.env.NYAMURU_LAN_KEY) {
    if (!process.env.NYAMURU_LAN_CERT || !process.env.NYAMURU_LAN_KEY) throw new Error('NYAMURU_LAN_CERTとNYAMURU_LAN_KEYを両方指定してください');
    tls = { cert: await readFile(process.env.NYAMURU_LAN_CERT), key: await readFile(process.env.NYAMURU_LAN_KEY) };
  } else tls = ensureLanCertificate(resolve(root, '.local-vision/lan-tls'), names);
  process.env.PUBLIC_NYAMURU_LAN = '1';
  // This launch uses the Mac's existing model and never publishes its inference port.
  process.env.NYAMURU_PANEL_ACTION_LLM_MODE = 'external-shared';
  process.env.NYAMURU_BRIDGE_RUN_STATE = resolve(root, '.astro/nyamuru-lan-bridge-process.json');
  const bridge = await selectLocalBridgeTarget({ preferredPort: Number(process.env.NYAMURU_LAN_BRIDGE_PORT || 8877), maxFallbacks: 20 });
  const output = resolve(root, '.astro/lan-dist');
  await build({ root, outDir: output, cacheDir: resolve(root, '.astro/lan-cache') });
  supervisor = await startLocalBridgeSupervisor({ repoRoot: root, port: Number(process.env.NYAMURU_LAN_SUPERVISOR_PORT || 8876), bridgePort: bridge.port, bridgeUrl: bridge.url });
  gateway = await startLanServer({ host, port, ...tls, root: output, bridgeUrl: bridge.url, supervisorUrl: supervisor.url,
    allowedHosts: names.map(name => `${name}:${port}`) });
  console.log(`\nNyamuru LAN 起動完了 (PID ${process.pid})\n編集PCで開く: https://${host === '0.0.0.0' ? addresses[0] : host}:${port}/\n接続コードは不要です。自宅のLAN内から直接開けます。\n作品の保存先: 編集しているPC\nLLM: Mac内の既存サーバー\n終了: Ctrl+C`);
  if (tls.caPath) console.log(`\n初回の編集PCには次のCA証明書を登録してください:\n${tls.caPath}\nSHA-256: ${tls.fingerprint}\n手順: docs/2026-10-20-lan-editing.md\n`);
} catch (error) { console.error(`LAN起動に失敗しました: ${error.message}`); await stop(1); }
