import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { X } from 'lucide-preact';
import catalog from '../../scripts/expression_catalog.json';
import reference from '../content/expression-reference.json';
import './ExpressionDictionary.css';

const images = import.meta.glob<string>('../assets/expression-dictionary/*.png', { eager: true, query: '?url', import: 'default' });
const boxes = new Map(reference.entries.map(entry => [entry.id, entry.box]));
const groups = reference.categories.map(category => ({
  ...category, image: images[`../assets/expression-dictionary/${category.image}`],
  entries: catalog.entries.filter(entry => entry.category === category.id),
}));

export default function ExpressionDictionary() {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<{ key:number; x:number; y:number; failed:boolean }>();
  const request = useRef(0);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(undefined), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  useEffect(() => () => { request.current += 1; }, []);
  const close = () => {
    request.current += 1;
    dialog.current?.close(); setOpen(false); setCopied(undefined);
    trigger.current?.focus({ preventScroll: true });
  };
  const copy = async (event:MouseEvent, prompt:string) => {
    const key = ++request.current, box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.detail ? event.clientX : box.x + box.width / 2;
    const y = event.detail ? event.clientY : box.y + box.height / 2;
    let failed = false;
    try { await navigator.clipboard.writeText(prompt); } catch { failed = true; }
    if (key === request.current) setCopied({ key, x, y, failed });
  };
  return <>
    <button type="button" class="primary-button expression-dictionary-open" ref={trigger} onClick={event => { event.stopPropagation(); setOpen(true); }}>表情辞書</button>
    {open && createPortal(<dialog ref={dialog} class="expression-dictionary" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); close(); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}>
      <header class="expression-dictionary-head"><h2 id={`${id}-title`}>表情辞書</h2>
        <button type="button" class="icon-button" aria-label="表情辞書を閉じる" onClick={close}><X size={18} /></button>
      </header>
      <div class="expression-dictionary-list">
        {groups.map(group => <section key={group.id} aria-labelledby={`${id}-${group.id}`}>
          <h3 id={`${id}-${group.id}`}>{group.name}</h3>
          <div class="expression-dictionary-grid">{group.entries.map(entry => {
            const [x, y, right, bottom] = boxes.get(entry.id)!;
            return <button type="button" class="expression-dictionary-card" key={entry.id} data-expression-id={entry.id}
              onClick={event => void copy(event, entry.prompt)}>
              <svg viewBox={`${x} ${y} ${right-x} ${bottom-y}`} aria-hidden="true">
                <defs><clipPath id={`${id}-${entry.id}-crop`}><rect x={x} y={y} width={right-x} height={bottom-y} /></clipPath></defs>
                <image href={group.image} width={group.width} height={group.height} clipPath={`url(#${id}-${entry.id}-crop)`} />
              </svg>
              <span lang="en">{entry.prompt}</span>
            </button>;
          })}</div>
        </section>)}
      </div>
      {copied && <span key={copied.key} class="expression-dictionary-copied" role={copied.failed?'alert':'status'}
        style={{ left:`clamp(70px, ${copied.x}px, calc(100vw - 70px))`, top:`max(42px, ${copied.y}px)` }}>
        {copied.failed?'コピーできませんでした':'コピー'}
      </span>}
    </dialog>, document.body)}
  </>;
}
