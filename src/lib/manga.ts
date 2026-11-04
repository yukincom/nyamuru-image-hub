import type { MangaDocument, Panel, Manga } from '../types';
import { parse, stringify } from 'yaml';
import { normalizeDocument, cloneDocument } from './document/normalize.ts';
import { toOmnyCatalogDocument, synchronizeCatalogReferences } from './catalogModel.ts';
import { restoreProvisionalScenarioText, detachResolvedScenarioLinks } from './scenario.ts';
import { initializePanelBackgrounds } from './panelContext.ts';
import { applyArtworkSettings, parseArtworkSettings, type ArtworkTarget, getArtworkSettings, getArtworkMode, compileArtworkRules, compileArtworkForMode } from './artworkRules.ts';
import { getFinishLayout, finishLayoutInstruction, getOutputSettings } from './finishLayout.ts';
import { toEnglishMangaFormat, toEnglishArtworkText, toEditableArtworkText } from './artworkEnglish.ts';
import { backgroundMaterialStages } from './background3d.ts';
import { OMAY_SPEC_NAME } from './document/schema.ts';

export function parseMangaYaml(source: string): MangaDocument {
  const value = parse(source) as MangaDocument;
  if (!value || typeof value !== 'object' || !value.manga) throw new Error('ルートに manga がありません');
  return normalizeDocument(value);
}

function stringifyMangaDocument(document: MangaDocument): string {
  return stringify(document, { indent: 2, lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' });
}

function withoutLocalAnalogImports(document: MangaDocument): MangaDocument {
  const next = cloneDocument(document);
  delete next.manga.scenario;
  next.manga.pages.forEach((page) => {
    page.panels.forEach((panel) => {
      // v1.13.2の短期間だけ保存されていた背景重複情報と旧コマ別書体を出力しない。
      const legacyPanel = panel as Panel & { font?: string; splitOverlapBackground?: true; splitOverlapBackgroundId?: string };
      delete legacyPanel.font;
      delete legacyPanel.splitOverlapBackground;
      delete legacyPanel.splitOverlapBackgroundId;
      panel.figures?.forEach((figure) => { delete figure.analogImport; delete figure.splitOverlap; delete figure.splitOverlapId; });
      panel.bubbles.forEach((bubble) => { delete bubble.scenarioMatch; delete bubble.analogTextImport; delete bubble.splitOverlap; delete bubble.splitOverlapId; delete bubble.anchor; });
      panel.screen_text?.forEach((screenText) => { delete screenText.splitOverlap; delete screenText.splitOverlapId; });
    });
    page.page_overlay?.figures?.forEach((figure) => { delete figure.analogImport; delete figure.splitOverlap; delete figure.splitOverlapId; });
    page.page_overlay?.bubbles?.forEach((bubble) => { delete bubble.scenarioMatch; delete bubble.analogTextImport; delete bubble.splitOverlap; delete bubble.splitOverlapId; delete bubble.anchor; });
    page.page_overlay?.screen_text?.forEach((screenText) => { delete screenText.splitOverlap; delete screenText.splitOverlapId; });
  });
  return next;
}

/** コピー・ダウンロード用OMNY。ローカル画像への参照は含めない。 */
export function toMangaYaml(document: MangaDocument): string {
  return stringifyMangaDocument(mangaExportDocument(document, true));
}

function mangaExportDocument(document: MangaDocument, includeArtwork: boolean): MangaDocument {
  const next = toOmnyCatalogDocument(document);
  restoreProvisionalScenarioText(next);
  initializePanelBackgrounds(next);
  delete (next.manga as Manga & { finish_layout?: unknown }).finish_layout;
  if (next.manga.artwork_settings) applyArtworkSettings(next.manga, next.manga.artwork_settings);
  const exported = { manga: { ...next.manga, finish_layout: getFinishLayout(next.manga) } };
  if (includeArtwork && next.manga.finish_settings) exported.manga.meta.style_notes = [...exported.manga.meta.style_notes.filter(note => note !== finishLayoutInstruction()), finishLayoutInstruction()];
  exported.manga.meta.format = toEnglishMangaFormat(exported.manga.meta.format);
  if (includeArtwork) {
    exported.manga.meta.style_notes = exported.manga.meta.style_notes.map(toEnglishArtworkText);
    exported.manga.layout_spec = toEnglishArtworkText(exported.manga.layout_spec);
  } else {
    delete (exported.manga.meta as Partial<Manga['meta']>).style_notes;
    delete (exported.manga as Partial<Manga>).layout_spec;
  }
  delete exported.manga.artwork_settings;
  return withoutLocalAnalogImports(exported);
}

/** ブラウザの自動保存専用。IndexedDBの切り抜き画像へ再接続するメタデータも保持する。 */
export function toStoredMangaYaml(document: MangaDocument): string {
  const next = cloneDocument(document);
  detachResolvedScenarioLinks(next);
  restoreProvisionalScenarioText(next);
  initializePanelBackgrounds(next);
  if (next.manga.artwork_settings) applyArtworkSettings(next.manga, next.manga.artwork_settings);
  synchronizeCatalogReferences(next);
  return stringifyMangaDocument(next);
}

// ストーリーOMNY：作画・演出ルール（style_notes）とレイアウト仕様（layout_spec）を含まないネームデータ
export function toSeparatedMangaYaml(document: MangaDocument): string {
  return stringifyMangaDocument(mangaExportDocument(document, false));
}

/** シリーズ共通人物・素材・作品分類・世界観を収めた、再利用可能なOMNYカタログ。 */
export function toSeriesCatalogMangaYaml(
  document: MangaDocument,
  options: { seriesSetting?: Manga['series_setting'] } = {},
): string {
  const next = toOmnyCatalogDocument(document, { includeSeriesImages: true });
  next.manga.meta.document_type = 'series-catalog';
  next.manga.meta.title = next.manga.meta.series.trim() || next.manga.meta.title;
  next.manga.meta.author = '';
  next.manga.meta.page_count = 0;
  next.manga.meta.style_notes = [];
  next.manga.layout_spec = '';
  delete next.manga.artwork_settings;
  next.manga.series_setting = structuredClone(options.seriesSetting ?? document.manga.series_setting);
  delete next.manga.finish_settings;
  delete next.manga.print_settings;
  delete (next.manga as Manga & { finish_layout?: unknown }).finish_layout;
  next.manga.setting = { location: '', time: '', weather: '', situation: '' };
  next.manga.characters = next.manga.characters.filter((character) => character.scope === 'series');
  next.manga.materials = next.manga.materials.filter((material) => material.scope === 'series');
  next.manga.background_stages=backgroundMaterialStages(document,'series').map(stage=>({...stage,seriesId:document.manga.meta.series_id}));
  if(!next.manga.background_stages.length)delete next.manga.background_stages;
  next.manga.pages = [];
  return stringifyMangaDocument(withoutLocalAnalogImports(next));
}

// 画像生成指示ファイル OMAY（Open Manga Artwork YAML）
export interface OmayDocument {
  spec_name: string;
  spec_version?: number | string;
  style_notes: string[];
  layout_spec: string;
  artwork_settings?: Manga['artwork_settings'];
}

export function parseOmayYaml(source: string): OmayDocument {
  const value = parse(source) as Partial<OmayDocument> | null;
  if (!value || typeof value !== 'object') throw new Error('作画設定のYAMLとして解釈できません');
  if (!Array.isArray(value.style_notes) || typeof value.layout_spec !== 'string') {
    throw new Error('style_notes（配列）と layout_spec（複数行テキスト）が必要です');
  }
  return {
    spec_name: typeof value.spec_name === 'string' ? value.spec_name : OMAY_SPEC_NAME,
    spec_version: typeof value.spec_version === 'number' || typeof value.spec_version === 'string' ? value.spec_version : undefined,
    style_notes: value.style_notes.map(note => toEditableArtworkText(String(note))),
    layout_spec: toEditableArtworkText(value.layout_spec),
    ...(value.artwork_settings !== undefined ? { artwork_settings: parseArtworkSettings(value.artwork_settings) } : {}),
  };
}

// OMAYの版数はOMNYのschema_versionと独立して管理するため、書き出しには刻印しない
export function toOmayYaml(document: MangaDocument, target?: ArtworkTarget): string {
  const settings = getArtworkSettings(document.manga);
  const mode = getArtworkMode(settings);
  const rules = target ? compileArtworkRules(settings, target) : compileArtworkForMode(settings, mode);
  const notes = target === 'character'
    ? [...rules.style_notes, '[const] Use finish_layout.format for the final color treatment and finish_layout.dpi for final placement. Its physical dimensions and trim_pixels / bleed_pixels describe the final page, not a full-page character image. Generate only the requested character; do not add page borders or text. Native model resolution is separate from the final print resolution.']
    : document.manga.finish_settings
      ? [...rules.style_notes.filter(note => note !== finishLayoutInstruction()), finishLayoutInstruction()]
      : rules.style_notes;
  return stringify({
    spec_name: OMAY_SPEC_NAME,
    style_notes: notes.map(toEnglishArtworkText),
    layout_spec: toEnglishArtworkText(rules.layout_spec),
    finish_layout: target === 'character' ? getOutputSettings(document.manga) : getFinishLayout(document.manga),
    ...(settings.mode ? { generation_mode: target ?? mode } : {}),
  }, { indent: 2, lineWidth: 0 });
}

/** 再編集用の控え。生成用OMAYとは分け、OFFの原本も保存する。 */
export function toArtworkSettingsYaml(document: MangaDocument): string {
  const settings = getArtworkSettings(document.manga);
  return stringify({ spec_name: OMAY_SPEC_NAME, ...compileArtworkRules(settings, 'integrated'), artwork_settings: settings }, { indent: 2, lineWidth: 0 });
}

function safeBaseName(title: string): string {
  return title.trim().replace(/[\\/:*?\"<>|]/g, '_') || 'manga-name';
}

// エディター内部文書（ルール込み）
export function safeFileName(title: string): string {
  return `${safeBaseName(title)}.yaml`;
}

// ストーリーOMNY（作品情報・素材・ネーム）
export function omnyFileName(title: string): string {
  return safeFileName(title);
}

export function omayFileName(title: string, purpose: 'settings' | 'generation' = 'generation'): string {
  return `${safeBaseName(title)}-${purpose}.yaml`;
}

export {
  STORAGE_KEY,
  NDM_SCHEMA_NAME,
  CURRENT_NDM_SCHEMA_VERSION,
  OMAY_SPEC_NAME,
  BUBBLE_SHAPES,
  ANCHORS,
  ANCHOR_LABELS,
  FIGURE_SIZES,
  FIGURE_SIZE_LABELS,
  FIGURE_ROLES,
  FIGURE_ROLE_LABELS,
  MATERIAL_SCOPES,
  BLEED_EDGES,
  SCREEN_TEXT_ORIENTATIONS,
  MAX_PANELS_PER_PAGE,
  DEFAULT_PANEL_FRAME_LINE_WIDTH_MM,
  withPanelFrameLineWidthStyleNote,
  panelFrameLineWidthFromStyleNotes,
  withPanelGutterStyleNote,
  panelGuttersFromStyleNotes,
} from './document/schema.ts';
export { cloneDocument, newPanel, newPage, normalizeDocument } from './document/normalize.ts';
export { validateManga } from './document/validate.ts';
