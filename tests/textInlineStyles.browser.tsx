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
render(<><button id="inline-run" onClick={()=>void verify()}>スタイルを一括検証</button><button id="alignment-run" onClick={()=>void verifyAlignment()}>行揃えを一括検証</button><button id="bubble-info-run" onClick={()=>void verifyBubbleInfo()}>情報タブを一括検証</button><button id="inline-inspect" onClick={()=>void inspect()}>保存データを表示</button><pre id="inline-report" style={{maxHeight:'180px',overflow:'auto',whiteSpace:'pre-wrap'}}>検証用の作品フォルダを用意しました。</pre><div id="inline-captures"/></>,controls);
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
async function save(){const control=document.querySelector<HTMLButtonElement>('[data-project-save]')!;control.click();await settle();await wait(()=>!control.disabled&&!control.textContent?.includes('処理中'),'保存完了待ち');await settle();}
async function open(){button('作品フォルダを開く').click();await wait(()=>!!nativeBubble(),'作品が開けません');await settle();}
async function verifyBubbleInfo(){
  const run=document.getElementById('bubble-info-run') as HTMLButtonElement,checks:string[]=[];
  const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);report.textContent=checks.join('\n');};
  const info=()=>document.querySelector<HTMLElement>('.bubble-info-content')!;
  const cards=()=>[...info().querySelectorAll<HTMLElement>('.selectable-card')];
  const field=(index:number,label:string)=>[...cards()[index].querySelectorAll<HTMLLabelElement>('label.field')].find(node=>node.querySelector('.field-label')?.textContent===label)!.querySelector<HTMLSelectElement>('select')!;
  const change=async(index:number,label:string,value:string)=>{cards()[index].click();await settle();const select=field(index,label);select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await settle();};
  const selected=()=>cards().findIndex(card=>card.classList.contains('is-selected'));
  const chooseBubble=async(panel:number,index:number,overlay=false)=>{
    document.querySelector<HTMLElement>(`[data-content-kind="bubble"][data-content-index="${index}"]${overlay?'[data-content-overlay]':`[data-content-panel="${panel}"]:not([data-content-overlay])`}`)!.click();await settle();
  };
  const informationOpen=()=>button('情報')?.getAttribute('aria-selected')==='true'&&!document.querySelector<HTMLElement>('.text-settings-window')!.hidden;
  run.disabled=true;report.textContent='情報タブを検証中';
  try{
    render(null,host);
    const doc=structuredClone(source),panel=doc.manga.pages[0].panels[0];
    doc.manga.characters=[{localId:'speaker-a',name:'アキ',role:'主人公',scope:'episode'},{localId:'speaker-b',name:'ユキ',role:'友人',scope:'episode'}];
    panel.figures=[{refId:'speaker-a',name:'アキ',kind:'person',bbox:{x:15,y:55,w:30,h:40}},{refId:'speaker-b',name:'ユキ',kind:'person',bbox:{x:110,y:55,w:30,h:40}}];
    panel.bubbles=Array.from({length:5},(_,index)=>({...structuredClone(panel.bubbles[0]),text:`台詞${index+1}`,bbox:{x:45,y:25+index*26,w:85,h:22},...(index===4?{locked:true}:{})}));
    doc.manga.pages[0].panels.push({...structuredClone(panel),id:2,bubbles:[{text:'別コマ',shape:'normal',bbox:{x:30,y:185,w:50,h:20}}],shape:{type:'rect',x:15,y:180,w:150,h:50}});
    doc.manga.pages[0].page_overlay!.bubbles=[{text:'前景一',shape:'normal',bbox:{x:1,y:1,w:30,h:20}},{text:'前景二',shape:'normal',bbox:{x:135,y:1,w:30,h:20}}];
    doc.manga.pages[0].page_overlay!.figures=structuredClone(panel.figures);
    doc.manga.scenario={version:1,fileName:'info-fixture.md',text:'# シナリオ\n## page1\n### コマ2\nアキ「確認した台詞」'};
    doc.manga.pages[0].panels[1].bubbles[0].scenarioMatch={status:'review',sourceIds:[],ocrText:'別コマ',score:.2};
    const reset=await project.createWritable();await reset.write(JSON.stringify(await createPortableProject(doc)));await reset.close();
    render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'起動画面待ち');await open();
    button('文字のツール一覧').click();await settle();button('情報').click();await settle();
    check(informationOpen()&&document.querySelectorAll('.text-settings-tabs [role="tab"]').length===3,'文字・ふきだし・情報の3タブ');
    check(button('通常文字').getAttribute('aria-pressed')==='false'&&!editor()&&history('元に戻す').disabled,'情報を開いても選択ツールと履歴を維持');
    check(cards().length===5&&cards().every((card,index)=>card.querySelector('.bubble-card-title')?.textContent?.replace(/\s/g,'')===`フキダシ${index+1}`),'フキダシ1〜5を元の順序で表示');
    check(!document.querySelector('.inspector-content .panel-bubble-section')&&!document.querySelector('.inspector-content .bubble-join-control'),'コマ情報側に吹き出しカード・結合欄を残さない');
    check([...cards()[1].querySelectorAll('.field-label')].map(node=>node.textContent).join(',')==='話者,しっぽ,結合先','話者→しっぽ→結合先の順序を保持');
    const inspector=document.querySelector<HTMLElement>('.inspector-content')!,card=cards()[1];
    check(Math.abs(card.getBoundingClientRect().width-(inspector.clientWidth-34))<2,'カード幅は元のコマ情報と同じ');
    const selectStyle=getComputedStyle(field(1,'しっぽ'));
    check(selectStyle.paddingTop==='9px'&&selectStyle.fontSize==='15px'&&selectStyle.borderRadius==='9px','入力欄の寸法は元のコマ情報と同じ');
    await save();const baseline=(await stored()).manga.pages[0];
    await chooseBubble(0,1);check(selected()===1&&informationOpen()&&!editor(),'選択ツールで紙面を選ぶと情報タブの該当カードへ追従');
    const viewport=document.querySelector<HTMLElement>('.canvas-spread-scroll')!,viewportPosition=[viewport.scrollLeft,viewport.scrollTop];
    await chooseBubble(0,3);
    await wait(()=>document.querySelector<HTMLElement>('.text-settings-window-body')!.scrollTop>0,'情報カードのスクロール待ち');
    check(informationOpen()&&selected()===3&&viewport.scrollLeft===viewportPosition[0]&&viewport.scrollTop===viewportPosition[1],'別の吹き出しへ変更してもタブを保持し原稿をスクロールしない');
    await change(1,'話者','speaker-b');await save();
    check((await stored()).manga.pages[0].panels[0].bubbles[1].speaker==='ユキ','話者を対象の吹き出しへ保存');
    history('元に戻す').click();await settle();check(field(1,'話者').value===''&&informationOpen(),'話者変更をUndoし情報タブを維持');
    history('やり直す').click();await settle();check(field(1,'話者').value==='speaker-b','Redoで話者を復元');
    await change(1,'しっぽ','thinking');await change(1,'結合先','1');await save();
    let saved=(await stored()).manga.pages[0];
    check(saved.panels[0].bubbles[1].tail_style==='thinking'&&saved.panels[0].bubbles[1].join_to===1,'しっぽと結合先を既存の保存データへ反映');
    check(saved.panels[0].bubbles.every((bubble,index)=>bubble.text===panel.bubbles[index].text&&JSON.stringify(bubble.bbox)===JSON.stringify(panel.bubbles[index].bbox)&&JSON.stringify(bubble.text_style)===JSON.stringify(panel.bubbles[index].text_style))&&JSON.stringify(saved.panels[1])===JSON.stringify(baseline.panels[1]),'本文・書式・位置・別コマを保持');
    check(cards()[4].inert&&cards()[4].getAttribute('aria-disabled')==='true','吹き出し単体の手動ロックを保持');
    await chooseBubble(1,0);check(informationOpen()&&cards().length===1,'別コマへ移っても情報タブを保持しカード一覧だけ切替');
    await chooseBubble(0,1,true);check(informationOpen()&&cards().length===2&&info().getAttribute('aria-label')==='ページ前景の吹き出し情報','ページ前景も同じ情報タブへ表示');
    await change(1,'話者','speaker-a');await change(1,'しっぽ','normal');await change(1,'結合先','1');await save();
    saved=(await stored()).manga.pages[0];
    check(saved.page_overlay!.bubbles![1].speaker==='アキ'&&saved.page_overlay!.bubbles![1].join_to===1&&saved.panels[0].bubbles[1].speaker==='ユキ','前景の操作が同じ番号のコマ内吹き出しを変更しない');
    button('ダイレクト選択').click();await settle();await chooseBubble(0,0);check(informationOpen()&&selected()===0&&button('通常文字').getAttribute('aria-pressed')==='false','ダイレクト選択でも情報タブを操作できる');
    button('コマ情報を閉じる').click();await settle();check(info().getBoundingClientRect().height>0&&informationOpen(),'コマ情報を閉じても情報タブは表示を維持');
    await change(0,'しっぽ','normal');check(field(0,'しっぽ').value==='normal','コマ情報を閉じた状態でも変更できる');
    const count=cards().length;info().querySelector<HTMLButtonElement>('.inline-add')!.click();await settle();check(cards().length===count+1&&informationOpen(),'カードの追加を移植');
    cards().at(-1)!.querySelector<HTMLButtonElement>('.nested-card-head button')!.click();await settle();check(cards().length===count&&informationOpen(),'カードの削除を移植');
    await save();render(null,host);render(<App/>,host);await wait(()=>!!button('作品フォルダを開く'),'再起動画面待ち');await open();button('文字のツール一覧').click();await settle();button('情報').click();await settle();
    check(field(1,'話者').value==='speaker-b'&&field(1,'しっぽ').value==='thinking'&&field(1,'結合先').value==='1','フォルダーを開き直しても話者・しっぽ・結合先を復元');
    button('コマ 01全体を固定').click();await settle();check(info().inert&&info().getAttribute('aria-disabled')==='true','コマ全体のロックも情報タブへ引き継ぐ');
    button('コマ 01全体の固定を解除').click();await settle();check(!info().inert,'コマのロック解除で情報欄も編集可能になる');
    button('シナリオ').click();await settle();button('吹き出し情報で確認').click();await settle();
    await wait(()=>informationOpen()&&cards().length===1&&selected()===0,'シナリオからの移動待ち');
    check(!!info().querySelector('.scenario-inline')&&!document.querySelector('.inspector-content .scenario-inline'),'シナリオの確認リンクが別コマの情報タブを開き対象を選択');
    info().querySelector<HTMLInputElement>('[aria-label="「確認した台詞」を確定"]')!.click();await settle();await save();
    check((await stored()).manga.pages[0].panels[1].bubbles[0].text==='確認した台詞'&&!info().querySelector('.scenario-inline'),'移動した候補カードの確定と保存も維持');
    await chooseBubble(0,3);await wait(()=>document.querySelector<HTMLElement>('.text-settings-window-body')!.scrollTop>0,'再選択スクロール待ち');
    report.textContent=`情報タブ PASS（${checks.length}項目）\n${checks.join('\n')}`;
  }catch(error){report.textContent=`情報タブ FAIL: ${String(error)}\n${checks.join('\n')}`;console.error(error);}
  finally{run.disabled=false;}
}
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
