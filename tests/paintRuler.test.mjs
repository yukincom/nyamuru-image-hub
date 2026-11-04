// 紙面上の直線拘束と画面pxの当たり判定を検査する。UI・Undo・筆圧の描画はブラウザーfixtureで確認する。
import assert from 'node:assert/strict';
import test from 'node:test';
import {hitPaintRuler,paintRulerProjection,paintRulerScreen,paintRulerAngle} from '../src/lib/paintRuler.ts';
import {appendPaintSamples} from '../src/lib/paintGesture.ts';
import {PaintSmoother} from '../src/lib/paintStroke.ts';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const ruler=(mode='parallel',angle=0)=>({mode,angle,origin:{x:50,y:50},enabled:true});

// 各筆の開始位置を通る平行な直線になる。筆圧・時刻と開始点を保ち、斜めの手ぶれを取り除けば合格。
test('parallel marks keep separate starts, pressure and timestamps',()=>{
  const guide=ruler('parallel',Math.PI/4);
  for(const start of [{x:10,y:20},{x:35,y:7}]){
    const project=paintRulerProjection(guide,start),sample={x:start.x+20,y:start.y+10,pressure:.31,time:19};
    const result=project(sample);
    close(result.x,start.x+15);close(result.y,start.y+15);
    assert.equal(result.pressure,.31);assert.equal(result.time,19);assert.deepEqual(project(start),start);
  }
});

// 集中線は開始点と焦点を通る直線上に乗る。焦点の反対側へ跨いでも同じ軸を保てば合格。
test('radial marks converge on the focus and may cross it',()=>{
  const project=paintRulerProjection(ruler('radial'),{x:80,y:90});
  const a=project({x:50,y:50}),b=project({x:17,y:19});
  close(a.x,50);close(a.y,50);
  close((b.x-50)*4,(b.y-50)*3);
  assert.ok(b.x<50&&b.y<50);
});

// 焦点上から始めた一筆は最初の移動で方向を決める。後の横ぶれで軸が変わらず、NaNも出なければ合格。
test('a mark starting at the focus establishes one stable axis',()=>{
  const project=paintRulerProjection(ruler('radial'),{x:50,y:50});
  assert.deepEqual(project({x:50,y:50}),{x:50,y:50});
  assert.deepEqual(project({x:50,y:60}),{x:50,y:60});
  assert.deepEqual(project({x:70,y:90}),{x:50,y:90});
});

// 定規の後の変更は開始済みの筆へ遡及しない。スナップOFFは座標・メタデータをそのまま返せば合格。
test('each mark captures its ruler and disabled snapping leaves samples intact',()=>{
  const guide=ruler(),project=paintRulerProjection(guide,{x:20,y:30});
  guide.angle=Math.PI/2;guide.origin.x=99;guide.enabled=false;
  assert.deepEqual(project({x:60,y:80}),{x:60,y:30});
  const sample={x:20,y:51,pressure:.2,time:23};
  assert.equal(paintRulerProjection(guide,{x:0,y:0})(sample),sample);
  assert.equal(paintRulerProjection(null,{x:0,y:0})(sample),sample);
});

// ○の外径は12 CSS px。倍率・向きによらず半径6px以内だけが切替対象、四角い外接枠は対象外なら合格。
test('the toggle hit region follows its visible circular edge at any zoom',()=>{
  for(const mode of ['parallel','radial'])for(const zoom of [.5,2,8]){
    const guide=ruler(mode,Math.PI/3),scale={x:zoom,y:zoom*.8},center=paintRulerScreen(guide,scale).toggle;
    assert.equal(hitPaintRuler(guide,{x:center.x+5.99,y:center.y},scale),'toggle');
    assert.notEqual(hitPaintRuler(guide,{x:center.x+6.01,y:center.y},scale),'toggle');
    assert.notEqual(hitPaintRuler(guide,{x:center.x+5,y:center.y+5},scale),'toggle');
  }
});

// 平行線の帯は線そのものに重ならなくても回転操作できる。帯外は掴まず、中央の菱形は移動なら合格。
test('the entire direction band is grabbable, while the focus moves',()=>{
  const guide=ruler(),scale={x:3,y:3},c=paintRulerScreen(guide,scale).origin;
  assert.equal(hitPaintRuler(guide,c,scale),'move');
  assert.equal(hitPaintRuler(guide,{x:c.x+100,y:c.y+4},scale),'rotate');
  assert.equal(hitPaintRuler(guide,{x:c.x+100,y:c.y+8.99},scale),'rotate');
  assert.equal(hitPaintRuler(guide,{x:c.x+100,y:c.y+9.01},scale),undefined);
});

// 集中線は短い方向線の内側全体を掴める。円の内側で線と重ならない点も移動対象なら合格。
test('radial handles include the space between the rays',()=>{
  const guide=ruler('radial'),scale={x:1,y:1};
  assert.equal(hitPaintRuler(guide,{x:61,y:57},scale),'move');
  assert.equal(hitPaintRuler(guide,{x:76,y:50},scale),undefined);
});

// Shift回転は原稿上の45度刻みへ丸める。45/90/135/180度を両方向から得られ、通常回転は連続なら合格。
test('parallel rotation snaps to 45, 90, 135 and 180 degrees',()=>{
  for(const degrees of [45,90,135,180])for(const offset of [-10,10]){
    const a=(degrees+offset)*Math.PI/180,p={x:50+20*Math.cos(a),y:50+20*Math.sin(a)};
    const snapped=paintRulerAngle({x:50,y:50},p,true,0);
    close(Math.cos(snapped),Math.cos(degrees*Math.PI/180));close(Math.sin(snapped),Math.sin(degrees*Math.PI/180));
    close(Math.cos(paintRulerAngle({x:50,y:50},p,false,0)),Math.cos(a));
  }
  const origin={x:50,y:50};assert.equal(paintRulerAngle(origin,origin,true,.3),.3);
});

// 定規付き直線へShiftが来ても水平・垂直へ二重拘束しない。coalescedとreleaseを通し、既存の筆圧補完を維持する。
test('ruler projection precedes smoothing and overrides shape Shift only for that stroke',()=>{
  const project=paintRulerProjection(ruler('parallel',Math.PI/4),{x:10,y:10});
  const stroke={tool:'pen',color:'#000000',size:8,points:[{x:10,y:10,pressure:.2,time:0}]};
  const event={type:'pointerup',pointerType:'pen',pressure:0,shiftKey:true,clientX:40,clientY:28,timeStamp:20,
    getCoalescedEvents:()=>[{type:'pointermove',pointerType:'pen',pressure:.8,clientX:30,clientY:25,timeStamp:10}]};
  const point=e=>({...project({x:e.clientX,y:e.clientY}),pressure:e.pressure,time:e.timeStamp});
  appendPaintSamples(stroke,new PaintSmoother(0),event,point,false);
  assert.equal(stroke.points.length,3);assert.equal(stroke.points.at(-1).pressure,.8);
  for(const p of stroke.points)close(p.x,p.y);
  const line={...stroke,tool:'line',points:[stroke.points[0]]};
  appendPaintSamples(line,new PaintSmoother(0),event,point,false);
  close(line.points[1].x,line.points[1].y);assert.notEqual(line.points[1].y,10);
});
