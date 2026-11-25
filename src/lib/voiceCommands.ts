import {isHandwrittenText} from './bubblePresentation.ts';
import type {CanvasElementSelection,MangaDocument} from '../types.ts';
import {isPropPlacement} from './catalogModel.ts';
import {bubbleVisible,panelVisible} from './panelLayers.ts';

/** BERT selects the intent; bounded argument resolution never guesses missing values. */
export const VOICE_LABELS = ['save','undo','redo','page_navigate','view_change','artwork_mode_set','bubble_set',
  'needs_clarification','needs_reasoning','compound_request','out_of_scope_request','not_command','panel_sync_set',
  'inner_frame_snap_set','panel_gap_snap_set','generate_request','background_3d_candidates','paint_tool_set','text_frames_align'] as const;
export type VoiceLabel = typeof VOICE_LABELS[number];
export type VoiceSlotType =
  | 'PAGE_NUM'
  | 'PANEL_NUM'
  | 'TARGET_DIRECTION'
  | 'CHAR_NAME'
  | 'SETTING_KEY'
  | 'SETTING_VALUE'
  | 'BUBBLE_SHAPE'
  | 'PAINT_TOOL'
  | 'ARTWORK_MODE'
  | 'BUBBLE_TEXT'
  | 'TARGET_KIND';
export interface VoiceCommandSlot {
  type: VoiceSlotType;
  text: string;
  start: number;
  end: number;
  score: number;
}
export interface VoicePrediction {
  text: string;
  label: VoiceLabel;
  confidence: number;
  model: string;
  elapsed_ms: number;
  slots?: VoiceCommandSlot[];
}
export type VoiceCommand =
  | {op:'save'|'undo'|'redo'|'open_bubble_materials'}
  | {op:'page'; target:'next'|'previous'|'first'|'last'|number}
  | {op:'setting'; key:'panel_sync'|'inner_frame_snap'|'panel_gap_snap'|'guides'|'spread'; enabled:boolean}
  | {op:'artwork'; mode:'integrated'|'draft'}
  | {op:'paint_tool'; tool:'pen'|'vector-pen'}
  | {op:'bubble_shape'; shape:'normal'|'square'|'caption'|'toge'}
  | {op:'bubble_text'; text:string}
  | {op:'generate_selected';kind:'selected'|'figure'|'bubble'|'page';locator?:{panel:number;name:string}};
export type VoiceResolution = {command:VoiceCommand; message?:never;localOnly?:never}|{command?:never;message:string;localOnly?:true};

const VALID_SLOT_TYPES = new Set<VoiceSlotType>([
  'PAGE_NUM', 'PANEL_NUM', 'TARGET_DIRECTION', 'CHAR_NAME', 'SETTING_KEY',
  'SETTING_VALUE', 'BUBBLE_SHAPE', 'PAINT_TOOL', 'ARTWORK_MODE', 'BUBBLE_TEXT', 'TARGET_KIND',
]);

export function parseVoicePrediction(value:unknown, text:string):VoicePrediction {
  const v=value as Partial<VoicePrediction>;
  if(!v||v.text!==text||!VOICE_LABELS.includes(v.label as VoiceLabel)||typeof v.confidence!=='number'||
    !Number.isFinite(v.confidence)||v.confidence<0||v.confidence>1||typeof v.model!=='string'||
    typeof v.elapsed_ms!=='number'||!Number.isFinite(v.elapsed_ms))throw new Error('分類結果が入力と一致しません');
  if(v.slots!==undefined){
    if(!Array.isArray(v.slots)||v.slots.length>32)throw new Error('スロット結果の形式が不正です');
    for(const slot of v.slots){
      if(!slot||typeof slot!=='object'||!VALID_SLOT_TYPES.has(slot.type)||typeof slot.text!=='string'||!slot.text
        ||!Number.isInteger(slot.start)||!Number.isInteger(slot.end)||slot.start<0||slot.end<=slot.start||slot.end>text.length
        ||text.slice(slot.start,slot.end)!==slot.text||typeof slot.score!=='number'||!Number.isFinite(slot.score)||slot.score<0||slot.score>1){
        throw new Error('スロット結果が入力範囲と一致しません');
      }
    }
  }
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

const SLOT_MIN_SCORE = 0.85;

function hasDisallowedCommandModifier(normalizedText: string): boolean {
  if (/「[^」]*」\s*(?:と|って)?(?:言った|書いた|話した)/u.test(normalizedText)) return true;
  if (/(?:しないで|やめて|止めて|待って|待て|保留|まだ|いや|ではなく|じゃなく|教える|教えて|ですか|ますか|かなあ|かも)/u.test(normalizedText)) return true;
  if (/(?:てから|たら|あとで|後で)/u.test(normalizedText)) return true;
  return false;
}

function bestSlot(slots: readonly VoiceCommandSlot[] | undefined, type: VoiceSlotType): VoiceCommandSlot | undefined {
  return slots
    ?.filter(slot => slot.type === type && slot.score >= SLOT_MIN_SCORE)
    .sort((a, b) => b.score - a.score)[0];
}

function resolveVoiceCommandFromSlots(prediction: VoicePrediction, normalizedText: string): VoiceCommand | undefined {
  const slots = prediction.slots;
  if (!slots?.length || hasDisallowedCommandModifier(normalizedText)) return undefined;
  const { label } = prediction;

  if (label === 'page_navigate') {
    const dir = bestSlot(slots, 'TARGET_DIRECTION')?.text.normalize('NFKC').trim();
    if (dir && dir in { 次: 1, 前: 1, 最初: 1, 最後: 1 }) {
      return { op: 'page', target: ({ 次: 'next', 前: 'previous', 最初: 'first', 最後: 'last' } as const)[dir as '次'] };
    }
    const pageRaw = bestSlot(slots, 'PAGE_NUM')?.text.normalize('NFKC').replace(/[^\d〇一二三四五六七八九十]/gu, '');
    if (pageRaw) {
      const n = number(pageRaw);
      if (Number.isInteger(n) && n > 0) return { op: 'page', target: n };
    }
  }

  if (label === 'panel_sync_set' || label === 'inner_frame_snap_set' || label === 'panel_gap_snap_set' || label === 'view_change') {
    const val = bestSlot(slots, 'SETTING_VALUE')?.text.normalize('NFKC').trim();
    const enabled = val ? /^(?:オン|有効|表示|on)$/iu.test(val) : undefined;
    const disabled = val ? /^(?:オフ|無効|非表示|off)$/iu.test(val) : undefined;
    if (!enabled && !disabled) return undefined;
    if (label === 'panel_sync_set') return { op: 'setting', key: 'panel_sync', enabled: Boolean(enabled) };
    if (label === 'inner_frame_snap_set') return { op: 'setting', key: 'inner_frame_snap', enabled: Boolean(enabled) };
    if (label === 'panel_gap_snap_set') return { op: 'setting', key: 'panel_gap_snap', enabled: Boolean(enabled) };
    const keyRaw = bestSlot(slots, 'SETTING_KEY')?.text.normalize('NFKC').trim();
    if (keyRaw === 'ガイド') return { op: 'setting', key: 'guides', enabled: Boolean(enabled) };
    if (keyRaw === '見開き') return { op: 'setting', key: 'spread', enabled: Boolean(enabled) };
  }

  if (label === 'artwork_mode_set') {
    const modeRaw = bestSlot(slots, 'ARTWORK_MODE')?.text.normalize('NFKC').trim();
    if (modeRaw && /下書き/u.test(modeRaw)) return { op: 'artwork', mode: 'draft' };
    if (modeRaw && /一体/u.test(modeRaw)) return { op: 'artwork', mode: 'integrated' };
  }

  if (label === 'paint_tool_set') {
    const toolRaw = bestSlot(slots, 'PAINT_TOOL')?.text.normalize('NFKC').trim();
    if (toolRaw === 'ラスターペン') return { op: 'paint_tool', tool: 'pen' };
    if (toolRaw === 'ベクターペン' || toolRaw === 'ベジェペン') return { op: 'paint_tool', tool: 'vector-pen' };
  }

  if (label === 'bubble_set') {
    const shapeRaw = bestSlot(slots, 'BUBBLE_SHAPE')?.text.normalize('NFKC').trim();
    if (shapeRaw && shapeRaw in { 丸: 1, 四角: 1, ナレーション: 1, トゲ: 1 }) {
      return { op: 'bubble_shape', shape: ({ 丸: 'normal', 四角: 'square', ナレーション: 'caption', トゲ: 'toge' } as const)[shapeRaw as '丸'] };
    }
    const textSlot = bestSlot(slots, 'BUBBLE_TEXT')?.text;
    if (textSlot && textSlot.length <= 500) return { op: 'bubble_text', text: textSlot };
  }

  if (label === 'generate_request') {
    const panelRaw = bestSlot(slots, 'PANEL_NUM')?.text.normalize('NFKC').replace(/[^\d〇一二三四五六七八九十]/gu, '');
    const nameRaw = bestSlot(slots, 'CHAR_NAME')?.text.trim();
    if (panelRaw && nameRaw && nameRaw.length <= 80) {
      const panel = number(panelRaw);
      if (Number.isSafeInteger(panel) && panel > 0) return { op: 'generate_selected', kind: 'figure', locator: { panel, name: nameRaw } };
    }
    const kindRaw = bestSlot(slots, 'TARGET_KIND')?.text.normalize('NFKC').trim();
    if (kindRaw === '描き文字' || kindRaw === '書き文字') return { op: 'generate_selected', kind: 'bubble' };
    if (kindRaw === '人物' || kindRaw === 'キャラ' || kindRaw === 'キャラクター') return { op: 'generate_selected', kind: 'figure' };
    if (kindRaw === 'ページ' || kindRaw === '全体') return { op: 'generate_selected', kind: 'page' };
    if (kindRaw === 'これ' || kindRaw === '選択') return { op: 'generate_selected', kind: 'selected' };
  }
  return undefined;
}

// 旧->新: 旧=正規表現全文一致のみで引数解決 -> 新=M5高信頼度スロット抽出による言い換え吸収を併用＋安全拒否契約を維持
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
    if(match(text,'(?:(?:この|今の)?ページ(?:全体)?|全コマ|全体)?を?(?:画像)?生成して'))return {command:{op:'generate_selected',kind:'page'}};
  }
  const slotCommand = resolveVoiceCommandFromSlots(prediction, text);
  if (slotCommand) return { command: slotCommand };
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
