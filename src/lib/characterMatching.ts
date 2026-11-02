import type { Character, Figure, FigureSize, FigureExpressionReading, MangaDocument, PersistentAnalogAssetRef } from '../types.ts';
import { CHARACTER_RECOGNITION_FIELDS } from './characterReferences.ts';
import { DETECTED_FIGURE_NAME, isDetectedFigureCharacter, isSystemMobCharacter } from './systemCharacters.ts';

export interface CharacterMatchTarget {
  sourceRegionId: string;
  assetId: string;
  persistentAsset?: PersistentAnalogAssetRef;
  currentSize: FigureSize;
  locations: string[];
}

export interface CharacterMatchCandidate {
  id: string;
  observedTraits: string[];
}

export type CharacterReadOutcome = {
  ok: true;
  candidateId: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  action: string;
  suggestedSize: FigureSize;
  reason: string;
  expressionReading: FigureExpressionReading;
} | {
  ok: false;
  error: string;
};

function isUnresolvedAnalogFigure(figure: Figure): boolean {
  return Boolean(figure.analogImport)
    && !figure.analogImport?.userEdited
    && (!figure.refId || figure.name === DETECTED_FIGURE_NAME);
}

/** 同じ人物切り抜きがコマ分割で複製されても、照合画面では1件にまとめる。 */
export function collectUnmatchedCharacterTargets(document: MangaDocument): CharacterMatchTarget[] {
  const targets = new Map<string, CharacterMatchTarget>();
  const add = (
    figure: Figure,
    location: string,
  ) => {
    if (!isUnresolvedAnalogFigure(figure) || !figure.analogImport) return;
    const key = figure.analogImport.sourceRegionId;
    const existing = targets.get(key);
    if (existing) {
      if (!existing.locations.includes(location)) existing.locations.push(location);
      return;
    }
    targets.set(key, {
      sourceRegionId: key,
      assetId: figure.analogImport.assetId,
      persistentAsset: figure.analogImport.persistentAsset,
      currentSize: figure.size ?? 'bust-up',
      locations: [location],
    });
  };
  document.manga.pages.forEach((page, pageIndex) => {
    page.panels.forEach((panel, panelIndex) => {
      panel.figures?.forEach((figure) => add(
        figure,
        `ページ ${String(pageIndex + 1).padStart(2, '0')}・コマ ${String(panelIndex + 1).padStart(2, '0')}`,
      ));
    });
    page.page_overlay?.figures?.forEach((figure) => add(
      figure,
      `ページ ${String(pageIndex + 1).padStart(2, '0')}・タチキリ`,
    ));
  });
  return [...targets.values()];
}

export function buildCharacterMatchCandidates(characters: readonly Character[]): CharacterMatchCandidate[] {
  return characters.flatMap((character) => {
    if (!character.localId || isDetectedFigureCharacter(character) || isSystemMobCharacter(character)) return [];
    const observedTraits = CHARACTER_RECOGNITION_FIELDS.flatMap(({ key }) =>
      character.recognition?.[key]?.observed ?? []);
    const traits = [...new Set(observedTraits.map(value => value.trim()).filter(Boolean))].slice(0, 64);
    return traits.length ? [{ id: character.localId, observedTraits: traits }] : [];
  });
}

/** 新規作成時の読み取り結果を、同じ原画領域から生じた全配置へ反映する。 */
export function applyCharacterReadOutcomes(
  document: MangaDocument,
  outcomes: ReadonlyMap<string, CharacterReadOutcome>,
): { applied: number; needsReview: number } {
  const characters = new Map(document.manga.characters.flatMap((character) => (
    character.localId ? [[character.localId, character] as const] : []
  )));
  const reviewRegions = new Set<string>();
  let applied = 0;
  const apply = (figure: Figure) => {
    const metadata = figure.analogImport;
    if (!metadata || metadata.userEdited) return;
    const sourceRegionId = metadata.sourceRegionId;
    const outcome = outcomes.get(sourceRegionId);
    if (!outcome) return;
    if (!outcome.ok) {
      metadata.analysisReview = 'error';
      metadata.analysisReviewMessage = outcome.error;
      reviewRegions.add(sourceRegionId);
      return;
    }
    metadata.expressionReading = structuredClone(outcome.expressionReading);
    figure.action = outcome.action;
    figure.size = outcome.suggestedSize;
    const character = outcome.candidateId ? characters.get(outcome.candidateId) : undefined;
    if (character) {
      figure.kind = 'person';
      figure.refId = character.localId;
      figure.name = character.name;
    }
    if (outcome.confidence === 'low' || outcome.confidence === 'none' || !character) {
      metadata.analysisReview = 'low-confidence';
      metadata.analysisReviewMessage = outcome.reason || '人物を確定できませんでした';
      reviewRegions.add(sourceRegionId);
    } else if (outcome.expressionReading.faces.length > 1 && !outcome.expressionReading.target_face_id) {
      metadata.analysisReview = 'low-confidence';
      metadata.analysisReviewMessage = '切り抜きに複数の顔があり、対象人物の表情を確定できませんでした';
      reviewRegions.add(sourceRegionId);
    } else {
      delete metadata.analysisReview;
      delete metadata.analysisReviewMessage;
    }
    applied += 1;
  };
  document.manga.pages.forEach((page) => {
    page.panels.forEach((panel) => panel.figures?.forEach(apply));
    page.page_overlay?.figures?.forEach(apply);
  });
  return { applied, needsReview: reviewRegions.size };
}

/** ユーザーが確認した割当だけを、同じ原画領域から生じた全配置へ反映する。 */
export function applyCharacterMatchAssignments(
  document: MangaDocument,
  assignments: ReadonlyMap<string, string>,
): number {
  const characters = new Map(document.manga.characters.flatMap((character) => (
    character.localId ? [[character.localId, character] as const] : []
  )));
  let applied = 0;
  const apply = (figure: Figure) => {
    const sourceRegionId = figure.analogImport?.sourceRegionId;
    if (!sourceRegionId || figure.analogImport?.userEdited) return;
    const characterId = assignments.get(sourceRegionId);
    const character = characterId ? characters.get(characterId) : undefined;
    if (!character) return;
    figure.kind = 'person';
    figure.refId = character.localId;
    figure.name = character.name;
    figure.analogImport!.userEdited = true;
    applied += 1;
  };
  document.manga.pages.forEach((page) => {
    page.panels.forEach((panel) => panel.figures?.forEach(apply));
    page.page_overlay?.figures?.forEach(apply);
  });
  return applied;
}
