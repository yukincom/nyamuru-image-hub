export interface HumanPoseClause {
  index: number;
  chunk_index: number;
  text: string;
  start: number;
  end: number;
}

interface HumanPoseLinkedClauseUnit {
  source_index: number;
  edited_index: number;
  original: string;
  text: string;
}

export type HumanPoseUnchangedClauseUnit = HumanPoseLinkedClauseUnit & { status: 'unchanged' };
export type HumanPoseModifiedClauseUnit = HumanPoseLinkedClauseUnit & { status: 'modified' };

export interface HumanPoseAddedClauseUnit {
  status: 'added';
  source_index: null;
  edited_index: number;
  original: null;
  text: string;
}

export interface HumanPoseDeletedClauseUnit {
  status: 'deleted';
  source_index: number;
  edited_index: null;
  original: string;
  text: null;
}

export type HumanPoseChangedClauseUnit = HumanPoseModifiedClauseUnit | HumanPoseAddedClauseUnit;
export type HumanPoseClauseUnit = HumanPoseUnchangedClauseUnit | HumanPoseChangedClauseUnit;

export interface HumanPoseClauseComparison {
  source_clauses: HumanPoseClause[];
  edited_clauses: HumanPoseClause[];
  units: HumanPoseClauseUnit[];
  changed_units: HumanPoseChangedClauseUnit[];
  deleted_units: HumanPoseDeletedClauseUnit[];
}

// 読点とASCIIカンマだけで分割し、元文字列のUTF-16位置を残す。
export function splitHumanPoseClauses(text: string): HumanPoseClause[] {
  const clauses: HumanPoseClause[] = [];
  let offset = 0;
  for (const [chunk_index, chunk] of text.split(/[,、]/u).entries()) {
    const content = chunk.trim();
    if (content) {
      const start = offset + chunk.length - chunk.trimStart().length;
      clauses.push({ index: clauses.length, chunk_index, text: content, start, end: start + content.length });
    }
    offset += chunk.length + 1;
  }
  return clauses;
}

// 同文の節を全体から先に一対一で確保し、挿入・削除・並べ替えの影響を局所化する。
export function compareHumanPoseClauses(baselineText: string, editedText: string): HumanPoseClauseComparison {
  const source_clauses = splitHumanPoseClauses(baselineText);
  const edited_clauses = splitHumanPoseClauses(editedText);
  const occurrences = new Map<string, { indices: number[]; next: number }>();
  for (const clause of source_clauses) {
    const entry = occurrences.get(clause.text) ?? { indices: [], next: 0 };
    entry.indices.push(clause.index);
    occurrences.set(clause.text, entry);
  }
  const usedSources = new Set<number>();
  const exactSources = edited_clauses.map(clause => {
    const entry = occurrences.get(clause.text);
    if (!entry || entry.next >= entry.indices.length) return null;
    const source_index = entry.indices[entry.next++];
    usedSources.add(source_index);
    return source_index;
  });

  // 残りは出現順で対応させる。「変更」は意味の一致や翻訳の対応を保証しない。
  const unmatchedSources = source_clauses.filter(clause => !usedSources.has(clause.index));
  let nextUnmatched = 0;
  const units: HumanPoseClauseUnit[] = edited_clauses.map(clause => {
    const exactSource = exactSources[clause.index];
    if (exactSource !== null) {
      return {
        status: 'unchanged', source_index: exactSource, edited_index: clause.index,
        original: source_clauses[exactSource].text, text: clause.text,
      };
    }
    const source = unmatchedSources[nextUnmatched];
    if (source) {
      nextUnmatched++;
      return {
        status: 'modified', source_index: source.index, edited_index: clause.index,
        original: source.text, text: clause.text,
      };
    }
    return { status: 'added', source_index: null, edited_index: clause.index, original: null, text: clause.text };
  });

  // 翻訳に回す追加・変更と、送信文から取り除く削除を分離する。
  const changed_units = units.filter((unit): unit is HumanPoseChangedClauseUnit => unit.status !== 'unchanged');
  const deleted_units: HumanPoseDeletedClauseUnit[] = unmatchedSources.slice(nextUnmatched).map(clause => ({
    status: 'deleted', source_index: clause.index, edited_index: null, original: clause.text, text: null,
  }));
  return { source_clauses, edited_clauses, units, changed_units, deleted_units };
}
