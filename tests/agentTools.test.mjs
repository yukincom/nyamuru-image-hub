import assert from 'node:assert/strict';
import test from 'node:test';
import {createEmptyWorkspaceDocument} from '../src/lib/workspaceStartup.ts';
import {agentEditorSnapshot,createAgentRevision,parseAgentBubbleEdit,prepareAgentBubbleEdit,selectedAgentBubble} from '../src/lib/agentTools.ts';
import {createBubbleBezier} from '../src/lib/bubbleBezier.ts';
import {bubbleTailTargetPoint} from '../src/lib/bubbleTail.ts';

const target={pageIndex:0,panelIndex:0,index:0,kind:'bubble',overlay:false};
function fixture(){const document=createEmptyWorkspaceDocument();document.manga.pages[0].panels=[{id:1,shape:{type:'rect',x:20,y:20,w:170,h:230},bg:0,action:'',
  figures:[{name:'春',bbox:{x:80,y:90,w:30,h:70}}],bubbles:[{text:'原文を残す。',speaker:'春',speakerId:'spring',shape:'normal',bbox:{x:120,y:40,w:40,h:50},tail:{x:1.4,y:-.2},clip_to_panel:true,join_to:2},
    {text:'続き',shape:'normal',clip_to_panel:true}]}];return document;}
const request=changes=>({revision:'r1',target,changes});
const edit=(document,changes)=>prepareAgentBubbleEdit(document,target,'r1',request(changes));

test('contour edits preserve dialogue role, text, tail, joins and the input document',()=>{
  for(const changes of [{preset:'cloud'},{bezier:createBubbleBezier('rounded')}]){
    const before=fixture(),saved=structuredClone(before),after=edit(before,changes);
    assert.deepEqual(before,saved);
    const b=after.manga.pages[0].panels[0].bubbles[0];assert.ok(b.bezier);delete b.bezier;
    assert.deepEqual(b,saved.manga.pages[0].panels[0].bubbles[0]);
  }
});
test('selected native geometry and material catalog are exposed without artwork bytes',()=>{
  const before=fixture();before.manga.pages[0].panels[0].bubbles[0].paint_overlay={kind:'x',data:'PRIVATE_PIXEL_DATA'};
  const snap=agentEditorSnapshot(before,'r1',0,target);
  assert.equal(snap.selected_bubble.text,'原文を残す。');assert.deepEqual(snap.selected_bubble.bbox,{x:120,y:40,w:40,h:50});
  assert.equal(snap.materials.length,45);assert.ok(snap.materials.some(material=>material.id==='kumo_01'));assert.ok(!snap.materials.some(material=>material.id==='thought_01'));assert.ok(!JSON.stringify(snap).includes('PRIVATE_PIXEL_DATA'));
  assert.deepEqual(selectedAgentBubble(2,5,{type:'bubble',index:3,scope:'page_overlay'}),{pageIndex:2,panelIndex:0,index:3,kind:'bubble',overlay:true});
  assert.equal(selectedAgentBubble(0,0,{type:'figure',index:0}),null);
});
test('character selection and current-page figures remain visible to conversation',()=>{
  const before=fixture(),figure=before.manga.pages[0].panels[0].figures[0];figure.refId='koyuki';figure.name='小雪';
  figure.artwork={data:'PRIVATE_PIXEL_DATA',sourcePath:'/PRIVATE_PROJECT_PATH'};
  before.manga.characters=[{localId:'koyuki',name:'小雪',role:'主人公',visual_prompt:'黒髪',aliases:['こゆき'],scope:'episode'}];
  const snap=agentEditorSnapshot(before,'r1',0,null,null,{panelIndex:0,selection:{type:'figure',index:0}});
  assert.equal(snap.selected_bubble,null);assert.deepEqual(snap.selected_element,{type:'figure',index:0,scope:'panel'});
  assert.equal(snap.selected_figure.name,'小雪');assert.equal(snap.selected_figure.character.visual_prompt,'黒髪');
  assert.equal(snap.selected_figure.generation_available,true);assert.equal(snap.active_panel_number,1);
  assert.deepEqual(snap.page_panels,[{number:1,id:1,figures:[{index:0,name:'小雪',kind:'person'}]}]);
  assert.ok(!JSON.stringify(snap).includes('PRIVATE_'));
  const noSelection=agentEditorSnapshot(before,'r2',0,null,null,{panelIndex:0,selection:null});
  assert.equal(noSelection.selected_element,null);assert.equal(noSelection.selected_figure,null);assert.equal(noSelection.page_panels[0].figures[0].name,'小雪');
  figure.artwork.locked=true;
  assert.equal(agentEditorSnapshot(before,'r3',0,null,null,{panelIndex:0,selection:{type:'figure',index:0}}).selected_figure.generation_available,false);
});
test('tail tip uses paper mm and may be outside the speaker box',()=>{
  const before=fixture(),after=edit(before,{tail_point:{x:130,y:78}}),b=after.manga.pages[0].panels[0].bubbles[0];
  assert.ok(b.tail.x>1&&b.tail.y<0);
  const tip=bubbleTailTargetPoint(before.manga.pages[0].panels[0].figures[0].bbox,b.tail);
  assert.ok(Math.abs(tip.x-130)<.04&&Math.abs(tip.y-78)<.04);
  assert.equal(edit(before,{tail_mode:'none'}).manga.pages[0].panels[0].bubbles[0].tail,false);
  assert.equal('tail' in edit(before,{tail_mode:'auto'}).manga.pages[0].panels[0].bubbles[0],false);
});
test('invalid, stale, hidden, locked and different targets cannot partially mutate a manuscript',()=>{
  const before=fixture(),saved=structuredClone(before);
  assert.throws(()=>prepareAgentBubbleEdit(before,target,'r2',request({preset:'cloud'})),/変わりました/);
  assert.throws(()=>prepareAgentBubbleEdit(before,{...target,index:1},'r1',request({preset:'cloud'})),/選択/);
  assert.throws(()=>edit(before,{preset:'cloud',tail_point:{x:-1,y:10}}),/紙面内/);
  assert.deepEqual(before,saved);
  before.manga.pages[0].panels[0].bubbles[0].hidden=true;assert.throws(()=>edit(before,{preset:'cloud'}),/非表示/);
  delete before.manga.pages[0].panels[0].bubbles[0].hidden;
  before.manga.pages[0].panels[0].bubbles[0].paint_overlay={locked:true};assert.throws(()=>edit(before,{preset:'cloud'}),/ロック/);
  for(const changes of [{text:'勝手な書き換え'},{preset:'cloud',material:'nomal_01'},{bbox:{x:0,y:0,w:NaN,h:10}},
    {tail_mode:'bad'},{tail_mode:'auto',tail_point:{x:80,y:60}},{tail_point:{x:Infinity,y:0}},
    {bezier:{nodes:[{x:0,y:0},{x:100,y:0},{x:50,y:100,handleIn:{x:Infinity,y:0}}]}}])assert.throws(()=>parseAgentBubbleEdit(request(changes)));
});
test('custom node changes affect only requested outline data; revisions detect state changes',()=>{
  const before=fixture(),outline=createBubbleBezier('ellipse');before.manga.pages[0].panels[0].bubbles[0].bezier=outline;
  const patch=structuredClone(outline);patch.nodes[0].handleOut={x:10,y:0};
  const after=edit(before,{bezier:patch});assert.deepEqual(after.manga.pages[0].panels[0].bubbles[0].bezier,patch);
  assert.deepEqual(before.manga.pages[0].panels[0].bubbles[0].bezier,outline);
  const revision=createAgentRevision();assert.equal(revision('a'),'r1');assert.equal(revision('a'),'r1');assert.equal(revision('b'),'r2');
});
test('node patches preserve unmentioned coordinates exactly and reject invalid or conflicting updates',()=>{
  const before=fixture();before.manga.pages[0].panels[0].bubbles[0].bezier=createBubbleBezier('ellipse');
  const outline=structuredClone(before.manga.pages[0].panels[0].bubbles[0].bezier);
  const after=edit(before,{node_updates:[{index:0,handleOut:{x:0,y:-40}}]});
  const expected=structuredClone(outline);expected.nodes[0].handleOut={x:0,y:-40};
  assert.deepEqual(after.manga.pages[0].panels[0].bubbles[0].bezier,expected);
  assert.deepEqual(before.manga.pages[0].panels[0].bubbles[0].bezier,outline);
  const outside=edit(before,{node_updates:[{index:0,x:-80,handleOut:{x:-120,y:190}}]});
  assert.equal(outside.manga.pages[0].panels[0].bubbles[0].bezier.nodes[0].x,-80);
  for(const changes of [{node_updates:[{index:4,x:50}]},{node_updates:[{index:0,handleOut:{x:Infinity,y:0}}]},
    {node_updates:[{index:0,x:20},{index:0,y:20}]},{node_updates:[{index:0,x:20}],preset:'cloud'},
    {node_updates:[{index:0,x:NaN}]},{node_updates:[{index:0}]}])assert.throws(()=>edit(before,changes));
  assert.deepEqual(before.manga.pages[0].panels[0].bubbles[0].bezier,outline);
});
