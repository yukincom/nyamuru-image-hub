// 見込み: 実人物欄からの辞書操作を作品編集と分ければ、既存のアクションを保てる。
// 合格: 全86英語名と10見本、コピー位置/1.5秒、閉じ方、作品不変。実PanelInspectorと画像、clipboard応答だけ模擬。
import {render} from 'preact';
import PanelInspector from '../src/components/PanelInspector';
import expressions from '../scripts/expression_catalog.json';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import type {Panel} from '../src/types';
import '../src/styles/global.css';
if(location.origin!=='http://127.0.0.1:4326')throw Error('Dedicated dictionary test origin required');
const doc=createEmptyWorkspaceDocument(),manga=doc.manga;
manga.characters=[{localId:'person',name:'確認用人物',role:'確認用',scope:'episode'}];
const panel:Panel={id:1,shape:{type:'rect',x:0,y:0,w:50,h:50},bg:0,action:null,bubbles:[],figures:[{
  refId:'person',name:'確認用人物',action:'Half-lidded eyes and a straight closed mouth.',size:'face' as const,
}]};
manga.pages[0].panels=[panel];
let changes=0,selections=0;
const noop=()=>{};
render(<div style={{width:'360px',margin:'20px',background:'var(--surface)'}}><PanelInspector
  manga={manga} panel={panel} pageIndex={0} panelIndex={0} selectedElement={{type:'figure',index:0}}
  canvasSelectionScrollRequest={0} episodeWorkspaceToken="" episodeWorkspaceFolder="" seriesId="" episodeId=""
  getOmnySnapshot={()=>''} onChooseEpisodeWorkspace={async()=>{}} onSelectElement={()=>{selections++;}} onChange={()=>{changes++;}}
  onOpenBackgrounds={noop} onOpenProps={noop} onAdd={noop} onDelete={noop} onTextCategory={noop} onSelectedText={noop}
  onOpenBackground3d={noop} onHandwrittenHistoryBoundary={noop} onGenerateText={noop} imageImportBusy={false}
  guideVisible={()=>true} onToggleGuide={noop} panelDraftToolbarTarget={null} onScenarioChoice={noop}
/></div>,document.querySelector('#app')!);
const tick=()=>new Promise(resolve=>setTimeout(resolve,40));
const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<150;i++){if(test())return;await tick();}throw Error(label);};
const openDictionary=async()=>{document.querySelector<HTMLButtonElement>('.expression-dictionary-open')!.click();await wait(()=>!!document.querySelector('.expression-dictionary[open]'),'dictionary open');};
const report=document.querySelector<HTMLOutputElement>('#report')!,run=document.querySelector<HTMLButtonElement>('#run')!;
run.style.cssText='position:fixed;right:12px;top:12px;';report.style.cssText='display:block;white-space:pre-wrap;background:white;position:fixed;right:12px;bottom:12px;max-width:50vw;max-height:35vh;overflow:auto;';
run.onclick=()=>{run.disabled=true;const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
void(async()=>{
  const before=JSON.stringify(doc),copied:string[]=[];
  let rejectCopy=false;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{if(rejectCopy)throw Error('denied');copied.push(text);}}});
  await openDictionary();
  const cards=Array.from(document.querySelectorAll<HTMLButtonElement>('.expression-dictionary-card'));
  check(cards.length===86&&cards.every((card,i)=>card.querySelector('[lang=en]')?.textContent===expressions.entries[i].prompt),'読取辞書と同じ86項目の英文');
  const images=Array.from(new Set(cards.map(card=>card.querySelector('image')!.getAttribute('href')!)));
  await Promise.all(images.map(src=>new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve();image.onerror=reject;image.src=src;})));
  check(images.length===10&&!document.querySelector('.panel-figure-section .figure-human-pose-edit'),'10枚の実見本、人物欄の3D編集を置換');
  const cell=cards[1],box=cell.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;
  cell.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:x,clientY:y}));
  await wait(()=>!!document.querySelector('.expression-dictionary-copied'),'copy feedback');
  const feedback=document.querySelector<HTMLElement>('.expression-dictionary-copied')!;
  check(copied[0]==='soft smile'&&feedback.textContent==='コピー'&&Math.abs(parseFloat(getComputedStyle(feedback).left)-x)<1,'英語名をコピー、クリック位置から表示');
  await new Promise(resolve=>setTimeout(resolve,1650));
  check(!document.querySelector('.expression-dictionary-copied'),'約1.5秒でコピー表示を消去');
  rejectCopy=true;cards[0].click();await wait(()=>!!document.querySelector('.expression-dictionary [role=alert]'),'failed copy');
  check(document.querySelector('.expression-dictionary [role=alert]')!.textContent==='コピーできませんでした'&&copied.length===1,'コピー失敗を成功表示にしない');
  document.querySelector<HTMLButtonElement>('[aria-label="表情辞書を閉じる"]')!.click();await tick();
  check(!document.querySelector('.expression-dictionary')&&document.activeElement===document.querySelector('.expression-dictionary-open'),'右上の閉じるとフォーカス復帰');
  await openDictionary();
  document.querySelector('.expression-dictionary')!.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:1,clientY:1}));await tick();
  check(!document.querySelector('.expression-dictionary'),'範囲外クリックで閉じる');
  await openDictionary();
  document.querySelector('.expression-dictionary')!.dispatchEvent(new Event('cancel',{cancelable:true}));await tick();
  check(!document.querySelector('.expression-dictionary')&&JSON.stringify(doc)===before&&changes===0&&selections===0,'Escapeで閉じ、作品・履歴の更新なし');
  report.textContent=`PASS（${checks.length}項目）\n${checks.join('\n')}`;
})().catch(error=>{report.textContent=`FAIL: ${String(error)}\n${checks.join('\n')}`;}).finally(()=>{run.disabled=false;});};
