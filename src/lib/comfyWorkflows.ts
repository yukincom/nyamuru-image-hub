export interface ComfyApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export type ComfyApiGraph = Record<string, ComfyApiNode>;
export interface ComfyInputBinding { node: string; input: string }
export interface ComfyWorkflowBinding {
  prompt: ComfyInputBinding[];
  seed: ComfyInputBinding[];
  width: ComfyInputBinding[];
  height: ComfyInputBinding[];
  images: ComfyInputBinding[][];
  output: { node: string; index: number };
  prompt_mode: 'qwen' | 'plain' | 'qwen-three-images';
  fixed_size: [number, number] | null;
}
export interface ComfyWorkflowDefinition {
  id: string;
  name: string;
  version: number;
  graph: ComfyApiGraph;
  binding: ComfyWorkflowBinding;
}
export interface ComfyWorkflowSave {
  id?: string;
  expected_version?: number;
  name: string;
  graph: ComfyApiGraph;
  binding: ComfyWorkflowBinding;
}
export interface ComfyWorkflowCheck { available: boolean; errors: string[]; endpoint: string }
export interface ComfyWorkflowInfo { object_info: Record<string, unknown>; endpoint: string; version: string }

export const COMFY_WORKFLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Preserve the API graph; neither UI workflows nor guessed node mappings are converted. */
export function parseComfyApiGraph(value: unknown): ComfyApiGraph {
  if (!object(value) || !Object.keys(value).length || Object.values(value).some(node =>
    !object(node) || typeof node.class_type !== 'string' || !node.class_type.trim() || !object(node.inputs))) {
    throw new Error('ComfyUIでAPI形式のJSONを書き出して選択してください');
  }
  return structuredClone(value) as ComfyApiGraph;
}

export function parseComfyWorkflowFile(source: string): ComfyApiGraph {
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { throw new Error('JSONファイルを読み取れません。ComfyUIでAPI形式を書き出してください'); }
  return parseComfyApiGraph(value);
}

export function comfyNodeLabel(id: string, node: ComfyApiNode): string {
  const title = typeof node._meta?.title === 'string' ? node._meta.title.trim() : '';
  return title ? `${title}（${id} · ${node.class_type}）` : `${node.class_type}（${id}）`;
}

/** Connected inputs are not writable slots; keep those graph edges intact. */
export function comfyLiteralInputs(graph: ComfyApiGraph, node: string, kind: 'string' | 'number'): string[] {
  return Object.entries(graph[node]?.inputs ?? {}).filter(([, value]) =>
    typeof value === kind && (kind !== 'number' || Number.isFinite(value))).map(([name]) => name);
}

export function parseComfyWorkflowBinding(value: unknown, graph: ComfyApiGraph): ComfyWorkflowBinding {
  if (!object(value)) throw new Error('入出力の対応付けを設定してください');
  const used = new Set<string>();
  const sinks = (raw: unknown, label: string, kind: 'string' | 'number', required = false): ComfyInputBinding[] => {
    if (!Array.isArray(raw) || required && !raw.length) throw new Error(`${label}の受け渡し先を設定してください`);
    return raw.map(sink => {
      if (!object(sink) || typeof sink.node !== 'string' || typeof sink.input !== 'string'
        || !comfyLiteralInputs(graph, sink.node, kind).includes(sink.input)) {
        throw new Error(`${label}には既存の${kind === 'string' ? '文字列' : '数値'}入力を選択してください`);
      }
      const key = JSON.stringify([sink.node, sink.input]);
      if (used.has(key)) throw new Error('同じ入力へ複数の値を割り当てることはできません');
      used.add(key);
      return { node: sink.node, input: sink.input };
    });
  };
  const prompt = sinks(value.prompt, '指示文', 'string', true);
  const seed = sinks(value.seed, 'シード', 'number', true);
  const width = sinks(value.width, '幅', 'number');
  const height = sinks(value.height, '高さ', 'number');
  if (!Array.isArray(value.images) || value.images.length > 10) throw new Error('参照画像は0〜10枚で設定してください');
  const images = value.images.map((slot, index) => sinks(slot, `参照画像${index + 1}`, 'string', true));
  const fixed = value.fixed_size;
  let fixed_size: [number, number] | null = null;
  if (fixed !== null) {
    if (!Array.isArray(fixed) || fixed.length !== 2 || !fixed.every(value => positiveInteger(value) && value >= 32 && value <= 4096) || width.length || height.length) {
      throw new Error('固定寸法は幅と高さを正の整数で指定し、寸法の受け渡し先は外してください');
    }
    fixed_size = [fixed[0], fixed[1]];
  } else if (!width.length || !height.length) {
    throw new Error('幅・高さの両方に受け渡し先を設定するか、固定寸法を指定してください');
  }
  const output = value.output;
  if (!object(output) || typeof output.node !== 'string' || !Object.hasOwn(graph, output.node)
    || typeof output.index !== 'number' || !Number.isSafeInteger(output.index) || output.index < 0 || output.index > 63) {
    throw new Error('完成画像の出力ノードと画像位置を選択してください');
  }
  if (value.prompt_mode !== 'qwen' && value.prompt_mode !== 'plain' && value.prompt_mode !== 'qwen-three-images') {
    throw new Error('指示文の扱いを選択してください');
  }
  if (value.prompt_mode === 'qwen-three-images' && (images.length !== 3 || fixed_size !== null)) {
    throw new Error('人物3枚参照には参照画像3枚と可変の出力寸法を指定してください');
  }
  return { prompt, seed, width, height, images, output: { node: output.node, index: output.index },
    prompt_mode: value.prompt_mode, fixed_size };
}

export function parseComfyWorkflowDefinition(value: unknown): ComfyWorkflowDefinition {
  if (!object(value) || typeof value.id !== 'string' || !COMFY_WORKFLOW_ID.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || !positiveInteger(value.version)) {
    throw new Error('登録ワークフローの情報を読み取れません');
  }
  const graph = parseComfyApiGraph(value.graph);
  return { id: value.id, name: value.name, version: value.version, graph,
    binding: parseComfyWorkflowBinding(value.binding, graph) };
}

export function parseComfyWorkflowList(value: unknown): ComfyWorkflowDefinition[] {
  if (!object(value) || !Array.isArray(value.workflows)) throw new Error('ワークフロー一覧を読み取れません');
  const workflows = value.workflows.map(parseComfyWorkflowDefinition);
  if (new Set(workflows.map(workflow => workflow.id)).size !== workflows.length) throw new Error('ワークフロー一覧のIDが重複しています');
  return workflows;
}

export function parseSavedComfyWorkflow(value: unknown): ComfyWorkflowDefinition {
  return parseComfyWorkflowDefinition(object(value) ? value.workflow : null);
}

export function parseComfyWorkflowCheck(value: unknown): ComfyWorkflowCheck {
  if (!object(value) || typeof value.available !== 'boolean' || typeof value.endpoint !== 'string'
    || !Array.isArray(value.errors) || !value.errors.every(error => typeof error === 'string')) {
    throw new Error('ワークフローの確認結果を読み取れません');
  }
  return { available: value.available, endpoint: value.endpoint, errors: value.errors as string[] };
}

export function parseComfyWorkflowInfo(value: unknown): ComfyWorkflowInfo {
  if (!object(value) || !object(value.object_info) || typeof value.endpoint !== 'string' || typeof value.version !== 'string') {
    throw new Error('ComfyUIの接続情報を読み取れません');
  }
  return { object_info: value.object_info, endpoint: value.endpoint, version: value.version };
}
