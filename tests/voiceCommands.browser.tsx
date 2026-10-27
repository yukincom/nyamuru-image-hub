/** Actual App + actual bridge/classifier, dedicated origin and synthetic manuscript. */
import {render} from 'preact';
import {useState,useRef} from 'preact/hooks';
import MangaCanvas from '../src/components/MangaCanvas';
import {BubblePathToolContext} from '../src/lib/paintWorkspace';
import App from '../src/components/App';
import VoiceCommands from '../src/components/VoiceCommands';
import AgentSettings from '../src/components/AgentSettings';
import {loadAgentPreferences,saveAgentPreferences,type AgentPreferences} from '../src/lib/agentPreferences';
import {newPage,STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {imageSha256} from '../src/lib/imagePlacement';
import {createBubbleBezier} from '../src/lib/bubbleBezier';
import '../src/styles/global.css';

const agentLockTest=new URLSearchParams(location.search).has('agent-lock');
if(location.origin!=='http://127.0.0.1:4338'&&!(agentLockTest&&location.origin==='http://127.0.0.1:4335'))throw Error('Dedicated test origin required');
const generationPipeline=new URLSearchParams(location.search).has('generation-pipeline');
const voiceStopTest=new URLSearchParams(location.search).has('voice-stop');
if(generationPipeline||new URLSearchParams(location.search).has('character-generation')&&!localStorage.getItem('nyamuru.character-generation-fixture.v1')){
  const previous=localStorage.getItem(STORAGE_KEY);if(previous)localStorage.setItem('nyamuru.character-generation.previous-document.v1',previous);
  const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='キャラクター生成の接続確認';fixture.manga.meta.episode_id='character-generation-fixture';
  fixture.manga.characters=[{localId:'koyuki-fixture',name:'小雪',role:'主人公',visual_prompt:'黒髪の女性',scope:'episode'}];
  fixture.manga.pages=[newPage(1)];fixture.manga.meta.page_count=1;
  fixture.manga.pages[0].panels=[1,2].map((id,index)=>({id,shape:{type:'rect' as const,x:20,y:25+index*125,w:170,h:110},bg:0,action:'',
    figures:[{name:'小雪',refId:'koyuki-fixture',bbox:{x:80,y:45+index*125,w:40,h:75}}],bubbles:[]}));
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));localStorage.setItem('nyamuru.character-generation-fixture.v1','created');
}
// Full editor integration with synthetic images and in-memory service responses only.
let generationPrepared:Record<string,any>|null=null,generationSubmissions=0,generationRestorations=0;
if(generationPipeline){
  const bridge={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
  const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,options)=>{
    const url=new URL(String(input),location.href),body=options?.body?JSON.parse(String(options.body)):{};
    if(!url.pathname.startsWith('/api/')){
      if(url.origin===location.origin)return originalFetch(input,options);
      throw Error('外部への接続は検証画面で停止しています');
    }
    if(url.pathname==='/api/health')return Response.json(bridge);
    if(url.pathname==='/api/new-creation/start')return Response.json({...supervisor,lease_token:'generation-fixture'});
    if(url.pathname==='/api/new-creation/stop'){generationRestorations++;return Response.json({...supervisor,released:true,llm_released:true});}
    if(url.pathname==='/api/panel-actions/prepare')return Response.json(supervisor);
    if(url.pathname==='/api/image-generation/prepare')return Response.json({...supervisor,llm_stopped:true});
    if(url.pathname==='/api/image-generation/connections')return Response.json({...bridge,
      qwen:{label:'Qwen-Image-2.1 Turbo',runtime:'ComfyUI Python',available:true,message:'模擬接続',steps:8,resolution:1024,entrypoint:'generate_selected',
        models:[{role:'generation',file:'turbo.safetensors'},{role:'text_encoder',file:'encoder.safetensors'},{role:'vae',file:'vae.safetensors'}]},
      comfyui:{endpoint:'http://127.0.0.1:8188',status:'unchecked',version:'',message:'未確認'}});
    // No registered images: the first generation request reports missing references.
    // Add the two reference roles and the draft instruction in the existing conversation to continue.
    if(url.pathname==='/api/agent/status')return Response.json({...bridge,connected:true,model:'生成連携の検証（応答は模擬）'});
    if(url.pathname==='/api/voice/classify')return Response.json({...bridge,text:body.text,label:'generate_request',confidence:1,model:'fixture',elapsed_ms:0});
    if(url.pathname==='/api/qwen-generation/prepare'){
      if(body.references?.length!==2||body.references[0].character_keys[0]!=='koyuki-fixture'||body.references[1].character_keys.length)throw Error('添付画像の用途が一致しません');
      if(!body.prompt.includes('背景は不要です'))throw Error('追加の描画指示が届いていません');
      generationPrepared={...body,request_sha256:'a'.repeat(64),status:'prepared',created_at:1};
      return Response.json({...bridge,...generationPrepared});
    }
    if(url.pathname==='/api/image-generation/submit'){
      if(!generationPrepared||body.payload.job_id!==generationPrepared.job_id)throw Error('準備したジョブが一致しません');
      generationSubmissions++;
      const canvas=document.createElement('canvas');canvas.width=generationPrepared.width;canvas.height=generationPrepared.height;
      const context=canvas.getContext('2d')!;context.fillStyle='#85b7db';context.fillRect(canvas.width*.12,canvas.height*.08,canvas.width*.76,canvas.height*.84);
      context.fillStyle='#fff';context.font=`bold ${Math.floor(canvas.width*.18)}px sans-serif`;context.fillText('QA',canvas.width*.28,canvas.height*.5);
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
      await new Promise(resolve=>setTimeout(resolve,1000));
      return Response.json({...supervisor,...generationPrepared,status:'succeeded',file_name:`qwen_${generationPrepared.job_id}.png`,image:canvas.toDataURL('image/png'),image_sha256:await imageSha256(blob)});
    }
    throw Error(`検証画面では使わないAPIです: ${url.pathname}`);
  };
}
let voiceTestSignal:{gain:GainNode}|undefined;
// Test-only microphone substitute. The signal goes to a MediaStream, never the speakers.
if(voiceStopTest)navigator.mediaDevices.getUserMedia=async()=>{
  const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
  gain.gain.value=0;oscillator.frequency.value=220;oscillator.connect(gain).connect(destination);oscillator.start();await context.resume();
  const signal={gain};voiceTestSignal=signal;
  for(const track of destination.stream.getTracks()){
    const stop=track.stop.bind(track);let stopped=false;
    track.stop=()=>{if(stopped)return;stopped=true;stop();oscillator.stop();void context.close();if(voiceTestSignal===signal)voiceTestSignal=undefined;};
  }
  return destination.stream;
};
// A fresh, isolated manuscript for actual seed43 save/page verification.
// Keep the previous dedicated-test-origin document recoverable.
if(new URLSearchParams(location.search).has('seed43')&&!localStorage.getItem('nyamuru.voice-seed43-fixture.v1')){
  const previous=localStorage.getItem(STORAGE_KEY);
  if(previous)localStorage.setItem('nyamuru.voice-seed43.previous-document.v1',previous);
  const fixture=createEmptyWorkspaceDocument();
  fixture.manga.meta.title='seed43 保存・ページ移動の検証';
  fixture.manga.meta.episode_id='voice-seed43-fixture-20261020';
  fixture.manga.pages=[newPage(1),newPage(2)];fixture.manga.meta.page_count=2;
  for(const page of fixture.manga.pages)page.panels[0].no_figures=true;
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));
  localStorage.setItem('nyamuru.voice-seed43-fixture.v1','created');
}
if(new URLSearchParams(location.search).has('bubble-material')&&!localStorage.getItem('nyamuru.bubble-material-fixture.v1')){
  const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='吹き出しの素材・文字編集テスト';fixture.manga.meta.episode_id='bubble-material-fixture';
  fixture.manga.pages=[newPage(1)];fixture.manga.meta.page_count=1;
  fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:25,w:170,h:240},bg:0,action:'朝の挨拶をする。',
    figures:[{name:'春',bbox:{x:80,y:120,w:40,h:80}}],bubbles:[
      {text:'おはよう。',speaker:'春',shape:'normal',bbox:{x:130,y:35,w:40,h:50},bezier:createBubbleBezier('ellipse'),tail:{x:.75,y:.05},text_style:{font:'游明朝',fontSize:12,fontWeight:400}},
      {text:'元気だよ。',shape:'normal',bbox:{x:60,y:75,w:45,h:50},bezier:createBubbleBezier('ellipse'),tail:false,text_style:{font:'游明朝',fontSize:12,fontWeight:400}}
    ]}];
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));localStorage.setItem('nyamuru.bubble-material-fixture.v1','created');
}
if(new URLSearchParams(location.search).has('agent-bubble')&&!localStorage.getItem('nyamuru.agent-bubble-fixture.v1')){
  const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='エージェントの形状調整テスト';fixture.manga.meta.episode_id='agent-bubble-fixture';
  fixture.manga.pages=[newPage(1)];fixture.manga.meta.page_count=1;
  fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:25,w:170,h:240},bg:0,action:'二人で朝の挨拶をする。',
    figures:[{name:'春',bbox:{x:80,y:120,w:40,h:80}}],bubbles:[{text:'おはよう。',speaker:'春',shape:'normal',bbox:{x:130,y:35,w:40,h:50},bezier:createBubbleBezier('ellipse'),tail:{x:.75,y:.05}}]}];
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));localStorage.setItem('nyamuru.agent-bubble-fixture.v1','created');
}
if(!localStorage.getItem(STORAGE_KEY)){
  const document=createEmptyWorkspaceDocument();
  document.manga.meta.title='音声操作の検証用原稿';
  document.manga.meta.episode_id='voice-pipeline-fixture';
  document.manga.pages=[newPage(1),newPage(2)];
  document.manga.meta.page_count=2;
  for(const page of document.manga.pages)page.panels[0].no_figures=true;
  document.manga.pages[0].panels[0].bubbles[0].bbox={x:145,y:25,w:35,h:30};
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(document));
}
function AgentUiFixture(){
  const storage=agentLockTest?{getItem:()=>null,setItem:()=>{}}:voiceStopTest?{getItem:()=>localStorage.getItem('nyamuru.voice-stop-test.profile.v1'),setItem:(_key:string,value:string)=>localStorage.setItem('nyamuru.voice-stop-test.profile.v1',value)}:localStorage;
  const [open,setOpen]=useState(false),[profile,setProfile]=useState(()=>loadAgentPreferences(storage));
  const [applied,setApplied]=useState(0),[delayed,setDelayed]=useState(false);
  const [agentWorking,setAgentWorking]=useState(false),pendingReply=useRef<(()=>void)|null>(null);
  const [previewPage]=useState(()=>{const page=newPage(1);page.canvas={w:100,h:100,unit:'mm'};page.panels=[{id:1,shape:{type:'rect',x:5,y:5,w:90,h:90},bg:0,action:null,bubbles:[{text:'作業対象',shape:'normal',tail:false,bbox:{x:20,y:20,w:40,h:50}}]}];return page;});
  const [signal,setSignal]=useState('無音'),[transcriptions,setTranscriptions]=useState(0);
  const change=(value:AgentPreferences)=>setProfile(saveAgentPreferences(storage,value));
  const setSignalLevel=(speaking:boolean)=>{if(!voiceTestSignal){setSignal('先に音声入力を開始してください');return;}voiceTestSignal.gain.gain.value=speaking?0.08:0;setSignal(speaking?'発話を模擬中':'無音');};
  return <main style="padding:24px;max-width:700px"><h1>エージェント表示の検証</h1>
    <p>{voiceStopTest?'録音は合成信号、文字起こし応答は検証用です。実マイク・スピーカー・モデルを使いません。':'応答・接続名は検証用です。LLMやマイクには接続しません。'}</p>
    {voiceStopTest&&<section aria-label="音声停止の検証"><button type="button" onClick={()=>setSignalLevel(true)}>合成音声を出す</button> <button type="button" onClick={()=>setSignalLevel(false)}>無音にする</button><p>入力信号: {signal} · 文字起こし回数: {transcriptions}</p></section>}
    <label><input type="checkbox" checked={delayed} onChange={e=>setDelayed(e.currentTarget.checked)}/>{voiceStopTest?'分類結果を10秒待つ':'分類結果を3秒待つ'}</label>
    {agentLockTest&&<><button disabled={!pendingReply.current} onClick={()=>{pendingReply.current?.();pendingReply.current=null;}}>検証応答を完了</button><p data-testid="agent-activity">{agentWorking?'作業中':'待機中'}</p>
      <div style="width:460px;height:420px"><BubblePathToolContext.Provider value="node"><MangaCanvas agentWorkTarget={agentWorking?{panelIndex:0,selection:{type:'bubble',index:0}}:undefined} page={previewPage} pageCount={1} title="作業表示検証" author="" activePanel={0} selectedPanels={[]} selectedElement={{type:'bubble',index:0}} zoomPercent={70} onZoomPercentChange={()=>{}} dpi={100} frameLineWidthMm={.3} bubbleLineWidthMm={.3} defaultBubbleFont="sans-serif" showGuides={false} innerFrameSnap={false} panelGutters={{rowGapMm:2,columnGapMm:2}} panelGapSnap={false} panelSync={false} guideVisible={()=>false} onToggleGuide={()=>{}} onGenerateArtwork={()=>{}} onSelectPanel={()=>{}} onSelectElement={()=>{}} onChangeElementBBox={()=>{}} onChangeBubbleTail={()=>{}} onMovePanel={()=>{}} onResizePanel={()=>{}} onMoveVertex={()=>{}} onMovePanelEdge={()=>{}}/></BubblePathToolContext.Provider></div></>}
    <p role="status">実行回数: {applied}</p><AgentSettings profile={profile} onChange={change}/>
    <VoiceCommands onActivity={setAgentWorking} profile={profile} onChangeProfile={change} open={open} onToggle={()=>setOpen(!open)} revision={()=>'fixture'}
      apply={()=>{setApplied(n=>n+1);return '保存しました（検証用）';}}
      connection={async()=>({connected:true,model:'gemma-4-26B-A4B-it-qat-UD-Q4_K_XL'})}
      request={async(action,body)=>{
        if(voiceStopTest&&action==='voice/transcribe'){
          if(!(body as {audio?:string}).audio)throw Error('録音データがありません');
          setTranscriptions(n=>n+1);await new Promise(resolve=>setTimeout(resolve,1800));return {text:'保存して'};
        }
        if(action!=='voice/classify')throw Error('この検証画面では録音しません');
        if(agentLockTest)await new Promise<void>(resolve=>{pendingReply.current=resolve;});
        if(delayed)await new Promise(resolve=>setTimeout(resolve,voiceStopTest?10000:3000));
        return {text:(body as {text:string}).text,label:'save',confidence:1,model:'fixture',elapsed_ms:0};
      }}/>
  </main>;
}
function BubbleQa(){
  const [data,setData]=useState('');
  return <><App/><details style="position:fixed;right:8px;bottom:8px;z-index:900;background:white;border:1px solid #ccc;padding:6px;max-width:360px;max-height:70vh;overflow:auto"><summary>検証値（テスト原稿）</summary><button onClick={()=>{const doc=parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);setData(JSON.stringify(doc.manga.pages[0].panels[0].bubbles,null,2));}}>保存中のOMNYを確認</button><pre data-testid="bubble-qa-state" style="font-size:10px;white-space:pre-wrap">{data}</pre></details></>;
}
function GenerationPipelineQa(){
  const [summary,setSummary]=useState('未確認');
  return <><App/><details style="position:fixed;right:8px;bottom:8px;z-index:900;background:white;color:#222;border:1px solid #aaa;padding:8px;max-width:420px"><summary>生成連携の検証値（合成画像）</summary>
    <button onClick={()=>{
      const current=parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
      const figures=current.manga.pages[0].panels.map(panel=>({panel:panel.id,figure:panel.figures?.[0]}));
      setSummary(JSON.stringify({submissions:generationSubmissions,restorations:generationRestorations,figures},null,2));
    }}>配置状態を確認</button><pre style="white-space:pre-wrap;font-size:10px;max-height:240px;overflow:auto">{summary}</pre>
  </details></>;
}
function Seed43Cleanup(){
  const [finished,setFinished]=useState(false);
  const restore=()=>{
    const key='nyamuru.project-folders.v1';
    const bindings=JSON.parse(localStorage.getItem(key)??'{}');
    delete bindings['voice-seed43-fixture-20261020'];
    localStorage.setItem(key,JSON.stringify(bindings));
    const current=localStorage.getItem(STORAGE_KEY);
    if(current&&parseMangaYaml(current).manga.meta.episode_id==='voice-seed43-fixture-20261020'){
      const previous=localStorage.getItem('nyamuru.voice-seed43.previous-document.v1');
      if(previous)localStorage.setItem(STORAGE_KEY,previous);
      else localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.removeItem('nyamuru.voice-seed43-fixture.v1');
    setFinished(true);
  };
  return <main style="padding:24px"><h1>seed43検証画面の後片付け</h1>
    <p>今回の検証原稿の保存先指定を解除し、以前の検証原稿を戻します。作品ファイルは変更しません。</p>
    <button disabled={finished} onClick={restore}>seed43の保存先を解除して前の検証原稿へ戻す</button>
    {finished&&<p role="status">保存先を解除し、以前の検証原稿を戻しました。</p>}
  </main>;
}
render(generationPipeline?<GenerationPipelineQa/>:new URLSearchParams(location.search).has('seed43-cleanup')?<Seed43Cleanup/>:agentLockTest||voiceStopTest||new URLSearchParams(location.search).has('agent-ui')?<AgentUiFixture/>:new URLSearchParams(location.search).has('bubble-material')?<BubbleQa/>:<App/>,document.getElementById('app')!);
