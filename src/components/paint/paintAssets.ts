import { useEffect, useRef, useLayoutEffect } from 'preact/hooks';
import { prepareGuideLayer } from '../../lib/paintGuide';
import type { PaintLayer } from '../../types';
import { type PaintOwner, type PaintScene, paintAssetIds } from '../../lib/paintDocument';
import { loadPaintImages, type PaintImages } from '../../lib/paintRenderer';
import type { PaintEditorOptions, PaintEditorState, PaintResult } from './paintEditorState';

const paintImageSignature=(scene:PaintScene)=>[...new Set(scene.owners.flatMap(owner=>paintAssetIds(owner.paint)))].sort().join('\u0000');

export function usePaintAssets(options: PaintEditorOptions, state: PaintEditorState, finishRuler: (keep?: boolean) => void) {
  const { resumeImages, resume, initialOwner, requested, onReady, assets } = options;
  const {
    releaseImages, setHistory, initial, setOwnerKey, setLayerId, selectionPointer, pendingContents,
    setSelection, setLassoPreview, loadedInitial, failedImageSignature, imageTarget, setMenu,
    setPenMenu, setEraserMenu, setVectorPreview, setVectorSelected, vectorState, vectorPointer,
    layerMove, setBackgroundOwner, setBackgroundSelection, backgroundMove, backgroundController,
    setStageImports, setMaskTarget, setImports, imagesRef, setImages, setLive, setError, setBusy,
    gesture, inputActive, operation, images, error, alive, checkpoint, rulerPointer, raf, scene,
    imports, dirty,
  } = state;
  useLayoutEffect(()=>{
    finishRuler(false);
    releaseImages(resumeImages);
    setHistory(()=>({initial,past:[],present:initial,future:[]}));
    const selected=initial.owners.find(o=>o.key===(resume?.ownerKey??initialOwner))??initial.owners[0];
    const initialLayerId=resume?.layerId??selected.paint.layers.findLast(l=>!l.locked)?.id??selected.paint.layers[0]?.id??'';
    setOwnerKey(selected.key);setLayerId(initialLayerId);
    selectionPointer.current?.cleanup();selectionPointer.current=null;pendingContents.current=null;setSelection(null);setLassoPreview([]);loadedInitial.current=null;failedImageSignature.current='';imageTarget.current=null;setMenu(null);setPenMenu(false);setEraserMenu(null);setVectorPreview(null);setVectorSelected([]);vectorState.current={paths:[],selected:[]};vectorPointer.current?.cleanup();vectorPointer.current=null;layerMove.current?.cleanup();layerMove.current=null;
    setBackgroundOwner(null);setBackgroundSelection(null);backgroundMove.current=null;backgroundController.current=null;setStageImports(resume?.stageImports??[]);setMaskTarget(resume?.maskTarget??null);setImports(resume?.imports??[]);const readyImages=resumeImages&&initial.owners.every(owner=>paintAssetIds(owner.paint).every(id=>resumeImages.has(id))&&owner.paint.layers.every(layer=>!layer.guide||!!layer.image))?resumeImages:null;imagesRef.current=readyImages;setImages(readyImages);setLive(undefined);setError('');setBusy(false);
    gesture.current?.cleanup();gesture.current=null;inputActive.current=false;operation.current=false;
  },[initial]);
  const readyInitial=useRef<PaintScene|null>(null);
  useEffect(()=>{if(requested&&(images||error)&&loadedInitial.current===initial&&readyInitial.current!==initial){readyInitial.current=initial;onReady?.();}},[initial,images,error]);
  useEffect(()=>{
    if(!requested)return;
    let cancelled=false;alive.current=true;let map:PaintImages=new Map();
    void (async()=>{
      const pending=new Map(resume?.imports.map(item=>[item.asset.id,item.blob])),preparedImports:PaintResult['imports']=[];
      try{
        const owners:PaintOwner[]=[];
        const preparedGuides:Array<{before:PaintOwner;prepared:PaintOwner}>=[];
        for(const owner of initial.owners){
          const layers:PaintLayer[]=[];
          let repairedImage=false;
          for(const layer of owner.paint.layers){
            if(cancelled)return;
            let repair=layer.guide&&!layer.image;
            if(layer.guide&&layer.image&&!resumeImages?.has(layer.image.assetId)){
              try{
                const probe=await loadPaintImages([{...owner.paint,layers:[layer]}],assets,pending);
                probe.forEach(image=>{image.src='';});
              }catch{repair=true;repairedImage=true;}
            }
            if(repair){
              const prepared=await prepareGuideLayer(owner,{...layer,image:undefined});
              layers.push({...prepared.layer,locked:layer.locked});
              preparedImports.push({asset:prepared.asset,blob:prepared.blob});pending.set(prepared.asset.id,prepared.blob);
            }else layers.push(layer);
          }
          const prepared=layers.some((l,i)=>l!==owner.paint.layers[i])?{...owner,paint:{...owner.paint,layers}}:owner;
          owners.push(prepared);
          if(prepared!==owner&&!repairedImage)preparedGuides.push({before:owner,prepared});
        }
        if(cancelled)return;
        const allAssets=[...assets,...preparedImports.map(item=>item.asset)];
        map=await loadPaintImages(owners.map(owner=>owner.paint),allAssets,pending,resumeImages);
        if(cancelled)return;
        for(const {before,prepared} of preparedGuides)checkpoint.prepareGuide(before,prepared);
        if(preparedImports.length){setImports(items=>[...items,...preparedImports]);setHistory(h=>({...h,present:{...initial,owners}}));}
        releaseImages(map);
        loadedInitial.current=initial;failedImageSignature.current='';imagesRef.current=map;setImages(map);
      }catch(error){map.forEach((image,id)=>{if(image!==resumeImages?.get(id))image.src='';});throw error;}
      finally{if(cancelled)map.forEach((image,id)=>{if(image!==resumeImages?.get(id))image.src='';});}
    })().catch(e=>{if(!cancelled){loadedInitial.current=initial;failedImageSignature.current=paintImageSignature(initial);setError(e instanceof Error?e.message:'原本を読み込めません');}});
    return()=>{cancelled=true;alive.current=false;rulerPointer.current?.cleanup();rulerPointer.current=null;selectionPointer.current?.cleanup();selectionPointer.current=null;gesture.current?.cleanup();gesture.current=null;vectorPointer.current?.cleanup();vectorPointer.current=null;layerMove.current?.cleanup();layerMove.current=null;inputActive.current=false;cancelAnimationFrame(raf.current);};
  },[initial]);
  useEffect(()=>()=>releaseImages(),[]);
  const recoveryImageSignature=paintImageSignature(scene);
  useEffect(()=>{
    if(!requested||images||loadedInitial.current!==initial||failedImageSignature.current===recoveryImageSignature)return;
    let cancelled=false;
    failedImageSignature.current=recoveryImageSignature;
    const pending=new Map(imports.map(item=>[item.asset.id,item.blob]));
    const allAssets=[...assets,...imports.map(item=>item.asset).filter(asset=>!assets.some(saved=>saved.id===asset.id))];
    void loadPaintImages(scene.owners.map(owner=>owner.paint),allAssets,pending).then(value=>{
      if(cancelled)value.forEach(image=>{image.src='';});
      else{imagesRef.current=value;setImages(value);setError('');failedImageSignature.current='';}
    }).catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:'原本を読み込めません');});
    // Published images belong to the session; setImages must not dispose its own result.
    return()=>{cancelled=true;};
  },[initial,recoveryImageSignature,images,assets,imports]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
}
