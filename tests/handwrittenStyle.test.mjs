// 見込み: 同じ辞書IDをUI・文書・生成で使い、固定英訳を対象の文字に付ける。
// 合格: 選択肢の対応、保存往復、単品/修正/コマ/ページの対象一致。範囲: 本体のコードのみ、LLM・画像生成は呼ばない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {LETTERING_PENS,LETTERING_EXPRESSIONS,handwrittenStyleExpressions,handwrittenStylePrompt} from '../src/lib/handwrittenStyle.ts';
import {toStoredMangaYaml,toMangaYaml,parseMangaYaml,validateManga} from '../src/lib/manga.ts';
import {paintScene} from '../src/lib/paintDocument.ts';
import {buildQwenGenerationPlan,qwenGenerationPrompt,qwenGenerationPayload} from '../src/lib/qwenGeneration.ts';
import {buildQwenCompositionPlan} from '../src/lib/qwenComposition.ts';
function fixture(){
 const doc=createEmptyWorkspaceDocument();
 doc.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:10,y:10,w:100,h:100},bg:0,action:null,bubbles:[
  {text:'ドン！',shape:'handwritten',bbox:{x:20,y:20,w:40,h:25},lettering_pen:'g-pen-firm',lettering_expressions:['scratchy','energetic']},
  {text:'普通の台詞',shape:'normal',lettering_pen:'brush',lettering_expressions:['cute']}]}];
 doc.manga.pages[0].page_overlay={frame:false,layer:'above_panel_frames',bubbles:[{text:'ふわっ',shape:'handwritten',bbox:{x:30,y:150,w:30,h:20},lettering_pen:'pencil-hb',lettering_expressions:['wobbly','cute']}]};
 return doc;
}
// 見込み/合格: 指定された13+7の日本語と固有ID、英語のみの対応。選択順を変えても表現の順序は一定。範囲: 辞書と正規化。
test('requested options are complete, distinct, and have fixed English',()=>{
 assert.deepEqual(LETTERING_PENS.map(x=>x.ja),['丸ペン　柔らかめ','Gペン　ややハード','万年筆','竹ペン','筆ペン','ボールペン','鉛筆　HB','鉛筆　B','サインペン','マジックペン　太','マジックペン　細','ミリペン　0.05','ミリペン　0.1']);
 assert.deepEqual(LETTERING_EXPRESSIONS.map(x=>x.ja),['スケッチ','かすれ','インクだまり','フリーハンド','ふにゃふにゃ','かわいい','いきおい']);
 for(const list of [LETTERING_PENS,LETTERING_EXPRESSIONS]){assert.equal(new Set(list.map(x=>x.id)).size,list.length);for(const option of list)assert.match(option.en,/^[\x20-\x7e]+$/);}
 assert.deepEqual(handwrittenStyleExpressions(['energetic','scratchy','scratchy','unknown']),['scratchy','energetic']);
 assert.equal(handwrittenStylePrompt({text:'',shape:'handwritten'}),'');
 assert.equal(handwrittenStylePrompt({text:'台詞',shape:'normal',lettering_pen:'brush'}),'');
});
// 見込み/合格: コマと前景の選択が保存/公開YAMLを往復し、不明ID・非配列・重複をエラーにする。範囲: 保存/validator本体。
test('pen and multiple expressions persist and malformed options are rejected',()=>{
 const doc=fixture();
 for(const serialize of [toStoredMangaYaml,toMangaYaml]){
  const page=parseMangaYaml(serialize(doc)).manga.pages[0];
  assert.equal(page.panels[0].bubbles[0].lettering_pen,'g-pen-firm');
  assert.deepEqual(page.panels[0].bubbles[0].lettering_expressions,['scratchy','energetic']);
  assert.equal(page.page_overlay.bubbles[0].lettering_pen,'pencil-hb');
  assert.deepEqual(page.page_overlay.bubbles[0].lettering_expressions,['wobbly','cute']);
 }
 const issues=()=>validateManga(doc).filter(x=>/lettering_(pen|expressions)$/.test(x.path));
 assert.deepEqual(issues(),[]);
 const bubble=doc.manga.pages[0].panels[0].bubbles[0];bubble.lettering_pen='unknown';assert.equal(issues().length,1);delete bubble.lettering_pen;
 for(const bad of ['cute',['unknown'],['cute','cute']]){bubble.lettering_expressions=bad;assert.equal(issues().length,1);}
 delete bubble.lettering_expressions;assert.deepEqual(issues(),[]);
});
// 見込み/合格: 単品と修正のpayloadが選択英訳・原文だけを保持し、撮影後に設定が変われば再選択を要求。範囲: 生成入力の組立のみ。
test('individual and correction payloads carry fixed selections and reject a stale owner',()=>{
 const doc=fixture(),manga=doc.manga,panel=manga.pages[0].panels[0],owner=paintScene(panel,100,[]).owners.find(x=>x.key==='bubble-0');
 const plan=buildQwenGenerationPlan(manga,0,0,false,owner),expected='Lettering pen: G-pen with a slightly firm nib.\nLettering expression: broken, scratchy strokes.\nLettering expression: energetic strokes.';
 for(const prompt of [plan.prompt,qwenGenerationPrompt(plan,undefined,{kind:'paint'})]){assert.ok(prompt.includes(expected));assert.ok(!prompt.includes('HB pencil'));}
 assert.deepEqual(qwenGenerationPayload(plan,[]).literal_text,['ドン！']);
 const captured=structuredClone(owner);panel.bubbles[0].lettering_pen='brush';
 assert.throws(()=>buildQwenGenerationPlan(manga,0,0,false,captured),/選び直し/);
});
// 見込み/合格: 全体生成では別の文字の指定を混ぜず、前景/コマ番号で英訳を識別。通常台詞と非表示の描き文字には付けない。範囲: composition計画。
test('composition options stay with their target lettering',()=>{
 const {manga}=fixture(),before=structuredClone(manga);
 const page=buildQwenCompositionPlan(manga,0,0,'page');
 assert.ok(page.prompt.includes('Lettering pen for panel 1, text 1: G-pen with a slightly firm nib.'));
 assert.ok(page.prompt.includes('Lettering expression for panel 1, text 1: energetic strokes.'));
 assert.ok(page.prompt.includes('Lettering pen for page foreground, text 1: HB pencil.'));
 assert.ok(page.prompt.includes('Lettering expression for page foreground, text 1: cute lettering.'));
 assert.ok(!page.prompt.includes('Lettering pen for panel 1, text 2:'));
 assert.ok(!buildQwenCompositionPlan(manga,0,0,'panel').prompt.includes('HB pencil'));
 assert.deepEqual(manga,before);
 manga.pages[0].panels[0].bubbles[0].hidden=true;
 assert.ok(!buildQwenCompositionPlan(manga,0,0,'page').prompt.includes('G-pen with a slightly firm nib'));
});
