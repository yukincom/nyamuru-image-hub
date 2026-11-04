import type { AnalogFigureImport, AnalogTextImport, MangaDocument } from '../../types.ts';
import { createEmptyWorkspaceDocument } from '../../lib/workspaceStartup.ts';
import { newPage } from '../../lib/manga.ts';
import { resizePageCanvas } from '../../lib/pageCanvas.ts';
import { inferPanelGutters, DEFAULT_PANEL_GUTTERS } from '../../lib/canvasGeometry.ts';
import { applyPanelTemplate, type PanelTemplate } from '../../lib/panelTemplates.ts';
import { attachDetectedFiguresToPage, attachRecognizedTextToPage } from '../../lib/localBridge.ts';
import { emptyNewSeriesSetting } from '../../lib/newProjectSettings.ts';
import { createSystemMobCharacter } from '../../lib/systemCharacters.ts';
import type { DetectedPageLayout, NewLayoutItem } from '../../lib/newLayoutPreview.ts';
import type { ImportedStorySetting } from '../../lib/settingTextImport.ts';
import type { PrintSetup } from '../../lib/printSettings.ts';

interface PageInputs {
  detectedLayouts: DetectedPageLayout[];
  analyzedItems: NewLayoutItem[];
  template?: PanelTemplate;
  figureImportsByItem: Map<string, Map<string, AnalogFigureImport>>;
  textImportsByItem: Map<string, Map<string, AnalogTextImport>>;
  newPrintSetup: PrintSetup;
  newLayoutRowGapMm: number;
  newLayoutColumnGapMm: number;
  newLayoutFrameLineWidthMm: number;
  newWorkTitle: string;
  newSeriesName: string;
  newSeriesId: string;
  newEpisodeNumber: string;
  freshEpisodeId: string;
  characterDraft: MangaDocument | null;
  newWorkSetting: ImportedStorySetting;
}

export function buildNewProjectPages({
  detectedLayouts, analyzedItems, template, figureImportsByItem, textImportsByItem,
  newPrintSetup, newLayoutRowGapMm, newLayoutColumnGapMm, newLayoutFrameLineWidthMm,
  newWorkTitle, newSeriesName, newSeriesId, newEpisodeNumber, freshEpisodeId, characterDraft, newWorkSetting,
}: PageInputs) {
  const empty = createEmptyWorkspaceDocument();
  let importedFigureCount = 0;
  let importedTextCount = 0;
  let reviewTextCount = 0;
  const pages = detectedLayouts.length ? detectedLayouts.map((detectedLayout, index) => {
    const page = newPage(index + 1);
    page.panels = detectedLayout.analysis.detectedPanels.map((shape, panelIndex) => ({
      id: panelIndex + 1,
      shape: structuredClone(shape),
      bg: 1,
      bubbles: [],
      action: null,
    }));
    const ownerPanels = new Map(detectedLayout.analysis.detectedPanelIds.map((id, panelIndex) => [id, page.panels[panelIndex]]));
    if (detectedLayout.analysis.detectedFigures.length) {
      importedFigureCount += attachDetectedFiguresToPage(
        page,
        detectedLayout.analysis.detectedFigures,
        figureImportsByItem.get(detectedLayout.sourceItemId),
        detectedLayout.analysis.sourceFrame,
        ownerPanels,
      ).added;
    }
    if (detectedLayout.analysis.ocrLines.length) {
      const attached = attachRecognizedTextToPage(
        page,
        detectedLayout.analysis.ocrLines,
        textImportsByItem.get(detectedLayout.sourceItemId),
        detectedLayout.analysis.sourceFrame,
        ownerPanels,
      );
      importedTextCount += attached.added;
      reviewTextCount += attached.needsReview;
    }
    return page;
  }) : Array.from({ length: newPrintSetup.purpose === 'illustration' ? 1 : newPrintSetup.body_pages }, (_, index) => newPage(index + 1, analyzedItems[0]?.analysis ? undefined : { w: newPrintSetup.width_mm, h: newPrintSetup.height_mm }));
  if (!detectedLayouts.length) {
    if (template) {
      for (const page of pages) {
        page.panels = [];
        applyPanelTemplate(page, template);
      }
      const analysis = analyzedItems[0]?.analysis;
      if (analysis?.detectedFigures.length) {
        importedFigureCount += attachDetectedFiguresToPage(
          pages[0],
          analysis.detectedFigures,
          figureImportsByItem.get(analyzedItems[0].id),
          analysis.sourceFrame,
        ).added;
      }
      if (analysis?.ocrLines.length) {
        const attached = attachRecognizedTextToPage(
          pages[0],
          analysis.ocrLines,
          textImportsByItem.get(analyzedItems[0].id),
          analysis.sourceFrame,
        );
        importedTextCount += attached.added;
        reviewTextCount += attached.needsReview;
      }
    } else {
      for (const page of pages) page.panels[0].bubbles = [];
    }
  }
  // Imported positions are in the analysis canvas, including OCR retained with a template.
  // Map them together before print setup; pages already created at the target size are unchanged.
  for (const page of pages) resizePageCanvas(page, { w: newPrintSetup.width_mm, h: newPrintSetup.height_mm }, 'inner-frame');
  const creationGutters = detectedLayouts.length
    ? { rowGapMm: newLayoutRowGapMm, columnGapMm: newLayoutColumnGapMm }
    : inferPanelGutters(
      pages[0].panels.map((item) => item.shape),
      template ? { rowGapMm: 5, columnGapMm: 5 } : DEFAULT_PANEL_GUTTERS,
    );
  const fresh: MangaDocument = {
    manga: {
      schema_name: empty.manga.schema_name,
      schema_version: empty.manga.schema_version,
      meta: {
        document_type: 'story',
        title: newWorkTitle.trim(),
        series: newSeriesName.trim(),
        series_id: newSeriesName.trim() ? (newSeriesId || crypto.randomUUID()) : '',
        episode_number: newEpisodeNumber.trim(),
        episode_id: freshEpisodeId,
        author: '', format: empty.manga.meta.format, page_count: pages.length,
        reading_direction: empty.manga.meta.reading_direction,
        text_orientation: empty.manga.meta.text_orientation,
        font: empty.manga.meta.font,
        bubble_line_width_mm: empty.manga.meta.bubble_line_width_mm,
        panel_frame_width_mm: newLayoutFrameLineWidthMm,
        panel_gutter_row_mm: creationGutters.rowGapMm,
        panel_gutter_column_mm: creationGutters.columnGapMm,
        style_notes: [],
      },
      layout_spec: '',
      series_setting: characterDraft
        ? structuredClone(characterDraft.manga.series_setting)
        : emptyNewSeriesSetting(),
      setting: structuredClone(newWorkSetting),
      characters: characterDraft
        ? structuredClone(characterDraft.manga.characters)
        : [createSystemMobCharacter()],
      materials: characterDraft
        ? structuredClone(characterDraft.manga.materials)
        : [],
      pages,
    },
  };
  return { fresh, importedFigureCount, importedTextCount, reviewTextCount };
}
