import { paintFolderChain, paintLayerEditable, paintOwnerLocked } from '../../lib/paintLock';
import type { FinishBatch } from '../MangaFinishDialog';
import { canFinishPaintLayer, finishLayerKey } from '../../lib/mangaFinishLayers';
import { newToneLayer } from '../../lib/paintTone';
import type { PaintLayerAction } from '../../lib/paintSession';
import type { PaintLayer } from '../../types';
import {
  movePaintEntry, addPaintLayer, addPaintFolder, ensureDirectPaintOwner, paintAddPosition,
  expandPaintOwnerToBounds, movePaintFolder, removePaintFolder, type PaintAddPosition, type PaintOwner,
  type PaintScene,
} from '../../lib/paintDocument';
import { paintStrokeBounds } from '../../lib/paintGesture';
import type { PaintEditorOptions, PaintEditorState } from './paintEditorState';

interface PaintLayerActionsBindings {
  finishGesture: (keep?: boolean) => void;
  commit: (next: PaintScene) => void;
  selectOwner: (key: string, id?: string, contents?: boolean, native?: boolean, rasterMask?: boolean) => void;
  updateOwnerLayer: (key: string, id: string, patch: Partial<PaintLayer>) => void;
  createGenerationMask: (key: string) => { owner: PaintOwner; layer: PaintLayer; } | undefined;
  clearVectorSelection: () => void;
  matchLayerPen: (kind: PaintLayer["kind"]) => void;
  openBackground3d: (key?: string) => void;
}

export function createPaintLayerActions(options: PaintEditorOptions, state: PaintEditorState, bindings: PaintLayerActionsBindings) {
  const { overlay, requested, textTool, zoomTool, onStartPaint, onAddOutside, onToggleGuide } = options;
  const {
    scene, busy, suspended, finishSelection, anchor, paletteScope, finishKeys, hasLayer, layer,
    setFinishSelection, toolSuspended, operation, setMenu, setFinishOpen, alive, historyRef,
    inputActive, imagesRef, setImages, setImports, setOwnerKey, setLayerId, setEffectsTab,
    setMaskTarget, setSelection, setPaletteFolded, ownerKey, layerId, selectedFolder, maskTarget,
    paletteFolded, owner, inkColor, setInkColor, selectedMask, images, locked, selectionBoxes, setError,
  } = state;
  const {
    finishGesture, commit, selectOwner, updateOwnerLayer, createGenerationMask, clearVectorSelection,
    matchLayerPen, openBackground3d,
  } = bindings;
  function toggleFinishLayer(key:string,id:string){
    const target=scene.owners.find(item=>item.key===key)?.paint.layers.find(item=>item.id===id);
    if(!target||!canFinishPaintLayer(target)||busy||suspended)return;
    const picked=finishLayerKey(key,id);
    const previous=finishSelection?.anchor===anchor&&finishSelection.scope===paletteScope?finishKeys:hasLayer&&canFinishPaintLayer(layer)?[anchor]:[];
    setFinishSelection({anchor,scope:paletteScope,keys:previous.includes(picked)?previous.filter(item=>item!==picked):[...previous,picked]});
  }
  function openFinish(){
    if(overlay||busy||toolSuspended||operation.current)return;
    if((!requested||textTool||zoomTool)&&!onStartPaint?.())return;
    finishGesture();setMenu(null);setFinishOpen(true);
  }
  function acceptFinish(batch:FinishBatch){
    if(!alive.current||historyRef.current.present!==batch.source||operation.current||inputActive.current)throw new Error('選択したコマが変わりました。仕上げを開き直してください');
    imagesRef.current=batch.images;setImages(batch.images);
    setImports(items=>[...items,...batch.imports.filter(add=>!items.some(item=>item.asset.id===add.asset.id))]);
    const {ownerKey,folderId,shadeId}=batch.focus;
    const target=batch.scene.owners.find(item=>item.key===ownerKey)!;
    commit(batch.scene);
    setFinishSelection(null);setOwnerKey(ownerKey);setLayerId(shadeId??folderId);
    if(shadeId)setEffectsTab('tone');
    setMaskTarget(null);setSelection(null);setFinishOpen(false);
    setPaletteFolded(current=>{
      const next={...current,[paletteScope]:false,[`${paletteScope}/owner/${ownerKey}`]:false};
      if(target.parentKey)next[`${paletteScope}/owner/${target.parentKey}`]=false;
      for(const folder of paintFolderChain(target.paint,folderId))next[`${paletteScope}/folder/${folder.id}`]=false;
      return next;
    });
  }
  function layerAction(action:PaintLayerAction){
    if(action.type==='background3d'){openBackground3d(action.key);return;}
    if(action.type==='guide'){toggleGuide(action.key);return;}
    if(action.type==='menu'){setMenu({key:action.key,x:action.x,y:action.y});return;}
    if(action.type==='select'){if(action.mask&&(action.id!==undefined||action.mask==='generationMask'))selectMask(action.key,action.id??'',action.mask);else selectOwner(action.key,action.id,action.contents,action.native);return;}
    if(action.type==='update'){updateOwnerLayer(action.key,action.id,action.patch);return;}
    if(action.type==='generation-mask'){const target=createGenerationMask(action.key);if(action.select&&target)selectMask(target.owner.key,target.layer.id,'generationMask');return;}
    const moving=action.type==='move-layer'||action.type==='move-folder';
    if(busy||(moving?toolSuspended:suspended)||operation.current||inputActive.current)return;
    let current=historyRef.current.present,target=current.owners.find(o=>o.key===action.key);
    if(!target)return;
    if(moving&&action.destination){
      const destination=action.destination;
      let destinationKey=destination.key;
      if(destination.stack){const direct=ensureDirectPaintOwner(current,destination.stack);if(!direct)return;current=direct.scene;destinationKey=direct.key;target=current.owners.find(o=>o.key===action.key)!;}
      const other=current.owners.find(item=>item.key===destinationKey);if(!other)return;
      if(other!==target){
        const moved=movePaintEntry(target,other,action.type==='move-folder'?'folder':'layer',action.id,action.target);if(!moved)return;
        commit({...current,owners:current.owners.map(item=>item===target?moved.source:item===other?moved.destination:item)});
        if(ownerKey===target.key&&(layerId===action.id||action.type==='move-folder'&&paintFolderChain(target.paint,selectedFolder?.id??layer.folderId).some(folder=>folder.id===action.id))){
          setOwnerKey(other.key);if(maskTarget)setMaskTarget({...maskTarget,key:other.key});
        }
        return;
      }
    }
    if(action.type==='add'||action.type==='add-folder'){
      if(!overlay&&(paletteFolded[paletteScope]===true||target.inheritedLocked)){onAddOutside?.(action);return;}
      const folded=(id:string)=>paletteFolded[`${paletteScope}/folder/${id}`]??false;
      const ownerFolded=(paletteFolded[`${paletteScope}/owner/${target.key}`]??target.kind==='bubble')||Boolean(target.parentKey&&(paletteFolded[`${paletteScope}/owner/${target.parentKey}`]??true));
      const external=target.kind!=='panel'&&target.kind!=='page'&&(ownerFolded||paintOwnerLocked(target));
      const position:PaintAddPosition=action.position??(external?{stack:{below:target.parentKey&&(ownerFolded||target.inheritedLocked)?target.parentKey:target.key}}:paintAddPosition(target,target.key===owner.key?layerId:undefined,folded));
      if(position.stack){const direct=ensureDirectPaintOwner(current,position.stack);if(!direct)return;current=direct.scene;target=current.owners.find(item=>item.key===direct.key)!;}
      if(paintOwnerLocked(target))return;
      if(action.type==='add'){
        const added=addPaintLayer(current,target.key,action.kind,{...position,stack:undefined});if(!added)return;
        commit(added.scene);setOwnerKey(added.key);setLayerId(added.layer.id);clearVectorSelection();setMaskTarget(null);
        matchLayerPen(action.kind);
      }else{
        if((target.paint.folders?.length??0)>=64)return;
        const next=addPaintFolder(target.paint);
        if(position.aboveNative)next.folder.aboveNative=true;
        const drop=position.target;
        const paint=drop?movePaintFolder(next.paint,next.folder.id,drop):next.paint;
        commit({...current,owners:current.owners.map(item=>item===target?{...item,paint}:item)});
        setOwnerKey(target.key);setLayerId(next.folder.id);clearVectorSelection();setMaskTarget(null);setSelection(null);
      }
      return;
    }
    if(action.type==='owner-lock'){
      if(target.inheritedLocked)return;
      if(target.kind==='bubble'&&!action.group){
        if(target.locked||target.bubble?.nativeLocked===action.locked)return;
        commit({...current,owners:current.owners.map(o=>o===target?{...o,bubble:{...o.bubble!,nativeLocked:action.locked||undefined}}:o)});return;
      }
      if(target.locked===action.locked)return;
      commit({...current,owners:current.owners.map(o=>{
        if(o===target)return {...o,locked:action.locked,...(!action.locked?{...(o.bubble?{bubble:{...o.bubble,nativeLocked:undefined}}:{}),paint:{...o.paint,folders:o.paint.folders?.map(folder=>({...folder,locked:false})),layers:o.paint.layers.map(layer=>({...layer,locked:false}))}}:{})};
        if(action.group&&o.parentKey===target.key)return {...o,inheritedLocked:action.locked,...(!action.locked?{locked:false,paint:{...o.paint,folders:o.paint.folders?.map(folder=>({...folder,locked:false})),layers:o.paint.layers.map(layer=>({...layer,locked:false}))}}:{})};
        return o;
      })});return;
    }
    if(action.type==='update-folder'){
      const folder=target.paint.folders?.find(folder=>folder.id===action.id);if(!folder)return;
      if(action.patch.locked!==undefined&&(paintOwnerLocked(target)||paintFolderChain(target.paint,folder.parentFolderId).some(parent=>parent.locked)))return;
      const folders=target.paint.folders!.map(item=>item===folder?{...item,...action.patch}:item);
      commit({...current,owners:current.owners.map(o=>o===target?{...o,paint:{...o.paint,folders}}:o)});return;
    }
    if(action.type!=='toggle'&&paintOwnerLocked(target))return;
    if((action.type==='rename-folder'||action.type==='remove-folder'||action.type==='move-folder')&&paintFolderChain(target.paint,action.id).some(folder=>folder.locked))return;
    if(action.type==='rename-folder'){
      const name=action.name.trim();if(!name||target.paint.folders?.find(folder=>folder.id===action.id)?.name===name)return;
      const folders=target.paint.folders?.map(folder=>folder.id===action.id?{...folder,name}:folder);if(!folders?.some(folder=>folder.id===action.id))return;
      commit({...current,owners:current.owners.map(o=>o.key===action.key?{...o,paint:{...o.paint,folders}}:o)});return;
    }
    if(action.type==='remove-folder'){
      const paint=removePaintFolder(target.paint,action.id);if(paint===target.paint)return;
      commit({...current,owners:current.owners.map(o=>o.key===action.key?{...o,paint}:o)});return;
    }
    if(action.type==='move-folder'||action.type==='move-layer'){
      const moved=movePaintEntry(target,target,action.type==='move-folder'?'folder':'layer',action.id,action.target);
      if(moved)commit({...current,owners:current.owners.map(o=>o===target?moved.destination:o)});
      return;
    }
    let layers=target.paint.layers;
    if(action.type==='toggle'){
      const visible=!layers.some(l=>l.visible);layers=layers.map(l=>({...l,visible}));
    }else{
      layers=[...layers];const from=layers.findIndex(l=>l.id===action.id);if(from<0||action.id===action.target)return;
      if(!paintLayerEditable(target,layers[from]))return;
      const moved=layers.splice(from,1)[0],to=layers.findIndex(l=>l.id===action.target);if(to<0)return;
      layers.splice(to+(action.after?0:1),0,moved);
    }
    commit({...current,owners:current.owners.map(o=>o.key===action.key?{...o,paint:{...o.paint,layers}}:o)});
  }
  function selectMask(key:string,id:string,kind:'mask'|'generationMask'){
    if(busy||suspended||operation.current||inputActive.current)return;
    if(kind==='generationMask'){
      const target=historyRef.current.present.owners.find(owner=>owner.key===key),selected=target?.paint.layers.find(layer=>layer.generationMask&&(!id||layer.id===id));if(!target||!selected)return;
      finishGesture();clearVectorSelection();setOwnerKey(target.key);setLayerId(selected.id);setMaskTarget(null);setSelection(null);
      setPaletteFolded(current=>({...current,[`${paletteScope}/owner/${target.key}`]:false}));
      if(!['#ff0000','#0000ff','#00ff00','#ffff00'].includes(inkColor))setInkColor('#ff0000');
      matchLayerPen('raster');
    }else{
      if(selectedMask==='mask'&&owner.key===key&&layer.id===id){finishGesture();setMaskTarget(null);setSelection(null);matchLayerPen(layer.kind);return;}
      selectOwner(key,id,false,false,true);setMaskTarget({key,id,kind});
      const target=scene.owners.find(o=>o.key===key)?.paint.layers.find(l=>l.id===id);
      if(target?.mask&&!target.mask.enabled&&!target.locked)updateOwnerLayer(key,id,{mask:{...target.mask,enabled:true}});
    }
  }
  function addToneMask(){
    if(!images||locked||busy||suspended||operation.current||owner.paint.layers.length>=64)return;
    finishGesture();const added=newToneLayer(selectionBoxes,scene.colorMode);
    try{const next=expandPaintOwnerToBounds({...owner,paint:{...owner.paint,layers:[...owner.paint.layers,added]}},added.mask?.strokes[0]?paintStrokeBounds(added.mask.strokes[0]):undefined);
      commit({...scene,owners:scene.owners.map(o=>o.key===owner.key?next:o)});}
    catch(error){setError(error instanceof Error?error.message:'描画範囲を拡張できませんでした');return;}
    setError('');clearVectorSelection();setLayerId(added.id);
    setMaskTarget({key:owner.key,id:added.id,kind:'mask'});setSelection(null);matchLayerPen('raster');
  }
  function addGenerationMask(){
    if(!images||busy||suspended)return;
    const target=createGenerationMask(owner.key);
    if(target)selectMask(target.owner.key,target.layer.id,'generationMask');
  }
  function toggleGuide(key:string){
    if(busy||suspended||operation.current||!images)return;
    const target=scene.owners.find(o=>o.key===key);if(!target)return;
    if(!target.paint.guideInitialized){onToggleGuide(key);return;}
    const guides=target.paint.layers.filter(l=>l.guide);if(!guides.length)return;
    const visible=!guides.some(l=>l.visible);
    commit({...scene,owners:scene.owners.map(o=>o===target?{...o,paint:{...o.paint,layers:o.paint.layers.map(l=>l.guide?{...l,visible}:l)}}:o)});
  }

  return {
    layerAction, toggleFinishLayer, selectMask, addToneMask, addGenerationMask, toggleGuide,
    acceptFinish, openFinish,
  };
}
