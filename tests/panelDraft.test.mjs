import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPanelDraftPlan,
  PANEL_DRAFT_CFG,
  PANEL_DRAFT_CHECKPOINT,
  PANEL_DRAFT_HEIGHT,
  PANEL_DRAFT_PROFILE,
  PANEL_DRAFT_SEED,
  PANEL_DRAFT_STEPS,
  PANEL_DRAFT_WIDTH,
  MANGA_BASE_PALETTE,
} from '../src/lib/panelDraft.ts';

function fixture() {
  return {
    meta: { format: 'モノクロ漫画' },
    setting: { location: '放課後の教室', time: '夕方', weather: '雨' },
    characters: [{
      localId: 'person-aki', name: 'アキ', role: '慎重な主人公', scope: 'series',
      default_proportion: { head_count: 4 },
      recognition: {
        hair: { observed: ['短い外はね'], inferred: [] },
        face: { observed: [], inferred: [] }, silhouette: { observed: [], inferred: [] },
        outfit: { observed: [], inferred: [] }, accessories: { observed: [], inferred: [] },
        ambiguous_design: { observed: [], inferred: [] },
      },
    }],
    materials: [{ localId: 'prop-umbrella', key: '赤い傘', type: 'prop', keywords: ['閉じた傘'], note: '木製の持ち手' }],
    pages: [{
      page: 3,
      panels: [
        {
          id: 1, bg: -1, action: '前のコマ', bubbles: [{ text: '含めない' }], figures: [],
        },
        {
          id: 2,
          bg: 1,
          action: 'アキが窓を見て驚く。',
          background_description: '窓際の机と雨粒、夕方の逆光',
          figures: [
            { name: 'アキ', refId: 'person-aki', kind: 'person', size: 'bust-up', role: 'main', action: '目を見開いて左を見る' },
            { name: '赤い傘', refId: 'prop-umbrella', kind: 'prop', action: '机へ立てかける' },
          ],
          bubbles: [{ text: '本当に？', speaker: 'アキ' }],
          screen_text: [{ text: '図書室' }],
        },
      ],
    }],
  };
}

test('選択した1コマの構造だけからmanga-base作画用ラフ計画を作る', () => {
  const plan = buildPanelDraftPlan(fixture(), 0, 1);
  assert.equal(plan.pageNumber, 3);
  assert.equal(plan.panelId, 2);
  assert.equal(plan.profile, PANEL_DRAFT_PROFILE);
  assert.equal(plan.checkpoint, PANEL_DRAFT_CHECKPOINT);
  assert.deepEqual(
    { width: plan.width, height: plan.height, steps: plan.steps, cfg: plan.cfg, seed: plan.seed },
    { width: PANEL_DRAFT_WIDTH, height: PANEL_DRAFT_HEIGHT, steps: PANEL_DRAFT_STEPS, cfg: PANEL_DRAFT_CFG, seed: PANEL_DRAFT_SEED },
  );
  assert.match(plan.positivePrompt, /single uninterrupted anime scene/);
  assert.match(plan.positivePrompt, /solo, one character only/);
  assert.match(plan.positivePrompt, /monochrome/);
  assert.match(plan.positivePrompt, /flat grayscale shading/);
  assert.doesNotMatch(plan.positivePrompt, /manga-base|#[0-9A-F]{6}|mask|comic panel|black red cyan/);
  assert.deepEqual(MANGA_BASE_PALETTE, {
    ink: '#000000', denseTone: '#E60012', lightTone: '#00D7E8', paper: '#FFFFFF',
  });
  assert.doesNotMatch(plan.positivePrompt, /masterpiece|best quality/);
  assert.match(plan.positivePrompt, /アキが窓を見て驚く/);
  assert.match(plan.positivePrompt, /慎重な主人公/);
  assert.match(plan.positivePrompt, /4頭身/);
  assert.match(plan.positivePrompt, /短い外はね/);
  assert.match(plan.positivePrompt, /目を見開いて左を見る/);
  assert.match(plan.positivePrompt, /赤い傘/);
  assert.match(plan.positivePrompt, /窓際の机と雨粒/);
  assert.doesNotMatch(plan.positivePrompt, /前のコマ|本当に|図書室|含めない/);
  assert.match(plan.negativePrompt, /speech bubble/);
  assert.match(plan.negativePrompt, /polished finished illustration/);
  assert.match(plan.negativePrompt, /black background/);
  assert.match(plan.negativePrompt, /character sheet/);
});

test('存在しないコマは生成計画にしない', () => {
  assert.throws(() => buildPanelDraftPlan(fixture(), 2, 0), /見つかりません/);
});

test('複数人物の肯定指定とnegative promptが矛盾しない', () => {
  const manga = fixture();
  manga.characters.push({
    localId: 'person-yu', name: 'ユウ', role: '友人', scope: 'series',
    default_proportion: { head_count: 5 },
    recognition: {
      hair: { observed: ['長い黒髪'], inferred: [] }, face: { observed: [], inferred: [] },
      silhouette: { observed: [], inferred: [] }, outfit: { observed: [], inferred: [] },
      accessories: { observed: [], inferred: [] }, ambiguous_design: { observed: [], inferred: [] },
    },
  });
  manga.pages[0].panels[1].figures.push({
    name: 'ユウ', refId: 'person-yu', kind: 'person', size: 'bust-up', role: 'sub', action: 'アキを見る',
  });

  const plan = buildPanelDraftPlan(manga, 0, 1);
  assert.match(plan.positivePrompt, /exactly 2 characters together in the same scene/);
  assert.match(plan.negativePrompt, /extra people/);
  assert.doesNotMatch(plan.negativePrompt, /multiple people|multiple characters/);
});
