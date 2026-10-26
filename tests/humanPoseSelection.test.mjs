import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { selectHumanPose, validateHumanPoseSelection, parseHumanPoseCatalog } from '../src/lib/humanPoseSelection.ts';
import { searchHumanPoses } from '../src/lib/humanPoseSearch.ts';
import { parseMangaYaml, toStoredMangaYaml, toMangaYaml } from '../src/lib/manga.ts';
import { deduplicateFigures } from '../src/lib/panelTemplates.ts';
import { buildQwenGenerationPlan } from '../src/lib/qwenGeneration.ts';
import { buildPanelDraftPlan } from '../src/lib/panelDraft.ts';
import { paintScene } from '../src/lib/paintDocument.ts';
import { cubeGlb } from './background3dFixture.mjs';
import { prepareBackgroundStage } from '../src/lib/background3d.ts';
import { createProjectSnapshot, restoreProjectSnapshot } from '../src/lib/projectPersistence.ts';
import { confirmHumanPoseCameraPrompt, humanPoseCameraPromptCurrent } from '../src/lib/humanPoseScene.ts';

const digest = 'a'.repeat(64);
const row = JSON.parse(readFileSync(new URL('../scripts/human_pose/data/curated-standing.json', import.meta.url)))[0];
const entry = { ...row, template_revision: 1, pose_normalized_text: row.pose_template,
  production_status: 'ready', review: { status: 'confirmed', user_confirmed: true },
  prompt_segments: [{ id: 'pose', text_ja: row.pose_text_ja, template_en: row.pose_template }],
  asset_files: { preview: { path: `poses/${row.id}/preview.png`, sha256: digest, byte_size: 64 } } };
const sample = readFileSync(new URL('../src/content/sample.yaml', import.meta.url), 'utf8');

test('コマ内・前景の撮影説明と手修正はOMNY保存・作品snapshot・モード往復でも残る', async () => {
  const doc = document();
  for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) {
    const pose = figure.human_pose;
    pose.camera_prompt = confirmHumanPoseCameraPrompt(pose.scene, { centre: [1, 1.3, -2], world_facing_degrees: 70 });
    pose.camera_prompt.overrides = { angle_ja: '右側から見る', lens_ja: '' }; pose.camera_prompt.review_required = true;
  }
  for (const mode of ['image', 'prompt']) {
    for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) figure.human_pose.input_mode = mode;
    const snapshot = await createProjectSnapshot(doc);
    const restored = await restoreProjectSnapshot(snapshot, async () => {});
    for (const candidate of [restored, parseMangaYaml(toStoredMangaYaml(doc)), parseMangaYaml(toMangaYaml(doc))]) {
      assert.deepEqual(candidate.manga.pages[0].panels[0].figures[0].human_pose, doc.manga.pages[0].panels[0].figures[0].human_pose);
      assert.deepEqual(candidate.manga.pages[0].page_overlay.figures[0].human_pose, doc.manga.pages[0].page_overlay.figures[0].human_pose);
    }
  }
  const left = doc.manga.pages[0].panels[0].figures[0], right = structuredClone(left);
  right.human_pose.camera_prompt.overrides.angle_ja = '左側から見る';
  assert.equal(deduplicateFigures([left, right]).length, 2);
  right.human_pose.scene.camera.fov++;
  const reloaded = parseMangaYaml(toStoredMangaYaml({ ...doc, manga: { ...doc.manga, pages: [{ ...doc.manga.pages[0], panels: [{ ...doc.manga.pages[0].panels[0], figures: [right] }] }] } }));
  const pose = reloaded.manga.pages[0].panels[0].figures[0].human_pose;
  assert.equal(humanPoseCameraPromptCurrent(pose.camera_prompt, pose.scene), false);
  assert.equal(pose.camera_prompt.overrides.angle_ja, '左側から見る');
  const bad = structuredClone(left.human_pose); bad.camera_prompt.subject.centre[0] = NaN;
  assert.throws(() => validateHumanPoseSelection(bad));
});

test('コマ内と前景で背景参照・倍率・表示とカメラを保存し、未登録の舞台は拒否する', () => {
  const doc = document(), stage = { id: `stage-${digest}`, sha256: digest, storageId: 'test-stage-original', name: '机と椅子', format: 'glb', byteLength: 64 };
  doc.manga.background_stages = [stage];
  for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) {
    figure.human_pose.scene.background = { sourceId: stage.id, cutaway: { enabled: true, depth: .2 }, objectVisibility: [{ mesh: 2, mode: 'hide' }] };
    figure.human_pose.scene.background.surface = { version: 1, point: [1, .47, 2], normal: [0, 1, 0], surfaceMesh: 7, anchor: 'hips', height_offset: .04, facing_degrees: -90 };
    figure.human_pose.scene.placement.scale = 100; figure.human_pose.scene.show_supports = false;
  }
  for (const serialize of [toStoredMangaYaml]) {
    const restored = parseMangaYaml(serialize(doc));
    assert.deepEqual(restored.manga.background_stages, [stage]);
    assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].human_pose, doc.manga.pages[0].panels[0].figures[0].human_pose);
    assert.deepEqual(restored.manga.pages[0].page_overlay.figures[0].human_pose, doc.manga.pages[0].page_overlay.figures[0].human_pose);
  }
  const exported = parseMangaYaml(toMangaYaml(doc));
  for (const figure of [exported.manga.pages[0].panels[0].figures[0], exported.manga.pages[0].page_overlay.figures[0]]) {
    const expected = structuredClone(doc.manga.pages[0].panels[0].figures[0].human_pose); delete expected.scene.background;
    assert.deepEqual(figure.human_pose, expected);
  }
  assert.equal(doc.manga.pages[0].panels[0].figures[0].human_pose.scene.background.sourceId, stage.id);
  delete doc.manga.background_stages;
  assert.throws(() => parseMangaYaml(toStoredMangaYaml(doc)), /人体ポーズの元の3D舞台/);
});

test('人物だけが使う舞台も作品に原本を1つ保存し、復元時のstorageId変更で配置は変わらない', async () => {
  const doc = document(), { stage, blob } = await prepareBackgroundStage(cubeGlb());
  doc.manga.background_stages = [stage];
  for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) figure.human_pose.scene.background = { sourceId: stage.id };
  doc.manga.pages[0].page_overlay.figures[0].human_pose.scene.background.surface = { version: 1, point: [0, 1, 0], normal: [0, 1, 0], surfaceMesh: 0, anchor: 'left_foot', height_offset: 0 };
  const snapshot = await createProjectSnapshot(doc, async id => { assert.equal(id, stage.storageId); return blob; });
  assert.equal(snapshot.assets.length, 1);
  let originals;
  const restored = await restoreProjectSnapshot(snapshot, async assets => { originals = assets; });
  assert.equal(originals.length, 1); assert.notEqual(restored.manga.background_stages[0].storageId, stage.storageId);
  assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].human_pose, doc.manga.pages[0].panels[0].figures[0].human_pose);
  assert.deepEqual(restored.manga.pages[0].page_overlay.figures[0].human_pose, doc.manga.pages[0].page_overlay.figures[0].human_pose);
});

function document() {
  const doc = parseMangaYaml(sample);
  const figure = { name: '確認用', refId: 'person-one', size: 'full', bbox: { x: 10, y: 10, w: 40, h: 80 },
    action: '元のアクション', human_pose: selectHumanPose(entry, digest) };
  figure.human_pose.edited_text_ja += ' 顔を上げる。';
  figure.human_pose.scene = { version: 1, source: { base_sha256: digest, rig_sha256: digest, pose_sha256: digest, rig_signature: digest, pose_revision: 1 },
    placement: { position: [1, .5, -2], yaw_degrees: 30 }, camera: { position: [3, 2, 5], target: [1, 1, -2], fov: 40, shift: [.1, -.2] },
    projection: 'perspective', up: [0, 1, 0], frame: { width: 512, height: 1024 } };
  doc.manga.characters = [{ localId: 'person-one', name: '確認用' }];
  doc.manga.pages[0].panels[0].figures = [figure];
  doc.manga.pages[0].page_overlay = { frame: false, layer: 'above_panel_frames', figures: [structuredClone(figure)], bubbles: [] };
  return doc;
}

test('仮選択の元データと編集後の文面を分離する', () => {
  const selected = selectHumanPose(entry, digest);
  selected.baseline_segments[0].text_ja = '変更';
  assert.equal(entry.prompt_segments[0].text_ja, row.pose_text_ja);
  assert.throws(() => selectHumanPose({ ...entry, production_status: 'in_progress' }, digest));
  for (const change of [{ catalog_sha256: '' }, { pose_id: '../pose' }, { baseline_segments: [] },
    { edited_text_ja: null }, { input_mode: 'auto' }, { input_mode: ['prompt'] }, { template_revision: 0 }]) {
    assert.throws(() => validateHumanPoseSelection({ ...selectHumanPose(entry, digest), ...change }));
  }
});

test('コマ内とページ上の人物の編集文が、保存とOMNY往復で残る', () => {
  const doc = document();
  for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
    const restored = parseMangaYaml(serialize(doc));
    assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].human_pose, doc.manga.pages[0].panels[0].figures[0].human_pose);
    assert.deepEqual(restored.manga.pages[0].page_overlay.figures[0].human_pose, doc.manga.pages[0].page_overlay.figures[0].human_pose);
    assert.equal(restored.manga.pages[0].panels[0].figures[0].action, '元のアクション');
  }
});

test('送り方の往復と保存再読込で編集文・基準文・反転と撮影設定を保持する', () => {
  assert.equal(selectHumanPose(entry, digest).input_mode, 'prompt');
  for (const edited_text_ja of ['右手を上げる。目線は左へ。', '']) {
    let doc = document();
    const source = doc.manga.pages[0].panels[0].figures[0].human_pose;
    source.edited_text_ja = edited_text_ja;
    source.scene.body_mirror = 'mirrored';
    doc.manga.pages[0].page_overlay.figures[0].human_pose = structuredClone(source);
    const initial = structuredClone(source);
    for (const input_mode of ['image', 'prompt', 'image']) {
      const page = doc.manga.pages[0];
      for (const figure of [page.panels[0].figures[0], page.page_overlay.figures[0]]) {
        figure.human_pose = { ...figure.human_pose, input_mode };
      }
      for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
        const restored = parseMangaYaml(serialize(doc)).manga.pages[0];
        for (const figure of [restored.panels[0].figures[0], restored.page_overlay.figures[0]]) {
          assert.deepEqual(figure.human_pose, { ...initial, input_mode });
          assert.equal(figure.action, '元のアクション');
        }
      }
      doc = parseMangaYaml(toStoredMangaYaml(doc));
    }
  }
});

test('送り方だけ異なる人物はコマ合体で落とさない', () => {
  const left = document().manga.pages[0].panels[0].figures[0], right = structuredClone(left);
  right.human_pose.input_mode = 'image';
  assert.equal(deduplicateFigures([left, right]).length, 2);
});

test('分割コピーのポーズ文が異なればコマ合体で落とさない', () => {
  const left = document().manga.pages[0].panels[0].figures[0];
  const right = structuredClone(left);
  assert.equal(deduplicateFigures([left, right]).length, 1);
  right.human_pose.edited_text_ja = '別の指定';
  assert.equal(deduplicateFigures([left, right]).length, 2);
});

test('撮影だけ違う人物を合体で落とさず、別ポーズへの変更で撮影設定を引き継がない', () => {
  const left = document().manga.pages[0].panels[0].figures[0], right = structuredClone(left);
  right.human_pose.scene.camera.fov = 60;
  assert.equal(deduplicateFigures([left, right]).length, 2);
  assert.equal(selectHumanPose(entry, digest).scene, undefined);
  const bad = structuredClone(left.human_pose); bad.scene.camera.position[0] = Infinity;
  assert.throws(() => validateHumanPoseSelection(bad));
});

test('体勢の反転がコマ内・ページ前景の保存往復で残り、基準文と編集文を変えない', () => {
  for (const body_mirror of [undefined, 'original', 'mirrored']) {
    const doc = document(), panel = doc.manga.pages[0].panels[0], overlay = doc.manga.pages[0].page_overlay;
    const baseline = structuredClone(panel.figures[0].human_pose.baseline_segments), text = panel.figures[0].human_pose.edited_text_ja;
    if (body_mirror !== undefined) for (const figure of [panel.figures[0], overlay.figures[0]]) figure.human_pose.scene.body_mirror = body_mirror;
    for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
      const page = parseMangaYaml(serialize(doc)).manga.pages[0];
      for (const figure of [page.panels[0].figures[0], page.page_overlay.figures[0]]) {
        assert.deepEqual(figure.human_pose, panel.figures[0].human_pose);
        assert.deepEqual(figure.human_pose.baseline_segments, baseline);
        assert.equal(figure.human_pose.edited_text_ja, text);
        assert.equal(figure.human_pose.scene.body_mirror, body_mirror);
      }
    }
  }
});

test('反転だけ異なる人物を合体で落とさず、不正な反転指定を拒否する', () => {
  const left = document().manga.pages[0].panels[0].figures[0], right = structuredClone(left);
  right.human_pose.scene.body_mirror = 'mirrored';
  assert.equal(deduplicateFigures([left, right]).length, 2);
  const selected = selectHumanPose({ ...entry, id: 'pose-another' }, digest);
  assert.equal(selected.scene, undefined);
  right.human_pose.scene.body_mirror = 'auto';
  assert.throws(() => validateHumanPoseSelection(right.human_pose));
});

test('確定したポーズを文と画像の両方式で計画に渡し、古い対象と未確定の撮影を拒否する', () => {
  for (const input_mode of ['prompt', 'image']) {
    const { manga } = document(), panel = manga.pages[0].panels[0];
    const pose = panel.figures[0].human_pose;
    pose.input_mode = input_mode;
    pose.camera_prompt = confirmHumanPoseCameraPrompt(pose.scene, { centre: [1, 1.3, -2], world_facing_degrees: 70 });
    const owner = paintScene(panel, 100, []).owners.find(owner => owner.figure);
    const plan = buildQwenGenerationPlan(manga, 0, 0, false, owner);
    assert.deepEqual(plan.humanPose.selection, pose);
    assert.match(plan.prompt, /元のアクション/);
    assert.match(plan.prompt, /アングル・レンズの説明/);
    if (input_mode === 'prompt') assert.ok(plan.prompt.includes(pose.edited_text_ja));
    else { assert.match(plan.prompt, /3Dポーズ参照/); assert.ok(!plan.prompt.includes(pose.edited_text_ja)); }
    const staleOwner = structuredClone(owner); delete staleOwner.figure.human_pose;
    assert.throws(() => buildQwenGenerationPlan(manga, 0, 0, false, staleOwner), /人体ポーズが変更/);
    assert.throws(() => buildPanelDraftPlan(manga, 0, 0), /Qwenで生成/);
    pose.camera_prompt.review_required = true;
    assert.throws(() => buildQwenGenerationPlan(manga, 0, 0, false, paintScene(panel, 100, []).owners[1]), /手修正文/);
    pose.camera_prompt.review_required = false; pose.scene.camera.fov++;
    assert.throws(() => buildQwenGenerationPlan(manga, 0, 0, false, paintScene(panel, 100, []).owners[1]), /確定し直し/);
  }
});

test('切り取り範囲はコマ・ページ前景のOMNYへ保存される', () => {
  const doc = document();
  for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) {
    figure.human_pose.scene.framing = { size: 'bust-up', crop: { x: .2, y: .1, w: .4, h: .4 } };
    figure.human_pose.camera_prompt = confirmHumanPoseCameraPrompt(figure.human_pose.scene, { centre: [1, 1.3, -2], world_facing_degrees: 70 });
  }
  for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
    const restoredDocument = parseMangaYaml(serialize(doc)), restored = restoredDocument.manga.pages[0];
    assert.deepEqual(restored.panels[0].figures[0].human_pose, doc.manga.pages[0].panels[0].figures[0].human_pose);
    assert.deepEqual(restored.page_overlay.figures[0].human_pose, doc.manga.pages[0].page_overlay.figures[0].human_pose);
    const owner = paintScene({ ...restored.page_overlay, id: 0, bg: -1, shape: { type: 'rect', x: 0, y: 0, w: 100, h: 150 } }, 100, []).owners.find(o => o.figure);
    assert.equal(buildQwenGenerationPlan(restoredDocument.manga, 0, 0, true, owner).overlay, true);
  }
});

test('受信時に本文と基準segmentの取り違えを拒否する', () => {
  const payload = { catalog_sha256: digest, catalog: { tags: [], poses: [entry] } };
  assert.equal(parseHumanPoseCatalog(payload).poses.length, 1);
  const bad = structuredClone(payload);
  bad.catalog.poses[0].pose_text_ja = '別の本文';
  assert.throws(() => parseHumanPoseCatalog(bad));
  const wrongType = structuredClone(payload);
  wrongType.catalog.poses[0].production_status = ['ready'];
  assert.throws(() => parseHumanPoseCatalog(wrongType));
  assert.equal(searchHumanPoses([entry], [], String(row.display_number)).length, 1);
});

test('関節編集と基準身長をコマ・前景のOMNYに保持し、不正な編集を拒否する', () => {
  const doc = document();
  for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) {
    figure.human_pose.scene.stature_m = 1.57;
    figure.human_pose.scene.joint_edits = { version: 1, rotations: { 'wrist.L': [0, Math.sin(.2), 0, Math.cos(.2)] }, root_offset: [.02, -.1, .04], foot_bends: { L: [20, 45], R: [-10, 15] } };
  }
  const restored = parseMangaYaml(toStoredMangaYaml(doc));
  assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].human_pose.scene, doc.manga.pages[0].panels[0].figures[0].human_pose.scene);
  assert.deepEqual(restored.manga.pages[0].page_overlay.figures[0].human_pose.scene, doc.manga.pages[0].page_overlay.figures[0].human_pose.scene);
  doc.manga.pages[0].panels[0].figures[0].human_pose.scene.joint_edits.rotations['wrist.L'] = [0, 0, 0, 0];
  assert.throws(() => parseMangaYaml(toStoredMangaYaml(doc)), /関節/);
});

test('モーションの時点と微調整をコマ・前景のOMNYに保存し同値で復元する', () => {
  const doc = document();
  for (const figure of [doc.manga.pages[0].panels[0].figures[0], doc.manga.pages[0].page_overlay.figures[0]]) {
    figure.human_pose.scene.motion = { version: 1, library_sha256: digest, clip_id: 'ual1-sprint-loop', phase: .475 };
    figure.human_pose.scene.joint_edits = { version: 1, rotations: { head: [0, 0, 0, 1] }, foot_bends: { L: [0, -60] } };
  }
  for (const serialize of [toStoredMangaYaml, toMangaYaml]) {
    const restored = parseMangaYaml(serialize(doc));
    assert.deepEqual(restored.manga.pages[0].panels[0].figures[0].human_pose, doc.manga.pages[0].panels[0].figures[0].human_pose);
    assert.deepEqual(restored.manga.pages[0].page_overlay.figures[0].human_pose, doc.manga.pages[0].page_overlay.figures[0].human_pose);
  }
});
