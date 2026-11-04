import type { MangaDocument, Panel, MangaPage, Manga, Bubble } from '../../types';
import { type CanvasSize, DEFAULT_CANVAS, innerFrameBounds, DEFAULT_PANEL_GUTTERS } from '../canvasGeometry.ts';
import { LEGACY_OMNY_SCHEMA_NAME, NDM_SCHEMA_NAME, panelFrameLineWidthFromStyleNotes, DEFAULT_PANEL_FRAME_LINE_WIDTH_MM, panelGuttersFromStyleNotes, normalizedFrameLineWidth, normalizedPanelGutters, migrateLegacyStyleNotes, withoutLegacyPanelSettingNotes, migrateLegacyLayoutSpec } from './schema.ts';
import { isDetectedFigureCharacter, ensureSystemMobCharacter } from '../systemCharacters.ts';
import { normalizedUniqueStrings, normalizedRecognition, CHARACTER_REFERENCE_VIEW_VALUES, normalizedCharacterSourceImage } from './characterNormalization.ts';
import { validateScenarioSource, detachResolvedScenarioLinks, restoreProvisionalScenarioText } from '../scenario.ts';
import { toEditableMangaFormat, toEditableArtworkText } from '../artworkEnglish.ts';
import { finishLayoutInstruction, validateFinishSettings } from '../finishLayout.ts';
import { normalizedBubbleLineWidth, DEFAULT_BUBBLE_LINE_WIDTH_MM } from '../bubblePresentation.ts';
import { validatePrintData } from '../printSettings.ts';
import { applyArtworkSettings } from '../artworkRules.ts';
import { normalizePanelLayer } from '../panelLayers.ts';
import { validateHumanPoseSelection } from '../humanPoseSelection.ts';
import { isPropPlacement, synchronizeCatalogReferences } from '../catalogModel.ts';
import { materialBubbleBezier } from '../bubblePresetData.ts';
import { normalizeBubbleConnections } from '../bubbleConnections.ts';
import { validateImagePlacements } from '../imagePlacement.ts';
import { initializePanelBackgrounds } from '../panelContext.ts';

export function cloneDocument(document: MangaDocument): MangaDocument {
  return structuredClone(document);
}

export function newPanel(id: number, offset = 0, canvas: CanvasSize = DEFAULT_CANVAS): Panel {
  const inner = innerFrameBounds(canvas);
  const height = Math.min(55, inner.h);
  return {
    id,
    shape: { type: 'rect', x: inner.x, y: inner.y + Math.max(0, Math.min(offset, inner.h - height)), w: inner.w, h: height },
    bg: 1,
    bubbles: [{ text: '新しいセリフ', shape: 'normal' }],
    action: null,
  };
}

export function newPage(pageNumber: number, canvas: CanvasSize = DEFAULT_CANVAS): MangaPage {
  return { page: pageNumber, canvas: { ...canvas, unit: 'mm' }, panels: [newPanel(1, 0, canvas)] };
}

export function normalizeDocument(document: MangaDocument): MangaDocument {
  const next = cloneDocument(document);
  const manga = next.manga;
  // 書き出し時の派生値を編集用原本として残さない。次の書き出しで正本から再計算する。
  delete (manga as Manga & { finish_layout?: unknown }).finish_layout;
  if (!manga.schema_name || manga.schema_name === LEGACY_OMNY_SCHEMA_NAME) manga.schema_name = NDM_SCHEMA_NAME;
  manga.pages ??= [];
  manga.characters ??= [];
  manga.materials ??= [];
  // 「人物あたり」は検出枠が使うシステム名であり、ユーザーの人物台帳には保存しない。
  manga.characters = manga.characters.filter((character) => !isDetectedFigureCharacter(character));
  ensureSystemMobCharacter(manga.characters);
  manga.characters.forEach((character) => {
    // 性別は未設定も不正値もそのまま保ち、検証で入力誤りを示す。
    character.scope = character.scope === 'series' ? 'series' : 'episode';
    character.aliases = normalizedUniqueStrings(character.aliases, 24);
    const rawHeadCount = Number(character.default_proportion?.head_count);
    if (Number.isFinite(rawHeadCount)) {
      character.default_proportion = {
        head_count: rawHeadCount,
      };
    } else {
      delete character.default_proportion;
    }
    character.recognition = normalizedRecognition(character.recognition);
    if (!character.recognition) delete character.recognition;
    if (character.scope !== 'series') {
      delete character.catalog_id;
      delete character.primary_material_catalog_id;
    }
  });
  manga.materials.forEach((material) => {
    material.scope ??= 'episode';
    if (!CHARACTER_REFERENCE_VIEW_VALUES.includes(material.view as (typeof CHARACTER_REFERENCE_VIEW_VALUES)[number])) delete material.view;
    material.source_image = normalizedCharacterSourceImage(material.source_image);
    if (!material.source_image) delete material.source_image;
  });
  manga.meta.series ??= '';
  if (manga.scenario) manga.scenario = validateScenarioSource(manga.scenario);
  const legacySeriesCatalog = manga.meta.document_type === undefined && manga.meta.format === 'series-catalog';
  manga.meta.document_type = manga.meta.document_type === 'series-catalog' || legacySeriesCatalog ? 'series-catalog' : 'story';
  if (legacySeriesCatalog) manga.meta.format = 'カラー漫画';
  manga.meta.format = toEditableMangaFormat(manga.meta.format);
  manga.meta.series_id ??= '';
  manga.meta.episode_number ??= '';
  manga.meta.episode_id ??= '';
  manga.meta.author ??= '';
  manga.meta.style_notes ??= [];
  manga.meta.style_notes = manga.meta.style_notes.map(toEditableArtworkText).filter(note => note !== finishLayoutInstruction());
  manga.meta.bubble_line_width_mm = normalizedBubbleLineWidth(Number(manga.meta.bubble_line_width_mm ?? DEFAULT_BUBBLE_LINE_WIDTH_MM));
  const legacyFrameWidth = panelFrameLineWidthFromStyleNotes(manga.meta.style_notes, DEFAULT_PANEL_FRAME_LINE_WIDTH_MM);
  const legacyGutters = panelGuttersFromStyleNotes(manga.meta.style_notes, DEFAULT_PANEL_GUTTERS);
  manga.meta.panel_frame_width_mm = normalizedFrameLineWidth(Number(manga.meta.panel_frame_width_mm ?? legacyFrameWidth));
  manga.meta.panel_gutter_row_mm = normalizedPanelGutters({
    rowGapMm: Number(manga.meta.panel_gutter_row_mm ?? legacyGutters.rowGapMm),
    columnGapMm: Number(manga.meta.panel_gutter_column_mm ?? legacyGutters.columnGapMm),
  }).rowGapMm;
  manga.meta.panel_gutter_column_mm = normalizedPanelGutters({
    rowGapMm: Number(manga.meta.panel_gutter_row_mm),
    columnGapMm: Number(manga.meta.panel_gutter_column_mm ?? legacyGutters.columnGapMm),
  }).columnGapMm;
  manga.meta.style_notes = migrateLegacyStyleNotes(withoutLegacyPanelSettingNotes(manga.meta.style_notes));
  manga.layout_spec = migrateLegacyLayoutSpec(toEditableArtworkText(manga.layout_spec ?? ''));
  if (manga.finish_settings) manga.finish_settings = validateFinishSettings(manga.finish_settings);
  if (manga.print_settings) manga.print_settings = validatePrintData(manga.print_settings);
  if (manga.artwork_settings) applyArtworkSettings(manga, manga.artwork_settings);
  manga.series_setting ??= {
    genre: '', target_audience: '', adult_content: false, situation: '', location: '', time: '', weather: '',
  };
  manga.series_setting.genre ??= '';
  manga.series_setting.target_audience ??= '';
  manga.series_setting.adult_content = manga.series_setting.adult_content === true;
  manga.series_setting.situation ??= '';
  manga.series_setting.location ??= '';
  manga.series_setting.time ??= '';
  manga.series_setting.weather ??= '';
  manga.setting ??= { location: '', time: '', weather: '', situation: '' };
  manga.setting.location ??= '';
  manga.setting.time ??= '';
  manga.setting.weather ??= '';
  manga.setting.situation ??= '';
  const settingWithMaterialLists = manga.setting as Manga['setting'] & { background?: unknown; props?: unknown };
  const materialKeys = new Set(manga.materials.map((material) => material.key));
  const collectSettingMaterials = (values: unknown, type: 'background' | 'prop') => {
    if (!Array.isArray(values)) return;
    values.map(String).map((value) => value.trim()).filter(Boolean).forEach((key) => {
      if (materialKeys.has(key)) return;
      manga.materials.push({ key, type, scope: 'episode', keywords: [key], note: '' });
      materialKeys.add(key);
    });
  };
  collectSettingMaterials(settingWithMaterialLists.background, 'background');
  collectSettingMaterials(settingWithMaterialLists.props, 'prop');
  delete settingWithMaterialLists.background;
  delete settingWithMaterialLists.props;
  manga.pages.forEach((page, pageIndex) => {
    page.page ??= pageIndex + 1;
    page.canvas ??= { w: 210, h: 297, unit: 'mm' };
    page.panels ??= [];
    const pageLayer=normalizePanelLayer(page.layer);
    if(pageLayer?.directLocked||pageLayer?.artOrder?.length)page.layer={...(pageLayer.directLocked?{directLocked:true}:{}),...(pageLayer.artOrder?.length?{artOrder:pageLayer.artOrder}:{})};
    else delete page.layer;
    page.panels.forEach((panel, panelIndex) => {
      if(panel.layer !== undefined)panel.layer=normalizePanelLayer(panel.layer);
      // IDは読み順そのもの。重複や飛び番を受け入れず配列順で必ず自動採番する。
      panel.id = panelIndex + 1;
      panel.bubbles ??= [];
      const legacyPanel = panel as Panel & { font?: string; splitOverlapBackground?: true; splitOverlapBackgroundId?: string };
      delete legacyPanel.font;
      delete legacyPanel.splitOverlapBackground;
      delete legacyPanel.splitOverlapBackgroundId;
      panel.figures?.forEach((figure) => {
        if (figure.human_pose !== undefined) validateHumanPoseSelection(figure.human_pose);
        if (isPropPlacement(figure)) {
          delete figure.size;
          delete figure.role;
          return;
        }
        figure.size ??= 'bust-up';
        figure.role ??= 'main';
      });
      panel.bubbles.forEach((bubble) => { delete (bubble as Bubble & { delivery?: unknown }).delivery; if(bubble.hidden!==true)delete bubble.hidden; const material=materialBubbleBezier(bubble.shape); if(bubble.bezier===undefined&&material)bubble.bezier=structuredClone(material); });
      normalizeBubbleConnections(panel.bubbles);
      panel.action ??= null;
      const backgroundDescription = panel.background_description;
      if (panel.bg === -1 || typeof backgroundDescription !== 'string') {
        delete panel.background_description;
      } else {
        panel.background_description = backgroundDescription.trim();
      }
    });
    if (page.page_overlay) {
      page.page_overlay.frame = false;
      page.page_overlay.layer = 'above_panel_frames';
      page.page_overlay.figures ??= [];
      page.page_overlay.bubbles ??= [];
      page.page_overlay.figures.forEach((figure) => {
        if (figure.human_pose !== undefined) validateHumanPoseSelection(figure.human_pose);
        if (isPropPlacement(figure)) {
          delete figure.size;
          delete figure.role;
          return;
        }
        figure.size ??= 'bust-up';
        figure.role ??= 'main';
      });
      page.page_overlay.bubbles.forEach((bubble) => { delete (bubble as Bubble & { delivery?: unknown }).delivery; if(bubble.hidden!==true)delete bubble.hidden; const material=materialBubbleBezier(bubble.shape); if(bubble.bezier===undefined&&material)bubble.bezier=structuredClone(material); });
      normalizeBubbleConnections(page.page_overlay.bubbles);
      page.page_overlay.screen_text?.forEach((screenText) => { if(screenText.orientation===undefined)screenText.orientation='horizontal'; });
    }
  });
  validateImagePlacements(next);
  synchronizeCatalogReferences(next);
  detachResolvedScenarioLinks(next);
  restoreProvisionalScenarioText(next);
  initializePanelBackgrounds(next);
  return next;
}
