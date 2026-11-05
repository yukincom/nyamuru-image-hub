import { appendBackgroundCapture } from '../../lib/background3d';
import { paintOwnerLocked } from '../../lib/paintLock';
import { moveBackgroundLayoutOwner } from '../../lib/background3dLayout';
import type { Background3dResult } from '../Background3dEditor';
import { validatePaintDocument, type PaintScene } from '../../lib/paintDocument';
import { decodePaintImage } from '../../lib/paintRenderer';
import type { PaintEditorOptions, PaintEditorState } from './paintEditorState';

interface PaintBackgroundActionsBindings {
  finishGesture: (keep?: boolean) => void;
  clearVectorSelection: () => void;
  endBackgroundMove: (keep?: boolean) => void;
  commit: (next: PaintScene) => void;
  flush: (capture?: boolean) => Promise<void>;
}

export function createPaintBackgroundActions(options: PaintEditorOptions, state: PaintEditorState, bindings: PaintBackgroundActionsBindings) {
  const { requested, overlay, externalSuspended, assets } = options;
  const {
    owner, busy, suspended, operation, images, historyRef, setMaskTarget, setSelection, setOwnerKey,
    setMenu, setBackgroundSelection, setBackgroundOwner, backgroundOwner, backgroundMove, inputActive,
    setVectorPreview, backgroundController, setBusy, imports, imagesRef, setImages, setImports,
    setStageImports, setLayerId, setLineKind, setTool, alive, scene,
  } = state;
  const { finishGesture, clearVectorSelection, endBackgroundMove, commit, flush } = bindings;
  function openBackground3d(key=owner.key){
    if(!requested||busy||suspended||operation.current||!images)return;
    const target=historyRef.current.present.owners.find(o=>o.key===key);if(!target||target.kind!=='background'||overlay||paintOwnerLocked(target))return;
    finishGesture();clearVectorSelection();setMaskTarget(null);setSelection(null);setOwnerKey(key);setMenu(null);setBackgroundSelection(null);setBackgroundOwner(key);
  }
  function beginBackgroundMove(key:string){
    if(!backgroundOwner||busy||externalSuspended||operation.current||!images)return false;
    endBackgroundMove();const before=historyRef.current.present;
    if(moveBackgroundLayoutOwner(before,key,1,0)===before)return false;
    setBackgroundSelection(key);backgroundMove.current={key,before,current:before};inputActive.current=true;return true;
  }
  function moveBackgroundOwner(dx:number,dy:number){
    const move=backgroundMove.current;if(!move)return;
    move.current=moveBackgroundLayoutOwner(move.before,move.key,dx,dy);setVectorPreview(move.current);
  }
  function closeBackground3d(){endBackgroundMove();setBackgroundOwner(null);backgroundController.current=null;}
  async function captureBackground3d(result:Background3dResult){
    if(!backgroundOwner||!images||operation.current)return;
    endBackgroundMove();operation.current=true;setBusy(true);
    try{
    const snapshot=historyRef.current.present,target=snapshot.owners.find(o=>o.key===backgroundOwner);
    if(!target)throw new Error('背景の描画先が見つかりません');
    if(paintOwnerLocked(target))throw new Error('背景フォルダが固定されています');
    const layers=result.layers.map(layer=>layer.kind==='vector'?{...layer,colorMode:snapshot.colorMode??'color'}:layer);
    const paint=appendBackgroundCapture(target.paint,result.config,layers);
    validatePaintDocument(paint,[...assets,...imports.map(i=>i.asset),...result.imports.map(i=>i.asset)]);
    const decoded=await Promise.all(result.imports.map(async item=>({id:item.asset.id,image:await decodePaintImage(item.blob)})));
    const map=new Map(images);for(const item of decoded)map.set(item.id,item.image);imagesRef.current=map;setImages(map);
    setImports(items=>[...items.filter(item=>!result.imports.some(next=>next.asset.id===item.asset.id)),...result.imports]);
    setStageImports(items=>[...items.filter(item=>!result.stageImports.some(next=>next.stage.id===item.stage.id)),...result.stageImports]);
    commit({...snapshot,owners:snapshot.owners.map(o=>o.key===backgroundOwner?{...o,paint}:o)});
    setLayerId(result.layers.find(layer=>layer.kind==='vector')!.id);setLineKind('vector');setTool('vector-select');setBackgroundOwner(null);
    }finally{operation.current=false;if(alive.current)setBusy(false);}
    await flush(true);
  }
  const backgroundTarget=scene.owners.find(o=>o.key===backgroundOwner);
  const backgroundFrame=backgroundTarget?.paint.background3d?.frame??backgroundTarget?.paint.referenceFrame??(backgroundTarget?{x:0,y:0,w:backgroundTarget.paint.width,h:backgroundTarget.paint.height}:undefined);

  return {
    openBackground3d, backgroundTarget, backgroundFrame, beginBackgroundMove, moveBackgroundOwner,
    captureBackground3d, closeBackground3d,
  };
}
