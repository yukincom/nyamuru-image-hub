import type { HumanPoseSearchEntry, HumanPoseTag } from './humanPoseTypes.ts';

export interface HumanPoseSearchCondition { text: string; tagIds: string[] }

// 検索語だけを正規化し、保存した原文や日本語本文は変えない。
export function normalizeHumanPoseQuery(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function humanPoseSearchConditions(query: string, tags: readonly HumanPoseTag[]): HumanPoseSearchCondition[] {
  const aliases = new Map<string, Set<string>>();
  for (const tag of tags) {
    for (const raw of [tag.label_ja, ...tag.aliases]) {
      const alias = normalizeHumanPoseQuery(raw);
      if (!alias) continue;
      const ids = aliases.get(alias) ?? new Set<string>();
      ids.add(tag.id);
      aliases.set(alias, ids);
    }
  }
  const ordered = [...aliases.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  const conditions: HumanPoseSearchCondition[] = [];
  let rest = normalizeHumanPoseQuery(query);
  while (rest) {
    const alias = ordered.find(value => rest.startsWith(value)
      && !(/[a-z0-9]$/u.test(value) && /^[a-z0-9]/u.test(rest.slice(value.length))));
    if (alias) {
      conditions.push({ text: alias, tagIds: [...aliases.get(alias)!] });
      rest = rest.slice(alias.length).trimStart();
    } else {
      const word = rest.split(' ', 1)[0];
      conditions.push({ text: word, tagIds: [] });
      rest = rest.slice(word.length).trimStart();
    }
  }
  return conditions;
}

// 既知の概念はtagで判定し、未知語も捨てずにAND条件へ残す。
export function searchHumanPoses<T extends HumanPoseSearchEntry>(
  poses: readonly T[], tags: readonly HumanPoseTag[], query: string,
): T[] {
  const normalized = normalizeHumanPoseQuery(query);
  const conditions = humanPoseSearchConditions(normalized, tags);
  if (!conditions.length) return [...poses];
  return poses.map((pose, index) => {
    const names = [pose.label_ja, pose.label_en].map(normalizeHumanPoseQuery);
    const aliases = pose.search_aliases.map(normalizeHumanPoseQuery);
    const english = normalizeHumanPoseQuery(pose.pose_normalized_text);
    let score = names.includes(normalized) ? 1000 : 0;
    for (const condition of conditions) {
      if (condition.tagIds.length) {
        if (!condition.tagIds.some(id => pose.tags.includes(id))) return null;
        score += 20;
      } else if (names.some(name => name.includes(condition.text))) score += 30;
      else if (aliases.some(alias => alias.includes(condition.text))) score += 20;
      else if (english.includes(condition.text)) score += 10;
      else return null;
    }
    return { pose, score, index };
  }).filter((entry): entry is { pose: T; score: number; index: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.pose);
}
