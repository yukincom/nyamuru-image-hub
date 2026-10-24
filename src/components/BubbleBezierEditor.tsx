import { useRef, useState } from 'preact/hooks';
import type { Bubble, BubbleShape, VectorPoint } from '../types';
import { addBubbleBezierNode, BUBBLE_BEZIER_PRESETS, bubbleBezierData, bubbleBezierPath, createBubbleBezier, fitBubbleBezier, isBubbleBezier, MAX_BUBBLE_NODES, moveBubbleBezierNode, type BubbleBezier } from '../lib/bubbleBezier.ts';
import { convertVectorNodes } from '../lib/vectorGeometry.ts';
import '../styles/bubbleBezier.css';

interface Props {
  bubble: Bubble;
  onChange: (outline: Bubble['bezier'], shape?: BubbleShape) => void;
}
type Handle = 'handleIn' | 'handleOut';
type Drag = { pointerId: number; index: number; handle?: Handle; before: BubbleBezier; current: BubbleBezier };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export default function BubbleBezierEditor({ bubble, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<BubbleBezier | null>(null);
  const [selected, setSelected] = useState(0);
  const saved = isBubbleBezier(bubble.bezier) ? bubble.bezier : null;
  const outline = draft ?? saved;
  const index = Math.min(selected, (outline?.nodes.length ?? 1) - 1);
  const node = outline?.nodes[index];
  const commit = (next: BubbleBezier) => { const fitted = fitBubbleBezier(next); if (isBubbleBezier(fitted)) onChange(fitted); };
  const position = (event: PointerEvent): VectorPoint | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const start = (event: PointerEvent, at: number, handle?: Handle) => {
    if (!outline || event.button !== 0 || drag.current) return;
    event.preventDefault(); event.stopPropagation(); setSelected(at);
    drag.current = { pointerId: event.pointerId, index: at, handle, before: outline, current: outline };
    svg.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const action = drag.current, p = position(event);
    if (!action || action.pointerId !== event.pointerId || !p) return;
    event.preventDefault(); event.stopPropagation();
    const anchor = action.before.nodes[action.index];
    const point = action.handle
      ? { x: anchor.x + clamp(p.x-anchor.x, -100, 100), y: anchor.y + clamp(p.y-anchor.y, -100, 100) }
      : { x: clamp(p.x, 0, 100), y: clamp(p.y, 0, 100) };
    action.current = moveBubbleBezierNode(action.before, action.index, point, action.handle, event.altKey);
    setDraft(action.current);
  };
  const finish = (event: PointerEvent, cancel = false) => {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    event.stopPropagation(); drag.current = null;
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    setDraft(null);
    if (!cancel && JSON.stringify(action.before) !== JSON.stringify(action.current)) commit(action.current);
  };
  const moveAnchor = (point: VectorPoint) => {
    if (outline) commit(moveBubbleBezierNode(outline, index, { x: clamp(point.x, 0, 100), y: clamp(point.y, 0, 100) }));
  };
  return <details class="bubble-bezier-editor" onClick={event => event.stopPropagation()}>
    <summary>ベジェで輪郭を作る・編集{saved ? '（適用中）' : ''}</summary>
    <div class="bubble-bezier-presets" role="group" aria-label="ベジェ輪郭のプリセット">
      {BUBBLE_BEZIER_PRESETS.map(([preset, label]) => <button type="button" onClick={() => {
        setSelected(0); setDraft(null);
        onChange(createBubbleBezier(preset), preset === 'cloud' ? 'thought' : preset === 'burst' ? 'flash' : preset === 'rounded' ? 'square' : 'normal');
      }}>{label}</button>)}
    </div>
    <p class="bubble-bezier-help">形を選んで作成。四角は輪郭の点、丸は曲がりを調整するハンドルです。Alt / Option で片側だけ動かせます。点とハンドルは点線の枠内で調整します。</p>
    {outline && node && <>
      <svg ref={svg} class="bubble-bezier-canvas" viewBox="-20 -20 140 140" aria-label="ベジェ輪郭の編集" onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => {
        if (event.key === 'Escape' && drag.current) { drag.current = null; setDraft(null); event.stopPropagation(); }
      }}>
        <rect class="bubble-bezier-box" x="0" y="0" width="100" height="100" />
        <path class="bubble-bezier-outline" d={bubbleBezierData(outline)} />
        {(['handleIn', 'handleOut'] as const).map(handle => {
          const h = node[handle];
          return h && <g>
            <line class="bubble-bezier-handle-line" x1={node.x} y1={node.y} x2={node.x+h.x} y2={node.y+h.y} />
            <circle class="bubble-bezier-handle" cx={node.x+h.x} cy={node.y+h.y} r="2.6" onPointerDown={event => start(event, index, handle)} />
          </g>;
        })}
        {outline.nodes.map((n, i) => <rect class={`bubble-bezier-node ${i === index ? 'is-selected' : ''}`} x={n.x-2.2} y={n.y-2.2} width="4.4" height="4.4" onPointerDown={event => start(event, i)} />)}
      </svg>
      <div class="bubble-bezier-coordinates">
        <label>点<select aria-label="編集する輪郭の点" value={index} onChange={event => setSelected(Number(event.currentTarget.value))}>{outline.nodes.map((_, i) => <option value={i}>{i+1}</option>)}</select></label>
        {(['x', 'y'] as const).map(axis => <label>{axis.toUpperCase()}<input aria-label={`輪郭の点 ${axis.toUpperCase()}`} type="number" min="0" max="100" step="1" value={Math.round(node[axis]*10)/10} onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) moveAnchor({ x: node.x, y: node.y, [axis]: value });
        }} /></label>)}
      </div>
      <div class="bubble-bezier-actions">
        <button type="button" disabled={outline.nodes.length >= MAX_BUBBLE_NODES} onClick={() => { commit(addBubbleBezierNode(outline, index)); setSelected(index+1); }}>次の区間に点を追加</button>
        <button type="button" disabled={outline.nodes.length <= 3} onClick={() => { commit({ nodes: outline.nodes.filter((_, i) => i !== index) }); setSelected(Math.max(0, index-1)); }}>点を削除</button>
        <button type="button" onClick={() => commit({ nodes: convertVectorNodes(bubbleBezierPath(outline), true, index).nodes })}>滑らかに</button>
        <button type="button" onClick={() => commit({ nodes: convertVectorNodes(bubbleBezierPath(outline), false, index).nodes })}>角にする</button>
        <button type="button" onClick={() => onChange(undefined)}>標準の形に戻す</button>
      </div>
      <p class="bubble-bezier-help">ページ上で文字の余白としっぽの位置を確認してください。変更は「元に戻す」で戻せます。</p>
    </>}
  </details>;
}
