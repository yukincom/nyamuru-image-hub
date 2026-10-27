/** Real App/editor integration on an isolated origin, using only a disposable browser folder. */
import {render} from 'preact';
import App from '../src/components/App';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup';
import {createPortableProject} from '../src/lib/portableProject';
import {textStyleSegments} from '../src/lib/textStyle';
import {captureQwenCompositionCanvas} from '../src/lib/qwenComposition';
import {isLanClient} from '../src/lib/clientRuntime';
import type {MangaDocument} from '../src/types';
import '../src/styles/global.css';
if(location.origin!=='http://127.0.0.1:4339'||!isLanClient)throw Error('Dedicated LAN fixture at 127.0.0.1:4339 required');
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href);
  return url.origin!==location.origin||url.pathname.startsWith('/__nyamuru/')
    ?Promise.resolve(Response.json({error:'Test fixture: resident services are disabled'},{status:503})):originalFetch(input,init);
};
const source=createEmptyWorkspaceDocument();
source.manga.meta.title='文字スタイルの検証';source.manga.meta.episode_id='inline-styles-disposable';source.manga.meta.font='Hiragino Sans';
source.manga.finish_settings={width_mm:182,height_mm:257,dpi:100,bleed_mm:0};
source.manga.pages=[{page:1,canvas:{w:182,h:257,unit:'mm'},panels:[{id:1,shape:{type:'rect',x:15,y:15,w:150,h:200},bg:0,action:null,figures:[],
  bubbles:[{text:'ABCDEF',shape:'square',tail:false,bbox:{x:60,y:30,w:85,h:35},text_style:{font:'Hiragino Sans',fontSize:24,fontWeight:400,orientation:'horizontal'}}],
  screen_text:[{text:'あいうえお',orientation:'vertical',bbox:{x:25,y:90,w:20,h:70},text_style:{font:'Hiragino Sans',fontSize:24,fontWeight:400}}],
}],page_overlay:{frame:false,layer:'above_panel_frames',bubbles:[{text:'前景の文字',shape:'square',tail:false,bbox:{x:65,y:155,w:90,h:35},text_style:{fontSize:18,fontWeight:400,orientation:'horizontal'}}]}}];
const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle(`inline-styles-${Date.now()}`,{create:true});
const project=await folder.getFileHandle('project.json',{create:true});
const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(source)));await writer.close();
Object.assign(window,{showDirectoryPicker:async()=>folder});
const host=document.getElementById('app')!;
render(<App/>,host);
const controls=document.createElement('aside');controls.style.cssText='position:fixed;z-index:99999;bottom:8px;left:8px;max-width:540px;background:#fff5ce;padding:8px;border:1px solid #d6bc68;font:12px sans-serif';document.body.append(controls);
render(<><button id="inline-run" onClick={()=>void verify()}>スタイルを一括検証</button><button id="alignment-run" onClick={()=>void verifyAlignment()}>行揃えを一括検証</button><button id="inline-inspect" onClick={()=>void inspect()}>保存データを表示</button><pre id="inline-report" style={{maxHeight:'180px',overflow:'auto',whiteSpace:'pre-wrap'}}>検証用の作品フォルダを用意しました。</pre><div id="inline-captures"/></>,controls);
const report=document.getElementById('inline-report')!;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const settle=async()=>{for(let i=0;i<4;i++)await frame();};
const wait=async(test:()=>boolean,label:string)=>{for(let i=0;i<300&&!test();i++)await frame();if(!test())throw Error(label);};
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent?.trim()===label)!;
const history=(label:string)=>document.querySelector<HTMLButtonElement>(`.app-header [aria-label="${label}"]`)!;
const editor=()=>document.querySelector<HTMLElement>('.native-text-input')!;
const nativeBubble=()=>document.querySelector<HTMLElement>('[data-content-panel="0"][data-content-kind="bubble"][data-content-index="0"] .bubble-text-content')!;
const stored=async():Promise<MangaDocument>=>JSON.parse(await(await project.getFile()).text()).snapshot.document;
async function inspect(){report.textContent=JSON.stringify((await stored()).manga.pages[0],null,2);}
async function choose(start:number,end=start){
  const root=editor();root.focus();const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let at=0,started=false;
  while(walker.nextNode()){const node=walker.currentNode,length=node.textContent!.length;if(!started&&start<=at+length){range.setStart(node,start-at);started=true;}if(started&&end<=at+length){range.setEnd(node,end-at);break;}at+=length;}
  const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));await settle();
}
async function input(value:string,composition=false){
  const root=editor();
  if(composition)root.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  root.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:composition?'insertCompositionText':'insertText',data:value,isComposing:composition}));
  const range=getSelection()!.getRangeAt(0);range.deleteContents();const node=document.createTextNode(value);range.insertNode(node);range.setStartAfter(node);range.collapse(true);getSelection()!.removeAllRanges();getSelection()!.addRange(range);
  root.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:composition?'insertCompositionText':'insertText',data:value,isComposing:composition}));
  if(composition)root.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:value}));
  await settle();
}
async function toggle(label:string,on:boolean){if(button(label).getAttribute('aria-pressed')!==String(on)){button(label).click();await settle();}}
const glyphStyle=(root:HTMLElement,index:number)=>{
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let at=0;
  while(walker.nextNode()){const node=walker.currentNode,length=node.textContent!.length;if(index<at+length)return getComputedStyle(node.parentElement!);at+=length;}
  throw Error(`Missing glyph ${index}`);
};
async function save(){const control=document.querySelector<HTMLButtonElement>('[data-project-save]')!;control.click();await wait(()=>!control.disabled&&!control.textContent?.includes('処理中'),'保存完了待ち');await settle();}
async function open(){button('作品フォルダを開く').click();await wait(()=>!!nativeBubble(),'作品が開けません');await settle();}
async function verify(){
  const run=document.getElementById('inline-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  run.disabled=true;report.textContent='検証中';
  try{
    if(!nativeBubble())await open();
    button('通常文字').click();await wait(()=>!!button('ボールド'),'文字パレットがありません');await settle();
    const labels=['ボールド','イタリック','下線','取り消し線'];
    for(const label of labels)await toggle(label,true);
    check(nativeBubble().textContent==='ABCDEF'&&history('元に戻す').disabled,'無選択のスタイル操作は既存本文・Undoを変えない');
    button('選択').click();await settle();button('通常文字').click();await settle();
    check(labels.every(label=>button(label).getAttribute('aria-pressed')==='true'),'ツールを持ち替えても4つの状態を保持');
    nativeBubble().click();await wait(()=>!!editor(),'本文編集が開けません');await settle();
    await choose(6);await input('新',true);
    let styled=glyphStyle(editor(),6),plain=glyphStyle(editor(),0);
    check(editor().textContent==='ABCDEF新'&&Number(styled.fontWeight)>=700&&styled.fontStyle==='italic'&&styled.textDecorationLine.includes('underline')&&styled.textDecorationLine.includes('line-through')&&plain.fontWeight==='400'&&plain.textDecorationLine==='none','IMEイベントの確定文字だけへB/I/U/Sを反映');
    for(const label of labels)await toggle(label,false);
    check(glyphStyle(editor(),6).fontStyle==='italic','無選択の解除は入力済みの文字を変更しない');
    await input('平');
    plain=glyphStyle(editor(),7);check(plain.fontWeight==='400'&&plain.fontStyle==='normal'&&plain.textDecorationLine==='none','解除後の次の文字だけが通常スタイル');
    history('元に戻す').click();await settle();check(nativeBubble().textContent==='ABCDEF新','次の入力を1回でUndo');
    history('やり直す').click();await settle();check(nativeBubble().textContent==='ABCDEF新平','Redoが入力とスタイルを復元');
    if(!editor()){nativeBubble().click();await wait(()=>!!editor(),'再編集できません');}
    await choose(1,3);
    for(const label of labels)await toggle(label,true);
    styled=glyphStyle(editor(),1);plain=glyphStyle(editor(),0);
    check(getSelection()?.toString()==='BC'&&styled.fontStyle==='italic'&&styled.textDecorationLine==='underline line-through'&&Number(styled.fontWeight)>=700&&plain.fontWeight==='400'&&plain.textDecorationLine==='none','選択したBCだけへ4種を重ね掛けし選択を保持');
    button('イタリック').click();await settle();
    check(glyphStyle(editor(),1).fontStyle==='normal'&&glyphStyle(editor(),1).textDecorationLine==='underline line-through','もう一度押すとそのスタイルだけ解除');
    await choose(0,3);check(button('下線').getAttribute('aria-pressed')==='mixed','混在した選択範囲を表示');
    button('下線').click();await settle();check([0,1,2].every(i=>glyphStyle(editor(),i).textDecorationLine.includes('underline')),'混在範囲への1クリックは全選択文字をON');
    await save();const saved=await stored(),bubble=saved.manga.pages[0].panels[0].bubbles[0];
    check(bubble.text==='ABCDEF新平'&&textStyleSegments(bubble).some(part=>part.strikethrough&&part.fontWeight!>=700),'実フォルダー保存が本文と範囲書式を保持');
    render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();
    check(nativeBubble().textContent==='ABCDEF新平'&&glyphStyle(nativeBubble(),1).textDecorationLine==='underline line-through','保存済み作品を開き直しても表示が一致');
    button('通常文字').click();await settle();
    document.querySelector<HTMLElement>('[data-content-kind="screen_text"][data-content-panel="0"]')!.click();await wait(()=>editor()?.getAttribute('aria-label')==='通常文字','縦書き編集が開けません');
    await choose(1,3);await toggle('下線',true);await toggle('取り消し線',true);await toggle('イタリック',true);
    check(glyphStyle(editor(),1).writingMode==='vertical-rl'&&glyphStyle(editor(),1).textDecorationLine==='underline line-through','縦書き通常文字も選択した範囲へ適用');
    await save();
    const snapshots=await stored();
    for(const orientation of ['horizontal','vertical'] as const){
    const hashes=new Set<number>();
    for(const decoration of ['plain','italic','underline','strikethrough','fontWeight']){
      const doc=structuredClone(snapshots);doc.manga.pages[0].panels[0].screen_text=[];delete doc.manga.pages[0].page_overlay;
      doc.manga.pages[0].panels[0].bubbles=[{text:'文字AB',shape:'normal',bbox:{x:50,y:35,w:90,h:50},text_style:{font:'Hiragino Sans',fontWeight:decoration==='fontWeight'?700:400,fontSize:24,orientation,...(decoration==='italic'?{italic:true}:{}),...(decoration==='underline'?{underline:true}:{}),...(decoration==='strikethrough'?{strikethrough:true}:{})}}];
      const canvas=await captureQwenCompositionCanvas(doc.manga,0,0,'page',{}, {width:364,height:514});let hash=2166136261;
      for(const byte of canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data){hash^=byte;hash=Math.imul(hash,16777619);}hashes.add(hash>>>0);canvas.width=canvas.height=1;
    }
    check(hashes.size===5,`${orientation==='horizontal'?'横':'縦'}書きの実Canvas画素でも4種がそれぞれ通常文字と異なる`);
    }
    report.textContent=`PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;}
}

/** The same real editor, folder and export path used by the inline-style check. */
async function verifyAlignment(){
  const control=document.getElementById('alignment-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const near=(a:number,b:number)=>Math.abs(a-b)<1;
  const textRect=(root:HTMLElement,start:number,end:number)=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let at=0,started=false;
    while(walker.nextNode()){const node=walker.currentNode,length=node.textContent!.length;if(!started&&start<=at+length){range.setStart(node,start-at);started=true;}if(started&&end<=at+length){range.setEnd(node,end-at);return range.getBoundingClientRect();}at+=length;}
    throw Error('行の文字範囲がありません');
  };
  control.disabled=true;report.textContent='行揃え検証中';
  try{
    const fresh=structuredClone(source),panel=fresh.manga.pages[0].panels[0];
    panel.bubbles[0].text='あいうえお\nかき';panel.bubbles[0].text_runs=[{start:1,end:3,underline:true,italic:true}];
    panel.screen_text![0].text='あいうえお\nかき';
    render(null,host);const writer=await project.createWritable();await writer.write(JSON.stringify(await createPortableProject(fresh)));await writer.close();render(<App/>,host);
    await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();button('通常文字').click();await settle();
    check(button('左寄せ').getAttribute('aria-pressed')==='true','行揃えの初期値は左寄せ');
    button('中央寄せ').click();await settle();
    check(history('元に戻す').disabled&&getComputedStyle(nativeBubble()).textAlign==='start','未選択の行揃えは既存文字とUndoを変えない');
    button('選択').click();await settle();button('通常文字').click();await settle();
    check(button('中央寄せ').getAttribute('aria-pressed')==='true','道具を持ち替えても新規文字の中央寄せを保持');
    const paper=document.querySelector<HTMLElement>('.manga-paper')!,box=paper.getBoundingClientRect();
    paper.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,detail:1,clientX:box.x+110/182*box.width,clientY:box.y+100/257*box.height}));
    await wait(()=>editor()?.getAttribute('aria-label')==='通常文字','クリックした場所に通常文字が作成されません');await input('新しい文字\n短');await save();
    check((await stored()).manga.pages[0].panels[0].screen_text!.at(-1)!.text_style?.textAlign==='center','次にクリックして作成した文字領域へ中央寄せを保存');
    button('選択').click();await settle();button('通常文字').click();await settle();nativeBubble().click();await wait(()=>editor()?.getAttribute('aria-label')==='吹き出しの文字','吹き出しを編集できません');await choose(1,3);
    button('中央寄せ').click();await settle();
    check(getSelection()?.toString()==='いう'&&getComputedStyle(editor()).textAlign==='center','部分選択中でも文字群全体を揃えて文字選択を保持');
    history('元に戻す').click();await settle();check(getComputedStyle(nativeBubble()).textAlign==='start','行揃えを1回のUndoで戻す');
    history('やり直す').click();await settle();check(getComputedStyle(nativeBubble()).textAlign==='center','Redoで行揃えを復元');
    for(const vertical of [false,true]){
      button('選択').click();await settle();button('通常文字').click();await settle();
      const target=vertical?document.querySelector<HTMLElement>('[data-content-kind="screen_text"][data-content-panel="0"][data-content-index="0"]')!:nativeBubble();target.click();
      await wait(()=>editor()?.getAttribute('aria-label')===(vertical?'通常文字':'吹き出しの文字'),'文字群を編集できません');await choose(1,3);
      let originalRect:DOMRect|undefined;
      for(const [label,factor] of [['左寄せ',0],['中央寄せ',.5],['右寄せ',1]] as const){
        button(label).click();await settle();const long=textRect(editor(),0,5),short=textRect(editor(),6,8),group=editor().getBoundingClientRect();
        const gap=vertical?short.top-long.top:short.left-long.left,space=vertical?long.height-short.height:long.width-short.width;
        check(near(gap,space*factor),`${vertical?'縦':'横'}書きの${label}で短い行の実位置が一致`);
        if(originalRect)check(near(group.x,originalRect.x)&&near(group.y,originalRect.y)&&near(group.width,originalRect.width)&&near(group.height,originalRect.height),`${vertical?'縦':'横'}書きの文字群の位置と大きさを保持`);else originalRect=group;
      }
    }
    await save();const saved=await stored(),bubble=saved.manga.pages[0].panels[0].bubbles[0],screen=saved.manga.pages[0].panels[0].screen_text![0];
    check(bubble.text_style?.textAlign==='right'&&screen.text_style?.textAlign==='right'&&JSON.stringify(bubble.text_runs)===JSON.stringify(panel.bubbles[0].text_runs)&&JSON.stringify(bubble.bbox)===JSON.stringify(panel.bubbles[0].bbox)&&JSON.stringify(screen.bbox)===JSON.stringify(panel.screen_text![0].bbox),'保存でも全体の行揃え・部分スタイル・枠を保持');
    render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動待ち');await open();
    check(getComputedStyle(nativeBubble()).textAlign==='end','作品を開き直しても右寄せを保持');
    for(const orientation of ['horizontal','vertical'] as const){
      const hashes=new Set<number>();
      for(const textAlign of ['left','center','right'] as const){
        const doc=structuredClone(saved);doc.manga.pages[0].panels[0].screen_text=[];delete doc.manga.pages[0].page_overlay;
        const text=doc.manga.pages[0].panels[0].bubbles[0];text.text_style={...text.text_style,orientation,textAlign};
        const canvas=await captureQwenCompositionCanvas(doc.manga,0,0,'page',{}, {width:364,height:514});let hash=2166136261;
        for(const byte of canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data){hash^=byte;hash=Math.imul(hash,16777619);}hashes.add(hash>>>0);canvas.width=canvas.height=1;
      }
      check(hashes.size===3,`${orientation==='horizontal'?'横':'縦'}書きの実Canvasでも3種の行揃えを描き分ける`);
    }
    report.textContent=`行揃え PASS ${checks.length}\n${checks.join('\n')}`;
  }catch(error){report.textContent=`行揃え FAIL after ${checks.length}: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{control.disabled=false;}
}
