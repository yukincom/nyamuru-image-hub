import type { Character, CharacterRecognitionProfile, VisualEvidence } from '../types.ts';

export const DETECTED_FIGURE_NAME = '人物あたり';
export const SYSTEM_MOB_NAME = 'モブキャラ';
export const SYSTEM_MOB_ROLE = '背景扱いのモブ';
export const SYSTEM_MOB_CATALOG_ID = 'character-system-mob';
export const SYSTEM_MOB_DEFAULT_DESIGN = 'シルエットとアウトラインだけのシンプルな造形';

/** 画像解析の仮配置名。ユーザーが管理する人物台帳には含めない。 */
export function isDetectedFigureCharacter(character: { name: string }): boolean {
  return character.name.normalize('NFKC').trim() === DETECTED_FIGURE_NAME;
}

function normalizedName(name: string): string {
  return name.normalize('NFKC').trim();
}

export function isSystemMobCharacter(character: Pick<Character, 'name' | 'catalog_id'>): boolean {
  return character.catalog_id === SYSTEM_MOB_CATALOG_ID || normalizedName(character.name) === SYSTEM_MOB_NAME;
}

function emptyEvidence(): VisualEvidence {
  return { observed: [], inferred: [] };
}

function defaultMobRecognition(): CharacterRecognitionProfile {
  return {
    hair: emptyEvidence(),
    face: emptyEvidence(),
    silhouette: { observed: [SYSTEM_MOB_DEFAULT_DESIGN], inferred: [] },
    outfit: emptyEvidence(),
    accessories: emptyEvidence(),
    ambiguous_design: emptyEvidence(),
  };
}

export function createSystemMobCharacter(): Character {
  return {
    name: SYSTEM_MOB_NAME,
    role: SYSTEM_MOB_ROLE,
    scope: 'series',
    catalog_id: SYSTEM_MOB_CATALOG_ID,
    default_proportion: { head_count: 6 },
    recognition: defaultMobRecognition(),
  };
}

/** 予約済みのモブ設定を1件だけ保持し、シリーズ人物の末尾へ移す。 */
export function ensureSystemMobCharacter(characters: Character[]): void {
  const byStableId = characters.find((character) => character.catalog_id === SYSTEM_MOB_CATALOG_ID);
  const existing = byStableId ?? characters.find((character) => normalizedName(character.name) === SYSTEM_MOB_NAME);
  const mob = existing ?? createSystemMobCharacter();

  // 名前だけで登録されていた既存データを初回だけ既定値付きのシステム人物へ移行する。
  if (existing && !byStableId) {
    mob.default_proportion ??= { head_count: 6 };
    mob.recognition ??= defaultMobRecognition();
  }
  mob.name = SYSTEM_MOB_NAME;
  mob.role = SYSTEM_MOB_ROLE;
  mob.scope = 'series';
  mob.catalog_id = SYSTEM_MOB_CATALOG_ID;

  characters.splice(0, characters.length, ...characters.filter((character) => (
    character !== mob && !isSystemMobCharacter(character)
  )), mob);
}
