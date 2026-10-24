import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'preact/jsx-runtime';

function fixture(){
 let cursor=0;const slots=[],effects=[],requests=[],exports={};
 const hooks={useMemo:(make,deps)=>{const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j]))slots[i]={deps,value:make()};return slots[i].value},
  useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value]},
  useEffect:(run,deps)=>{const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j])){const before=slots[i];slots[i]={deps};effects.push(()=>{before?.cleanup?.();slots[i].cleanup=run()})}}};
 const modules={'preact/hooks':hooks,'preact/jsx-runtime':jsxRuntime,'lucide-preact':{},'../lib/canvasGeometry':{},'../lib/paintDocument':{paintScene:panel=>({owners:[{key:'figure-0',paint:{layers:[{id:panel.id}]}}]})},
  '../lib/paintRenderer':{loadPaintImages:()=>new Promise(resolve=>requests.push(resolve))},'../lib/panelLayers':{panelVisible:()=>true},'../lib/paintWorkspace':{},'../lib/pageCanvas':{},'../lib/displayLabels':{},
  './PaintLayerPalette':{__esModule:true,default:'Palette'},'./LayerVisibilityButton':{__esModule:true,default:'Visibility'}};
 const source=readFileSync(new URL('../src/components/PageLayerPalette.tsx',import.meta.url),'utf8').replace('function InactiveLayers(','export function InactiveLayers(');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,jsxImportSource:'preact'}}).outputText,{exports,require:name=>{assert.ok(name in modules,name);return modules[name]}});
 return {requests,render(panel,assets){cursor=0;const tree=exports.InactiveLayers({panel,index:0,p:{dpi:100,assets}});return tree.props.children.find(child=>child?.type==='Palette').props.images},
  flush(){while(effects.length)effects.shift()()},dispose(){for(const slot of slots)slot?.cleanup?.()}};
}
test('new artwork and Undo cannot expose an older decoded map before effects load the current scene',async()=>{
 const f=fixture(),assets=[],original={id:1};assert.equal(f.render(original,assets),null);f.flush();
 const originalImages=new Map();f.requests.shift()(originalImages);await Promise.resolve();assert.equal(f.render(original,assets),originalImages);
 const inserted={id:2};assert.equal(f.render(inserted,assets),null,'old map must disappear before effects');f.flush();
 const insertedImages=new Map([['generated',{src:'blob:generated'}]]);f.requests.shift()(insertedImages);await Promise.resolve();assert.equal(f.render(inserted,assets),insertedImages);
 assert.equal(f.render(original,assets),null,'Undo must not reuse the generated map');f.flush();assert.equal(insertedImages.get('generated').src,'');f.dispose();
});
test('late image loading for an abandoned scene is disposed and cannot replace the current images',async()=>{
 const f=fixture(),assets=[],old={id:1},current={id:2};f.render(old,assets);f.flush();f.render(current,assets);f.flush();
 const stale=new Map([['stale',{src:'blob:stale'}]]);f.requests.shift()(stale);await Promise.resolve();assert.equal(stale.get('stale').src,'');assert.equal(f.render(current,assets),null);
 const fresh=new Map();f.requests.shift()(fresh);await Promise.resolve();assert.equal(f.render(current,assets),fresh);f.dispose();
});
