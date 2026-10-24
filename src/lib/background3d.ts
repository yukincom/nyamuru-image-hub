import type { BackgroundCapture, BackgroundStage, BBox, PaintDocument, PaintLayer, MangaDocument, MaterialScope } from '../types.ts';
import {defaultPaintTone} from './paintTone.ts';

export const CUBE_STAGE_ID='builtin:cube';
export const stageMediaType=(stage:Pick<BackgroundStage,'format'>)=>stage.format==='glb'?'model/gltf-binary':'application/vnd.autodesk.fbx';

export function defaultBackgroundCapture(frame:BBox,dpi=600):BackgroundCapture {
  const tone=defaultPaintTone();
  return {version:1,sourceId:CUBE_STAGE_ID,camera:{position:[4,3,5],target:[0,0,0],fov:40},light:{azimuth:45,elevation:50,preset:'daylight',intensity:1,bounce:1},
    outlineWidth:Math.max(1,dpi/150),detailWidth:Math.max(1,dpi/300),creaseAngle:35,detail:1,lineGap:0,
    blackAmount:15,toneEnabled:true,toneDensity:tone.density,toneLpi:tone.lpi,toneThreshold:45,frame:{...frame},layerIds:[]};
}
export function validateBackgroundCapture(value:BackgroundCapture):void {
  const range=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  const vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(n=>range(n,-1e12,1e12));
  const c=value?.camera,b=value?.frame;
  if(!value||value.version!==1||typeof value.sourceId!=='string'||!value.sourceId||!c||!vec(c.position)||!vec(c.target)
    ||Math.hypot(...c.position.map((n,i)=>n-c.target[i]))<1e-8||!range(c.fov,5,150)
    ||c.shift!==undefined&&(!Array.isArray(c.shift)||c.shift.length!==2||!c.shift.every(n=>typeof n==='number'&&Number.isFinite(n)))
    ||!value.light||!range(value.light.azimuth,-360,360)||!range(value.light.elevation,-90,90)
    ||value.light.preset!==undefined&&!['daylight','evening','indoor'].includes(value.light.preset)
    ||value.light.intensity!==undefined&&!range(value.light.intensity,.1,4)
    ||value.light.bounce!==undefined&&!range(value.light.bounce,0,2)
    ||value.light.ceiling!==undefined&&typeof value.light.ceiling!=='boolean'
    ||value.light.windowMesh!==undefined&&(!Number.isSafeInteger(value.light.windowMesh)||value.light.windowMesh<0)
    ||!range(value.outlineWidth,.1,1000)||!range(value.detailWidth,.1,1000)||!range(value.creaseAngle,0,180)
    ||!range(value.detail,0,1)||!range(value.lineGap,0,.9)||!range(value.blackAmount,0,100)
    ||typeof value.toneEnabled!=='boolean'||!range(value.toneDensity,0,100)||!range(value.toneLpi,1,1000)
    ||value.toneThreshold!==undefined&&!range(value.toneThreshold,0,100)
    ||value.cutaway!==undefined&&(!value.cutaway||typeof value.cutaway.enabled!=='boolean'||!range(value.cutaway.depth,.05,.45))
    ||value.objectVisibility!==undefined&&(!Array.isArray(value.objectVisibility)||value.objectVisibility.some(rule=>!rule||!Number.isSafeInteger(rule.mesh)||rule.mesh<0||!['show','hide'].includes(rule.mode))||new Set(value.objectVisibility.map(rule=>rule.mesh)).size!==value.objectVisibility.length)
    ||value.focusMesh!==undefined&&(!Number.isSafeInteger(value.focusMesh)||value.focusMesh<0)
    ||value.focusPoint!==undefined&&(!vec(value.focusPoint)||value.focusMesh===undefined)
    ||!b||![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0
    ||!Array.isArray(value.layerIds)||value.layerIds.length>64||value.layerIds.some(id=>typeof id!=='string'||!id)) {
    throw new Error('3D背景のカメラまたは線・トーン設定が不正です');
  }
}
export function validateBackgroundStages(stages:BackgroundStage[]=[]):void {
  if(!Array.isArray(stages))throw new Error('3D舞台の保存情報が不正です');
  const ids=new Set<string>();
  for(const stage of stages){
    if(!stage||!/^stage-[a-f0-9]{64}$/.test(stage.id)||stage.id!==`stage-${stage.sha256}`||ids.has(stage.id)
      ||typeof stage.storageId!=='string'||!stage.storageId||typeof stage.name!=='string'||!stage.name
      ||!['glb','fbx'].includes(stage.format)||!Number.isSafeInteger(stage.byteLength)||stage.byteLength<=0
      ||stage.seriesId!==undefined&&(typeof stage.seriesId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(stage.seriesId)))
      throw new Error('3D舞台の保存情報が不正です');
    ids.add(stage.id);
  }
}
async function digest(blob:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');}
export async function prepareBackgroundStage(file:File):Promise<{stage:BackgroundStage;blob:Blob}> {
  const format=file.name.split('.').at(-1)?.toLowerCase();
  if(!['glb','fbx'].includes(format??'')||!file.size)throw new Error('GLBまたはFBXの3Dモデルを選んでください');
  const sha256=await digest(file),stage:BackgroundStage={id:`stage-${sha256}`,storageId:`original-stage-${crypto.randomUUID()}`,name:file.name,format:format as 'glb'|'fbx',sha256,byteLength:file.size};
  return {stage,blob:new Blob([file],{type:stageMediaType(stage)})};
}
export async function verifyBackgroundStage(stage:BackgroundStage,blob:Blob):Promise<void> {
  if(blob.size!==stage.byteLength||blob.type!==stageMediaType(stage)||await digest(blob)!==stage.sha256)throw new Error(`3D舞台「${stage.name}」の原本が保存情報と一致しません`);
}
/** Previous captures live in the common undo history, including their retouching. */
export function appendBackgroundCapture(paint:PaintDocument,capture:BackgroundCapture,layers:PaintLayer[]):PaintDocument {
  const previous=new Set(paint.background3d?.layerIds??[]),retained=paint.layers.filter(layer=>!previous.has(layer.id));
  if(retained.length+layers.length>64)throw new Error('撮影用レイヤーを追加できません。不要なレイヤーを整理してください（上限64枚）');
  return {...paint,background3d:{...structuredClone(capture),layerIds:layers.map(l=>l.id)},layers:[...retained,...layers]};
}
export function mapBackgroundCapture(capture:BackgroundCapture,mapBox:(b:BBox)=>BBox,scale=1):BackgroundCapture {
  return {...structuredClone(capture),frame:mapBox(capture.frame),outlineWidth:capture.outlineWidth*scale,detailWidth:capture.detailWidth*scale};
}

/** Include registered models even before any panel has used them. */
export function backgroundMaterialStages(document:MangaDocument,scope?:MaterialScope):BackgroundStage[] {
  const ids=new Set(document.manga.materials.filter(material=>material.type==='background'&&(!scope||material.scope===scope)).map(material=>material.source_stage_id).filter(Boolean));
  return (document.manga.background_stages??[]).filter(stage=>ids.has(stage.id));
}

/** Show the user's background names while keeping model identity stable. */
export function namedBackgroundStages(document:MangaDocument):BackgroundStage[] {
  return (document.manga.background_stages??[]).map(stage=>{
    const names=document.manga.materials.filter(material=>material.type==='background'&&material.source_stage_id===stage.id).map(material=>material.key.trim()).filter(Boolean);
    return names.length?{...stage,name:[...new Set(names)].join(' / ')}:stage;
  });
}

/** Shared originals may be reused by several cards without duplicating their bytes. */
export function mergeBackgroundStages(target:MangaDocument,source:MangaDocument,stages=backgroundMaterialStages(source,'series')):void {
  const known=target.manga.background_stages??=[];
  for(const stage of stages){
    const existing=known.find(item=>item.id===stage.id);
    if(existing){if(!existing.seriesId&&stage.seriesId)existing.seriesId=stage.seriesId;}
    else known.push(structuredClone(stage));
  }
  if(!known.length)delete target.manga.background_stages;
}
