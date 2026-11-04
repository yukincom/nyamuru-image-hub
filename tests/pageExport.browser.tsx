// 見込み: 保存先/形式/範囲の変更は作品に触れず、実処理と保存完了に合わせて進捗を表示する。
// 範囲: 合成3ページを実Appで描画しOPFSへ保存。pickerと書込失敗のみ模擬。OSのフォルダー選択は別確認。
import { render } from 'preact';
import App from '../src/components/App';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { createPortableProject } from '../src/lib/portableProject';
import { saveImageExport } from '../src/lib/pageExport';
import type { BrowserDirectoryHandle } from '../src/lib/browserWorkspace';
import '../src/styles/global.css';

const report=document.querySelector<HTMLOutputElement>('#report')!;
const host=document.querySelector<HTMLElement>('#app')!;
const sleep=(ms=25)=>new Promise(resolve=>setTimeout(resolve,ms));
let count=0;
function check(condition:unknown,message:string){if(!condition)throw Error(message);count++;}
async function wait<T>(probe:()=>T|undefined|null|false,label:string):Promise<T>{
  for(let i=0;i<400;i++){const value=probe();if(value)return value;await sleep();}
  throw Error(`待機: ${label} / ${host.querySelector('[role="alert"]')?.textContent??''}`);
}
const dialog=()=>host.querySelector<HTMLElement>('.image-export-dialog');
const button=(name:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>!b.disabled&&(b.getAttribute('aria-label')===name||b.textContent?.trim()===name));
const click=async(name:string)=>{(await wait(()=>button(name),name)).click();await sleep();};
const field=(label:string)=>host.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`)!;
async function change(label:string,value:string){const input=field(label);input.value=value;input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await sleep();}
async function mode(index:number){host.querySelectorAll<HTMLInputElement>('[name="image-export-range"]')[index].click();await sleep();}
async function names(folder:FileSystemDirectoryHandle){const result:string[]=[];for await(const name of folder.keys())result.push(name);return result.sort();}

async function run(){
  if(location.hostname!=='127.0.0.1'||location.port!=='4337')throw Error('専用port 4337でbrowserWorkspace.vite.mjsを使ってください');
  const root=await navigator.storage.getDirectory();
  const space=await root.getDirectoryHandle(`export-qa-${Date.now()}`,{create:true});
  const project=await space.getDirectoryHandle('作品',{create:true});
  const output=await space.getDirectoryHandle('画像の保存先',{create:true});
  const source=createEmptyWorkspaceDocument();source.manga.meta.title='書き出し確認';source.manga.meta.episode_id='export-qa';
  source.manga.finish_settings={width_mm:50,height_mm:60,dpi:72,bleed_mm:0};
  source.manga.pages=Array.from({length:3},(_,i)=>({page:i+1,canvas:{w:50,h:60,unit:'mm' as const},panels:[{id:1,shape:{type:'rect' as const,x:5,y:5,w:40,h:50},action:null,bg:0,bubbles:[]}]}));
  source.manga.meta.page_count=3;
  const projectFile=await project.getFileHandle('project.json',{create:true});
  const original=JSON.stringify(await createPortableProject(source));
  const writer=await projectFile.createWritable();await writer.write(original);await writer.close();
  let picker:'project'|'cancel'|'output'|'failure'='project',pauseSave=true;
  const pick=async()=>{
    if(picker==='cancel')throw new DOMException('cancelled','AbortError');
    if(picker==='project')return project;
    const fail=picker==='failure';
    return {name:fail?'保存失敗の確認':output.name,async getFileHandle(name:string,options?:{create?:boolean}){
      const handle=await output.getFileHandle(name,options);
      if(!options?.create)return handle;
      return {async createWritable(){
        const stream=await handle.createWritable();
        return {async write(blob:Blob){if(fail)throw Error('保存できません（試験）');await stream.write(blob);},async close(){
          if(pauseSave){
            pauseSave=false;
            const bar=host.querySelector<HTMLProgressElement>('progress')!;
            check(bar.value>0&&bar.value<bar.max,'保存完了前に100%へ到達しない');
            check(dialog()?.textContent?.includes('保存しています'),'保存中の工程を表示');
            check([...dialog()!.querySelectorAll('input,select,button')].every(el=>el.matches(':disabled')),'処理中に選択を変更できない');
            dialog()!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep();
            check(dialog(),'保存途中にEscapeで閉じない');
            report.dataset.stage='saving';
            await new Promise<void>(resolve=>{
              const timer=setTimeout(resolve,8000);
              Object.assign(window,{continueExportTest:()=>{clearTimeout(timer);resolve();}});
            });
          }
          await stream.close();
        },async abort(){await stream.abort();}};
      }};
    }};
  };
  Object.assign(window,{showDirectoryPicker:pick});
  render(<App/>,host);await click('作品フォルダを開く');await wait(()=>host.querySelector('.toast')?.textContent?.includes('読み込みました'),'原稿を開く');
  await click('画像書出');await wait(dialog,'書出画面');

  // 見込み: 小型UIの配置と設定変更は原稿から独立。合格: ラジオ幅/高さ、select、Undo不変、選択取消しで保存なし。
  const undo=()=>host.querySelector<HTMLButtonElement>('.app-header [aria-label^="元に戻す"]')!.disabled;
  const initialUndo=undo();
  check(field('書き出し形式') instanceof HTMLSelectElement,'形式はプルダウン');
  check(dialog()!.getBoundingClientRect().height<420,'画面の縦幅を詰める');
  check([...dialog()!.querySelectorAll('input[type=radio]')].every(el=>el.getBoundingClientRect().width<=18),'ラジオが全幅に伸びない');
  picker='cancel';await click('保存先を選択');check(dialog()!.textContent?.includes('未選択'),'選択取消しで未選択を保持');
  await click('書き出す');check(dialog()&&!host.querySelector('progress')&&!host.querySelector('[role="alert"]'),'書出前の保存先選択取消しは静かに戻る');
  check((await names(output)).length===0,'取消しで出力しない');
  picker='output';await click('保存先を選択');check(dialog()!.textContent?.includes(output.name),'選択フォルダー名を表示');
  picker='cancel';await click('保存先を選択');check(dialog()!.textContent?.includes(output.name),'再選択取消しで前回フォルダーを保持');
  await mode(1);await change('開始ページ','3');await change('終了ページ','2');await change('書き出し形式','psd');
  await click('書き出す');check(host.querySelector('[role="alert"]')?.textContent?.includes('ページ範囲'),'範囲エラーを画面内に表示');
  check((await names(output)).length===0,'範囲エラーで出力しない');
  await change('開始ページ','2');await change('終了ページ','3');check(undo()===initialUndo,'設定変更でUndoを増やさない');

  // 見込み: 2〜3ページのPSDはその2件のみのZIPになる。合格: 実保存byteのページ名・PSD signature・進捗の単調増加。
  const values:number[]=[];
  const observer=new MutationObserver(()=>{const p=host.querySelector<HTMLProgressElement>('progress');if(p)values.push(p.value);});
  observer.observe(host,{childList:true,subtree:true,attributes:true,characterData:true});
  await click('書き出す');await wait(()=>!dialog(),'ZIP保存');observer.disconnect();
  check(values.includes(0)&&values.some(n=>n>0)&&values.includes(4),'進捗は開始/途中/保存完了を表示: '+values.join(','));
  check(values.every((n,i)=>!i||n>=values[i-1]),'進捗が後戻りしない');
  const zipName=(await names(output))[0];check(zipName.endsWith('-pages-002-003-psd.zip'),'選択範囲と形式のZIP名');
  const zip=new Uint8Array(await (await (await output.getFileHandle(zipName)).getFile()).arrayBuffer());
  let offset=0;const archived:string[]=[];
  while(new DataView(zip.buffer).getUint32(offset,true)===0x04034b50){
    const view=new DataView(zip.buffer),size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),start=offset+30+length;
    archived.push(new TextDecoder().decode(zip.slice(offset+30,start)));
    check(new TextDecoder().decode(zip.slice(start,start+4))==='8BPS','ZIP内は実PSD');
    offset=start+size;
  }
  check(archived.length===2&&archived[0].includes('page-002')&&archived[1].includes('page-003'),'選択ページだけを収録');

  // 見込み: 単ページPNGの再出力で既存ファイルを残す。合格: 実PNG寸法と同名回避、作品ファイル/Undo不変。
  for(let i=0;i<2;i++){await click('画像書出');await click('書き出す');await wait(()=>!dialog(),'PNG保存');}
  const exported=await names(output),pngName=exported.find(n=>n.endsWith('dpi.png'))!;
  const png=await (await output.getFileHandle(pngName)).getFile();
  const bitmap=await createImageBitmap(png);check(bitmap.width===142&&bitmap.height===170,'PNGは作品の用紙サイズとdpi');bitmap.close();
  check(exported.some(n=>n.endsWith('dpi (1).png')),'同名出力を連番で保持');

  // 見込み: 同時に同名を書き出しても両方残る。合格: 実Web LocksとOPFSで2ファイルに各byteを保存。
  const concurrent=await Promise.all(['A','B'].map(text=>saveImageExport(new Blob([text]),'同時.png',output as unknown as BrowserDirectoryHandle)));
  check(new Set(concurrent).size===2,'同時出力の保存名が重複しない');
  check((await Promise.all(concurrent.map(async name=>(await (await output.getFileHandle(name)).getFile()).text()))).join('')==='AB','同時出力の内容を両方保持');

  // 見込み: 保存失敗ではdialogと選択が残り、再試行できる。合格: エラー表示・操作復帰・再選択後成功。
  await click('画像書出');picker='failure';await click('保存先を選択');await change('書き出し形式','psd');
  await click('書き出す');await wait(()=>host.querySelector('[role="alert"]')?.textContent?.includes('保存できません'),'保存失敗');
  check(dialog()&&field('書き出し形式').value==='psd'&&!field('書き出し形式').disabled,'失敗後も形式保持と操作復帰');
  picker='output';await click('保存先を選択');await click('書き出す');await wait(()=>!dialog(),'保存再試行');
  check(await (await projectFile.getFile()).text()===original,'書出で作品ファイルを書き換えない');
  check(undo()===initialUndo,'書出でUndoを増やさない');

  // 見込み: 非対応ブラウザーにも既存ダウンロードを残す。合格: 選択不可を明示し、有効なPNGを渡す。保存ダイアログは模擬。
  render(null,host);render(<App/>,host);picker='project';await click('作品フォルダを開く');await wait(()=>host.querySelector('.toast')?.textContent?.includes('読み込みました'),'原稿再読込');
  delete (window as Window&{showDirectoryPicker?:unknown}).showDirectoryPicker;
  await click('画像書出');check(dialog()!.textContent?.includes('ブラウザーの保存先')&&!button('保存先を選択'),'非対応時の保存先を明示');
  const nativeClick=HTMLAnchorElement.prototype.click;let downloaded:Blob|null=null;
  HTMLAnchorElement.prototype.click=function(){void fetch(this.href).then(r=>r.blob()).then(b=>{downloaded=b;});};
  try{await click('書き出す');await wait(()=>!dialog()&&downloaded,'ダウンロード');check((downloaded as Blob|null)?.type==='image/png','非対応時もPNGを渡す');}
  finally{HTMLAnchorElement.prototype.click=nativeClick;}
  Object.assign(window,{showDirectoryPicker:pick});picker='output';await click('画像書出');await mode(2);await change('書き出し形式','psd');await click('保存先を選択');
  report.textContent=`PASS ${count}項目`;report.dataset.stage='done';
}
document.querySelector<HTMLButtonElement>('#run')!.onclick=()=>{report.textContent='実行中';void run().catch(error=>{report.textContent=`FAIL ${String(error)}`;report.dataset.stage='done';console.error(error);});};
