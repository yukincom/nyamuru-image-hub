import type {BackgroundCapture} from '../types.ts';
import {defaultBackgroundCapture} from './background3d.ts';
import {defaultPaintTone} from './paintTone.ts';

const KEY='nyamuru.background3d-defaults.v1';
const STYLE_KEYS=['outlineWidth','detailWidth','creaseAngle','detail','lineGap','blackAmount','toneEnabled','toneThreshold'] as const;
export const background3dDefaultGroups={
  stage:['cutawayEnabled'],
  line:['outlineWidth','detailWidth','creaseAngle','detail','lineGap'],
  daylight:['azimuth','elevation','ceiling'],
  light:['preset','intensity','bounce'],
  tone:['blackAmount','toneEnabled','toneThreshold'],
} as const;
export type Background3dDefaultGroup=keyof typeof background3dDefaultGroups;
const GROUPS=Object.keys(background3dDefaultGroups) as Background3dDefaultGroup[];
export interface Background3dDefaults extends Required<Pick<BackgroundCapture,typeof STYLE_KEYS[number]>> {
  version:1;
  light:Required<Omit<BackgroundCapture['light'],'windowMesh'>>;
  cutawayEnabled:boolean;
  /** Absent on legacy preferences, where every group was saved together. */
  savedGroups?:Background3dDefaultGroup[];
}

function validate(value:Background3dDefaults):Background3dDefaults {
  const range=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  if(!value||value.version!==1||!value.light
    ||!range(value.outlineWidth,1,1000)||!range(value.detailWidth,1,1000)||!range(value.creaseAngle,0,180)
    ||!range(value.detail,0,1)||!range(value.lineGap,0,.8)||!range(value.blackAmount,0,100)
    ||typeof value.toneEnabled!=='boolean'||!range(value.toneThreshold,0,100)||typeof value.cutawayEnabled!=='boolean'
    ||!['daylight','evening','indoor'].includes(value.light.preset)||!range(value.light.azimuth,-360,360)||!range(value.light.elevation,-90,90)
    ||!range(value.light.intensity,.1,2)||!range(value.light.bounce,0,1)||typeof value.light.ceiling!=='boolean'
    ||value.savedGroups!==undefined&&(!Array.isArray(value.savedGroups)||!value.savedGroups.every(group=>GROUPS.includes(group)))) {
    throw new Error('3D背景のデフォルト設定が不正です');
  }
  return value;
}

/** Save rendering choices, never stage identities or shot composition. */
export function background3dDefaults(capture:BackgroundCapture):Background3dDefaults {
  const {azimuth,elevation,preset='daylight',intensity=1,bounce=1,ceiling=true}=capture.light;
  return validate({version:1,outlineWidth:capture.outlineWidth,detailWidth:capture.detailWidth,creaseAngle:capture.creaseAngle,
    detail:capture.detail,lineGap:capture.lineGap,blackAmount:capture.blackAmount,toneEnabled:capture.toneEnabled,toneThreshold:capture.toneThreshold??45,
    light:{azimuth,elevation,preset,intensity,bounce,ceiling},cutawayEnabled:capture.cutaway?.enabled??false});
}

export function loadBackground3dDefaults(storage?:Pick<Storage,'getItem'>):Background3dDefaults|undefined {
  try {
    const raw=storage?.getItem(KEY);if(raw==null)return;
    const value=validate(JSON.parse(raw));
    // Select known fields again so unrelated data cannot become capture settings.
    const defaults=background3dDefaults({...defaultBackgroundCapture({x:0,y:0,w:1,h:1}),...value,cutaway:{enabled:value.cutawayEnabled,depth:.25}});
    return value.savedGroups?{...defaults,savedGroups:[...new Set(value.savedGroups)]}:defaults;
  }catch{return;}
}

export function saveBackground3dDefaults(storage:Pick<Storage,'setItem'>,capture:BackgroundCapture):Background3dDefaults {
  const defaults=background3dDefaults(capture);storage.setItem(KEY,JSON.stringify(defaults));return defaults;
}

export function hasSavedBackground3dDefault(defaults:Background3dDefaults|undefined,group:Background3dDefaultGroup):boolean {
  return !!defaults&&(!defaults.savedGroups||defaults.savedGroups.includes(group));
}

function applyGroup(capture:BackgroundCapture,saved:Background3dDefaults,group:Background3dDefaultGroup):BackgroundCapture {
  if(group==='stage')return {...capture,cutaway:{depth:capture.cutaway?.depth??.25,enabled:saved.cutawayEnabled}};
  if(group==='daylight'||group==='light')return {...capture,light:{...capture.light,...Object.fromEntries(background3dDefaultGroups[group].map(key=>[key,saved.light[key]]))}};
  return {...capture,...Object.fromEntries(background3dDefaultGroups[group].map(key=>[key,saved[key]]))};
}

export function saveBackground3dDefaultGroup(storage:Pick<Storage,'getItem'|'setItem'>,capture:BackgroundCapture,group:Background3dDefaultGroup,dpi=600):Background3dDefaults {
  const previous=loadBackground3dDefaults(storage),factory=defaultBackgroundCapture(capture.frame,dpi);
  const baseline=applyBackground3dDefaults(factory,previous,dpi);
  const defaults={...background3dDefaults(applyGroup(baseline,background3dDefaults(capture),group)),
    savedGroups:[...new Set([...(previous?(previous.savedGroups??GROUPS):[]),group])]};
  storage.setItem(KEY,JSON.stringify(defaults));return defaults;
}

export function applyBackground3dDefaults(capture:BackgroundCapture,defaults:Background3dDefaults|undefined,dpi=600,group?:Background3dDefaultGroup):BackgroundCapture {
  const factory=background3dDefaults(defaultBackgroundCapture(capture.frame,dpi));
  let result=capture;
  for(const section of group?[group]:GROUPS)result=applyGroup(result,hasSavedBackground3dDefault(defaults,section)?defaults!:factory,section);
  if(group&&group!=='tone')return result;
  const tone=defaultPaintTone();return {...result,toneLpi:tone.lpi,toneDensity:tone.density};
}
