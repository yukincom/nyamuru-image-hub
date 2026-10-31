import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Real settings component; only its bridge module is replaced. No backend is started.
export default defineConfig({
  plugins: [tailwindcss(), {
    name: 'settings-bridge-fixture', enforce: 'pre',
    resolveId(source, importer) {
      if (importer?.endsWith('/src/components/LocalImageModelSettings.tsx') && /^\.\.\/lib\/localBridge(?:\.ts)?$/.test(source))
        return fileURLToPath(new URL('./comfyWorkflows.bridge-fixture.ts', import.meta.url));
    },
  }],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  server: { host: '127.0.0.1', port: 4342, strictPort: true },
});
