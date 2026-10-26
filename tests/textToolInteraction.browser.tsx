// Dedicated, disposable UI artwork. Never reads or writes a user's manuscript.
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {STORAGE_KEY,toStoredMangaYaml} from '../src/lib/manga';
import '../src/styles/global.css';
if(location.hostname!=='127.0.0.1'||location.port!=='4325')throw new Error('Dedicated local test origin required.');
if(!new URLSearchParams(location.search).has('resume')){
  const doc=createEmptyWorkspaceDocument();
  doc.manga.meta.title='T単クリック・文字サイズ確認';
  doc.manga.meta.episode_id='text-tool-disposable';
  doc.manga.finish_settings={width_mm:182,height_mm:257,dpi:600,bleed_mm:0};
  doc.manga.pages=[{page:1,canvas:{w:182,h:257,unit:'mm'},panels:[
    {id:1,shape:{type:'rect',x:16,y:18.5,w:150,h:105},bg:0,action:null,
      figures:[{name:'あたり上のクリック',bbox:{x:25,y:75,w:35,h:35}}],
      bubbles:[{text:'吹き出し本文',shape:'square',tail:false,bbox:{x:100,y:30,w:50,h:45},text_style:{fontSize:15,orientation:'horizontal'}}],
      screen_text:[{text:'既存の文字',orientation:'horizontal',bbox:{x:25,y:35,w:55,h:12},text_style:{fontSize:18}}]},
    {id:2,shape:{type:'rect',x:16,y:128.5,w:150,h:110},bg:0,action:null,bubbles:[]},
  ],page_overlay:{frame:false,layer:'above_panel_frames',bubbles:[{text:'ページの文字',shape:'square',tail:false,bbox:{x:25,y:240,w:130,h:13},text_style:{fontSize:12,orientation:'horizontal'}}]}}];
  localStorage.setItem(STORAGE_KEY,toStoredMangaYaml(doc));
}
// Visible test-only counter: observe the real App autosave path on this isolated origin.
const saves=document.createElement('output');
saves.setAttribute('aria-label','検証用の本文保存回数');
saves.style.cssText='position:fixed;bottom:4px;left:4px;z-index:99999;background:white;color:black;font:12px monospace;pointer-events:none';
let saveCount=0;
const updateSaveCount=()=>{saves.textContent=`本文保存: ${saveCount}回`;};
const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){setItem.call(this,key,value);if(this===localStorage&&key===STORAGE_KEY){saveCount++;updateSaveCount();}};
updateSaveCount();document.body.append(saves);
render(<App/>,document.getElementById('app')!);
