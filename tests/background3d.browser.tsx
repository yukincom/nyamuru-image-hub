/** Synthetic cube only. This fixture never writes the user's project or browser storage. */
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import PaintEditor, { PaintTools, PaintLayers, PaintStatus } from '../src/components/PaintEditor';
import PaintInputSurface, { PaintOwnerPreview } from '../src/components/PaintSceneView';
import { usePaintWorkspace } from '../src/lib/paintWorkspace';
import type { PaintController } from '../src/lib/paintSession';
import { newPaintLayer, type PaintScene } from '../src/lib/paintDocument';
import type { BackgroundStage, ImageAsset } from '../src/types';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence';
import { parseMangaYaml } from '../src/lib/manga';
import { prepareImageAsset } from '../src/lib/imagePlacement';
import { eraseVectors } from '../src/lib/vectorGeometry';
import source from '../src/content/sample.yaml?raw';
import '../src/styles/global.css';

const frame={x:5,y:5,w:90,h:60};
const initial:PaintScene={frame,owners:[{key:'background',kind:'background',index:0,label:'背景あたり',frame,paint:{version:1,width:900,height:600,dpi:600,layers:[newPaintLayer('手直し')]} }]};
function Checks(){const state=usePaintWorkspace();return <div class="fixture-checks"><button disabled={!state?.canUndo} onClick={()=>state?.undo()}>元に戻す</button><button disabled={!state?.canRedo} onClick={()=>state?.redo()}>やり直す</button><output aria-label="検証状態">{JSON.stringify(state?.scene.owners[0].paint.layers.map(l=>({name:l.name,visible:l.visible,paths:l.paths?.length,mask:!!l.mask,tone:l.tone?.enabled})))}</output>
  <output aria-label="撮影カメラ">{JSON.stringify(state?.scene.owners[0].paint.background3d?.camera)}</output></div>;}
function Fixture(){
  const controller=useRef<PaintController|null>(null),[assets,setAssets]=useState<ImageAsset[]>([]),[stages,setStages]=useState<BackgroundStage[]>([]),[saved,setSaved]=useState('未保存');
  const cache=useRef(new Map<string,Blob>());
  return <><style>{`body{padding:12px;background:#f6f5f3}h1{font-size:20px}.fixture-workspace{display:flex;gap:10px;align-items:flex-start}.fixture-tools{width:82px;flex:none}.fixture-layers{width:230px;flex:none}.fixture-paper{position:relative;width:900px;height:650px;background:#fff;border:1px solid #ccc;flex:none}.fixture-checks output{display:block;font-size:10px;max-width:1200px;overflow-wrap:anywhere}.fixture-tools .paint-tools{display:block}.fixture-tools .paint-tool-icons{display:grid;grid-template-columns:1fr 1fr}.fixture-tools .paint-size{display:flex}.fixture-tools .paint-aa{display:none}`}</style><h1>立方体で3D背景を検証</h1>
    <PaintEditor initial={initial} assets={assets} stages={stages} title="合成立方体" page={0} panelIndex={0} overlay={false} controller={controller} onApply={async result=>{
      const doc=parseMangaYaml(source);doc.manga.meta.episode_id='synthetic-cube';
      for(const item of result.imports)cache.current.set(item.asset.storageId,item.blob);
      for(const item of result.stageImports??[])cache.current.set(item.stage.storageId,item.blob);
      const flat=await prepareImageAsset(new File([result.owners[0].blob],'cube.png',{type:'image/png'}));cache.current.set(flat.storageId,result.owners[0].blob);
      doc.manga.image_assets=[...result.imports.map(i=>i.asset),flat];doc.manga.background_stages=(result.stageImports??[]).map(i=>i.stage);
      const owner=result.owners[0].owner;doc.manga.pages[0].panels[0].background_images=[{id:'cube',assetId:flat.id,bbox:frame,crop:{x:0,y:0,w:owner.paint.width,h:owner.paint.height},hidden:false,locked:false,opacity:1,paint:owner.paint}];
      const paths=owner.paint.layers.find(layer=>layer.kind==='vector')?.paths??[],first=paths[0];
      if(!first)throw new Error('線画がありません');
      const reduced=eraseVectors(paths,[{x:(first.nodes[0].x+first.nodes[1].x)/2,y:(first.nodes[0].y+first.nodes[1].y)/2}],2,'whole');
      if(reduced.length>=paths.length)throw new Error('ベクター消しゴムが効きません');
      const snapshot=await createProjectSnapshot(doc,async id=>cache.current.get(id)??null);
      const restored=await restoreProjectSnapshot(snapshot,async items=>{for(const item of items)cache.current.set(item.id,item.blob);});
      if(JSON.stringify(restored.manga.pages[0].panels[0].background_images?.[0].paint)!==JSON.stringify(owner.paint))throw new Error('再読込で描画が変わりました');
      setAssets(doc.manga.image_assets);setStages(doc.manga.background_stages??[]);setSaved(`PASS: PNG ${result.owners[0].blob.size} bytes、保存・再読込一致、ベクター消去 ${paths.length}→${reduced.length}本`);
    }} onClose={()=>{}}><Checks/><div class="fixture-workspace"><aside class="paint-dock fixture-tools"><PaintTools/></aside><div class="fixture-paper"><PaintOwnerPreview ownerKey="background" container={{x:0,y:0,w:100,h:72}} inkOnly/><PaintInputSurface canvas={{w:100,h:72}}/></div><aside class="paint-dock fixture-layers"><PaintLayers/></aside></div><PaintStatus/></PaintEditor>
    <button onClick={()=>void controller.current?.flush().catch(error=>setSaved(`FAIL: ${String(error)}`))}>保存・再読込を検証</button><output role="status">{saved}</output>
  </>;
}
render(<Fixture/>,document.getElementById('test-root')!);
