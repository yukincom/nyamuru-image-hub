import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { Agent } from 'node:https';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { ensureLanCertificate } from '../scripts/lan-certificate.mjs';
import { startLanServer } from '../scripts/lan-server.mjs';
import { startLocalBridgeSupervisor } from '../scripts/local-bridge-supervisor.mjs';
import { watchInitialParent } from '../scripts/process-lifecycle.mjs';

// Dedicated loopback UI fixture -> CA-verified HTTPS gateway -> actual local bridge.
// No browser certificate warning is bypassed; OS trust stores are not modified.
process.env.NYAMURU_PANEL_ACTION_LLM_MODE = 'external-shared';
const tls = ensureLanCertificate(mkdtempSync(join(tmpdir(), 'nyamuru-lan-browser-ca-')), ['127.0.0.1', 'localhost']);
const origin = 'https://127.0.0.1:4344';
process.env.NYAMURU_BRIDGE_RUN_STATE = resolve(tls.caPath, '..', 'test-bridge-process.json');
const ca = readFileSync(tls.caPath), agent = new Agent({ ca });
const supervisor = await startLocalBridgeSupervisor({ repoRoot: process.cwd(), port: 8896, bridgePort: 8897 });
const gateway = await startLanServer({ host: '127.0.0.1', port: 4344, ...tls, root: resolve('public'),
  bridgeUrl: 'http://127.0.0.1:8897', supervisorUrl: supervisor.url, allowedHosts: ['127.0.0.1:4344'] });
let closing = false;
async function close() { if (closing) return; closing = true; await gateway.close(); await supervisor.close(); agent.destroy(); }
const stopWatching = watchInitialParent(() => { void close().finally(() => process.exit(0)); });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { stopWatching(); void close().finally(() => process.exit(0)); });
export default defineConfig({
  plugins: [tailwindcss(), { name: 'lan-test-cleanup', configureServer(server) { server.httpServer?.on('close', () => { void close(); }); } }],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { 'import.meta.env.PUBLIC_NYAMURU_LAN': JSON.stringify('1') },
  server: { host: '127.0.0.1', port: 4346, strictPort: true, proxy: {
    '/__nyamuru/': { target: origin, changeOrigin: true, secure: true, agent, headers: { Origin: origin } },
  } },
});
