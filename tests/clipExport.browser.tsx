// 見込み: 実Appから作品を変えずにCLIP+元データを保存できる。
// 範囲: 合成原稿/実OPFS/実encoder。pickerとservice起動管理は模擬。CSP表示は別確認。
import { render } from 'preact';
import App from '../src/components/App';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { createPortableProject } from '../src/lib/portableProject';
import '../src/styles/global.css';

declare global {interface Window {
  clipTestEncode:(page:unknown)=>Promise<Record<string,unknown>>;
  clipTestSave:(name:string,bytes:number[])=>Promise<void>;
}}
const report=document.querySelector<HTMLOutputElement>('#report')!,host=document.querySelector<HTMLElement>('#app')!;
const sleep=()=>new Promise(resolve=>setTimeout(resolve,25));
let count=0;
function check(ok:unknown,message:string){if(!ok)throw Error(message);count++;}
async function wait<T>(probe:()=>T|false|undefined|null,label:string):Promise<T>{for(let i=0;i<800;i++){const value=probe();if(value)return value;await sleep();}throw Error(`待機: ${label} ${host.querySelector('[role="alert"]')?.textContent??''}`);}
const button=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>!b.disabled&&(b.getAttribute('aria-label')===name||b.textContent?.trim()===name));
const click=async(name:string)=>{(await wait(()=>button(name),name)).click();await sleep();};
const dialog=()=>host.querySelector('.image-export-dialog');
const format=()=>host.querySelector<HTMLSelectElement>('[aria-label="書き出し形式"]')!;
async function chooseClip(){format().value='clip';format().dispatchEvent(new Event('change',{bubbles:true}));await sleep();}
async function list(folder:FileSystemDirectoryHandle){const names:string[]=[];for await(const name of folder.keys())names.push(name);return names.sort();}
function unzip(bytes:Uint8Array){const result=new Map<string,Uint8Array>(),view=new DataView(bytes.buffer);let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){const length=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),size=view.getUint32(offset+18,true),start=offset+30+length+extra;
    result.set(new TextDecoder().decode(bytes.slice(offset+30,offset+30+length)),bytes.slice(start,start+size));offset=start+size;}return result;}

async function run(){
  if(location.hostname!=='127.0.0.1'||location.port!=='4341')throw Error('専用port 4341で実行してください');
  if(!window.clipTestEncode)throw Error('実encoderを接続した検証runnerが必要です');
  let failed=true,starts=0,stops=0,encodes=0;
  const nativeFetch=window.fetch;
  window.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href),path=url.pathname;
    if(path.startsWith('/__nyamuru/supervisor/')){
      if(path.endsWith('/start'))starts++;else if(path.endsWith('/stop'))stops++;
      return Response.json({service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1,lease_token:`clip-test-${starts}`,released:true,llm_released:true});
    }
    const identity={service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3};
    if(path==='/__nyamuru/bridge/api/health')return Response.json({...identity,ok:true});
    if(path==='/__nyamuru/bridge/api/export/clip'){
      if(failed)return Response.json({...identity,error:'CLIP変換失敗（試験）'},{status:400});
      encodes++;const body=JSON.parse(String(init?.body));
      check(!JSON.stringify(body).includes('"sources":'),'元データを変換processへ重複送信しない');
      return Response.json({...identity,...await window.clipTestEncode(body)});
    }
    if(path.startsWith('/__nyamuru/'))return Response.json({...identity,error:'未定義の試験経路'},{status:404});
    return nativeFetch(input,init);
  };
  const root=await navigator.storage.getDirectory(),name=`clip-app-${Date.now()}`,space=await root.getDirectoryHandle(name,{create:true});
  const project=await space.getDirectoryHandle('作品',{create:true}),output=await space.getDirectoryHandle('書出先',{create:true});
  const source=createEmptyWorkspaceDocument();source.manga.meta.title='CLIP書出確認'.repeat(20);source.manga.meta.page_count=2;source.manga.meta.episode_id='clip-export-qa';
  source.manga.finish_settings={width_mm:101.6,height_mm:76.2,dpi:150,bleed_mm:0};
  source.manga.pages=[1,2].map(page=>({page,canvas:{w:101.6,h:76.2,unit:'mm'},panels:[{id:1,shape:{type:'rect',x:5,y:5,w:91.6,h:66.2},bg:0,action:null,bubbles:[{text:`編集できる文字 ${page}\nフォント確認`,shape:'typeset',bbox:{x:20,y:20,w:60,h:30},text_style:{font:'Hiragino Sans',fontSize:18,fontWeight:400,orientation:'horizontal'}}]}]}));
  const original=JSON.stringify(await createPortableProject(source)),handle=await project.getFileHandle('project.json',{create:true}),stream=await handle.createWritable();await stream.write(original);await stream.close();
  let opening=true;Object.assign(window,{showDirectoryPicker:async()=>{if(opening){opening=false;return project;}return output;}});
  try{
    render(<App/>,host);await click('作品フォルダを開く');await wait(()=>host.querySelector('.toast')?.textContent?.includes('読み込みました'),'原稿');
    const undo=()=>host.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')!.disabled,initialUndo=undo();
    await click('画像書出');await chooseClip();await click('保存先を選択');
    // 見込み: 失敗時に作品保存せず選択を保持する。合格: エラー表示/空出力/再試行可能。
    await click('書き出す');await wait(()=>host.querySelector('[role="alert"]')?.textContent?.includes('CLIP変換失敗'),'変換失敗');
    check(format().value==='clip'&&!format().disabled,'失敗後に形式を保持して操作を戻す');check((await list(output)).length===0,'失敗ファイルを残さない');check(starts===stops,'失敗時に利用sessionを終了する');
    failed=false;await click('書き出す');await wait(()=>!dialog(),'CLIP保存');
    const first=(await list(output))[0],zip=unzip(new Uint8Array(await (await (await output.getFileHandle(first)).getFile()).arrayBuffer()));
    check(first.endsWith('-clip.zip'),'CLIPと元データを同じZIPにまとめる');
    const clip=[...zip].find(([name])=>name.endsWith('.clip'))!;check(new TextDecoder().decode(clip[1].slice(0,8))==='CSFCHUNK','実CLIPを保存する');
    check([...zip.keys()].some(name=>name.endsWith('/layers.json')),'レイヤーと元データの対応を同梱');
    check([...zip.values()].some(bytes=>new TextDecoder().decode(bytes).includes('編集できる文字')),'文字本文と書式の元データを同梱');
    await window.clipTestSave(clip[0],[...clip[1]]);
    // 見込み: 全ページ指定でも各ページが独立したCLIPになる。合格: CLIP2件、作品/Undo不変。
    await click('画像書出');await chooseClip();host.querySelectorAll<HTMLInputElement>('[name="image-export-range"]')[2].click();await sleep();await click('書き出す');await wait(()=>!dialog(),'全ページ保存');
    const all=(await list(output)).find(name=>name.includes('001-002'))!,both=unzip(new Uint8Array(await (await (await output.getFileHandle(all)).getFile()).arrayBuffer()));
    check([...both.keys()].filter(name=>name.endsWith('.clip')).length===2,'全ページに独立CLIPを保存');
    check(await (await handle.getFile()).text()===original,'元作品を変更しない');check(undo()===initialUndo,'Undoを追加しない');check(encodes===3&&starts===stops,'成功後もsessionを残さない');
    await click('画像書出');await chooseClip();report.textContent=`PASS ${count}項目`;report.dataset.stage='done';
  }finally{window.fetch=nativeFetch;}
}
document.querySelector<HTMLButtonElement>('#run')!.onclick=()=>{report.textContent='実行中';void run().catch(error=>{report.textContent=`FAIL ${String(error)}`;report.dataset.stage='done';console.error(error);});};
