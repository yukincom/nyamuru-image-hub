import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { readGlobalStyles } from './helpers/globalStyles.mjs';
export default defineConfig({
  plugins: [
    {
      name: 'legacy-viewport-fixture',
      enforce: 'pre',
      transform(code, id) {
        if (process.env.NYAMURU_TEST_LEGACY_VIEWPORT !== '1' || !id.split('?')[0].endsWith('/src/styles/global.css')) return;
        // Model pre-Chrome-108 CSS parsing: declarations with unknown viewport units are discarded.
        return { code: readGlobalStyles(code).replace(/\b(?:height|max-height):[^;{}]*\d(?:dvh|svh|lvh)[^;{}]*(?:;|(?=}))/g, ''), map: null };
      },
    },
    tailwindcss(),
  ],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { 'import.meta.env.PUBLIC_NYAMURU_LAN': JSON.stringify('1') },
  server: { host: '127.0.0.1', port: 4339, strictPort: true },
});
