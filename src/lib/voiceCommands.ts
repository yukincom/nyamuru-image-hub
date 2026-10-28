import {isHandwrittenText} from './bubblePresentation.ts';
import type {CanvasElementSelection,MangaDocument} from '../types.ts';
import {isPropPlacement} from './catalogModel.ts';
import {bubbleVisible,panelVisible} from './panelLayers.ts';

/** BERT selects the intent; bounded argument resolution never guesses missing values. */
export const VOICE_LABELS = ['save','undo','redo','page_navigate','view_change','artwork_mode_set','bubble_set',
  'needs_clarification','needs_reasoning','compound_request','out_of_scope_request','not_command','panel_sync_set',
  'inner_frame_snap_set','panel_gap_snap_set','generate_request','background_3d_candidates','paint_tool_set','text_frames_align'] as const;
export type VoiceLabel = typeof VOICE_LABELS[number];
export interface VoicePrediction { text:string; label:VoiceLabel; confidence:number; model:string; elapsed_ms:number }
export type VoiceCommand =
  | {op:'save'|'undo'|'redo'|'open_bubble_materials'}
  | {op:'page'; target:'next'|'previous'|'first'|'last'|number}
  | {op:'setting'; key:'panel_sync'|'inner_frame_snap'|'panel_gap_snap'|'guides'|'spread'; enabled:boolean}
  | {op:'artwork'; mode:'integrated'|'draft'}
  | {op:'paint_tool'; tool:'pen'|'vector-pen'}
  | {op:'bubble_shape'; shape:'normal'|'square'|'caption'|'toge'}
  | {op:'bubble_text'; text:string}
  | {op:'generate_selected';kind:'selected'|'figure'|'bubble';locator?:{panel:number;name:string}};
export type VoiceResolution = {command:VoiceCommand; message?:never;localOnly?:never}|{command?:never;message:string;localOnly?:true};

export function parseVoicePrediction(value:unknown, text:string):VoicePrediction {
  const v=value as Partial<VoicePrediction>;
  if(!v||v.text!==text||!VOICE_LABELS.includes(v.label as VoiceLabel)||typeof v.confidence!=='number'||
    !Number.isFinite(v.confidence)||v.confidence<0||v.confidence>1||typeof v.model!=='string'||
    typeof v.elapsed_ms!=='number'||!Number.isFinite(v.elapsed_ms))throw new Error('分類結果が入力と一致しません');
  return v as VoicePrediction;
}

const polite='(?:ください|下さい|くれる|くれますか|もらえる|もらえますか|ほしい|ね|よ)?';
const match=(text:string,pattern:string)=>text.match(new RegExp(`^(?:${pattern})${polite}$`,'u'));
const number=(value:string)=>{
  if(/^\d+$/.test(value))return Number(value);
  const digits='〇一二三四五六七八九';
  if(value==='十')return 10;
  if(value.includes('十')){const [t,u]=value.split('十');return (t?digits.indexOf(t):1)*10+(u?digits.indexOf(u):0);}
  return digits.indexOf(value);
};

function quotedBubbleText(value:string):string|undefined {
  const text=value.trim();
  const prefix=text.match(/^(?:この|選択中の)?(?:吹き出し|フキダシ)(?:の本文)?(?:に|を)「/u);
  if(!prefix)return;
  let depth=1;
  for(let index=prefix[0].length;index<text.length;index++){
    if(text[index]==='「')depth++;
    if(text[index]==='」'&&!--depth){
      const literal=text.slice(prefix[0].length,index);
      if(literal.length>=1&&literal.length<=500&&/^(?:と入れて|にして|に変えて)(?:ください|くれる)?[。!！?？]*$/u.test(text.slice(index+1)))return literal;
      return;
    }
  }
}

export function resolveVoiceCommand(prediction:VoicePrediction):VoiceResolution {
  const {label,confidence}=prediction;
  // Whole-utterance matches prevent quoted, deferred, withdrawn or compound
  // requests from falling through to an action merely because a keyword exists.
  const text=prediction.text.normalize('NFKC').trim().replace(/[。!！?？]+$/u,'').trim();
  const refuse=(message='操作の指定を確定できませんでした。短い一つの操作に言い換えてください。'):VoiceResolution=>({message});
  if(match(text,'(?:(?:吹き出し|フキダシ)(?:の)?素材(?:ウィンドウ|ウインドウ|一覧)?|素材(?:ウィンドウ|ウインドウ))を(?:開いて|表示して|見せて)')){
    return label==='view_change'&&confidence>=0.9?{command:{op:'open_bubble_materials'}}
      :{localOnly:true,message:'表示の依頼として確定できませんでした。「吹き出しの素材ウィンドウを表示して」と入力してください。'};
  }
  if(label==='not_command')return refuse('操作依頼としては実行しませんでした。');
  if(label==='compound_request')return refuse('複数の操作は、一つずつ入力してください。');
  if(label==='needs_reasoning'||label==='background_3d_candidates')return refuse('内容を判断する操作は、まだ接続していません。');
  if(label==='text_frames_align')return refuse('複数文字枠の上端揃えは、まだ実装されていません。');
  if(label==='out_of_scope_request')return refuse('この操作は、現在の音声・文字操作の対象外です。');
  if(label==='needs_clarification')return refuse();
  if(confidence<0.9)return refuse('分類を確定できませんでした。操作は実行していません。');
  if(label==='save'&&match(text,'(?:(?:この)?(?:作品|原稿|状態)を)?(?:上書き)?保存(?:して|する)?'))return {command:{op:'save'}};
  if(label==='undo'&&match(text,'(?:Undo|undo|アンドゥ)(?:して)?|(?:一つ|ひとつ|一回|1回)?(?:元に)?戻して|直前の操作を取り消して'))return {command:{op:'undo'}};
  if(label==='redo'&&match(text,'(?:Redo|redo|リドゥ)(?:して)?|やり直して|(?:一つ|ひとつ|一回|1回)やり直して'))return {command:{op:'redo'}};
  if(label==='page_navigate'){
    const direction=match(text,'(次|前|最初|最後)のページ(?:(?:に|へ)(?:移動して|進んで|戻って|行って|切り替えて)?)?');
    if(direction)return {command:{op:'page',target:({'次':'next','前':'previous','最初':'first','最後':'last'} as const)[direction[1] as '次']}};
    const page=match(text,'([0-9〇一二三四五六七八九十]+)ページ(?:目)?(?:に|へ)(?:移動して|進んで|戻って|行って|切り替えて)?');
    if(page){const n=number(page[1]);if(Number.isInteger(n)&&n>0)return {command:{op:'page',target:n}};}
  }
  const setting={panel_sync_set:['コマシンクロ','panel_sync'],inner_frame_snap_set:['内枠スナップ','inner_frame_snap'],panel_gap_snap_set:['コマスナップ','panel_gap_snap']} as const;
  if(label in setting){
    const [name,key]=setting[label as keyof typeof setting];
    const value=match(text,`${name}(?:を)?(オン|オフ|有効|無効)にして`);
    if(value)return {command:{op:'setting',key,enabled:['オン','有効'].includes(value[1])}};
  }
  if(label==='view_change'){
    const view=match(text,'(ガイド|見開き)(?:表示)?を(表示して|非表示にして|オンにして|オフにして)');
    if(view)return {command:{op:'setting',key:view[1]==='ガイド'?'guides':'spread',enabled:['表示して','オンにして'].includes(view[2])}};
  }
  if(label==='artwork_mode_set'){
    if(match(text,'(?:作画方式を)?(?:下書き|下書き生成)(?:方式|モード)?に(?:して|切り替えて)'))return {command:{op:'artwork',mode:'draft'}};
    if(match(text,'(?:作画方式を)?(?:一体生成|一体型生成)(?:方式|モード)?に(?:して|切り替えて)'))return {command:{op:'artwork',mode:'integrated'}};
  }
  if(label==='paint_tool_set'){
    const tool=match(text,'(ラスターペン|ベクターペン|ベジェペン)に(?:して|変えて|切り替えて)');
    if(tool)return {command:{op:'paint_tool',tool:tool[1]==='ラスターペン'?'pen':'vector-pen'}};
  }
  if(label==='bubble_set'){
    const shape=match(text,'(?:この|選択中の)?(?:吹き出し|フキダシ)を(丸|四角|ナレーション|トゲ)(?:形)?にして');
    if(shape)return {command:{op:'bubble_shape',shape:({'丸':'normal','四角':'square','ナレーション':'caption','トゲ':'toge'} as const)[shape[1] as '丸']}};
    // Preserve literal text, including full-width punctuation and whitespace.
    const quoted=quotedBubbleText(prediction.text);
    if(quoted!==undefined)return {command:{op:'bubble_text',text:quoted}};
  }
  if(label==='generate_request'){
    const target=match(text,'(これ|(?:この|選択中の|今選択している|今選んでいる)(人物|キャラクター|キャラ|描き文字|書き文字))を(?:画像)?生成して');
    if(target)return {command:{op:'generate_selected',kind:!target[2]?'selected':['描き文字','書き文字'].includes(target[2])?'bubble':'figure'}};
    const named=match(text,'([0-9〇一二三四五六七八九十]+)コマ(?:目)?の([^「」\\n]{1,80})を(?:画像)?生成して');
    if(named){const panel=number(named[1]);if(Number.isSafeInteger(panel)&&panel>0)return {command:{op:'generate_selected',kind:'figure',locator:{panel,name:named[2].trim()}}};}
  }
  return refuse();
}

/** Resolve within the current page; a name never creates or silently selects another character. */
export function resolveVoiceGenerationTarget(document:MangaDocument,pageIndex:number,panelIndex:number,selection:CanvasElementSelection|null,
  command:Extract<VoiceCommand,{op:'generate_selected'}>){
  const page=document.manga.pages[pageIndex];
  if(!page)throw Error('表示中のページが見つかりません');
  let kind:'figure'|'bubble',index:number,overlay=false;
  if(command.locator){
    if(command.kind!=='figure'||!Number.isSafeInteger(command.locator.panel)||command.locator.panel<1)throw Error('生成対象のコマを指定してください');
    panelIndex=command.locator.panel-1;
    const panel=page.panels[panelIndex];
    if(!panel)throw Error(`このページに${command.locator.panel}コマ目はありません`);
    const name=command.locator.name.normalize('NFKC').trim();
    const matches=(panel.figures??[]).flatMap((figure,index)=>{
      if(isPropPlacement(figure))return [];
      const character=figure.refId?document.manga.characters.find(c=>c.localId===figure.refId):undefined;
      const names=[figure.name,character?.name,...(character?.aliases??[])];
      return name&&names.some(value=>value?.normalize('NFKC').trim()===name)?[index]:[];
    });
    if(!matches.length)throw Error(`${command.locator.panel}コマ目に「${command.locator.name}」の人物配置が見つかりません`);
    if(matches.length!==1)throw Error(`${command.locator.panel}コマ目に「${command.locator.name}」が複数あります。生成する人物を一つ選択してください`);
    kind='figure';index=matches[0];
  }else{
    if(!selection||selection.scope==='page'||!['figure','bubble'].includes(selection.type))throw Error('生成する人物か描き文字を選択してください');
    if(command.kind!=='selected'&&selection.type!==command.kind)throw Error('入力した種類と選択中の生成対象が一致しません');
    kind=selection.type as 'figure'|'bubble';index=selection.index;overlay=selection.scope==='page_overlay';
  }
  const owner=overlay?page.page_overlay:page.panels[panelIndex];
  const figure=kind==='figure'?owner?.figures?.[index]:undefined,bubble=kind==='bubble'?owner?.bubbles?.[index]:undefined;
  if(!owner||(!figure&&!bubble))throw Error('選択中の生成対象が見つかりません');
  if(bubble&&!isHandwrittenText(bubble))throw Error('吹き出し単品は生成できません。描き文字を選択してください');
  if(figure&&isPropPlacement(figure)&&command.kind==='figure')throw Error('選択中の対象は小道具です。生成する人物を選択してください');
  if((!overlay&&!panelVisible(page.panels[panelIndex]))||figure?.artwork?.hidden||bubble&&!bubbleVisible(bubble))throw Error('生成対象が非表示です');
  return {pageIndex,panelIndex:overlay?0:panelIndex,index,kind,overlay};
}

/** Capture the editor state before awaiting classification; close/edit/navigation cancels application. */
export async function runVoiceCommand(options:{text:string;revision:()=>string;cancelled:()=>boolean;
  classify:(body:{text:string})=>Promise<unknown>;apply:(command:VoiceCommand)=>Promise<string>|string}){
  const revision=options.revision();
  const prediction=parseVoicePrediction(await options.classify({text:options.text}),options.text);
  if(options.cancelled()||options.revision()!==revision)throw new Error('待機中に原稿や選択が変わったため、操作を適用しませんでした。');
  const resolution=resolveVoiceCommand(prediction);
  const message=resolution.command?await options.apply(resolution.command):resolution.message;
  return {prediction,message,executed:Boolean(resolution.command)};
}
