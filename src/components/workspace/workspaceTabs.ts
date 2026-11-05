import { BookOpen, Box, ClipboardCheck, LayoutPanelTop, Settings2, UsersRound } from 'lucide-preact';
import type { WorkspaceTab } from '../../types';

export const TABS: {
  id: WorkspaceTab;
  label: string;
  icon: typeof LayoutPanelTop;
}[] = [
  { id: 'storyboard', label: 'ネーム', icon: LayoutPanelTop },
  { id: 'meta', label: '作品情報', icon: BookOpen },
  { id: 'setting', label: '舞台設定', icon: Settings2 },
  { id: 'characters', label: '登場人物', icon: UsersRound },
  { id: 'props', label: '小道具', icon: Box },
  { id: 'coverage', label: 'シナリオ', icon: ClipboardCheck },
];

export function initialTab(): WorkspaceTab {
  try {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested === 'materials') return 'props';
    if (requested && TABS.some((item) => item.id === requested)) return requested as WorkspaceTab;
  } catch { /* no URL access */ }
  return 'storyboard';
}
