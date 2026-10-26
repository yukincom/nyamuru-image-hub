import { createPortal } from 'preact/compat';
import { useId, useLayoutEffect, useEffect, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, X } from 'lucide-preact';
import type { FigureSize } from '../types';
import { FIGURE_SIZE_LABELS } from '../lib/manga';
import catImageUrl from '../assets/figure-framing-cat.png?url';
import './FigureSizePicker.css';

// Shared artwork with nested frames; the boundaries explain the UI, not a model guarantee.
const GUIDES: Record<FigureSize, { crop: string; code: string; name: string }> = {
  long: { crop: '-190 -130 1404 1820', code: 'LS', name: 'ロングショット' },
  full: { crop: '145 65 735 1390', code: 'FF', name: 'フルフィギュア' },
  'knee-up': { crop: '180 70 665 1180', code: 'KS', name: 'ニーショット' },
  'waist-up': { crop: '245 70 535 900', code: 'WS', name: 'ウエストショット' },
  'bust-up': { crop: '290 70 445 620', code: 'BS', name: 'バストショット' },
  'shoulder-up': { crop: '290 70 445 510', code: 'US', name: 'アップ' },
  face: { crop: '290 95 445 455', code: 'CU', name: 'クローズアップ' },
  'face-detail': { crop: '330 310 360 150', code: 'BCU', name: '大アップ' },
  hand: { crop: '690 835 180 200', code: '手', name: '手' },
  foot: { crop: '525 1210 210 180', code: '足', name: '足' },
  part: { crop: '525 500 245 330', code: '部分', name: '身体の一部' },
};

type CutFrame = { size: FigureSize; x: number; y: number; width: number; height: number };
const BODY_FRAMES: CutFrame[] = [
  { size: 'long', x: 8, y: 2, width: 206, height: 251 },
  { size: 'full', x: 32, y: 25, width: 164, height: 208 },
  { size: 'knee-up', x: 48, y: 29, width: 132, height: 168 },
  { size: 'waist-up', x: 62, y: 30, width: 104, height: 125 },
];
const FACE_FRAMES: CutFrame[] = [
  { size: 'bust-up', x: 8, y: 6, width: 206, height: 247 },
  { size: 'shoulder-up', x: 18, y: 13, width: 186, height: 202 },
  { size: 'face', x: 28, y: 24, width: 166, height: 156 },
  { size: 'face-detail', x: 47, y: 110, width: 128, height: 52 },
];
const PART_FRAMES: CutFrame[] = [
  { size: 'hand', x: 149, y: 143, width: 28, height: 31 },
  { size: 'foot', x: 126, y: 195, width: 30, height: 28 },
  { size: 'part', x: 126, y: 97, width: 34, height: 46 },
];
// The diagram's labels run from the closest crop at the top to the widest at the bottom.
const ORDERED_FRAMES = [...BODY_FRAMES].reverse().concat([...FACE_FRAMES].reverse());
const OPTION_ORDER = [...ORDERED_FRAMES, ...PART_FRAMES].map(({ size }) => size);

function CutIllustration({ size }: { size: FigureSize }) {
  return <svg viewBox={GUIDES[size].crop} preserveAspectRatio="xMidYMid meet" aria-hidden="true" class="figure-cut-illustration">
    <image href={catImageUrl} width="1024" height="1536" />
  </svg>;
}

function NestedDiagram({ detail, value, preview, onChoose, onPreview }: {
  detail: boolean; value: FigureSize; preview: FigureSize; onChoose: (size: FigureSize) => void; onPreview: (size: FigureSize) => void;
}) {
  const clipId = useId();
  const frames = detail ? FACE_FRAMES : BODY_FRAMES;
  const selected = [...frames, ...(detail ? [] : PART_FRAMES)].find((frame) => frame.size === value);
  const highlighted = [...frames, ...(detail ? [] : PART_FRAMES)].find((frame) => frame.size === preview);
  const visibleFrames = [...frames, ...(selected && !frames.includes(selected) ? [selected] : [])];
  const portrait = detail ? { x: -111, y: -24, width: 440, height: 660 } : { x: 54, y: 28, width: 142, height: 213 };
  const hitAt = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return undefined;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    // Resolve geometry, independently of which selected outline is painted on top.
    return [...visibleFrames].sort((a, b) => a.width * a.height - b.width * b.height).find((frame) =>
      point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height);
  };
  return <svg viewBox="0 0 222 258" class="figure-nested-diagram" aria-hidden="true"
    onPointerMove={(event) => onPreview(hitAt(event.currentTarget, event.clientX, event.clientY)?.size ?? value)}
    onPointerLeave={() => onPreview(value)}
    onClick={(event) => { const hit = hitAt(event.currentTarget, event.clientX, event.clientY); if (hit) onChoose(hit.size); }}>
    {highlighted && <defs><clipPath id={clipId}><rect x={highlighted.x} y={highlighted.y} width={highlighted.width} height={highlighted.height} /></clipPath></defs>}
    <image href={catImageUrl} {...portrait} opacity=".27" />
    {highlighted && <image href={catImageUrl} {...portrait} clipPath={`url(#${clipId})`} />}
    {[...visibleFrames.filter((frame) => frame !== highlighted), ...(highlighted ? [highlighted] : [])].map((frame) => {
      // BCU sits inside CU: put its label at the upper right, away from CU/US below.
      const labelX = frame.size === 'face-detail' ? frame.x + frame.width - 36 : frame.x + 3;
      const labelY = frame.size === 'face-detail' ? frame.y + 2 : frame.y + frame.height - 17;
      return <g key={frame.size} class={`figure-nested-frame ${preview === frame.size ? 'is-preview' : ''}`}>
        <rect x={frame.x} y={frame.y} width={frame.width} height={frame.height} class="figure-nested-outline" />
        <g onClick={(event) => { event.stopPropagation(); onChoose(frame.size); }}>
          <rect x={labelX} y={labelY} width={GUIDES[frame.size].code.length > 2 ? 34 : 26} height="16" class="figure-nested-label-bg" />
          <text x={labelX + 3} y={labelY + 12}>{GUIDES[frame.size].code}</text>
        </g>
      </g>;
    })}
  </svg>;
}

export default function FigureSizePicker({ value, onChange }: { value: FigureSize; onChange: (value: FigureSize) => void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const options = useRef<Partial<Record<FigureSize, HTMLButtonElement>>>({});
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(value);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const dismiss = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = () => { setDraft(value); setPreview(value); setOpen(true); };
  const choose = (size: FigureSize) => { setDraft(size); setPreview(size); };
  const confirm = () => { if (draft !== value) onChange(draft); dismiss(true); };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = popup.current.getBoundingClientRect();
    const below = anchor.bottom + 6;
    const top = below + box.height <= window.innerHeight - 12 ? below : anchor.top - box.height - 6;
    setPosition({
      left: Math.max(12, Math.min(anchor.right - box.width, window.innerWidth - box.width - 12)),
      top: Math.max(12, Math.min(top, window.innerHeight - box.height - 12)),
    });
    options.current[value]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) dismiss();
    };
    const resize = () => dismiss();
    const scroll = (event: Event) => { if (event.target instanceof Node && !popup.current?.contains(event.target)) dismiss(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', resize);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('resize', resize);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  const navigate = (event: KeyboardEvent, size: FigureSize) => {
    const index = OPTION_ORDER.indexOf(size);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? OPTION_ORDER.length - 1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % OPTION_ORDER.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + OPTION_ORDER.length - 1) % OPTION_ORDER.length : null;
    if (next !== null) { event.preventDefault(); options.current[OPTION_ORDER[next]]?.focus(); }
  };

  return <div class="figure-size-picker">
    <button ref={trigger} type="button" class="figure-size-trigger" aria-label={`描写範囲：${FIGURE_SIZE_LABELS[value]}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={(event) => { event.stopPropagation(); open ? dismiss() : show(); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}>
      <CutIllustration size={value} /><span>{FIGURE_SIZE_LABELS[value]}</span><ChevronDown size={14} />
    </button>
    {open && createPortal(<div ref={popup} id={id} class="figure-size-popover" role="dialog" aria-labelledby={`${id}-title`}
      style={position} onClick={(event) => event.stopPropagation()} onPointerLeave={() => setPreview(draft)}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); dismiss(true); } }}>
      <div class="figure-size-popover-head">
        <div><strong id={`${id}-title`}>描写範囲を選ぶ</strong><p>絵や名称で選択し、「確定」で反映します</p></div>
        <button type="button" class="figure-size-close" aria-label="描写範囲の選択を閉じる" onClick={() => dismiss(true)}><X size={17} /></button>
      </div>
      <div class="figure-size-diagrams">
        <div><NestedDiagram detail={false} value={draft} preview={preview} onChoose={choose} onPreview={setPreview} /><span class="figure-diagram-caption">全身から腰まで</span></div>
        <div><NestedDiagram detail value={draft} preview={preview} onChoose={choose} onPreview={setPreview} /><span class="figure-diagram-caption">胸から顔の一部まで</span></div>
      </div>
      <div class="figure-size-options" role="group" aria-label="描写範囲の候補">
        {ORDERED_FRAMES.map(({ size }) => <button type="button" key={size} ref={(element) => { if (element) options.current[size] = element; }}
          class={`figure-size-option ${draft === size ? 'is-selected' : ''} ${preview === size ? 'is-preview' : ''}`} aria-pressed={draft === size}
          aria-label={`${GUIDES[size].name}：${FIGURE_SIZE_LABELS[size]}`} data-figure-size={size}
          onClick={() => choose(size)} onFocus={() => setPreview(size)} onPointerEnter={() => setPreview(size)} onPointerLeave={() => setPreview(draft)} onKeyDown={(event) => navigate(event, size)}>
          <b>{GUIDES[size].code}</b><span>{GUIDES[size].name}<small>{size === 'long' ? '周囲を含む全身' : size === 'face-detail' ? '顔の一部' : FIGURE_SIZE_LABELS[size]}</small></span>
          {draft === size && <Check size={13} />}
        </button>)}
      </div>
      <div class="figure-size-parts" role="group" aria-label="部分の描写範囲">
        {PART_FRAMES.map(({ size }) => <button type="button" key={size} ref={(element) => { if (element) options.current[size] = element; }}
          class={`figure-size-option ${draft === size ? 'is-selected' : ''} ${preview === size ? 'is-preview' : ''}`} aria-pressed={draft === size}
          aria-label={FIGURE_SIZE_LABELS[size]} data-figure-size={size}
          onClick={() => choose(size)} onFocus={() => setPreview(size)} onPointerEnter={() => setPreview(size)} onPointerLeave={() => setPreview(draft)} onKeyDown={(event) => navigate(event, size)}>
          <span>{FIGURE_SIZE_LABELS[size]}</span>{draft === size && <Check size={13} />}
        </button>)}
      </div>
      <div class="figure-size-footer">
        <span>選択：{GUIDES[draft].name}</span>
        <button type="button" class="figure-size-cancel" onClick={() => dismiss(true)}>キャンセル</button>
        <button type="button" class="figure-size-confirm" onClick={confirm}>確定</button>
      </div>
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </div>;
}
