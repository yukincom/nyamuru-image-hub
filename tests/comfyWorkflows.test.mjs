import assert from 'node:assert/strict';
import test from 'node:test';
import { comfyLiteralInputs, comfyNodeLabel, parseComfyApiGraph, parseComfyWorkflowFile,
  parseComfyWorkflowBinding, parseComfyWorkflowDefinition, parseComfyWorkflowList,
  parseComfyWorkflowInfo, parseComfyWorkflowCheck, parseSavedComfyWorkflow,
} from '../src/lib/comfyWorkflows.ts';

// 見込み: グラフと明示された対応だけを読むと、推測変換や参照の交換を防げる。
// 合格: 順序・未対応入力を保持し、不正な対応は拒否。確認範囲: 純粋parser、API・実画面・モデルは対象外。
const graph = {
  text: { class_type: 'TextEncode', inputs: { prompt: 'keep source text', other: 'leave alone' }, _meta: { title: '指示の入力' } },
  sampler: { class_type: 'Sampler', inputs: { seed: 80, width: 768, height: 1024, cfg: 1, model: ['model', 0] } },
  model: { class_type: 'ModelLoader', inputs: { model_name: 'selected-model.safetensors' } },
  imageA: { class_type: 'LoadImage', inputs: { image: 'first.png' } },
  imageB: { class_type: 'LoadImage', inputs: { image: 'second.png' } },
  output: { class_type: 'SaveImage', inputs: { images: ['sampler', 0], filename_prefix: 'ComfyUI' } },
};
const sink = (node, input) => ({ node, input });
const binding = {
  prompt: [sink('text', 'prompt')], seed: [sink('sampler', 'seed')],
  width: [sink('sampler', 'width')], height: [sink('sampler', 'height')],
  images: [[sink('imageB', 'image')], [sink('imageA', 'image')]],
  output: { node: 'output', index: 1 }, prompt_mode: 'plain', fixed_size: null,
};
const definition = { id: 'ec178bba-3b09-47e5-8be8-d43728d0045c', name: 'My workflow', version: 2, graph, binding };

// 見込み: API JSONだけを受け付ければ編集形式を誤実行しない。
// 合格: graph保持、編集形式/壊れたJSON/包んだpromptを拒否。確認範囲: ファイル内容のparser。
test('imports only API node graphs and preserves all graph values independently', () => {
  const parsed = parseComfyWorkflowFile(JSON.stringify(graph));
  assert.deepEqual(parsed, graph);
  parsed.sampler.inputs.cfg = 4;
  assert.equal(graph.sampler.inputs.cfg, 1);
  for (const value of [{ nodes: [], links: [] }, { prompt: graph }, {}, null, []]) {
    assert.throws(() => parseComfyApiGraph(value), /API形式/);
  }
  assert.throws(() => parseComfyWorkflowFile('{'), /JSON/);
});

// 見込み: 受け渡し先は既存literalに限ればリンクを上書きしない。
// 合格: 数値/文字列候補を区別し、接続入力を除外、明示参照順を保持。確認範囲: 候補列挙とbinding parser。
test('mapping preserves reference order and supports multiple explicitly chosen sinks', () => {
  assert.deepEqual(comfyLiteralInputs(graph, 'sampler', 'number'), ['seed', 'width', 'height', 'cfg']);
  assert.deepEqual(comfyLiteralInputs(graph, 'sampler', 'string'), []);
  assert.equal(comfyNodeLabel('text', graph.text), '指示の入力（text · TextEncode）');
  const input = { ...binding, prompt: [...binding.prompt, sink('text', 'other')] };
  const parsed = parseComfyWorkflowBinding(input, graph);
  assert.deepEqual(parsed, input);
  parsed.images[0][0].node = 'changed';
  assert.equal(binding.images[0][0].node, 'imageB');
  assert.equal(graph.text.inputs.other, 'leave alone');
  assert.deepEqual(graph.sampler.inputs.model, ['model', 0]);
});

// 見込み: 欠損・型違い・二重割当を拒否すれば保存時に入力の曖昧さが残らない。
// 合格: 既存リンク/未知入力/数値prompt/重複sink/空promptとseedを拒否。確認範囲: ローカル検証のみ。
test('rejects missing, linked, wrongly typed and multiply assigned inputs', () => {
  for (const patch of [
    { prompt: [] }, { seed: [] }, { prompt: [sink('text', 'missing')] },
    { prompt: [sink('sampler', 'seed')] }, { seed: [sink('sampler', 'model')] },
    { prompt: [sink('text', 'prompt'), sink('text', 'prompt')] },
    { images: [[sink('imageA', 'image')], [sink('imageA', 'image')]] },
    { images: [[]] },
  ]) assert.throws(() => parseComfyWorkflowBinding({ ...binding, ...patch }, graph));
});

// 見込み: 寸法と参照数を明示すれば固定値や不足画像を補作しない。
// 合格: mapped両方/固定正整数/0〜10枠を受付、片方/混在/11枠を拒否。確認範囲: binding契約。
test('requires paired dimensions or a fixed size and keeps zero to ten exact image slots', () => {
  const fixed = { ...binding, width: [], height: [], fixed_size: [512, 768], images: [] };
  assert.deepEqual(parseComfyWorkflowBinding(fixed, graph), fixed);
  for (const patch of [{ width: [] }, { fixed_size: [512, 768] }, { width: [], height: [], fixed_size: [0, 768] }]) {
    assert.throws(() => parseComfyWorkflowBinding({ ...binding, ...patch }, graph));
  }
  const expanded = structuredClone(graph), slots = [];
  for (let index = 0; index < 11; index++) {
    expanded[`ref${index}`] = { class_type: 'LoadImage', inputs: { image: `${index}.png` } };
    slots.push([sink(`ref${index}`, 'image')]);
  }
  assert.equal(parseComfyWorkflowBinding({ ...fixed, images: slots.slice(0, 10) }, expanded).images.length, 10);
  assert.throws(() => parseComfyWorkflowBinding({ ...fixed, images: slots }, expanded), /0〜10/);
});

// 見込み: 出力・指示処理・登録ID/版の欠損を受付しなければ別定義を確定表示しない。
// 合格: 定義/保存/一覧を読め、未知モード・出力・重複ID・壊れた版を拒否。確認範囲: API応答の模擬データ。
test('decodes versioned definitions and rejects invalid output locations or identities', () => {
  assert.deepEqual(parseComfyWorkflowDefinition(definition), definition);
  assert.deepEqual(parseSavedComfyWorkflow({ workflow: definition }), definition);
  assert.deepEqual(parseComfyWorkflowList({ workflows: [definition] }), [definition]);
  for (const patch of [{ prompt_mode: 'guess' }, { output: { node: 'missing', index: 0 } },
    { output: { node: 'output', index: -1 } }, { output: { node: 'output', index: 64 } }]) {
    assert.throws(() => parseComfyWorkflowBinding({ ...binding, ...patch }, graph));
  }
  for (const patch of [{ id: '../x' }, { version: 0 }, { version: 2.5 }, { name: '  ' }]) {
    assert.throws(() => parseComfyWorkflowDefinition({ ...definition, ...patch }));
  }
  assert.throws(() => parseComfyWorkflowList({ workflows: [definition, definition] }), /重複/);
});

// 見込み: 接続と利用可否を分けて読めば未実行を成功済みと誤認しない。
// 合格: server情報とavailable=false理由を保持、不完全応答を拒否。確認範囲: decoderのみ、実サーバー未使用。
test('keeps connection information and workflow availability as separate results', () => {
  const info = { object_info: { TextEncode: { input: {} } }, endpoint: 'http://127.0.0.1:8188', version: '0.43.2' };
  const check = { available: false, errors: ['Missing node'], endpoint: info.endpoint };
  assert.deepEqual(parseComfyWorkflowInfo(info), info);
  assert.deepEqual(parseComfyWorkflowCheck(check), check);
  assert.throws(() => parseComfyWorkflowInfo({ endpoint: info.endpoint }));
  assert.throws(() => parseComfyWorkflowCheck({ ...check, available: 'yes' }));
});
