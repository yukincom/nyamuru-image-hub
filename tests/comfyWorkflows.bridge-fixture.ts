import type { ComfyApiGraph, ComfyWorkflowDefinition, ComfyWorkflowSave } from '../src/lib/comfyWorkflows';

// 見込み: 登録APIだけをメモリへ差替えると、実UIの保存要求と版競合をモデルなしで観測できる。
// 合格: 成功時だけ定義を更新、版不一致は保持。範囲: 模擬bridge。実サーバー・ファイル保存・生成は未接続。
export const WORKFLOW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const WORKFLOW_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const WORKFLOW_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const importGraph: ComfyApiGraph = {
  text: { class_type: 'TextEncode', inputs: { text: 'Original prompt', extra: 'keep this literal' }, _meta: { title: '入力する指示' } },
  sampler: { class_type: 'Sampler', inputs: { seed: 410, steps: 8, model: ['model', 0] } },
  model: { class_type: 'ModelLoader', inputs: { name: 'fixture-model.safetensors' } },
  size: { class_type: 'Latent', inputs: { width: 768, height: 1024 } },
  reference: { class_type: 'LoadImage', inputs: { image: 'fixture-reference.png' } },
  output: { class_type: 'SaveImage', inputs: { images: ['sampler', 0], filename_prefix: 'fixture' } },
};
function workflow(id: string, name: string): ComfyWorkflowDefinition {
  return { id, name, version: 1, graph: structuredClone(importGraph), binding: {
    prompt: [{ node: 'text', input: 'text' }], seed: [{ node: 'sampler', input: 'seed' }],
    width: [{ node: 'size', input: 'width' }], height: [{ node: 'size', input: 'height' }],
    images: [], output: { node: 'output', index: 0 }, prompt_mode: 'plain', fixed_size: null,
  } };
}
type Action = 'list' | 'save' | 'delete' | 'check' | 'info';
const records = new Map<string, ComfyWorkflowDefinition>();
const calls: { action: Action; body: Record<string, unknown> }[] = [];
let writes = 0, externalUpdates = 0;
const clone = <T,>(value: T): T => structuredClone(value);
function existing(id: unknown) {
  const value = typeof id === 'string' ? records.get(id) : undefined;
  if (!value) throw new Error('登録が見つかりません');
  return value;
}
export const comfyFixture = {
  reset() {
    records.clear(); records.set(WORKFLOW_A, workflow(WORKFLOW_A, 'ワークフローA'));
    records.set(WORKFLOW_B, workflow(WORKFLOW_B, 'ワークフローB'));
    calls.length = 0; writes = 0; externalUpdates = 0;
  },
  snapshot() { return clone({ workflows: Array.from(records.values()), calls, writes, externalUpdates }); },
  get(id: string) { return clone(existing(id)); },
  advanceVersion(id: string) {
    const value = existing(id);
    records.set(id, { ...value, version: value.version + 1 });
    externalUpdates++;
  },
};
comfyFixture.reset();

export async function requestComfyWorkflows(action: Action, body: Record<string, unknown>): Promise<unknown> {
  calls.push({ action, body: clone(body) });
  // The await keeps the component's real busy/response path in use.
  await Promise.resolve();
  if (action === 'list') return { workflows: clone(Array.from(records.values())) };
  if (action === 'info') return { endpoint: body.comfyui_url || 'http://127.0.0.1:8188', version: 'fixture', object_info: {
    TextEncode: { input: { required: { text: ['STRING'] } } },
    Sampler: { input: { required: { seed: ['INT'] } } },
    SaveImage: { output_node: true },
  } };
  if (action === 'check') {
    existing(body.id);
    return { available: true, errors: [], endpoint: body.comfyui_url || 'http://127.0.0.1:8188' };
  }
  if (action === 'save') {
    const request = body as unknown as ComfyWorkflowSave;
    if (Object.keys(body).some(key => !['id', 'expected_version', 'name', 'graph', 'binding'].includes(key))
      || typeof request.name !== 'string' || !request.graph || !request.binding) throw new Error('保存要求はflatな登録形式で送信してください');
    const previous = request.id ? existing(request.id) : null;
    if (previous && previous.version !== request.expected_version) throw new Error('別の端末で更新されました。一覧を読み直してください');
    const id = previous?.id ?? WORKFLOW_C;
    if (!previous && records.has(id)) throw new Error('Fixture allows one new workflow');
    const saved = { id, name: request.name, version: (previous?.version ?? 0) + 1, graph: clone(request.graph), binding: clone(request.binding) };
    records.set(id, saved); writes++;
    return { workflow: clone(saved) };
  }
  if (action === 'delete') {
    const previous = existing(body.id);
    if (body.expected_version !== previous.version) throw new Error('別の端末で更新されました。一覧を読み直してください');
    records.delete(previous.id); writes++;
    return { deleted_id: previous.id };
  }
  throw new Error(`Unexpected fixture action: ${String(action)}`);
}
