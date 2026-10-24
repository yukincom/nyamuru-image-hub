import type { Figure, Manga, Material, Panel } from '../types.ts';
import { isPropPlacement } from './catalogModel.ts';

export const PANEL_DRAFT_CHECKPOINT = 'animagine-xl-3.1.safetensors';
export const PANEL_DRAFT_PROFILE = 'manga-base';
export const PANEL_DRAFT_WIDTH = 512;
export const PANEL_DRAFT_HEIGHT = 512;
export const PANEL_DRAFT_STEPS = 20;
export const PANEL_DRAFT_CFG = 6;
export const PANEL_DRAFT_SEED = 2026082901;

export const MANGA_BASE_PALETTE = {
  ink: '#000000',
  denseTone: '#E60012',
  lightTone: '#00D7E8',
  paper: '#FFFFFF',
} as const;

export interface PanelDraftPlan {
  pageNumber: number;
  panelId: number;
  positivePrompt: string;
  negativePrompt: string;
  profile: typeof PANEL_DRAFT_PROFILE;
  checkpoint: typeof PANEL_DRAFT_CHECKPOINT;
  width: typeof PANEL_DRAFT_WIDTH;
  height: typeof PANEL_DRAFT_HEIGHT;
  steps: typeof PANEL_DRAFT_STEPS;
  cfg: typeof PANEL_DRAFT_CFG;
  seed: typeof PANEL_DRAFT_SEED;
}

function clean(value: string | null | undefined): string {
  return value?.normalize('NFKC').replace(/\s+/g, ' ').trim() ?? '';
}

function linkedCharacterDescription(manga: Manga, figure: Figure): string {
  const character = (figure.refId
    ? manga.characters.find((entry) => entry.localId === figure.refId)
    : undefined) ?? manga.characters.find((entry) => clean(entry.name) === clean(figure.name));
  if (!character) return '';
  const stableTraits = character.recognition
    ? [
      character.recognition.hair,
      character.recognition.face,
      character.recognition.silhouette,
      character.recognition.outfit,
      character.recognition.accessories,
    ].flatMap((evidence) => evidence.observed).map(clean).filter(Boolean)
    : [];
  const visualNotes = manga.materials
    .filter((material) => material.type === 'character' && material.characterId === character.localId)
    .flatMap((material) => [...material.keywords.map(clean), clean(material.note)])
    .filter(Boolean);
  return [
    clean(character.role),
    character.default_proportion ? `${character.default_proportion.head_count}頭身` : '',
    ...stableTraits,
    ...visualNotes,
  ].filter(Boolean).join(', ');
}

function linkedMaterial(manga: Manga, figure: Figure): Material | undefined {
  if (figure.refId) {
    const byId = manga.materials.find((material) => material.localId === figure.refId);
    if (byId) return byId;
  }
  return manga.materials.find((material) => clean(material.key) === clean(figure.name));
}

function figurePrompt(manga: Manga, figure: Figure): string {
  if (isPropPlacement(figure)) {
    const material = linkedMaterial(manga, figure);
    const details = [clean(figure.name), ...(material?.keywords ?? []).map(clean), clean(material?.note), clean(figure.action)].filter(Boolean);
    return details.join(', ') || 'unspecified object';
  }
  const size = figure.size ? figure.size.replace('-', ' ') : '';
  const role = figure.role === 'main' ? 'main character' : figure.role === 'sub' ? 'supporting character' : '';
  const details = [clean(figure.name), linkedCharacterDescription(manga, figure), size, role, clean(figure.action)].filter(Boolean);
  return details.join(', ') || 'unspecified person';
}

function backgroundPrompt(manga: Manga, panel: Panel): string {
  if (panel.bg === -1) return 'plain background';
  if (panel.bg === 0) return clean(panel.background_description) || 'abstract emotional background';
  const setting = [clean(manga.setting.location), clean(manga.setting.time), clean(manga.setting.weather)].filter(Boolean).join(', ');
  return (panel.background_description === undefined ? setting : clean(panel.background_description)) || 'simple background';
}

/** 選択中の1コマだけを、固定ComfyUIワークフローへ渡す確認用計画にする。 */
export function buildPanelDraftPlan(manga: Manga, pageIndex: number, panelIndex: number): PanelDraftPlan {
  const page = manga.pages[pageIndex];
  const panel = page?.panels[panelIndex];
  if (!page || !panel) throw new Error('作画用ラフを生成するコマが見つかりません');
  if (panel.figures?.some(figure => figure.human_pose)) throw new Error('選択した人体ポーズの作画用ラフへの反映は準備中です。');

  const people = (panel.figures ?? []).filter((figure) => !isPropPlacement(figure)).map((figure) => figurePrompt(manga, figure));
  const props = (panel.figures ?? []).filter(isPropPlacement).map((figure) => figurePrompt(manga, figure));
  const peopleCountPrompt = people.length === 1
    ? 'solo, one character only'
    : people.length > 1
      ? `exactly ${people.length} characters together in the same scene`
      : 'no people';
  const cardinalityNegativePrompt = people.length === 1
    ? 'multiple people, multiple characters, duplicate character, repeated subject'
    : people.length === 0
      ? 'person, people, character'
      : 'extra people, extra characters, duplicated person, repeated same character';
  const scene = clean(panel.action);
  const positivePrompt = [
    'single uninterrupted anime scene',
    peopleCountPrompt,
    'rough manga lineart',
    'unfinished drawing',
    'monochrome',
    'flat grayscale shading',
    'mostly white background',
    'readable anime face proportions',
    'stable simplified anatomy and pose',
    'sparse incomplete detail',
    'broad simple shapes',
    scene ? `scene: ${scene}` : '',
    people.length ? `characters together in the scene: ${people.join(' ; ')}` : '',
    props.length ? `props in the scene: ${props.join(' ; ')}` : '',
    `background: ${backgroundPrompt(manga, panel)}`,
  ].filter(Boolean).join(', ');

  return {
    pageNumber: page.page,
    panelId: panel.id,
    positivePrompt,
    negativePrompt: `${cardinalityNegativePrompt}, character sheet, design sheet, model sheet, reference sheet, contact sheet, grid, collage, tiled image, rows, columns, multiple views, triptych, split screen, panel borders, multiple panels, comic page, polished finished illustration, ultra-detailed rendering, detailed eye highlights, individual hair strand detail, glossy finish, gradients, soft shading, painterly shading, natural colors, extra colors, colored background, black background, dark backdrop, full black backdrop, crosshatching, screentone dots, texture noise, photorealism, 3d render, clean vector art, malformed anatomy, distorted face, horror face, malformed hands, extra fingers, missing fingers, text, letters, speech bubble, dialogue, caption, sound effect, watermark, signature, logo`,
    profile: PANEL_DRAFT_PROFILE,
    checkpoint: PANEL_DRAFT_CHECKPOINT,
    width: PANEL_DRAFT_WIDTH,
    height: PANEL_DRAFT_HEIGHT,
    steps: PANEL_DRAFT_STEPS,
    cfg: PANEL_DRAFT_CFG,
    seed: PANEL_DRAFT_SEED,
  };
}
