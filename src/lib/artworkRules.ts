import type { ArtworkMode, ArtworkRuleGroup, ArtworkSettingsData, Manga } from '../types.ts';

export type ArtworkTarget = 'integrated' | 'character' | 'handwritten';
export interface ArtworkSource { style_notes: string[]; layout_spec: string }

const TONE = '[style] 作品の出力形式はOMNYの meta.format に従う。カラー漫画は線画＋ベタ塗り（必要に応じてグラデーション）、モノクロ漫画は白黒線画＋ベタ・スクリーントーン、グレースケール漫画は灰色階調で描く';
// 共通へ自動移行するのは既知の本文だけ。独自の追記を見出しだけで共通扱いしない。
const IDENTITY = `### 画風を変えてもキャラを保つ
- [const] 画風を変えるときも、キャラクターの識別記号（特徴的な髪・耳・
  衣装のパーツ・固有色・体の特徴）は省略せず、その画風の描き方に翻訳して残す。
  「その画風では描けないから省く」は認めない——線で描けないなら面で、
  面で描けないなら色で、色で描けないなら形で残す
- [const] 識別記号は、その画風の物理・材料で説明のつく形に翻訳する
  （例: ドット絵のキャラを実写の世界に置くなら、印刷されたアクリルスタンドとして置く。
  ステンドグラスなら、ガラスは正方形にしか切れないという理由でドットの角を保つ）
- [const] 画風の指定は、絵の具や画材の名前だけでなく、形・比率・線の性格・
  黒白の設計・情報量の指定として解釈する。画材だけ変えて形が元のままの絵は、
  画風を変えたことにならない`;
const ACTING = `### ト書き(action)
- [const] panels[].action はセリフと分離した、コマ全体の場面・カメラ・構図のト書き。
  figures[].action は対象人物だけの表情・姿勢・視線・身体の向き・手足の動き・接触。
  panels[].background_description は人物を含めない背景レイヤー専用の場所・構図・パース・光・感情効果。
  人物について両方に指示がある場合は figures[].action を優先して描画に反映する`;
const ACTOR_ACTION = `- [const] action: その人物だけの画像生成指示。表情・姿勢・視線・身体の向き・
  手足の動き・接触を描く。背景・カメラ・画風には使わず、object: true の物には付けない。`;
const GROUPS: ArtworkRuleGroup[] = [
  { id: 'tone', label: '出力形式に合わせた仕上げ', scope: 'common', enabled: true },
  { id: 'identity', label: '画風を変えても人物の特徴を保つ', scope: 'common', enabled: true },
  { id: 'acting', label: '人物の演技と背景の指示を分ける', scope: 'common', enabled: true },
  { id: 'page', label: 'ページ構成・セリフ・背景のルール', scope: 'integrated', enabled: true },
];

/** 元の順序・空白・独自文を保持する。表示しただけでは作品を書き換えない。 */
export function artworkSettingsFromSource(source: ArtworkSource): ArtworkSettingsData {
  const fragments: ArtworkSettingsData['fragments'] = source.style_notes.map(text => ({
    groupId: text === TONE ? 'tone' : 'page', kind: 'style', text,
  }));
  // 次の見出しまでを一単位にし、既知本文の完全一致だけを切り出す。
  const sections = source.layout_spec.split(/(?=^#{2,3} )/m);
  for (const text of sections) {
    if (!text) continue;
    const body = text.trim();
    const groupId = body === IDENTITY ? 'identity' : body === ACTING ? 'acting' : 'page';
    // 人物配置の節にもある同じ演技指示を一緒に切り替える。
    const matchAt = groupId === 'page' ? text.indexOf(ACTOR_ACTION) : -1;
    const duplicateAt = matchAt >= 0 && (matchAt === 0 || text[matchAt - 1] === '\n') && (matchAt + ACTOR_ACTION.length === text.length || text[matchAt + ACTOR_ACTION.length] === '\n') ? matchAt : -1;
    if (duplicateAt >= 0) {
      fragments.push({ groupId, kind: 'layout', text: text.slice(0, duplicateAt) });
      fragments.push({ groupId: 'acting', kind: 'layout', text: text.slice(duplicateAt, duplicateAt + ACTOR_ACTION.length) });
      fragments.push({ groupId, kind: 'layout', text: text.slice(duplicateAt + ACTOR_ACTION.length) });
    } else fragments.push({ groupId, kind: 'layout', text });
  }
  return { version: 1, groups: GROUPS.filter(group => fragments.some(part => part.groupId === group.id)).map(group => ({ ...group })), fragments };
}

/** 不正な設定を黙って初期化せず、読込元でエラーにする（OFFの原本を守る）。 */
export function parseArtworkSettings(value: unknown): ArtworkSettingsData {
  if (!value || typeof value !== 'object') throw new Error('作画設定の形式が不正です');
  const data = value as ArtworkSettingsData;
  if (data.version !== 1 || !Array.isArray(data.groups) || !Array.isArray(data.fragments)) throw new Error('未対応の作画設定です');
  if (data.mode !== undefined && data.mode !== 'integrated' && data.mode !== 'draft') throw new Error('未対応の作画方法です');
  const ids = new Set<string>();
  for (const group of data.groups) {
    if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) || typeof group.label !== 'string' || !['common', 'integrated'].includes(group.scope) || typeof group.enabled !== 'boolean') throw new Error('作画ルールの項目が不正です');
    ids.add(group.id);
  }
  for (const part of data.fragments) {
    if (!part || !ids.has(part.groupId) || !['style', 'layout'].includes(part.kind) || typeof part.text !== 'string') throw new Error('作画ルールの本文が不正です');
  }
  return structuredClone(data);
}

export function getArtworkSettings(manga: Manga): ArtworkSettingsData {
  return manga.artwork_settings ? parseArtworkSettings(manga.artwork_settings) : artworkSettingsFromSource({ style_notes: manga.meta.style_notes ?? [], layout_spec: manga.layout_spec ?? '' });
}

export function getArtworkMode(settings: ArtworkSettingsData): ArtworkMode {
  return settings.mode ?? (settings.groups.some(group => group.id === 'page' && !group.enabled) ? 'draft' : 'integrated');
}

/** データの読み方を定義する既知の内部ルール。表示する設定にはしない。 */
export function isInternalArtworkGroup(settings: ArtworkSettingsData, groupId: string): boolean {
  const parts = settings.fragments.filter(part => part.groupId === groupId).map(part => part.text.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(text => text === TONE || text === ACTING || text === ACTOR_ACTION);
}

const DRAFT_LAYOUT = `## 手描き仕上げ用の下書き
- コマごとに独立した下書き画像を作る。完成ページとしてまとめない。
- ネームの構図、人物の位置・姿勢・表情、背景の指示を保ち、描き直し・加筆できる線画を優先する。
- セリフ・フキダシ・コマ枠・タイトル・ページ番号・作者名は画像に焼き込まず、後の編集で配置する。
- 元の文字データは省略・変更せず保持する。各下書きが元の何ページ・何コマに対応するかを明示する。
- finish_layout は最終原稿の仕様。下書き画像そのものの生成解像度や、後加工の禁止を意味しない。`;

/** ユーザーの選択は作り方。仕上がりの設定・OFFの原本は変更しない。 */
export function compileArtworkForMode(settings: ArtworkSettingsData, mode = getArtworkMode(settings)): ArtworkSource {
  const effective = structuredClone(settings);
  for (const group of effective.groups) {
    if (isInternalArtworkGroup(effective, group.id)) group.enabled = true;
    if (group.id === 'page') group.enabled = mode === 'integrated';
  }
  const result = compileArtworkRules(effective, mode === 'integrated' ? 'integrated' : 'character');
  if (mode === 'draft') {
    result.style_notes = result.style_notes.filter(note => note !== TONE);
    result.style_notes.push('[style] 手描きで仕上げるための下書き。最終原稿の色形式は meta.format を参照するが、下書き段階では完成塗りを行わない。');
    result.layout_spec = [result.layout_spec.trimEnd(), DRAFT_LAYOUT].filter(Boolean).join('\n\n');
  }
  return result;
}

/** 生成用にはONかつ対象に合う本文だけ。OFFの原本や他モードの設定を混ぜない。 */
export function compileArtworkRules(settings: ArtworkSettingsData, target: ArtworkTarget, defaults?: ArtworkSource): ArtworkSource {
  if (target === 'handwritten') {
    const enabled = settings.groups.filter(group => group.enabled);
    const active = new Set(enabled.map(group => group.id));
    const parts = settings.fragments.filter(part => active.has(part.groupId));
    const result = {
      // Only authored lettering rules belong to the standalone lettering image.
      style_notes: parts.filter(part => part.kind === 'style' && /\bmeta\.text_orientation\b/.test(part.text)).map(part => part.text),
      // Keep the authored handwritten clause, without unrelated balloon definitions.
      layout_spec: parts.filter(part => part.kind === 'layout').flatMap(part => part.text.split(/(?=^[-#])/m))
        .filter(block => block.startsWith('- ')).flatMap(block => {
          const clause = block.match(/\bhandwritten\s*=[\s\S]*?(?=\s*\/\s*[a-z_]+\s*=|$)/)?.[0].trim();
          return clause ? [clause] : [];
        }).join('\n'),
    };
    if (defaults) {
      const fallback = compileArtworkRules(artworkSettingsFromSource(defaults), 'handwritten');
      // Missing rules use the bundled YAML. Authored OFF rules stay OFF.
      if (!settings.fragments.some(part => part.kind === 'style' && /\bmeta\.text_orientation\b/.test(part.text)))
        result.style_notes.push(...fallback.style_notes.filter(note => /\bmeta\.text_orientation\b/.test(note)));
      if (!settings.fragments.some(part => part.kind === 'layout' && /\bhandwritten\s*=/.test(part.text)))
        result.layout_spec = fallback.layout_spec;
    }
    return result;
  }
  const active = new Set(settings.groups.filter(group => group.enabled && (group.scope === 'common' || target === 'integrated')).map(group => group.id));
  const parts = settings.fragments.filter(part => active.has(part.groupId));
  return {
    style_notes: parts.filter(part => part.kind === 'style').map(part => part.text),
    layout_spec: parts.filter(part => part.kind === 'layout').reduce((text, part) => text + (text && !text.endsWith('\n') && !part.text.startsWith('\n') ? '\n\n' : '') + part.text, ''),
  };
}

export function applyArtworkSettings(manga: Manga, settings: ArtworkSettingsData): void {
  manga.artwork_settings = parseArtworkSettings(settings);
  const active = compileArtworkForMode(manga.artwork_settings);
  manga.meta.style_notes = active.style_notes;
  manga.layout_spec = active.layout_spec;
}

const WORK_STYLE_GROUP = 'work-style';

/** 作品情報も既存の作画設定を編集し、生成用の別保存先は作らない。 */
export function getWorkStylePrompt(manga: Manga): string {
  return getArtworkSettings(manga).fragments
    .filter(part => part.groupId === WORK_STYLE_GROUP && part.kind === 'style')
    .map(part => part.text).join('\n\n');
}

export function setWorkStylePrompt(manga: Manga, prompt: string): void {
  const settings = getArtworkSettings(manga);
  const group = settings.groups.find(group => group.id === WORK_STYLE_GROUP);
  if (group) Object.assign(group, { scope: 'common', enabled: true });
  else settings.groups.push({ id: WORK_STYLE_GROUP, label: '作品の画風', scope: 'common', enabled: true });
  settings.fragments = settings.fragments.filter(part => part.groupId !== WORK_STYLE_GROUP || part.kind !== 'style');
  if (prompt) settings.fragments.push({ groupId: WORK_STYLE_GROUP, kind: 'style', text: prompt });
  applyArtworkSettings(manga, settings);
}

/** 読み込みは追加のみ。同じ原本は重複追加も再ONもしない。 */
export function appendArtworkSettings(current: ArtworkSettingsData, incoming: ArtworkSettingsData, label: string): ArtworkSettingsData {
  const next = structuredClone(current);
  const addedIds = new Map<string, string>();
  for (const group of incoming.groups) {
    const parts = incoming.fragments.filter(part => part.groupId === group.id);
    if (!parts.length) continue;
    const identical = next.groups.some(existing => {
      const saved = next.fragments.filter(part => part.groupId === existing.id);
      return existing.scope === group.scope && JSON.stringify(saved.map(({ kind, text }) => ({ kind, text }))) === JSON.stringify(parts.map(({ kind, text }) => ({ kind, text })));
    });
    if (identical) continue;
    let index = 1;
    while (next.groups.some(existing => existing.id === `import-${index}`)) index++;
    const id = `import-${index}`;
    // 新しい追加項目も最初はOFF。現在の生成設定を勝手に変更しない。
    next.groups.push({ ...group, id, label: `${label}：${group.label}`, enabled: false });
    addedIds.set(group.id, id);
  }
  // 分類順に並べ替えず、持ち込まれた本文の順序を保つ。
  next.fragments.push(...incoming.fragments.flatMap(part => {
    const groupId = addedIds.get(part.groupId);
    return groupId ? [{ ...part, groupId }] : [];
  }));
  return next;
}

export interface ArtworkNumberControl { id: string; label: string; value: number; min: number; max: number; step: number }
const numberPatterns = [
  { id: 'header', label: '見出しの文字サイズ（mm）', pattern: /(ヘッダーの文字:[^\n]*?フォントサイズ約)(\d+(?:\.\d+)?)(mm)/g, min: 0.1, max: 30, step: 0.1 },
  { id: 'footer', label: '作者名の文字サイズ（mm）', pattern: /(フッターの文字:[^\n]*?フォントサイズ約)(\d+(?:\.\d+)?)(mm)/g, min: 0.1, max: 30, step: 0.1 },
  { id: 'footerOffset', label: '作者名の下端からの距離（mm）', pattern: /(フッターの文字:[^\n]*?下端から)(\d+(?:\.\d+)?)(mm)/g, min: 0, max: 10, step: 0.1 },
  { id: 'emphasisMin', label: '強調文字の倍率・最小', pattern: /(それぞれを)(\d+(?:\.\d+)?)(〜\d+(?:\.\d+)?倍のサイズで描く)/g, min: 1, max: 5, step: 0.1 },
  { id: 'emphasisMax', label: '強調文字の倍率・最大', pattern: /(それぞれを\d+(?:\.\d+)?〜)(\d+(?:\.\d+)?)(倍のサイズで描く)/g, min: 1, max: 5, step: 0.1 },
  { id: 'backgrounds', label: '詳細背景の上限（コマ／ページ）', pattern: /(bg:2 のコマは1ページに)(\d+)(コマまで)/g, min: 0, max: 100, step: 1 },
];

export function artworkNumberControls(settings: ArtworkSettingsData, groupId: string): ArtworkNumberControl[] {
  const text = settings.fragments.filter(part => part.groupId === groupId).map(part => part.text).join('\n');
  return numberPatterns.flatMap(({ pattern, ...spec }) => {
    const matches = [...text.matchAll(pattern)];
    if (!matches.length || matches.some(match => match[2] !== matches[0][2])) return [];
    return [{ ...spec, value: Number(matches[0][2]) }];
  });
}

export function setArtworkNumber(settings: ArtworkSettingsData, groupId: string, id: string, value: number): ArtworkSettingsData {
  const spec = numberPatterns.find(spec => spec.id === id);
  const controls = artworkNumberControls(settings, groupId);
  if (!spec || !controls.some(control => control.id === id) || !Number.isFinite(value) || value < spec.min || value > spec.max || (spec.step === 1 && !Number.isInteger(value))) throw new Error('入力値が範囲外です');
  const other = controls.find(control => control.id === (id === 'emphasisMin' ? 'emphasisMax' : 'emphasisMin'));
  if (other && ((id === 'emphasisMin' && value > other.value) || (id === 'emphasisMax' && value < other.value))) throw new Error('強調倍率の最小値は最大値以下にしてください');
  const next = structuredClone(settings);
  for (const part of next.fragments.filter(part => part.groupId === groupId)) {
    // 同じ指示中で繰り返される数値も一緒に更新し、矛盾した指定を残さない。
    if (id === 'header') part.text = part.text.replace(/ヘッダーの文字:(?:(?!フッターの文字:)[^\n])*/g, header => header.replace(/(フォントサイズ約)\d+(?:\.\d+)?(mm)/g, (_, prefix, suffix) => `${prefix}${value}${suffix}`));
    else if (id === 'backgrounds') part.text = part.text.replace(spec.pattern, (_, prefix, _old, suffix) => `${prefix}${value}${suffix}`).replace(/この\d+コマ制限/g, `この${value}コマ制限`);
    else part.text = part.text.replace(spec.pattern, (_, prefix, _old, suffix) => `${prefix}${value}${suffix}`);
  }
  return next;
}
