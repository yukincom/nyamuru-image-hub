import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Dedicated browser fixture: production modules remain untouched on disk.
export default defineConfig({
  plugins:[{name:'image-retention-observer',enforce:'pre',transform(code,id){
    const path=id.split('?')[0];
    const replace=(from,to)=>{if(!code.includes(from))throw Error(`Retention probe anchor missing: ${path}`);code=code.replace(from,to);};
    if(path.endsWith('/src/lib/workspaceStartup.ts'))
      replace('return { document: createEmptyWorkspaceDocument(), hasDocument: false };','return { document: window.__retentionFixture.document, hasDocument: true };');
    else if(path.endsWith('/src/lib/figureCropStore.ts')){
      replace('items.forEach(asset => assets.set(asset.id, asset.blob));','items.forEach(asset => assets.set(asset.id, asset.blob));\n  await window.__retentionFixture.afterStore(items);');
      code+='\nexport function retentionStoreSnapshot(){return {importing, assets:[...assets].map(([id,blob])=>({id,bytes:blob.size}))};}\n';
    }else if(path.endsWith('/src/components/App.tsx'))
      replace('useEffect(() => onFigureCropAssetsChanged(prunePaintAssets), []);',`window.__retentionFixture.workspace=()=>({document:documentRef.current,past:timeline.current.past,future:timeline.current.future});
  window.__retentionFixture.prune=prunePaintAssets;
  useEffect(() => onFigureCropAssetsChanged(prunePaintAssets), []);`);
    else return;
    return {code,map:null};
  }},tailwindcss()],
  esbuild:{jsx:'automatic',jsxImportSource:'preact'},
  define:{'import.meta.env.PUBLIC_NYAMURU_LAN':JSON.stringify('1')},
  server:{host:'127.0.0.1',port:4347,strictPort:true,hmr:false},
});
