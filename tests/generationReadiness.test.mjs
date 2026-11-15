// 見込み: ボタンと会話の準備判定を共用すれば、未準備箇所を同じ情報で案内できる。
// 範囲: 実判定・会話sender、状態/生成callbackは模擬。実モデル・起動・実UIは別確認。
import test from 'node:test';
import assert from 'node:assert/strict';
import {generationReadiness, generationReadinessMessage} from '../src/lib/generation/readiness.ts';
import {createGenerationConversation} from '../src/components/generation/createGenerationConversation.ts';
import {validateGenerationInputs} from '../src/components/generation/createGenerationActions.ts';
import {QWEN_GENERATION_PROFILE} from '../src/lib/qwenGeneration.ts';

const input = (patch = {}) => ({
  working: false, phase: '', attempted: false, cloud: false, hasWorkflow: true,
  workflowError: '', plan: {characterKeys: []}, threeImages: false, usesPoseImage: false,
  targetError: '', poseImage: '', poseError: '', characterLoading: false, sketchLoading: false,
  sourceErrors: {character: '', expression: ''}, references: [], validateInputs: () => {}, ...patch,
});

// 見込み: 送信するpayloadの検査を共用すれば、参照枚数違いを開始前に案内できる。
// 合格: 0枚定義+1枚資料は未準備、1枚定義は許可、空指示も案内。実payload検査、画像とworkflowは模擬。
test('submission payload errors become readiness blockers before starting a workflow', () => {
  const plan={profile:QWEN_GENERATION_PROFILE,documentKey:'readiness',pageNumber:1,panelId:1,overlay:false,
    ownerKey:'figure-0',label:'人物',width:160,height:224,prompt:'人物を描く',characterKeys:[],candidates:[]};
  const draft={prompt:plan.prompt,references:[{label:'資料',characterKeys:[],image:'data:image/png;base64,fixture'}]};
  const workflow={name:'検証',binding:{images:[]}};
  const validateInputs=()=>validateGenerationInputs(plan,draft,false,workflow);
  const blocked=generationReadiness(input({validateInputs}));
  assert.equal(blocked.ready,false);
  assert.deepEqual(blocked.blockers,[{code:'inputs',label:'生成の入力',state:'action_required',
    detail:'検証は参照画像0枚の定義です。現在は1枚です。環境設定で対応する定義を選んでください'}]);
  workflow.binding.images.push({});assert.equal(generationReadiness(input({validateInputs})).ready,true);
  draft.prompt='';assert.equal(generationReadiness(input({validateInputs})).blockers[0].detail,'生成指示を入力してください');
});

// 見込み/合格: 選択済み入力から生成を始める時点ではComfy未起動でも許可。判定自体は起動処理を持たない。
test('ready input allows the existing generation path to start ComfyUI on demand', () => {
  assert.deepEqual(generationReadiness(input()), {ready: true, message: '生成の準備が整っています', blockers: []});
  assert.equal(generationReadiness(input({cloud: true, hasWorkflow: false})).ready, true);
});

// 見込み/合格: 読込待ちと設定修正を区別し、未選択/失敗の具体的理由を保持。状態入力だけを模擬。
test('workflow loading and configuration errors produce different actionable status', () => {
  const waiting = generationReadiness(input({hasWorkflow: false}));
  assert.equal(waiting.ready, false);
  assert.deepEqual(waiting.blockers, [{code: 'workflow', label: 'ワークフロー', state: 'waiting', detail: '使用するワークフローを読み込んでいます'}]);
  for (const detail of ['使用するワークフローを選んでください', '選択したワークフローの登録がありません', '一覧を読み込めません']) {
    const result = generationReadiness(input({hasWorkflow: false, workflowError: detail}));
    assert.equal(result.ready, false);
    assert.equal(result.blockers[0].state, 'action_required');
    assert.equal(result.blockers[0].detail, detail);
  }
});

// 見込み/合格: 必要な資料の不足を各項目として示し、満たした入力だけ解除。画像bytesの品質は対象外。
test('three-image input reports character, pose, target, and expression blockers together', () => {
  const pending = input({threeImages: true, usesPoseImage: true, characterLoading: true, sketchLoading: true,
    targetError: '対象のコマを指定してください', plan: {characterKeys: ['person']}});
  const result = generationReadiness(pending);
  assert.deepEqual(result.blockers.map(item => [item.code, item.state]),
    [['characters', 'waiting'], ['target', 'action_required'], ['pose', 'waiting'], ['expression', 'waiting']]);
  const ready = {...pending, characterLoading: false, sketchLoading: false, targetError: '',
    poseImage: 'data:pose', reference: {image: 'data:expression'}, references: [{characterKeys: ['person'], image: 'data:character'}]};
  assert.equal(generationReadiness(ready).ready, true);
  assert.equal(generationReadiness({...ready, references: []}).blockers[0].code, 'characters');
  assert.equal(generationReadiness({...ready, reference: undefined}).blockers[0].code, 'expression');
});

// 見込み/合格: 読込失敗は待てば直ると案内せず、そのエラーを返す。実loaderの失敗発生は対象外。
test('failed assets and unconfirmed poses keep their concrete correction messages', () => {
  const result = generationReadiness(input({threeImages: true, usesPoseImage: true, poseError: '3D撮影失敗',
    sourceErrors: {character: '設定画が見つかりません', expression: 'ネーム原画が見つかりません'}}));
  assert.deepEqual(result.blockers.map(item => item.detail), ['設定画が見つかりません', '3D撮影失敗', 'ネーム原画が見つかりません']);
  assert.ok(result.blockers.every(item => item.state === 'action_required'));
  assert.match(generationReadiness(input({threeImages: true})).blockers.find(item => item.code === 'pose').detail, /3Dモデル/);
});

// 見込み/合格: 起動・実行中は現在の工程をそのまま返し、生成/LLM/排他operationを一切呼ばない。
test('queries during ComfyUI startup or image work return facts without waking an LLM or generating again', async () => {
  for (const phase of ['ComfyUIを起動中', '画像を生成中', '生成後の復帰を確認中']) {
    const readiness = generationReadiness(input({working: true, phase}));
    const send = createGenerationConversation({isAlive: () => true, isCurrent: () => true,
      isWorking: () => true, readiness: () => readiness,
      snapshot: () => assert.fail('must not consult'), update: () => assert.fail('must not edit'),
      operation: () => assert.fail('must not enter LLM operation'), generate: () => assert.fail('must not generate'),
      cloud: false, label: '人物'});
    for (const text of ['生成して', 'いまどうなっている？']) {
      const reply = await send(text, () => true);
      assert.equal(reply, generationReadinessMessage(readiness));
      assert.match(reply, /準備が整っていません/);
      assert.ok(reply.includes(phase));
      assert.match(reply, /現在の処理が終わるまで/);
      assert.doesNotMatch(reply, /改めて/);
    }
  }
});

// 見込み/合格: 終了した画面の古いcallbackは案内も生成も行わない。生存状態は模擬。
test('closed or closing generation conversation refuses even an early saved callback', async () => {
  const send = createGenerationConversation({isAlive: () => true, isCurrent: () => false,
    readiness: () => assert.fail('must not inspect a closed dialog'), cloud: false, label: '人物'});
  assert.equal(await send('生成して', () => true), '生成の会話を終了しました');
});
