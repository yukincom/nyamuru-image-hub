import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
// Browser-folder persistence on an isolated origin; the fixture blocks service calls.
export default defineConfig({plugins:[tailwindcss()],esbuild:{jsx:'automatic',jsxImportSource:'preact'},
 define:{'import.meta.env.PUBLIC_STANDALONE':'true','import.meta.env.PUBLIC_NYAMURU_LAN':'"1"'},
 server:{host:'127.0.0.1',port:4341,strictPort:true}});
