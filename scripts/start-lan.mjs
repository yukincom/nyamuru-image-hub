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
  else if (arg === '--help') { console.log('別のPCからにゃむるを使う\n\n起動: npm run lan\n手順: README.md の「別のPCから使う」\n接続コードは不要です。自宅のLAN内から直接開けます。\n\n必要なときだけ指定してください。\n  --host <アドレス>  接続に使うMacのアドレスを指定する\n  --port <番号>      接続に使うポート番号を指定する（通常は4322）'); process.exit(0); }
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
  console.log('にゃむるを準備しています…');
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
  await build({ root, outDir: output, cacheDir: resolve(root, '.astro/lan-cache'), logLevel: 'error' });
  supervisor = await startLocalBridgeSupervisor({ repoRoot: root, port: Number(process.env.NYAMURU_LAN_SUPERVISOR_PORT || 8876), bridgePort: bridge.port, bridgeUrl: bridge.url });
  gateway = await startLanServer({ host, port, ...tls, root: output, bridgeUrl: bridge.url, supervisorUrl: supervisor.url,
    allowedHosts: names.map(name => `${name}:${port}`) });
  console.log('\nにゃむるを起動しました。この画面は開いたままにしてください。\n手順: README.md の「別のPCから使う」');
  if (tls.caPath) console.log(`\n初めて使うPCは、先に手順に沿って証明書を登録してください。\n編集PCへ渡すファイル: ${tls.caPath}`);
  console.log(`\n編集PCのブラウザーで開いてください。\n   https://${host === '0.0.0.0' ? addresses[0] : host}:${port}/\n\n接続コードは不要です。自宅のLAN内から直接開けます。\n作品は編集PCに保存します。\n終了するときは作品を保存し、この画面で Ctrl+C を押してください。\n`);
} catch (error) { console.error(`LAN起動に失敗しました: ${error.message}`); await stop(1); }
