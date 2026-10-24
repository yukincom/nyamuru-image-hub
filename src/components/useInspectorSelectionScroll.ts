import { useEffect, useRef } from 'preact/hooks';

/** 紙面・レイヤーから選んだ項目を、コマ情報の固定見出しの直下へ揃える。 */
export function useInspectorSelectionScroll(request: number) {
  const inspectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (request <= 0) return;
    const inspector = inspectorRef.current;
    const scroller = inspector?.closest<HTMLElement>('.inspector-content');
    const header = inspector?.querySelector<HTMLElement>('.inspector-sticky-head');
    const card = inspector?.querySelector<HTMLElement>('.selectable-card.is-selected');
    if (!scroller || !header || !card) return;

    const frame = requestAnimationFrame(() => {
      const scrollerTop = scroller.getBoundingClientRect().top;
      const cardTop = card.getBoundingClientRect().top;
      const target = scroller.scrollTop + cardTop - scrollerTop - header.getBoundingClientRect().height;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroller.scrollTo({ top: Math.max(0, target), behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [request]);

  return inspectorRef;
}
