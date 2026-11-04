import type { PcFontFamily } from './bubbleFonts.ts';

export const INNER_FRAME_SNAP_KEY = 'manga-name-studio.inner-frame-snap.v1';
export const PANEL_SYNC_KEY = 'manga-name-studio.panel-sync.v1';
const LEGACY_PANEL_SYNC_KEY = 'manga-name-studio.panel-snap.v1';
export const PANEL_GAP_SNAP_KEY = 'manga-name-studio.panel-gap-snap.v1';
export const SHOW_GUIDES_KEY = 'manga-name-studio.show-guides.v1';
export const SPREAD_VIEW_KEY = 'manga-name-studio.spread-view.v2';
const LEGACY_SPREAD_VIEW_KEY = 'manga-name-studio.spread-view.v1';
export const PERSIST_ANALOG_ASSETS_KEY = 'manga-name-studio.persist-analog-assets.v1';
const EPISODE_WORKSPACE_ROOTS_KEY = 'manga-name-studio.episode-workspace-roots.v1';
const PC_FONT_CATALOG_KEY = 'manga-name-studio.pc-font-catalog.v1';

export function storedPcFontCatalog(): PcFontFamily[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PC_FONT_CATALOG_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PcFontFamily => Boolean(
      value && typeof value === 'object'
      && typeof (value as PcFontFamily).family === 'string'
      && ((value as PcFontFamily).displayName === undefined || typeof (value as PcFontFamily).displayName === 'string')
      && ((value as PcFontFamily).weights === undefined || Array.isArray((value as PcFontFamily).weights) && (value as PcFontFamily).weights!.every(option=>option&&typeof option.label==='string'&&Number.isInteger(option.value)&&option.value>=1&&option.value<=1000))
      && ['japanese', 'other', 'unreadable'].includes((value as PcFontFamily).support),
    ));
  } catch { /* private mode or an old malformed value */ }
  return [];
}

export function rememberPcFontCatalog(families: readonly PcFontFamily[]): void {
  try { localStorage.setItem(PC_FONT_CATALOG_KEY, JSON.stringify(families)); } catch { /* private mode */ }
}

export function savedWorkspaceRoot(key: string): string {
  try {
    const value = JSON.parse(localStorage.getItem(EPISODE_WORKSPACE_ROOTS_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const roots = value as Record<string, unknown>;
    const exact = roots[key];
    return typeof exact === 'string' ? exact : typeof roots._last === 'string' ? roots._last : '';
  } catch { /* private mode or an old malformed value */ }
  return '';
}

export function rememberWorkspaceRoot(key: string, directory: string): void {
  if (!directory) return;
  try {
    const value = JSON.parse(localStorage.getItem(EPISODE_WORKSPACE_ROOTS_KEY) || '{}');
    const roots = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    roots[key] = directory;
    roots._last = directory;
    localStorage.setItem(EPISODE_WORKSPACE_ROOTS_KEY, JSON.stringify(roots));
  } catch { /* private mode */ }
}

export function initialInnerFrameSnap(): boolean {
  try {
    return localStorage.getItem(INNER_FRAME_SNAP_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

export function initialPanelSync(): boolean {
  try {
    const saved = localStorage.getItem(PANEL_SYNC_KEY);
    if (saved !== null) {
      localStorage.removeItem(LEGACY_PANEL_SYNC_KEY);
      return saved !== '0';
    }
    const legacy = localStorage.getItem(LEGACY_PANEL_SYNC_KEY);
    const enabled = legacy !== '0';
    localStorage.setItem(PANEL_SYNC_KEY, enabled ? '1' : '0');
    localStorage.removeItem(LEGACY_PANEL_SYNC_KEY);
    return enabled;
  } catch { /* private mode */ }
  return true;
}

export function initialPanelGapSnap(): boolean {
  try {
    return localStorage.getItem(PANEL_GAP_SNAP_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

export function initialShowGuides(): boolean {
  try {
    return localStorage.getItem(SHOW_GUIDES_KEY) !== '0';
  } catch { /* private mode */ }
  return true;
}

export function initialSpreadView(): boolean {
  try {
    const saved = localStorage.getItem(SPREAD_VIEW_KEY);
    if (saved !== null) return saved !== '0';
    // 旧版は見開きOFFが初期値だったため引き継がず、今回の作品向け初期値へ更新する。
    localStorage.removeItem(LEGACY_SPREAD_VIEW_KEY);
  } catch { /* private mode */ }
  return true;
}

export function initialPersistAnalogAssets(): boolean {
  try {
    return localStorage.getItem(PERSIST_ANALOG_ASSETS_KEY) === '1';
  } catch { /* private mode */ }
  return false;
}
