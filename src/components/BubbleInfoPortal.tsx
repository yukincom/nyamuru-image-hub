import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { useInspectorSelectionScroll } from './useInspectorSelectionScroll';

/** Relocate the existing inspector cards without adding a second editing state. */
export default function BubbleInfoPortal({ children, request, disabled = false, label }: {
  children: ComponentChildren; request: number; disabled?: boolean; label: string;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const ref = useInspectorSelectionScroll(host ? request : 0, '.text-settings-window-body', '.text-settings-tabs');
  useEffect(() => { setHost(document.getElementById('paint-bubble-info-slot')); }, []);
  return host ? createPortal(<div ref={ref} class="bubble-info-content" inert={disabled} aria-disabled={disabled} aria-label={label}>{children}</div>, host) : null;
}
