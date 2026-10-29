import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import {createPortal} from 'preact/compat';
import {Camera,RotateCcw,Settings} from 'lucide-preact';
import type { BackgroundCapture, BackgroundStage, PaintDocument } from '../types';
import { CUBE_STAGE_ID, defaultBackgroundCapture, verifyBackgroundStage } from '../lib/background3d';
import { loadBackgroundStage } from '../lib/backgroundStageStore';
import BackgroundCameraGizmo from './BackgroundCameraGizmo';
import Background3dFocus from './Background3dFocus';
import { Background3dRenderer, fitStageCamera, loadStageShape, type StageShape } from '../lib/background3dRenderer';
import { dollyBackgroundCamera, focusBackgroundCamera } from '../lib/background3dCamera';
import { backgroundLightPresets, backgroundLightSettings, backgroundLightWindow, backgroundPresetLight } from '../lib/background3dLightingModel';
import {applyBackground3dDefaults,background3dDefaults,background3dDefaultGroups,hasSavedBackground3dDefault,loadBackground3dDefaults,saveBackground3dDefaultGroup,type Background3dDefaultGroup} from '../lib/background3dPreferences';
import {defaultPaintTone} from '../lib/paintTone';

export type Background3dResult=Awaited<ReturnType<Background3dRenderer['capture']>>&{stageImports:Array<{stage:BackgroundStage;blob:Blob}>};
export type Background3dObjectState=ReturnType<Background3dRenderer['objectVisibilityState']>;
export interface Background3dController {setObjectVisibility:(mesh:number,mode:'auto'|'show'|'hide')=>void;capture:()=>Promise<void>;snapshot:()=>{config:BackgroundCapture;stageImports:Background3dResult['stageImports']}}
interface Props {onCaptureReady?:(ready:boolean)=>void;host:HTMLDivElement|null;paint:PaintDocument;stages:BackgroundStage[];pendingStages:Background3dResult['stageImports'];controller?:RefObject<Background3dController|null>;disabled?:boolean;onCapture:(result:Background3dResult)=>Promise<void>;onCancel:()=>void}
export default function Background3dEditor({host,paint,stages,pendingStages,controller,onCaptureReady,disabled=false,onCapture,onCancel}:Props){
  const [objects,setObjects]=useState<Background3dObjectState>([]);
  const [defaults,setDefaults]=useState(()=>{try{return loadBackground3dDefaults(window.localStorage);}catch{return undefined;}});
  const [preferencesOpen,setPreferencesOpen]=useState<Partial<Record<Background3dDefaultGroup,boolean>>>({});
  const [preferenceStatus,setPreferenceStatus]=useState<Partial<Record<Background3dDefaultGroup,string>>>({}),preferencesId=useId();
  const [config,setConfig]=useState<BackgroundCapture>(()=>{
    let capture=structuredClone(paint.background3d??defaultBackgroundCapture(paint.referenceFrame??{x:0,y:0,w:paint.width,h:paint.height},paint.dpi));
    if(!paint.background3d)capture=applyBackground3dDefaults(capture,defaults,paint.dpi);
    const tone=defaultPaintTone();capture.toneLpi=tone.lpi;capture.toneDensity=tone.density;
    // Preserve stored captures, but keep a newly opened editing draft within
    // the available controls so its slider, percentage and lighting agree.
    capture.light={...capture.light,intensity:Math.min(2,capture.light.intensity??1),bounce:Math.min(1,capture.light.bounce??1)};
    capture.outlineWidth=Math.max(1,capture.outlineWidth);capture.detailWidth=Math.max(1,capture.detailWidth);
    return capture;
  });
  const current=useRef(config);current.current=config;
  const renderer=useRef<Background3dRenderer|null>(null),shape=useRef<StageShape|null>(null),fitNext=useRef(false);
  const engineSource=useRef<string|null>(null),reportedObjects=useRef('');
  const [stageImports]=useState<Background3dResult['stageImports']>(()=>pendingStages),[ready,setReady]=useState(false),[working,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('舞台を読み込み中…');
  const pickingMode=useRef<'object'|'point'|'window'>('object');
  const [picking,setPicking]=useState(false),[focusHint,setFocusHint]=useState(''),[objectMenu,setObjectMenu]=useState<{mesh:number;x:number;y:number}|null>(null);
  const busy=working||disabled;
  if(controller)controller.current={setObjectVisibility:setVisibility,capture,snapshot:()=>{
    if(working||fitNext.current&&!ready&&!error)throw new Error('3Dモデルの読み込み・撮影が終わってから切り替えてください');
    return {config:structuredClone(current.current),stageImports:[...stageImports]};
  }};
  const availableLayers=paint.layers.filter(layer=>!paint.background3d?.layerIds.includes(layer.id)).length;
  const canCapture=ready&&!busy&&availableLayers<=61;
  useEffect(()=>{onCaptureReady?.(canCapture);return()=>onCaptureReady?.(false);},[canCapture]);
  useEffect(()=>()=>{if(controller)controller.current=null;},[controller]);
  useEffect(()=>{renderer.current?.setEnabled(!busy);},[busy,ready]);
  useEffect(()=>{renderer.current?.setPicking(picking&&ready&&!busy,pickingMode.current==='point'?config.focusMesh:undefined);},[picking,ready,busy]);
  const allStages=[...stages,...stageImports.map(item=>item.stage).filter(stage=>!stages.some(saved=>saved.id===stage.id))];
  useEffect(()=>{
    if(!host)return;
    let cancelled=false,engine:Background3dRenderer|undefined;
    setReady(false);setError('');setStatus('舞台を読み込み中…');
    void(async()=>{
      try{
        engine=new Background3dRenderer(host,current.current,paint.dpi,camera=>{
          setObjectMenu(null);current.current={...current.current,camera};setConfig(current.current);
        },setStatus,hit=>{
          if(!hit){setFocusHint(pickingMode.current==='point'?'選んだ物の見えている表面をクリックしてください。':'3Dの物がある場所をクリックしてください。');return;}
          setPicking(false);setFocusHint('');
          if(pickingMode.current==='window')change({light:backgroundPresetLight({...current.current.light,windowMesh:hit.surfaceMesh},current.current.light.preset??'daylight',shape.current??undefined)});
          else change({focusMesh:hit.mesh,focusPoint:hit.point});
        },point=>{setPicking(false);setFocusHint('');change({focusPoint:point});});renderer.current=engine;engine.onObjectMenu=(mesh,x,y)=>setObjectMenu({mesh,x,y});
        const sourceId=current.current.sourceId,stage=allStages.find(stage=>stage.id===sourceId);
        if(sourceId!==CUBE_STAGE_ID&&!stage)throw new Error('元の舞台が見つかりません。作品フォルダから開き直してください');
        const blob=stage?(stageImports.find(item=>item.stage.id===stage.id)?.blob??await loadBackgroundStage(stage)):undefined;
        if(stage&&blob)await verifyBackgroundStage(stage,blob);
        const loaded=await loadStageShape(stage,blob??undefined);
        if(cancelled)return;
        shape.current=loaded;engine.setShape(loaded);engineSource.current=sourceId;
        if(fitNext.current||!current.current.light.preset){const next={...current.current,...(fitNext.current?{camera:fitStageCamera(loaded)}:{}),light:current.current.light.preset?current.current.light:backgroundPresetLight(current.current.light,'daylight',loaded)};fitNext.current=false;current.current=next;setConfig(next);engine.configure(next);}
        setReady(true);
      }catch(error){if(!cancelled)setError(error instanceof Error?error.message:String(error));}
    })();
    return()=>{cancelled=true;engine?.dispose();if(renderer.current===engine){renderer.current=null;engineSource.current=null;}shape.current=null;};
  },[host,config.sourceId]);
  useEffect(()=>{
    renderer.current?.configure(config);
    const objects=ready?renderer.current?.objectVisibilityState()??[]:[],key=JSON.stringify(objects);if(key!==reportedObjects.current){reportedObjects.current=key;setObjects(objects);}
  },[config,ready]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){if(document.getElementById('paint-tool-description'))return;event.preventDefault();event.stopPropagation();if(!busy){if(objectMenu){setObjectMenu(null);}else if(picking){setPicking(false);setFocusHint('');}else onCancel();}}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[busy,picking,objectMenu,onCancel]);
  const change=(patch:Partial<BackgroundCapture>)=>{
    setObjectMenu(null);setPreferenceStatus({});
    if(patch.sourceId&&patch.sourceId!==current.current.sourceId){setReady(false);setPicking(false);setFocusHint('');patch={...patch,objectVisibility:undefined,focusMesh:undefined,focusPoint:undefined,light:{...current.current.light,windowMesh:undefined}};engineSource.current=null;}
    current.current={...current.current,...patch};setConfig(current.current);
  };
  function saveDefaults(group:Background3dDefaultGroup){
    try{setDefaults(saveBackground3dDefaultGroup(window.localStorage,current.current,group,paint.dpi));setPreferenceStatus(value=>({...value,[group]:'この項目のデフォルトを保存しました。'}));}
    catch{setPreferenceStatus(value=>({...value,[group]:'デフォルトを保存できませんでした。ブラウザーの保存設定を確認してください。'}));}
  }
  function restoreDefaults(group:Background3dDefaultGroup){
    setPicking(false);setFocusHint('');change(applyBackground3dDefaults(current.current,defaults,paint.dpi,group));setPreferenceStatus({[group]:'この項目をデフォルトに戻しました。'});
  }
  function focusAt(mesh:number|null){
    const target=renderer.current?.focusTarget(mesh??undefined);
    if(!target){setFocusHint('3Dの物がある場所をクリックしてください。');return;}
    setPicking(false);setFocusHint('');
    change({focusMesh:target.mesh,focusPoint:undefined,camera:focusBackgroundCamera(current.current.camera,target.bounds,current.current.frame.w/current.current.frame.h)});
  }
  function dolly(factor:number){const controls=renderer.current?.controls;if(controls)change({camera:dollyBackgroundCamera(current.current.camera,factor,controls.minDistance,controls.maxDistance,current.current.focusPoint)});}
  const focus=renderer.current?.focusTarget(config.focusMesh);
  function setVisibility(mesh:number,mode:'auto'|'show'|'hide'){
    if(busy||!ready)return;
    const target=renderer.current?.focusTarget(mesh);if(!target)return;
    const rules=(current.current.objectVisibility??[]).filter(rule=>!target.indices.includes(rule.mesh));
    if(mode!=='auto')rules.push({mesh:target.mesh,mode});
    setPicking(false);
    change({objectVisibility:rules.length?rules:undefined,...(mode==='hide'&&focus?.mesh===target.mesh?{focusMesh:undefined,focusPoint:undefined}:{})});
  }
  const menuTarget=objectMenu&&renderer.current?.focusTarget(objectMenu.mesh);
  const visibilityMenu=objectMenu&&menuTarget&&createPortal(<><button class="canvas-generation-menu-dismiss" aria-label="3Dの物のメニューを閉じる" onClick={()=>setObjectMenu(null)}/><div class="canvas-generation-menu" role="menu" aria-label="3Dの物の操作" style={{left:Math.max(8,Math.min(objectMenu.x,window.innerWidth-280)),top:Math.max(8,Math.min(objectMenu.y,window.innerHeight-200))}}>
    <strong>{menuTarget.name}</strong>
    <button autoFocus role="menuitem" disabled={busy} onClick={()=>setVisibility(menuTarget.mesh,'hide')}>隠す</button>
    <button role="menuitem" disabled={busy} onClick={()=>setVisibility(menuTarget.mesh,'show')}>常に表示</button>
    {config.objectVisibility?.some(rule=>menuTarget.indices.includes(rule.mesh))&&<button role="menuitem" disabled={busy} onClick={()=>setVisibility(menuTarget.mesh,'auto')}>自動表示に戻す</button>}
  </div></>,document.body);
  const light=backgroundLightSettings(config.light),lightWindow=shape.current&&backgroundLightWindow(shape.current,config.light);
  const sunlight=light.preset!=='indoor';
  const chooseFocus=()=>{pickingMode.current='object';setPicking(value=>!value);setFocusHint('');};
  const choosePoint=()=>{pickingMode.current='point';setPicking(true);setFocusHint('緑の輪郭の内側をクリックするか、緑のスコープをドラッグして回転の中心を選んでください。');};
  const range=(label:string,key:'outlineWidth'|'detailWidth'|'creaseAngle'|'detail'|'lineGap'|'blackAmount'|'toneThreshold',min:number,max:number,step:number,suffix='')=><label>{caption(label)}<span><input aria-label={label} type="range" min={min} max={max} step={step} value={config[key]??45} disabled={busy} onInput={e=>change({[key]:Number(e.currentTarget.value)})}/><output>{Math.round((config[key]??45)*100)/100}{suffix}</output></span></label>;
  const lightRange=(label:string,key:'intensity'|'bounce',min:number,max:number,ariaLabel=label)=><label>{caption(label)}<span>
    <input aria-label={ariaLabel} type="range" min={min/100} max={max/100} step=".01" value={light[key]} onInput={e=>change({light:{...config.light,[key]:Number(e.currentTarget.value)}})}/>
    <span class="background3d-percent"><input aria-label={`${ariaLabel}（%）`} type="number" min={min} max={max} step="1" value={Math.round(light[key]*100)}
      onInput={e=>{if(e.currentTarget.value!==''&&e.currentTarget.validity.valid)change({light:{...config.light,[key]:e.currentTarget.valueAsNumber/100}});}}
      onBlur={e=>{const value=e.currentTarget.valueAsNumber,percent=Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):Math.round(light[key]*100);e.currentTarget.value=String(percent);change({light:{...config.light,[key]:percent/100}});}}/>%</span>
  </span></label>;
  async function capture(){
    if(!canCapture||!renderer.current||engineSource.current!==current.current.sourceId)return;setPicking(false);setBusy(true);setError('');
    try{renderer.current.configure(current.current);const result=await renderer.current.capture();await onCapture({...result,stageImports});}
    catch(error){setError(error instanceof Error?error.message:String(error));setBusy(false);}
  }

  const caption=(label:string)=><span data-tool-label={label}>{label}</span>;
  const standard=background3dDefaults(applyBackground3dDefaults(defaultBackgroundCapture(config.frame,paint.dpi),defaults,paint.dpi));
  const onOff=(value:boolean)=>value?'オン':'オフ',number=(value:number)=>Math.round(value*100)/100;
  const savedValues=[
    ['outlineWidth','輪郭の太さ',`${number(standard.outlineWidth)}px`],['detailWidth','細部の太さ',`${number(standard.detailWidth)}px`],
    ['creaseAngle','角の抽出',`${standard.creaseAngle}°`],['detail','細部の省略',`${Math.round((1-standard.detail)*100)}%`],['lineGap','線の抜き',String(standard.lineGap)],
    ['preset','光の雰囲気',backgroundLightPresets.find(item=>item.value===standard.light.preset)!.label],
    ['azimuth','日差しの方角',`${standard.light.azimuth}°`],['elevation','日差しの高さ',`${standard.light.elevation}°`],
    ['ceiling','天井からの外光を遮る',onOff(standard.light.ceiling)],['intensity','明るさ',`${Math.round(standard.light.intensity*100)}%`],['bounce','反射光',`${Math.round(standard.light.bounce*100)}%`],
    ['blackAmount','ベタの量',`${standard.blackAmount}%`],['toneEnabled','スクリーントーン',onOff(standard.toneEnabled)],['toneThreshold','トーンの境界',String(standard.toneThreshold)],['cutawayEnabled','大型オブジェクトの自動非表示',onOff(standard.cutawayEnabled)],
  ];
  const preferences=(group:Background3dDefaultGroup,label:string)=>{
    const open=!!preferencesOpen[group],id=`${preferencesId}-${group}`,keys:readonly string[]=background3dDefaultGroups[group];
    return <>
      <div class="background3d-default-trigger"><button type="button" disabled={busy} aria-label={`${label}の環境設定`} aria-expanded={open} aria-controls={id} data-tool-label={`${label}の環境設定`} onClick={()=>setPreferencesOpen(value=>({...value,[group]:!value[group]}))}><Settings size={16} aria-hidden="true"/>環境設定</button></div>
      {open&&<fieldset id={id} disabled={busy} class="background3d-preferences" data-default-group={group}><legend>{label}の環境設定</legend>
        {group==='stage'&&<label class="background3d-check"><input type="checkbox" aria-label="大型オブジェクトを自動で隠す" checked={config.cutaway?.enabled??false} onChange={e=>change({cutaway:{enabled:e.currentTarget.checked,depth:config.cutaway?.depth??.25}})}/>{caption('大型オブジェクトを自動で隠す')}</label>}
        <strong>{hasSavedBackground3dDefault(defaults,group)?'保存済みのデフォルト':'デフォルト（未保存・初期値）'}</strong>
        <dl class="background3d-saved-defaults">{savedValues.filter(([key])=>keys.includes(key)).map(([key,label,value])=><div key={key}><dt>{label}</dt><dd data-default-key={key}>{value}</dd></div>)}</dl>
        <button type="button" aria-label={`${label}のデフォルトを保存`} onClick={()=>saveDefaults(group)}>表示中の値をデフォルトとして保存</button>
        <button type="button" class="background3d-restore" aria-label={`${label}をデフォルトに戻す`} onClick={()=>restoreDefaults(group)}><RotateCcw size={16} aria-hidden="true"/>デフォルトに戻す</button>
        {preferenceStatus[group]&&<small role="status">{preferenceStatus[group]}</small>}
      </fieldset>}
    </>;
  };

  return <>{visibilityMenu}<Background3dFocus host={host}>
    <BackgroundCameraGizmo camera={config.camera} pivot={config.focusPoint} disabled={!ready||busy||picking} onChange={camera=>change({camera})}/>
    <button type="button" class="background3d-focus-pick" disabled={!ready||busy} aria-pressed={picking} data-tool-label={'注目する物を選ぶ'} onClick={chooseFocus}>{picking?'選択をやめる':'注目する物を選ぶ'}</button>
    {focus&&<small class="background3d-selected-name" tabIndex={0} data-tool-label={'選択中の物'}>選択中：{focus.name}</small>}
    <div class="background3d-viewport-actions">
      {focus&&<><button disabled={!ready||busy} onClick={()=>focusAt(focus.mesh)}>物全体へ寄る</button><button disabled={!ready||busy} data-tool-label={'部分に注目'} onClick={choosePoint}>部分に注目</button><button disabled={busy} onClick={()=>change({focusMesh:undefined,focusPoint:undefined})}>注目を解除</button></>}
      <button disabled={!ready||busy} onClick={()=>{if(shape.current){setPicking(false);change({focusMesh:undefined,focusPoint:undefined,camera:fitStageCamera(shape.current)});}}}>全体を収める</button>
      <div class="background3d-actions" role="group" aria-label="カメラの距離"><button disabled={!ready||busy||picking} onClick={()=>dolly(.8)}>近づく</button><button disabled={!ready||busy||picking} onClick={()=>dolly(1.25)}>離れる</button></div>
    </div>
    {picking&&<small role="status">{focusHint||'原稿内の物をクリックして選んでください。'}</small>}
  </Background3dFocus><section class="background3d-controls" role="dialog" aria-label="3D背景の調整" onPointerDown={e=>e.stopPropagation()}>
    <header><strong tabIndex={0} data-tool-label={'3D背景編集モード'}>3D背景編集モード</strong><button type="button" disabled={busy} aria-label="3D背景を閉じる" onClick={onCancel}>保存せずに閉じる</button></header>
    <fieldset disabled={busy}><legend>{caption('舞台')}</legend><select aria-label="3Dの舞台" disabled={busy} value={config.sourceId} onChange={e=>{fitNext.current=true;change({sourceId:e.currentTarget.value});}}><option value={CUBE_STAGE_ID}>テスト用の立方体</option>{allStages.map(stage=><option key={stage.id} value={stage.id}>{stage.name}</option>)}</select>{preferences('stage','舞台')}</fieldset>
    {objects.some(object=>!object.visible&&object.mode==='hide')&&<fieldset disabled={!ready||busy}><legend>非表示の3Dオブジェクト</legend>
      {objects.filter(object=>!object.visible&&object.mode==='hide').map(object=><div class="background3d-actions" key={object.mesh} data-background-object={object.mesh}><span>{object.name}</span><button type="button" aria-label={`${object.name}を再表示`} onClick={()=>setVisibility(object.mesh,'show')}>再表示</button></div>)}
    </fieldset>}
    <fieldset disabled={busy}><legend>線</legend>{range('輪郭の太さ','outlineWidth',1,20,.1,'px')}{range('細部の太さ','detailWidth',1,20,.1,'px')}{range('角の抽出','creaseAngle',0,180,1,'°')}
      <label>{caption('細部の省略')}<span><input aria-label="細部の省略" type="range" min="0" max="100" step="5" value={Math.round((1-config.detail)*100)} onInput={e=>change({detail:1-Number(e.currentTarget.value)/100})}/><output>{Math.round((1-config.detail)*100)}%</output></span></label>
      {range('線の抜き','lineGap',0,.8,.05,'')}
      {preferences('line','線')}
    </fieldset>
    <fieldset disabled={busy}><legend>{caption('光源の設定')}</legend>
      <label>{caption('光の雰囲気')}<select aria-label="光の雰囲気" value={light.preset} onChange={e=>{setPicking(false);setFocusHint('');change({light:backgroundPresetLight(config.light,e.currentTarget.value as typeof light.preset,shape.current??undefined)});}}>{backgroundLightPresets.map(preset=><option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
      <fieldset class="background3d-daylight" aria-label="日差しと窓の光" disabled={busy||!sunlight} data-inactive={!sunlight||undefined}><legend>{caption('日差しと窓の光')}</legend>
      <small>{lightWindow?`窓の光：${config.light.windowMesh===undefined?'自動検出':'選択した面'}`:'窓の光：未検出'}</small>
      {lightWindow&&<label class="background3d-check"><input type="checkbox" checked={config.light.ceiling!==false} onChange={e=>change({light:{...config.light,ceiling:e.currentTarget.checked}})}/>天井からの外光を遮る</label>}
      <div class="background3d-actions"><button disabled={!ready||busy} data-tool-label={'窓の面を選ぶ'} onClick={()=>{pickingMode.current='window';setPicking(true);setFocusHint('窓ガラスの面をクリックしてください。');}}>窓の面を選ぶ</button>{config.light.windowMesh!==undefined&&<button onClick={()=>change({light:backgroundPresetLight({...config.light,windowMesh:undefined},light.preset,shape.current??undefined)})}>窓を自動検出</button>}</div>
      <label>{caption('日差しの方角')}<span><input aria-label="日差しの方角" type="range" min="-180" max="180" value={config.light.azimuth} onInput={e=>change({light:{...config.light,azimuth:Number(e.currentTarget.value)}})}/><output>{sunlight?`${config.light.azimuth}°`:''}</output></span></label>
      <label>{caption('日差しの高さ')}<span><input aria-label="日差しの高さ" type="range" min="-90" max="90" value={config.light.elevation} onInput={e=>change({light:{...config.light,elevation:Number(e.currentTarget.value)}})}/><output>{sunlight?`${config.light.elevation}°`:''}</output></span></label>
      {preferences('daylight','日差しと窓の光')}
      </fieldset>
      {lightRange('明るさ','intensity',10,200,'照明の明るさ')}
      {lightRange('反射光','bounce',0,100,'反射光')}
      {preferences('light','光源')}
    </fieldset>
    <fieldset disabled={busy} class="background3d-tone"><legend>ベタとスクリーントーン</legend>
      {range('ベタの量','blackAmount',0,100,1,'%')}
      <label class="background3d-check"><input type="checkbox" checked={config.toneEnabled} onChange={e=>change({toneEnabled:e.currentTarget.checked})}/>{caption('スクリーントーン')}</label>
      {range('トーンの境界','toneThreshold',0,100,1,'')}
      {preferences('tone','ベタとスクリーントーン')}
    </fieldset>
    <output aria-label="3D背景の状態">{status}</output>{error&&<p role="alert" class="paint-error">{error}</p>}
    <button class="background3d-capture" disabled={!canCapture} data-tool-label={'撮影して線画にする'} onClick={()=>void capture()}><Camera size={18} aria-hidden="true"/>{busy?'撮影中…':'撮影して線画にする'}</button>
    {availableLayers>61&&<p>撮影には空きレイヤーが3枚必要です。</p>}
  </section></>;
}
