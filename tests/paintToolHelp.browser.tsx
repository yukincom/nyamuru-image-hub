// 見込み: 既存ヘルプをキー専用に絞れば、道具のキー案内だけが出て他の操作は残る。
// 合格: hover/focusと設定切替の出し分け、メニューと分布ボタンの保持。範囲: 実App・合成文書・合成イベント、外部サービス/実作品は使わない。
import {render} from 'preact';
// @ts-expect-error QA Vite config exports the existing editor without changing its implementation.
import {EditorApp} from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml,parseMangaYaml} from '../src/lib/manga';
import {loadEditGuide,saveEditGuide} from '../src/lib/paintPreferences';
import '../src/styles/global.css';
if(location.hostname!=='127.0.0.1'||location.port!=='4341')throw Error('Dedicated popup QA origin required');
const previous=localStorage.getItem(STORAGE_KEY);
if(previous&&parseMangaYaml(previous).manga.meta.episode_id!=='popup-help-qa')throw Error('Do not replace another manuscript');
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);return url.origin!==location.origin&&/^https?:$/.test(url.protocol)||url.pathname.startsWith('/__nyamuru/')?Promise.resolve(Response.json({error:'Popup QA: services disabled'},{status:503})):originalFetch(input,init);};
const fixture=createEmptyWorkspaceDocument();fixture.manga.meta.title='キー案内の検証';fixture.manga.meta.episode_id='popup-help-qa';
fixture.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:30,w:170,h:220},bg:0,action:null,bubbles:[{text:'テスト',shape:'normal',bbox:{x:40,y:50,w:40,h:30}}]}];
localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(fixture));saveEditGuide(localStorage,true);
const mount=()=>render(<EditorApp startupWorkspace={{document:structuredClone(fixture),hasDocument:true}}/>,document.getElementById('app')!);
mount();
const tick=(ms=100)=>new Promise(resolve=>setTimeout(resolve,ms));
const button=(name:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(el=>(el.getAttribute('aria-label')===name||el.textContent?.trim()===name)&&el.getClientRects().length>0)!;
const wait=async(predicate:()=>boolean,label:string)=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error(`Timeout: ${label}`);};
const click=async(name:string)=>{const el=button(name);if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')throw Error(`Button unavailable: ${name}`);el.click();await tick();};
const tooltip=()=>document.querySelector('[role="tooltip"]');
const over=async(el:Element)=>{el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse',buttons:0}));await tick(1150);};
const dismiss=async()=>{document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await tick();};
const checks:string[]=[],check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
async function run(){
 if(button('ペンツールを開く'))await click('ペンツールを開く');
 await wait(()=>!!button('選択')&&!!button('ラスターレイヤー追加'),'editor ready');
 // 見込み: キーを持たないコントロールの説明経路は残らない。合格: title/help属性なし、キー属性は道具欄のみ。範囲: 初期画面の実DOM。
 check(!document.querySelector('body [title],body svg title,body [data-tool-help]'),'標準tooltipと長い説明の属性がない');
 check(Array.from(document.querySelectorAll('[data-tool-shortcut]')).every(el=>!!el.closest('.paint-tools-dock,.pen-family-menu')),'キー案内をツールボックスだけに限定');
 await tick(600);const before=localStorage.getItem(STORAGE_KEY);
 await over(button('選択'));check(tooltip()?.textContent==='選択V','選択のhoverは名前とVだけ');
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();check(!tooltip(),'Escapeでキー案内を閉じる');
 button('ダイレクト選択').focus();await tick(1150);check(tooltip()?.textContent==='ダイレクト選択A','キーボードfocusでも名前とAだけ');
 button('ダイレクト選択').blur();await tick();check(!tooltip(),'focusが外れると閉じる');
 await over(button('ラスターレイヤー追加'));check(!tooltip(),'レイヤー追加には説明が出ない');
 await over(button('保存'));check(!tooltip(),'ヘッダーには説明が出ない');
 check(button('元に戻す').disabled&&localStorage.getItem(STORAGE_KEY)===before,'案内のhoverとfocusでUndo履歴や保存データを増やさない');
 // 見込み: 削除対象は説明だけ。合格: 図形/文字のクリックメニューと分布8ボタンを保持。範囲: 実コンポーネントの合成クリック。
 await click('図形のツール一覧');check(!!document.querySelector('.pen-family-menu'),'図形メニューは開く');
 await over(button('楕円'));check(tooltip()?.textContent==='楕円LShift：正円','図形メニューも短いキー案内だけ');await dismiss();
 await click('写植文字');check(!!button('ふきだし'),'文字設定のタブは残る');
 await over(button('ふきだし'));check(!tooltip(),'文字設定タブには説明が出ない');
 await click('ベクターレイヤー追加');await wait(()=>!!button('分布'),'vector editor ready');
 await click('分布');
 for(const label of ['垂直方向・上端を分布','垂直方向・中心を分布','垂直方向・下端を分布','水平方向・左端を分布','水平方向・中心を分布','水平方向・右端を分布','垂直に等間隔','水平に等間隔'])check(!!button(label),`${label}の操作を保持`);
 await over(button('水平方向・右端を分布'));check(!tooltip(),'分布ボタンにも説明が出ない');
 // 見込み: 編集ガイドの既存設定はキー案内に引き続き適用される。合格: OFF/再読込で非表示、ONで再表示。範囲: 設定UIと同originのStorage。
 await click('コマ 01を選択');await tick(600);await click('環境設定');await click('表示');
 const setting=()=>document.querySelector<HTMLInputElement>('input[aria-label="編集ガイド"]')!;
 setting().click();await tick();check(!loadEditGuide(localStorage),'編集ガイドOFFを保存');
 await click('環境設定を閉じる');await over(button('選択'));check(!tooltip(),'OFFではキー案内も出ない');
 render(null,document.getElementById('app')!);mount();await tick();await click('ペンツールを開く');await wait(()=>!!button('選択'),'reload');
 await over(button('選択'));check(!tooltip(),'再読込後もOFFを保持');
 await click('環境設定');await click('表示');setting().click();await tick();check(loadEditGuide(localStorage),'編集ガイドONを保存');
 await click('環境設定を閉じる');await over(button('選択'));check(tooltip()?.textContent==='選択V','ONでキー案内を再表示');await dismiss();
 check(!document.querySelector('body [title],body svg title,body [data-tool-help]'),'設定とメニュー操作後も不要なtooltipがない');
 // 見込み: 遅延読込の3D設定にも説明は戻らない。合格: 開閉とトーン名を保持し、属性/hover tooltipなし。範囲: 組込立方体、撮影・ファイル保存なし。
 await click('背景あたりの3Dモデルを配置・調整');await wait(()=>!!button('3D背景を閉じる')&&!!document.querySelector('[data-tool-label="スクリーントーン"]'),'3D controls');
 check(!document.querySelector('body [title],body svg title,body [data-tool-help]'),'3D設定とスコープにも標準tooltipがない');
 const tone=document.querySelector('[data-tool-label="スクリーントーン"]')!;check(tone.textContent==='スクリーントーン','3Dトーンの項目名を保持');
 await over(tone);check(!tooltip(),'3D設定のhoverで説明が出ない');
 await click('3D背景を閉じる');check(!document.querySelector('.background3d-controls'),'3D設定を保存せず閉じる操作を保持');
}
const report=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');report.style.cssText='position:fixed;bottom:8px;left:170px;z-index:20000;background:white;color:black;max-height:60vh;overflow:auto;padding:8px;border:1px solid';summary.textContent='キー案内の検証中';report.append(summary,list);document.body.append(report);
void run().then(()=>{summary.textContent=`キー案内 PASS ${checks.length}`;}).catch(error=>{summary.textContent=`キー案内 FAIL: ${String(error)}`;report.open=true;}).finally(()=>{for(const text of checks){const li=document.createElement('li');li.textContent=text;list.append(li);}});
