import type { BBox, Bubble, MangaDocument, Panel, PanelShape } from '../types.ts';
import { compileArtworkRules, getWorkNegativePrompt } from './artworkRules.ts';
import { toOmnyCatalogDocument } from './catalogModel.ts';
import { currentGenerationPreferences } from './generationPreferences.ts';
import { cloudGenerationFileName, omayFileName, omnyFileName, toOmayYaml, toSeparatedMangaYaml } from './manga.ts';

export interface CloudRenderOptions {
  includeBackground?: boolean;
  includeBubbles?: boolean;
  includeHandwritten?: boolean;
  includeScreenText?: boolean;
  includePanelBorders?: boolean;
  exportReferenceImages?: boolean;
}

export interface AgentWorkflowYamlFile {
  fileName: string;
  yaml: string;
  mimeType?: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function compactBox(box?: BBox): BBox | undefined {
  if (!box) return undefined;
  return { x: round1(box.x), y: round1(box.y), w: round1(box.w), h: round1(box.h) };
}

function compactPanelShape(shape: PanelShape): Record<string, unknown> {
  if (shape.type === 'polygon') {
    return { type: 'polygon', points: shape.points.map(([x, y]) => [round1(x), round1(y)]) };
  }
  return { type: 'rect', x: round1(shape.x), y: round1(shape.y), w: round1(shape.w), h: round1(shape.h) };
}

function cloudBubbleKind(bubble: Bubble): 'thought' | 'monologue' | 'narration' | 'handwritten' | 'speech' {
  if (bubble.tail_style === 'thinking') return 'thought';
  if (bubble.monologue) return 'monologue';
  if (bubble.shape === 'handwritten' || bubble.lettering_description) return 'handwritten';
  if (bubble.shape === 'square' && bubble.tail === false) return 'narration';
  return 'speech';
}

function cloudPanelBackground(panel: Panel, location: string): Record<string, unknown> {
  const custom = panel.background_description?.trim();
  let mode: 'plain' | 'abstract' | 'setting' | 'detailed' = 'setting';
  let description = '';
  if (panel.bg === -1) {
    mode = 'plain';
    description = 'plain pure white background only (no scenery, no tone, no shading)';
  } else if (panel.bg === 0) {
    mode = 'abstract';
    description = custom || 'abstract emotional background (no concrete scenery)';
  } else if (panel.bg === 2) {
    mode = 'detailed';
    description = custom || location || 'detailed scene background';
  } else {
    mode = 'setting';
    description = custom || location || 'scene setting background';
  }
  return {
    mode,
    description,
    ...(panel.assets?.length ? { material_keys: panel.assets } : {}),
  };
}

/**
 * Build a compact, self-explanatory JSON structure for cloud/external-agent
 * image generation without bezier coordinates or internal editor metadata.
 */
export function buildCloudGenerationSpec(source: MangaDocument, options?: CloudRenderOptions): Record<string, unknown> {
  const cloudPrefs = currentGenerationPreferences().cloud;
  const includeBackground = options?.includeBackground ?? cloudPrefs.includeBackground;
  const includeBubbles = options?.includeBubbles ?? cloudPrefs.includeBubbles;
  const includeHandwritten = options?.includeHandwritten ?? cloudPrefs.includeHandwritten;
  const includeScreenText = options?.includeScreenText ?? cloudPrefs.includeScreenText;
  const includePanelBorders = options?.includePanelBorders ?? cloudPrefs.includePanelBorders;
  const exportReferenceImages = options?.exportReferenceImages ?? cloudPrefs.exportReferenceImages;
  const prepared = toOmnyCatalogDocument(source);
  const { manga } = prepared;
  const location = manga.setting.location.trim();
  const characterMaterials = (source.manga.materials ?? []).filter(material => material.type === 'character');
  const characters = (prepared.manga.characters ?? []).map((character, index) => {
    const sourceCharacter = source.manga.characters?.[index];
    const catalogId = character.catalog_id || sourceCharacter?.catalog_id;
    const refs = characterMaterials
      .filter(material =>
        (catalogId && material.character_catalog_id === catalogId)
        || (material.keywords ?? []).includes(character.name))
      .map(material => ({
        key: material.key,
        ...(material.view ? { view: material.view } : {}),
        ...(material.note ? { note: material.note } : {}),
      }));
    return {
      name: character.name,
      ...(character.role ? { role: character.role } : {}),
      ...(character.visual_prompt ? { visual_prompt: character.visual_prompt } : {}),
      ...(character.default_proportion ? { default_proportion: character.default_proportion } : {}),
      ...(character.recognition ? { recognition: character.recognition } : {}),
      ...(refs.length ? { reference_images: refs } : {}),
    };
  });

  const pages = (manga.pages ?? []).map(page => ({
    page: page.page,
    ...(exportReferenceImages ? { guide_image: `${String(page.page).padStart(2, '0')}.png` } : {}),
    canvas: page.canvas,
    panels: (page.panels ?? []).map(panel => ({
      id: panel.id,
      shape: compactPanelShape(panel.shape),
      ...(panel.bleed?.length ? { bleed: panel.bleed } : {}),
      background: includeBackground
        ? cloudPanelBackground(panel, location)
        : { mode: 'omitted', description: 'background omitted (character/foreground only)' },
      ...(panel.no_figures ? { no_figures: true } : {}),
      figures: (panel.figures ?? []).map(figure => ({
        name: figure.name,
        ...(figure.role ? { role: figure.role } : {}),
        ...(figure.size ? { size: figure.size } : {}),
        ...(figure.action ? { action: figure.action } : {}),
        ...(figure.kind ? { kind: figure.kind } : {}),
        ...(figure.bbox ? { bbox: compactBox(figure.bbox) } : {}),
      })),
      bubbles: (panel.bubbles ?? []).flatMap(bubble => {
        const kind = cloudBubbleKind(bubble);
        const allowed = kind === 'handwritten' ? includeHandwritten : includeBubbles;
        if (!allowed) return [];
        return [{
          text: bubble.text,
          kind,
          ...(bubble.speaker ? { speaker: bubble.speaker } : {}),
          ...(bubble.shape && bubble.shape !== 'normal' ? { shape: bubble.shape } : {}),
          ...(bubble.offscreen ? { offscreen: true } : {}),
          ...(bubble.emphasis ? { emphasis: bubble.emphasis } : {}),
          ...(bubble.lettering_description ? { lettering_description: bubble.lettering_description } : {}),
          ...(bubble.bbox ? { bbox: compactBox(bubble.bbox) } : {}),
        }];
      }),
      ...(includeScreenText && panel.screen_text?.some(item => !item.hidden && item.text.trim())
        ? {
            screen_text: panel.screen_text
              .filter(item => !item.hidden && item.text.trim())
              .map(item => ({
                text: item.text,
                ...(item.orientation ? { orientation: item.orientation } : {}),
                ...(item.bbox ? { bbox: compactBox(item.bbox) } : {}),
              })),
          }
        : {}),
    })),
  }));

  const workNegativePrompt = getWorkNegativePrompt(source.manga).trim();

  return {
    format: 'nyamuru-cloud-generation-v1',
    render_options: {
      include_background: includeBackground,
      include_bubbles: includeBubbles,
      include_handwritten: includeHandwritten,
      include_screen_text: includeScreenText,
      include_panel_borders: includePanelBorders,
      panel_border_mode: includePanelBorders ? 'black-gutter-frames' : 'light-blue-cutlines-no-black-borders',
      export_reference_images: exportReferenceImages,
    },
    meta: manga.meta,
    setting: {
      location: manga.setting.location,
      time: manga.setting.time,
      weather: manga.setting.weather,
      situation: manga.setting.situation,
      ...(manga.series_setting?.situation ? { series_situation: manga.series_setting.situation } : {}),
    },
    ...(workNegativePrompt ? { negative_prompt: workNegativePrompt } : {}),
    ...(manga.artwork_settings ? { artwork_rules: compileArtworkRules(manga.artwork_settings, 'integrated') } : {}),
    characters,
    pages,
  };
}

/**
 * Export the work's lightweight cloud-generation JSON for external agents and APIs.
 */
export function agentWorkflowCloudFiles(document: MangaDocument, options?: CloudRenderOptions): AgentWorkflowYamlFile[] {
  const title = document.manga.meta.title;
  return [{
    fileName: cloudGenerationFileName(title),
    yaml: JSON.stringify(buildCloudGenerationSpec(document, options), null, 2),
    mimeType: 'application/json;charset=utf-8',
  }];
}

/**
 * Export the work's pure OMNY YAML (and work-specific OMAY YAML when configured)
 * for external-agent manga generation, without ZIP wrapping or plain-text replacement.
 */
export function agentWorkflowYamlFiles(document: MangaDocument): AgentWorkflowYamlFile[] {
  const title = document.manga.meta.title;
  const files: AgentWorkflowYamlFile[] = [
    { fileName: omnyFileName(title), yaml: toSeparatedMangaYaml(document) },
  ];
  if (document.manga.artwork_settings) {
    files.push({ fileName: omayFileName(title, 'generation'), yaml: toOmayYaml(document) });
  }
  return files;
}

/**
 * Deliver cloud generation files to the bound episode folder when available,
 * falling back to browser download otherwise.
 */
export async function deliverAgentWorkflowYamlFiles(
  files: AgentWorkflowYamlFile[],
  saveToWorkspace: ((files: AgentWorkflowYamlFile[]) => Promise<string | null>) | undefined,
  downloadFile: (file: AgentWorkflowYamlFile) => void,
): Promise<{ folderName: string | null; fileNames: string[] }> {
  if (!files.length) throw new Error('書き出す生成用データがありません');
  const folderName = saveToWorkspace ? await saveToWorkspace(files) : null;
  if (!folderName) {
    for (const file of files) downloadFile(file);
  }
  return { folderName, fileNames: files.map(file => file.fileName) };
}
