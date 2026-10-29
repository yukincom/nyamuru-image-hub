import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
// 起動入力だけを合成するため、既存の編集本体をQA内だけでexportする。処理本体は変更しない。
export default defineConfig({
 plugins:[{name:'popup-editor-fixture',enforce:'pre',transform(code,id){
  if(id.split('?')[0].endsWith('/src/components/App.tsx'))return {code:code.replace('function EditorApp(', 'export function EditorApp('),map:null};
 }},tailwindcss()],
 esbuild:{jsx:'automatic',jsxImportSource:'preact'},
 define:{'import.meta.env.PUBLIC_STANDALONE':'true'},
 server:{host:'127.0.0.1',port:4341,strictPort:true},
});
