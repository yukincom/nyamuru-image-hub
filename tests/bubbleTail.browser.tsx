/** Visual regression fixture: production SVG component and geometry, no user document. */
import { render } from 'preact';
import BubbleShapeSvg from '../src/components/BubbleShapeSvg';
import { bubbleTailComposite } from '../src/lib/bubbleTail';
import { createBubbleBezier } from '../src/lib/bubbleBezier';
import { BUBBLE_MATERIALS } from '../src/lib/bubblePresetData';
import type { Bubble } from '../src/types';
import '../src/styles/global.css';
const cases: Array<{ label: string; shape: Bubble['shape']; bezier?: Bubble['bezier']; w: number; h: number; target: { x: number; y: number } }> = [
  { label: '標準オーバル・斜め', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 40, h: 55, target: { x: 60, y: 70 } },
  { label: '標準オーバル・下', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 45, h: 45, target: { x: 22.5, y: 70 } },
  { label: '横長オーバル・左', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 55, h: 30, target: { x: -10, y: 50 } },
  { label: '四角・角へ接続', shape: 'square', w: 38, h: 45, target: { x: 65, y: 65 } },
  { label: '作者素材・右', shape: BUBBLE_MATERIALS[0].shape, bezier: BUBBLE_MATERIALS[0].bezier, w: 45, h: 40, target: { x: 70, y: 20 } },
  { label: '削除後の本体', shape: 'normal', bezier: createBubbleBezier('ellipse'), w: 40, h: 55, target: { x: 20, y: 27.5 } },
];
render(<main style={{ padding: '24px', background: '#eef0f3', minHeight: '100vh', color: '#242735' }}>
  <h1 style={{fontSize:'22px'}}>本体としっぽの合成</h1><p>本体と先端は別データのまま。描画する外周だけを合体。</p>
  <div style={{display:'grid',gridTemplateColumns:'repeat(3, 280px)',gap:'16px'}}>
    {cases.map((item, i) => <section style={{background:'#fff',padding:'16px',borderRadius:'8px'}} key={item.label}>
      <h2 style={{fontSize:'15px'}}>{item.label}</h2>
      <div style={{position:'relative',height:'280px', marginLeft:'32px',marginTop:'16px','--bubble-line-width':'3px'}}>
        <div style={{position:'absolute',width:`${item.w*3}px`,height:`${item.h*3}px`,top:'12px'}}>
          <BubbleShapeSvg shape={item.shape} bezier={item.bezier} composite={bubbleTailComposite({x:0,y:0,w:item.w,h:item.h},item.target,item.shape,item.bezier) ?? undefined} />
        </div>
      </div>
      <small>{i===5?'しっぽなし':'接続部を拡大して確認'}</small>
    </section>)}
  </div>
</main>,document.getElementById('app')!);
