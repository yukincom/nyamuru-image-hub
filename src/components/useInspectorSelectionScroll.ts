import { useEffect, useRef } from 'preact/hooks';

/** Scroll only the owning inspector, keeping the manuscript viewport still. */
export function scrollInspectorSelection(inspector: HTMLElement | null, scrollerSelector = '.inspector-content', headerSelector = '.inspector-sticky-head') {
  const scroller = inspector?.closest<HTMLElement>(scrollerSelector);
  const header = scroller?.querySelector<HTMLElement>(headerSelector);
  const card = inspector?.querySelector<HTMLElement>('.selectable-card.is-selected');
  if (!scroller || !header || !card || !scroller.getClientRects().length || !card.getClientRects().length) return;
  const frame = requestAnimationFrame(() => {
    const scrollerTop = scroller.getBoundingClientRect().top;
    const cardTop = card.getBoundingClientRect().top;
    const target = scroller.scrollTop + cardTop - scrollerTop - header.getBoundingClientRect().height;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: Math.max(0, target), behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  return () => cancelAnimationFrame(frame);
}

/** 紙面・レイヤーから選んだ項目を、各パレットの見出しの直下へ揃える。 */
export function useInspectorSelectionScroll(request: number, scrollerSelector = '.inspector-content', headerSelector = '.inspector-sticky-head') {
  const inspectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (request <= 0) return;
    return scrollInspectorSelection(inspectorRef.current, scrollerSelector, headerSelector);
  }, [request, scrollerSelector, headerSelector]);

  return inspectorRef;
}
