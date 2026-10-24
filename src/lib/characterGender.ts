import type { Character, CharacterGender } from '../types.ts';

// 保存値と表示名は同じ対応表を使う。
export const CHARACTER_GENDER_OPTIONS = [
  { value: 'female', label: '女性' },
  { value: 'male', label: '男性' },
  { value: 'neutral', label: '中性' },
] as const;

export function isCharacterGender(value: unknown): value is CharacterGender {
  return CHARACTER_GENDER_OPTIONS.some(option => option.value === value);
}

export function characterGenderLabel(value: CharacterGender): string {
  const option = CHARACTER_GENDER_OPTIONS.find(option => option.value === value);
  if (!option) throw new Error('性別は female / male / neutral のいずれかで指定してください');
  return option.label;
}

export function parseCharacterGenderLabel(value: string): CharacterGender {
  const option = CHARACTER_GENDER_OPTIONS.find(option => option.label === value.trim());
  if (!option) throw new Error('性別は「女性」「男性」「中性」のいずれかで指定してください');
  return option.value;
}

// 中性への補完は生成時だけ行い、元の人物設定は変更しない。
export function resolveCharacterGender(character?: Pick<Character, 'gender'>): {
  gender: CharacterGender;
  isFallback: boolean;
} {
  if (character?.gender === undefined) return { gender: 'neutral', isFallback: true };
  if (!isCharacterGender(character.gender)) throw new Error('人物の性別属性が不正です');
  return { gender: character.gender, isFallback: false };
}
