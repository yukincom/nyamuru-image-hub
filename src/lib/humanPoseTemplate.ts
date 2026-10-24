import grammar from '../../scripts/human_pose/data/grammar.json' with { type: 'json' };
import type { HumanPoseGender } from './humanPoseTypes.ts';
import type { Character } from '../types.ts';
import { resolveCharacterGender } from './characterGender.ts';

const pronounKeys = ['subject', 'object', 'possessive_adjective', 'possessive_pronoun', 'reflexive'];
const verbs: Readonly<Record<string, string>> = grammar.verbs;

// 対応語形を限定し、未知のtokenを生成指示へ流さない。
export function renderHumanPoseTemplate(template: string, gender: HumanPoseGender = 'neutral'): string {
  if (!Object.hasOwn(grammar.pronouns, gender)) throw new Error('人物の性別属性が不正です');
  if (!template.trim()) throw new Error('ポーズ英文が空です');
  const result = template.replace(/\{\{([^{}]+)\}\}/gu, (_, token: string) => {
    const index = pronounKeys.indexOf(token);
    if (index >= 0) return grammar.pronouns[gender][index];
    const lemma = token.startsWith('verb:') ? token.slice(5) : '';
    if (!Object.hasOwn(verbs, lemma)) throw new Error(`未対応のポーズtokenです: ${token}`);
    return gender === 'neutral' ? (lemma === 'be' ? 'are' : lemma) : verbs[lemma];
  });
  if (/[{}]/u.test(result)) throw new Error('ポーズtokenの括弧が不正です');
  return result.trim().replace(/^[a-z]/u, letter => letter.toUpperCase());
}

// 生成側へ、確定した英文と未設定の補完情報を一緒に渡す。
export function renderCharacterHumanPoseTemplate(template: string, character?: Pick<Character, 'gender'>) {
  const resolved = resolveCharacterGender(character);
  return { ...resolved, text: renderHumanPoseTemplate(template, resolved.gender) };
}
