export interface ConfirmableSeriesReferenceCandidate {
  relativePath: string;
  recommended: boolean;
}

export interface SeriesReferenceConfirmationState {
  requiresConfirmation: boolean;
  selectedPaths: string[];
}

/**
 * A discovered series document is only a candidate. Even one high-confidence
 * candidate stays behind the same explicit checkbox-and-button confirmation.
 */
export function seriesReferenceConfirmationState(
  candidates: readonly ConfirmableSeriesReferenceCandidate[],
): SeriesReferenceConfirmationState {
  return {
    requiresConfirmation: candidates.length > 0,
    selectedPaths: candidates
      .filter((candidate) => candidate.recommended)
      .map((candidate) => candidate.relativePath),
  };
}

/** Replace one row without discarding the other documents or their checkboxes. */
export function replaceSeriesReferenceCandidate<T extends { relativePath: string; seriesDirectory: string }>(
  candidates: readonly T[],
  selectedPaths: readonly string[],
  replacement: T,
  replacedPath?: string,
): { candidates: T[]; selectedPaths: string[] } {
  if (candidates.some((candidate) => candidate.seriesDirectory !== replacement.seriesDirectory)) {
    throw new Error('同じシリーズフォルダ内の資料を選んでください。');
  }
  const next = candidates.filter((candidate) => candidate.relativePath !== replacedPath
    && candidate.relativePath !== replacement.relativePath);
  const index = candidates.findIndex((candidate) => candidate.relativePath === replacedPath);
  next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, replacement);
  const selected = new Set(selectedPaths);
  if (replacedPath) selected.delete(replacedPath);
  selected.add(replacement.relativePath);
  return { candidates: next, selectedPaths: next.filter((candidate) => selected.has(candidate.relativePath)).map((candidate) => candidate.relativePath) };
}
