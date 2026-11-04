import { type TargetDraft, assertValidUnicode, coverageMatchKey, codePointLength, MAX_TARGET_VALUE_CODEPOINTS, MAX_TARGET_UNITS, MAX_ADJACENT_BUBBLES, type SourceCoverageTarget, utf8Bytes, stableJson, MAX_PROJECTION_BYTES, sha256Hex } from './sourceUnits.ts';
import type { MangaDocument } from '../../types';

function addTarget(drafts: TargetDraft[], target: Omit<TargetDraft, 'matchKey'>): void {
  const value = target.value.trim();
  if (!value) return;
  assertValidUnicode(value, 'OMNYの照合対象');
  const matchKey = coverageMatchKey(value);
  if (!matchKey) return;
  if (codePointLength(value) > MAX_TARGET_VALUE_CODEPOINTS
    || codePointLength(matchKey) > MAX_TARGET_VALUE_CODEPOINTS) {
    throw new Error(`OMNYの照合対象が${MAX_TARGET_VALUE_CODEPOINTS.toLocaleString()}文字を超えています`);
  }
  drafts.push({ ...target, value, matchKey });
  if (drafts.length > MAX_TARGET_UNITS) throw new Error(`OMNY\u306e\u7167\u5408\u5bfe\u8c61\u304c${MAX_TARGET_UNITS.toLocaleString()}\u4ef6\u3092\u8d85\u3048\u3066\u3044\u307e\u3059`);
}

function pointerSegment(value: string | number): string {
  return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function bubbleSpeakerKeys(document: MangaDocument, speaker: string | undefined): string[] {
  const speakerKey = coverageMatchKey(speaker ?? '');
  if (!speakerKey) return [];
  const character = document.manga.characters.find((entry) => [entry.name, ...(entry.aliases ?? [])]
    .some((candidate) => coverageMatchKey(candidate) === speakerKey));
  return [...new Set([speaker, character?.name, ...(character?.aliases ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(coverageMatchKey))].sort();
}

function addBubbleTargets(
  drafts: TargetDraft[],
  document: MangaDocument,
  bubbles: readonly { text: string; speaker?: string }[],
  baseLocator: string,
): void {
  bubbles.forEach((bubble, index) => addTarget(drafts, {
    layer: 'storyboard_evidenced',
    kind: 'bubble',
    locator: `${baseLocator}/${index}/text`,
    value: bubble.text,
    speakerKeys: bubbleSpeakerKeys(document, bubble.speaker),
  }));
  for (let start = 0; start < bubbles.length; start += 1) {
    for (let length = 2; length <= MAX_ADJACENT_BUBBLES && start + length <= bubbles.length; length += 1) {
      const sequence = bubbles.slice(start, start + length);
      const speakerSets = sequence.map((bubble) => new Set(bubbleSpeakerKeys(document, bubble.speaker)));
      const sharedSpeakers = speakerSets[0]
        ? [...speakerSets[0]].filter((speaker) => speakerSets.every((entries) => entries.has(speaker))).sort()
        : [];
      for (const separator of ['', ' ']) addTarget(drafts, {
        layer: 'storyboard_evidenced',
        kind: 'bubble_sequence',
        locator: `${baseLocator}/${start}-${start + length - 1}`,
        value: sequence.map((bubble) => bubble.text.trim()).join(separator),
        speakerKeys: sharedSpeakers,
      });
    }
  }
}

export async function extractOmnyCoverageTargets(document: MangaDocument): Promise<SourceCoverageTarget[]> {
  const drafts: TargetDraft[] = [];
  const context = (kind: string, locator: string, value: string) => addTarget(drafts, {
    layer: 'context_retained', kind, locator, value, speakerKeys: [],
  });
  const storyboard = (kind: string, locator: string, value: string, speakerKeys: string[] = []) => addTarget(drafts, {
    layer: 'storyboard_evidenced', kind, locator, value, speakerKeys,
  });
  const { manga } = document;
  context('meta_title', '/manga/meta/title', manga.meta.title);
  context('meta_series', '/manga/meta/series', manga.meta.series);
  context('meta_episode_number', '/manga/meta/episode_number', manga.meta.episode_number);
  context('setting_location', '/manga/setting/location', manga.setting.location);
  context('setting_time', '/manga/setting/time', manga.setting.time);
  context('setting_weather', '/manga/setting/weather', manga.setting.weather);
  context('setting_situation', '/manga/setting/situation', manga.setting.situation);
  context('series_genre', '/manga/series_setting/genre', manga.series_setting.genre ?? '');
  context('series_target_audience', '/manga/series_setting/target_audience', manga.series_setting.target_audience ?? '');
  context('series_situation', '/manga/series_setting/situation', manga.series_setting.situation);
  manga.characters.forEach((character, characterIndex) => {
    const base = `/manga/characters/${characterIndex}`;
    context('character_name', `${base}/name`, character.name);
    context('character_role', `${base}/role`, character.role);
    character.aliases?.forEach((alias, aliasIndex) => context('character_alias', `${base}/aliases/${aliasIndex}`, alias));
  });
  manga.materials.forEach((material, materialIndex) => {
    const base = `/manga/materials/${materialIndex}`;
    context('material_key', `${base}/key`, material.key);
    material.keywords.forEach((keyword, keywordIndex) => context('material_keyword', `${base}/keywords/${keywordIndex}`, keyword));
    context('material_note', `${base}/note`, material.note ?? '');
  });
  manga.pages.forEach((page, pageIndex) => {
    page.panels.forEach((panel, panelIndex) => {
      const base = `/manga/pages/${pageIndex}/panels/${panelIndex}`;
      storyboard('panel_action', `${base}/action`, panel.action ?? '');
      storyboard('panel_background', `${base}/background_description`, panel.background_description ?? '');
      panel.figures?.forEach((figure, figureIndex) => {
        storyboard('figure_name', `${base}/figures/${figureIndex}/name`, figure.name);
        storyboard('figure_action', `${base}/figures/${figureIndex}/action`, figure.action ?? '');
      });
      addBubbleTargets(drafts, document, panel.bubbles, `${base}/bubbles`);
      panel.screen_text?.forEach((screenText, textIndex) => storyboard(
        'screen_text', `${base}/screen_text/${textIndex}/text`, screenText.text,
      ));
    });
    const overlay = page.page_overlay;
    if (!overlay) return;
    const base = `/manga/pages/${pageIndex}/page_overlay`;
    overlay.figures?.forEach((figure, figureIndex) => {
      storyboard('overlay_figure_name', `${base}/figures/${figureIndex}/name`, figure.name);
      storyboard('overlay_figure_action', `${base}/figures/${figureIndex}/action`, figure.action ?? '');
    });
    addBubbleTargets(drafts, document, overlay.bubbles ?? [], `${base}/bubbles`);
  });
  const projectionBytes = utf8Bytes(stableJson(drafts.map(({ layer, kind, value, matchKey, speakerKeys }) => ({
    layer, kind, value, match_key: matchKey, speaker_keys: speakerKeys,
  }))));
  if (projectionBytes.byteLength > MAX_PROJECTION_BYTES) throw new Error('OMNY\u306e\u76e3\u67fbprojection\u304c5MiB\u3092\u8d85\u3048\u3066\u3044\u307e\u3059');
  const episodeIdentity = manga.meta.episode_id.trim() || await sha256Hex(projectionBytes);
  const ordinals = new Map<string, number>();
  return Promise.all(drafts.map(async (draft) => {
    const duplicateKey = `${draft.layer}\0${draft.kind}\0${draft.matchKey}\0${draft.speakerKeys.join('\0')}`;
    const ordinal = (ordinals.get(duplicateKey) ?? 0) + 1;
    ordinals.set(duplicateKey, ordinal);
    return {
      target_id: `target-${await sha256Hex(`${episodeIdentity}\0${duplicateKey}\0${ordinal}`)}`,
      layer: draft.layer,
      kind: draft.kind,
      locator: draft.locator.split('/').map((part, index) => index === 0 ? '' : pointerSegment(part)).join('/'),
      value: draft.value,
      match_key: draft.matchKey,
      speaker_keys: draft.speakerKeys,
    } satisfies SourceCoverageTarget;
  }));
}
