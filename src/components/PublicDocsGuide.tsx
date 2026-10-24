import { useEffect, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import AgentWorkflowGuide from './AgentWorkflowGuide';
import GenerationPromptGuide from './GenerationPromptGuide';
import NyamurutanGuide from './NyamurutanGuide';
import SchemaGuide from './SchemaGuide';
import type { DocsLanguage } from '../types';

const DOCS_LANG_KEY = 'manga-name-studio.docs-lang.v1';

type PublicGuideKind = 'prompt' | 'workflow' | 'ndm' | 'nyamurutan';

interface Props {
  kind: PublicGuideKind;
}

export default function PublicDocsGuide({ kind }: Props) {
  const [lang, setLang] = useState<DocsLanguage>('ja');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(DOCS_LANG_KEY) === 'en') setLang('en');
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const changeLang = (next: DocsLanguage) => {
    setLang(next);
    try { localStorage.setItem(DOCS_LANG_KEY, next); } catch { /* private mode */ }
  };

  const commonProps = { lang, onChangeLang: changeLang, onNotify: setToast };

  return <div class="public-docs-guide">
    {kind === 'prompt' && <GenerationPromptGuide {...commonProps} />}
    {kind === 'workflow' && <AgentWorkflowGuide {...commonProps} onOpenMeta={() => { window.location.href = '/?tab=meta'; }} />}
    {kind === 'ndm' && <SchemaGuide {...commonProps} />}
    {kind === 'nyamurutan' && <NyamurutanGuide {...commonProps} />}
    {toast && <div class="toast"><span>{toast}</span><button type="button" onClick={() => setToast(null)} aria-label="通知を閉じる"><X size={15} /></button></div>}
  </div>;
}
