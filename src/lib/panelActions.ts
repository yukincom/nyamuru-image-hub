import type { Bubble, Character, Figure, Manga, Panel } from '../types.ts';
import { isPropPlacement } from './catalogModel.ts';

export interface PanelActionFigureInput {
  id: string;
  name: string;
  description: string;
  currentAction: string;
  size: string;
  role: string;
}

export interface PanelActionDialogueInput {
  speaker: string;
  text: string;
  monologue: boolean;
  offscreen: boolean;
  shape: string;
}

export interface PanelActionWorkInput {
  seriesTitle: string;
  subtitle: string;
  episodeNumber: string;
  synopsis: string;
  location: string;
  time: string;
  weather: string;
}

export interface PanelActionCharacterInput {
  name: string;
  description: string;
}

export interface PanelActionContextPanelInput {
  pageNumber: number;
  panelId: number;
  panelAction: string;
  people: string[];
  dialogues: PanelActionDialogueInput[];
}

export interface PanelActionSuggestionRequest {
  work: PanelActionWorkInput;
  characters: PanelActionCharacterInput[];
  currentPanel: PanelActionContextPanelInput;
  previousPanel?: PanelActionContextPanelInput;
  nextPanel?: PanelActionContextPanelInput;
  figures: PanelActionFigureInput[];
}

export interface PanelActionSuggestion {
  id: string;
  action: string;
}

export interface PanelActionSuggestionResponse {
  actions: PanelActionSuggestion[];
  model?: string;
}

export interface PanelPersonPlacement {
  figure: Figure;
  index: number;
  requestId: string;
}

function characterDescription(figure: Figure, characters: readonly Character[]): string {
  const linked = figure.refId
    ? characters.find((character) => character.localId === figure.refId)
    : characters.find((character) => character.name === figure.name);
  return linked?.role?.trim() ?? '';
}

export function panelPersonPlacements(panel: Pick<Panel, 'figures'>): PanelPersonPlacement[] {
  return (panel.figures ?? [])
    .map((figure, index) => ({ figure, index, requestId: `figure-${index}` }))
    .filter(({ figure }) => !isPropPlacement(figure));
}

function dialogueInput(bubble: Bubble): PanelActionDialogueInput {
  return {
    speaker: bubble.speaker?.trim() || '話者なし',
    text: bubble.text.trim(),
    monologue: bubble.monologue ?? false,
    offscreen: bubble.offscreen ?? false,
    shape: bubble.shape ?? 'normal',
  };
}

function contextPanel(pageNumber: number, panel: Panel): PanelActionContextPanelInput {
  return {
    pageNumber,
    panelId: panel.id,
    panelAction: panel.action?.trim() ?? '',
    people: panelPersonPlacements(panel).map(({ figure }) => figure.name.trim()).filter(Boolean),
    dialogues: panel.bubbles.filter((bubble) => bubble.text.trim()).map(dialogueInput),
  };
}

export function buildPanelActionSuggestionRequest(
  manga: Manga,
  pageIndex: number,
  panelIndex: number,
): PanelActionSuggestionRequest {
  const page = manga.pages[pageIndex];
  const panel = page?.panels[panelIndex];
  if (!page || !panel) throw new Error('人物アクションを入力するコマが見つかりません');
  const placements = panelPersonPlacements(panel);
  const flattened = manga.pages.flatMap((entry, entryPageIndex) => entry.panels.map((entryPanel, entryPanelIndex) => ({
    pageNumber: entry.page,
    panel: entryPanel,
    isCurrent: entryPageIndex === pageIndex && entryPanelIndex === panelIndex,
  })));
  const currentIndex = flattened.findIndex((entry) => entry.isCurrent);
  const previous = currentIndex > 0 ? flattened[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 && currentIndex + 1 < flattened.length ? flattened[currentIndex + 1] : undefined;
  return {
    work: {
      seriesTitle: manga.meta.series.trim(),
      subtitle: manga.meta.title.trim(),
      episodeNumber: manga.meta.episode_number.trim(),
      synopsis: manga.setting.situation.trim(),
      location: manga.setting.location.trim(),
      time: manga.setting.time.trim(),
      weather: manga.setting.weather.trim(),
    },
    characters: manga.characters.map((character) => ({ name: character.name.trim(), description: character.role.trim() })),
    currentPanel: contextPanel(page.page, panel),
    ...(previous ? { previousPanel: contextPanel(previous.pageNumber, previous.panel) } : {}),
    ...(next ? { nextPanel: contextPanel(next.pageNumber, next.panel) } : {}),
    figures: placements.map(({ figure, requestId }, ordinal) => ({
      id: requestId,
      name: figure.name.trim() || `人物${ordinal + 1}`,
      description: characterDescription(figure, manga.characters),
      currentAction: figure.action?.trim() ?? '',
      size: figure.size ?? '',
      role: figure.role ?? '',
    })),
  };
}


/** Apply complete reconciled actions only after validating the entire response. */
export function applyReconciledPanelActions(panel: Panel, suggestions: readonly PanelActionSuggestion[]): number {
  const placements = new Map(panelPersonPlacements(panel).map(({ requestId, index }) => [requestId, index]));
  const updates = new Map<number, string>();
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const index = placements.get(suggestion.id);
    if (index === undefined || seen.has(suggestion.id)) throw new Error('人物アクションのIDが対象人物と一致しません。変更しませんでした。');
    seen.add(suggestion.id);
    if (typeof suggestion.action !== 'string' || suggestion.action.length > 4000) throw new Error('統合後のアクションは4000文字以内の文章にしてください。変更しませんでした。');
    const action = suggestion.action.trim();
    // An empty model result must never erase an existing action.
    if (action && action !== (panel.figures![index].action ?? '')) updates.set(index, action);
  }
  if (seen.size !== placements.size) throw new Error('対象人物のアクションが不足しています。変更しませんでした。');
  for (const [index, action] of updates) panel.figures![index].action = action;
  return updates.size;
}
