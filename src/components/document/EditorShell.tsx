import type { ComponentChildren } from 'preact';

export function EditorShell({ eyebrow, title, description, action, children, embedded = false }: { eyebrow: string; title: string; description: string; action?: ComponentChildren; children: ComponentChildren; embedded?: boolean }) {
  return <div class={`document-editor${embedded ? ' is-embedded' : ''}`}>{!embedded && <div class="document-editor-head"><div><span class="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><div class="document-head-actions">{action}</div></div>}<div class="document-editor-body">{children}</div></div>;
}
