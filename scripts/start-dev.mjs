import { dev } from 'astro';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDevOptions } from './dev-server-options.mjs';
import { selectLocalBridgeTarget, startLocalBridgeSupervisor } from './local-bridge-supervisor.mjs';
import { claimRunState, signalExitCode, watchInitialParent } from './process-lifecycle.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runStatePath = resolve(repoRoot, '.astro', 'nyamuru-dev-process.json');

const options = parseDevOptions(process.argv.slice(2), { root: repoRoot });
if (!options) process.exit(0);
const bridgeSupervisorPort = Number(process.env.NYAMURU_BRIDGE_SUPERVISOR_PORT || 8786);
if (!Number.isSafeInteger(bridgeSupervisorPort) || bridgeSupervisorPort < 1 || bridgeSupervisorPort > 65535) {
  throw new Error(`NYAMURU_BRIDGE_SUPERVISOR_PORTが正しくありません: ${process.env.NYAMURU_BRIDGE_SUPERVISOR_PORT}`);
}
process.env.PUBLIC_NYAMURU_BRIDGE_SUPERVISOR_URL ||= `http://127.0.0.1:${bridgeSupervisorPort}`;
const preferredBridgePort = Number(process.env.NYAMURU_BRIDGE_PORT || 8787);
const bridgeTarget = await selectLocalBridgeTarget({
  preferredPort: preferredBridgePort,
  maxFallbacks: process.env.NYAMURU_BRIDGE_PORT ? 0 : 20,
});
process.env.PUBLIC_NYAMURU_BRIDGE_URL = bridgeTarget.url;
if (bridgeTarget.port !== preferredBridgePort) {
  console.warn(`ポート${preferredBridgePort}は別のアプリが使用中のため、Nyamuru Image Hubローカル連携を${bridgeTarget.port}へ切り替えます。`);
}
const releaseRunState = claimRunState(runStatePath, 'Nyamuru Image Hub開発サーバー');
let server;
let bridgeSupervisor;
let stopping = false;
let requestedExitCode = 0;
let forceTimer;
let stopWatchingParent = () => {};

const stopServer = async (signal = 'SIGTERM', exitCode = signalExitCode(signal)) => {
  if (stopping) {
    releaseRunState();
    process.exit(exitCode);
  }
  stopping = true;
  requestedExitCode = exitCode;
  stopWatchingParent();
  forceTimer = setTimeout(() => {
    releaseRunState();
    process.exit(requestedExitCode);
  }, 5_000);
  forceTimer.unref();
  try {
    await server?.stop();
  } catch (error) {
    console.error(`Astro開発サーバーの停止に失敗しました: ${error instanceof Error ? error.message : error}`);
    if (requestedExitCode === 0) requestedExitCode = 1;
  }
  try {
    await bridgeSupervisor?.close();
  } catch (error) {
    console.error(`ローカル連携の起動管理を停止できませんでした: ${error instanceof Error ? error.message : error}`);
    if (requestedExitCode === 0) requestedExitCode = 1;
  } finally {
    clearTimeout(forceTimer);
    releaseRunState();
    process.exit(requestedExitCode);
  }
};

stopWatchingParent = watchInitialParent(() => { void stopServer('SIGTERM', 0); });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  process.on(signal, () => { void stopServer(signal); });
}
process.once('exit', releaseRunState);

try {
  bridgeSupervisor = await startLocalBridgeSupervisor({
    repoRoot,
    port: bridgeSupervisorPort,
    bridgePort: bridgeTarget.port,
    bridgeUrl: bridgeTarget.url,
  });
  // AstroのCLIを経由しないため、AI環境検出によるdetached起動は発生しない。
  server = await dev(options);
} catch (error) {
  stopWatchingParent();
  await bridgeSupervisor?.close().catch(() => undefined);
  releaseRunState();
  console.error(`Astro開発サーバーを起動できませんでした: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
