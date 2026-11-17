import { useEffect, useRef, useState } from 'preact/hooks';
import { requestComfyWorkflows } from '../lib/localBridge';
import { normalizeComfyuiUrl } from '../lib/localModelPreferences';
import {
  QWEN_FIGURE_WORKFLOW, isStandardQwenVariant, comfyLiteralInputs, comfyNodeLabel, parseComfyWorkflowBinding,
  parseComfyWorkflowFile, parseComfyWorkflowList, parseSavedComfyWorkflow,
  promptUpsamplerNodeIds, withPromptUpsampler, workflowPromptUpsampler,
  type ComfyApiGraph, type ComfyInputBinding, type ComfyWorkflowBinding,
  type ComfyWorkflowDefinition, type ComfyWorkflowSave,
} from '../lib/comfyWorkflows';
import { Field, SectionTitle } from './Fields';
import threeImageGraph from '../../examples/comfyui/nyamuru_qwen_turbo_3images.api.json';
import threeImageBinding from '../../examples/comfyui/nyamuru_qwen_turbo_3images.binding.json';

interface Props {
  endpoint: string;
  onChange: (value: string) => void;
  workflowId: string;
  onWorkflowChange: (value: string) => void;
  onOpenAgent?: () => void;
}
interface Draft {
  id?: string;
  expectedVersion?: number;
  name: string;
  graph: ComfyApiGraph;
  binding: ComfyWorkflowBinding;
}
const seedInputsOnly = (inputs: string[]) => inputs.filter(input => /(^|_)seed$/i.test(input));

interface SeedRow {
  node: string;
  input: string;
  enabled: boolean;
  favorite: boolean;
}

function SeedBindings({ graph, value, disabled, onChange }: {
  graph: ComfyApiGraph; value: ComfyInputBinding[]; disabled: boolean;
  onChange: (value: ComfyInputBinding[]) => void;
}) {
  const inputsFor = (nodeId: string) => seedInputsOnly(comfyLiteralInputs(graph, nodeId, 'number'));
  const nodes = Object.entries(graph).filter(([id]) => inputsFor(id).length > 0);
  const [rows, setRows] = useState<SeedRow[]>(() =>
    value.map(item => ({ node: item.node, input: item.input, enabled: true, favorite: false })),
  );
  useEffect(() => {
    setRows(current => {
      const sameEnabled = current.filter(row => row.enabled).map(({ node, input }) => ({ node, input }));
      if (JSON.stringify(sameEnabled) === JSON.stringify(value)) return current;
      return value.map(item => ({ node: item.node, input: item.input, enabled: true, favorite: false }));
    });
  }, [value]);

  const commit = (next: SeedRow[]) => {
    setRows(next);
    onChange(next.filter(row => row.enabled).map(({ node, input }) => ({ node, input })));
  };

  const singleFixed = nodes.length <= 1 && rows.length === 1;
  const canDelete = !disabled && !singleFixed && rows.some(row => row.enabled && !row.favorite);
  const canAdd = !disabled && (nodes.length > 1 || rows.length === 0);

  return <fieldset>
    <legend>シード</legend>
    {rows.map((row, index) => <div key={index} style="display:grid;grid-template-columns:auto 1fr 1fr auto;gap:5px 10px;align-items:center;margin-bottom:10px;">
      <span />
      <span class="field-label">対象ノード</span>
      <span class="field-label">パラメータ</span>
      <span />
      <input
        type="checkbox"
        aria-label={`シード ${index + 1} を使用`}
        checked={row.enabled}
        disabled={disabled || singleFixed}
        style="margin:0;"
        onChange={event => commit(rows.map((item, i) => i === index ? { ...item, enabled: event.currentTarget.checked } : item))}
      />
      <select aria-label={`シード ${index + 1} ノード`} value={row.node} disabled={disabled || singleFixed}
        style="width:100%;min-width:0;margin:0;"
        onChange={event => {
          const nodeId = event.currentTarget.value;
          const available = nodeId ? inputsFor(nodeId) : [];
          commit(rows.map((item, i) => i === index ? { ...item, node: nodeId, input: available.length === 1 ? available[0] : '' } : item));
        }}>
        <option value="">ノードを選択</option>
        {row.node && !nodes.some(([id]) => id === row.node) && <option value={row.node}>見つからないノード（{row.node}）</option>}
        {nodes.map(([id, node]) => <option key={id} value={id}>{comfyNodeLabel(id, node)}</option>)}
      </select>
      <select aria-label={`シード ${index + 1} 入力`} value={row.input} disabled={disabled || !row.node || singleFixed}
        style="width:100%;min-width:0;margin:0;"
        onChange={event => commit(rows.map((item, i) => i === index ? { ...item, input: event.currentTarget.value } : item))}>
        <option value="">入力を選択</option>
        {row.input && !inputsFor(row.node).includes(row.input) && <option value={row.input}>見つからない入力（{row.input}）</option>}
        {inputsFor(row.node).map(input => <option key={input} value={input}>{input}</option>)}
      </select>
      <button
        type="button"
        class="secondary-button"
        style="margin:0;"
        disabled={disabled || singleFixed}
        aria-label={`シード ${index + 1} をお気に入り`}
        aria-pressed={row.favorite}
        title={row.favorite ? 'お気に入り（削除不可）' : 'お気に入りに登録'}
        onClick={() => commit(rows.map((item, i) => i === index ? { ...item, favorite: !item.favorite } : item))}
      >{row.favorite ? '⭐' : '☆'}</button>
    </div>)}
    <div class="paint-entry-actions">
      <button type="button" class="secondary-button" disabled={!canDelete}
        onClick={() => commit(rows.filter(row => !row.enabled || row.favorite))}>削除</button>
      <button type="button" class="secondary-button" disabled={!canAdd}
        onClick={() => commit([...rows, { node: '', input: '', enabled: true, favorite: false }])}>+ シードの接続先を追加</button>
    </div>
  </fieldset>;
}

function defaultRandomNoiseBinding(graph: ComfyApiGraph): ComfyInputBinding[] {
  for (const [id, node] of Object.entries(graph)) {
    if (node.class_type !== 'RandomNoise') continue;
    const seeds = seedInputsOnly(comfyLiteralInputs(graph, id, 'number'));
    if (seeds.length) return [{ node: id, input: seeds.includes('noise_seed') ? 'noise_seed' : seeds[0] }];
  }
  return [];
}

function defaultLoadImageBindings(graph: ComfyApiGraph): ComfyInputBinding[][] {
  return Object.entries(graph)
    .filter(([id, node]) => node.class_type === 'LoadImage' && comfyLiteralInputs(graph, id, 'string').includes('image'))
    .slice(0, 10)
    .map(([id]) => [{ node: id, input: 'image' }]);
}

function defaultOutputBinding(graph: ComfyApiGraph): { node: string; index: number } {
  const entries = Object.entries(graph);
  const preferred = entries.find(([, node]) => node.class_type === 'NyamuruSavePrintPNG')
    ?? entries.find(([, node]) => node.class_type === 'SaveImage' || node.class_type === 'PreviewImage')
    ?? entries.find(([id]) => id === 'output');
  return { node: preferred ? preferred[0] : '', index: 0 };
}

function editWorkflow(workflow: ComfyWorkflowDefinition): Draft {
  return { id: workflow.id, expectedVersion: workflow.version, name: workflow.name,
    graph: structuredClone(workflow.graph), binding: structuredClone(workflow.binding) };
}

function InputBindings({ label, graph, value, kind, disabled, allowedInputs, onChange }: {
  label: string; graph: ComfyApiGraph; value: ComfyInputBinding[]; kind: 'string' | 'number';
  disabled: boolean; allowedInputs?: (inputs: string[]) => string[]; onChange: (value: ComfyInputBinding[]) => void;
}) {
  const inputsFor = (nodeId: string) => {
    const raw = comfyLiteralInputs(graph, nodeId, kind);
    return allowedInputs ? allowedInputs(raw) : raw;
  };
  const nodes = Object.entries(graph).filter(([id]) => inputsFor(id).length);
  return <fieldset>
    <legend>{label}</legend>
    {value.map((sink, index) => <div class="field-grid" key={index}>
      <Field label="対象ノード"><select aria-label={`${label} ${index + 1} ノード`} value={sink.node} disabled={disabled}
        onChange={event => {
          const nodeId = event.currentTarget.value;
          const available = nodeId ? inputsFor(nodeId) : [];
          onChange(value.map((item, i) => i === index ? { node: nodeId, input: available.length === 1 ? available[0] : '' } : item));
        }}>
        <option value="">ノードを選択</option>
        {sink.node && !nodes.some(([id]) => id === sink.node) && <option value={sink.node}>見つからないノード（{sink.node}）</option>}
        {nodes.map(([id, node]) => <option key={id} value={id}>{comfyNodeLabel(id, node)}</option>)}
      </select></Field>
      <Field label="パラメータ"><select aria-label={`${label} ${index + 1} 入力`} value={sink.input} disabled={disabled || !sink.node}
        onChange={event => onChange(value.map((item, i) => i === index ? { ...item, input: event.currentTarget.value } : item))}>
        <option value="">入力を選択</option>
        {sink.input && !inputsFor(sink.node).includes(sink.input) && <option value={sink.input}>見つからない入力（{sink.input}）</option>}
        {inputsFor(sink.node).map(input => <option key={input} value={input}>{input}</option>)}
      </select></Field>
      <button type="button" class="secondary-button" disabled={disabled} aria-label={`${label} ${index + 1} を削除`}
        onClick={() => onChange(value.filter((_, i) => i !== index))}>削除</button>
    </div>)}
    <div class="paint-entry-actions"><button type="button" class="secondary-button" disabled={disabled}
      onClick={() => onChange([...value, { node: '', input: '' }])}>+ {label}の接続先を追加</button></div>
  </fieldset>;
}

export default function LocalImageModelSettings({ endpoint, onChange, workflowId, onWorkflowChange }: Props) {
  const [workflows, setWorkflows] = useState<ComfyWorkflowDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [removePending, setRemovePending] = useState(false);
  const [sendPrompt, setSendPrompt] = useState(false);
  const revision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileUpdate = useRef<ComfyWorkflowDefinition | null>(null);
  const selected = workflows.find(workflow => workflow.id === workflowId);
  async function operation(task: (current: () => boolean) => Promise<void>) {
    const ticket = ++revision.current;
    const current = () => ticket === revision.current;
    setBusy(true); setError(''); setNotice('');
    try { await task(current); }
    catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : 'ワークフローの操作に失敗しました'); }
    finally { if (current()) setBusy(false); }
  }
  const refresh = () => operation(async current => {
    const next = parseComfyWorkflowList(await requestComfyWorkflows('list', {}));
    if (current()) { setWorkflows(next); setLoaded(true); }
  });
  useEffect(() => { void refresh(); return () => { revision.current++; }; }, []);
  useEffect(() => { setRemovePending(false); setDraft(null); }, [workflowId]);

  function openEditDraft(workflow: ComfyWorkflowDefinition) {
    const next = editWorkflow(workflow);
    setDraft(next);
    setSendPrompt(next.binding.prompt_mode !== 'promptless-two-images' && next.binding.prompt.length > 0);
    setRemovePending(false);
  }

  function chooseFile(update: ComfyWorkflowDefinition | null) {
    fileUpdate.current = update;
    fileInput.current?.click();
  }
  function loadFile(file?: File) {
    if (!file) return;
    const updating = fileUpdate.current;
    void operation(async current => {
      const graph = parseComfyWorkflowFile(await file.text());
      if (!current()) return;
      setDraft(updating ? { ...editWorkflow(updating), graph } : {
        name: file.name.replace(/\.json$/i, ''), graph,
        binding: { prompt: [], seed: defaultRandomNoiseBinding(graph), width: [], height: [], images: defaultLoadImageBindings(graph), output: defaultOutputBinding(graph), prompt_mode: 'promptless-two-images', fixed_size: null, size_source: 'atari' },
      });
      setSendPrompt(updating ? updating.binding.prompt_mode !== 'promptless-two-images' && updating.binding.prompt.length > 0 : false);
      setRemovePending(false);
    });
  }
  const changeDraft = (patch: Partial<Draft>) => setDraft(current => current ? { ...current, ...patch } : current);
  const changeBinding = (patch: Partial<ComfyWorkflowBinding>) => setDraft(current => current ? { ...current, binding: { ...current.binding, ...patch } } : current);
  async function save() {
    if (!draft) return;
    const editing = draft;
    await operation(async current => {
      if (!editing.name.trim()) throw new Error('ワークフローの名前を入力してください');
      const binding = parseComfyWorkflowBinding({ ...editing.binding,
        prompt_mode: sendPrompt ? editing.binding.prompt_mode : 'promptless-two-images',
        prompt: sendPrompt ? editing.binding.prompt : [],
        width: [],
        height: [],
        fixed_size: null,
        size_source: editing.binding.size_source === 'panel' ? 'panel' : 'atari',
      }, editing.graph);
      const body: ComfyWorkflowSave = { name: editing.name.trim(), graph: editing.graph, binding,
        ...(editing.id ? { id: editing.id, expected_version: editing.expectedVersion } : {}) };
      const saved = parseSavedComfyWorkflow(await requestComfyWorkflows('save', { ...body }));
      if (editing.id && (saved.id !== editing.id || saved.version <= (editing.expectedVersion ?? 0))) throw new Error('更新した登録のIDと版を確認できません。一覧を読み直してください');
      if (!current()) return;
      setWorkflows(previous => previous.some(item => item.id === saved.id)
        ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
      setLoaded(true); setDraft(null);
      setNotice(`${saved.name}を${editing.id ? '更新' : '登録'}しました。`);
    });
  }
  async function remove() {
    if (!selected) return;
    const removing = selected;
    await operation(async current => {
      const result = await requestComfyWorkflows('delete', { id: removing.id, expected_version: removing.version }) as { deleted_id?: unknown };
      if (result?.deleted_id !== removing.id) throw new Error('登録解除の結果を確認できません。一覧を読み直してください');
      if (!current()) return;
      setWorkflows(previous => previous.filter(item => item.id !== removing.id));
      setRemovePending(false);
      onWorkflowChange('');
      setNotice(`${removing.name}の登録を解除しました。`);
    });
  }
  const bindingEditor = (label: string, key: 'prompt' | 'seed' | 'width' | 'height', kind: 'string' | 'number', allowedInputs?: (inputs: string[]) => string[]) => draft &&
    <InputBindings label={label} graph={draft.graph} value={draft.binding[key]} kind={kind} disabled={busy} allowedInputs={allowedInputs} onChange={value => changeBinding({ [key]: value })} />;

  return <section class="local-image-model-settings" aria-label="画像生成設定">
    <SectionTitle title="画像生成設定" />
    <Field label="ComfyUI接続先" wide><input aria-label="ComfyUI接続先" value={endpoint} disabled={busy}
      placeholder="http://127.0.0.1:8188" spellcheck={false} onInput={event => onChange(event.currentTarget.value)} /></Field>
    <Field label="使用するワークフロー" wide><select aria-label="使用するワークフロー" value={workflowId} disabled={busy || Boolean(draft && !draft.id)}
      onChange={event => { setNotice(''); onWorkflowChange(event.currentTarget.value); }}>
      <option value="">未選択</option>
      {workflowId && !selected && <option value={workflowId}>{loaded ? '選択した登録が見つかりません' : '登録を読み込んでいます'}</option>}
      {workflows.filter(item=>item.id===workflowId||!isStandardQwenVariant(item.id)).map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
    </select></Field>
    {(selected || draft) && <details class="environment-settings-details" style="border-top:none;padding-top:0;margin-top:8px;margin-bottom:14px;" open={Boolean(draft)}
      onToggle={event => {
        if (event.currentTarget.open && !draft && selected) openEditDraft(selected);
        else if (!event.currentTarget.open && draft?.id) { setDraft(null); setError(''); }
      }}>
      <summary>{draft && !draft.id ? 'ワークフローを追加' : 'ワークフローの詳細設定'}</summary>
      {draft && <>
      <Field label="ワークフロー名" wide><input aria-label="ワークフロー名" value={draft.name} disabled={busy} maxLength={200}
        onInput={event => changeDraft({ name: event.currentTarget.value })} /></Field>
      <Field label="パイプラインの定義" wide><select aria-label="パイプラインの定義" value={draft.binding.prompt_mode} disabled={busy}
        onChange={event => {
          const mode = event.currentTarget.value as ComfyWorkflowBinding['prompt_mode'];
          changeBinding({ prompt_mode: mode });
          if (mode === 'promptless-two-images') setSendPrompt(false);
          else setSendPrompt(true);
        }}>
        <option value="promptless-two-images">2画像参照（1:設定画、2:ポーズ）</option>
        <option value="qwen-three-images">3画像参照（1:表情、2:設定画、3:3Dポーズ）</option>
        <option value="qwen">プロンプト生成</option>
        {draft.binding.prompt_mode === 'plain' && <option value="plain">プロンプト生成（そのまま渡す）</option>}
      </select></Field>
      <div style="display:grid;gap:8px;justify-items:start;">
        <label class="qwen-checkbox" style="display:flex;align-items:center;justify-content:flex-start;gap:8px;white-space:nowrap;width:fit-content;margin:0;">
          <input
            type="checkbox"
            aria-label="プロンプト送信"
            checked={sendPrompt}
            disabled={busy}
            onChange={event => {
              const checked = event.currentTarget.checked;
              setSendPrompt(checked);
              if (checked && draft.binding.prompt_mode === 'promptless-two-images') {
                changeBinding({ prompt_mode: 'qwen' });
              }
            }}
          />
          <span>プロンプト送信</span>
        </label>
        {sendPrompt && bindingEditor('指示文', 'prompt', 'string')}
        {promptUpsamplerNodeIds(draft.graph).length > 0 && (
          <label class="qwen-checkbox" style="display:flex;align-items:center;justify-content:flex-start;gap:8px;white-space:nowrap;width:fit-content;margin:0;">
            <input
              type="checkbox"
              checked={Boolean(draft.graph[promptUpsamplerNodeIds(draft.graph)[0]].inputs.switch)}
              disabled={busy}
              onChange={event => changeDraft({ graph: withPromptUpsampler(draft.graph, event.currentTarget.checked) })}
            />
            <span>プロンプト自動補強（Prompt Upsampler）を既定でオンにする</span>
          </label>
        )}
      </div>
      {draft && <SeedBindings graph={draft.graph} value={draft.binding.seed} disabled={busy} onChange={value => changeBinding({ seed: value })} />}
      <Field label="出力サイズ" wide><select aria-label="出力サイズ" value={draft.binding.size_source === 'panel' ? 'panel' : 'atari'} disabled={busy}
        onChange={event => changeBinding({ size_source: event.currentTarget.value === 'panel' ? 'panel' : 'atari' })}>
        <option value="atari">あたり画像参照</option>
        <option value="panel">コマを参照（所属コマがない場合はあたり画像を参照）</option>
      </select></Field>
      <div class="paint-entry-actions"><button type="button" class="primary-button" disabled={busy} onClick={() => void save()}>{draft.id ? '変更を保存' : '登録する'}</button>
        <button type="button" class="secondary-button" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>元に戻す</button></div>
      </>}
    </details>}
    <div class="paint-entry-actions">
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft) || !selected} onClick={() => setRemovePending(true)}>このワークフローを削除</button>
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft)} onClick={() => void refresh()}>一覧を更新</button>
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft)} onClick={() => chooseFile(null)}>追加</button>
      {loaded&&!workflows.some(item=>item.id===QWEN_FIGURE_WORKFLOW)&&<button type="button" class="secondary-button" disabled={busy || Boolean(draft)} onClick={() => {
        const graph = structuredClone(threeImageGraph);
        setDraft({ name: 'nyamuru_qwen_turbo_3images', graph, binding: parseComfyWorkflowBinding(threeImageBinding, graph) });
        setSendPrompt(true);
        setRemovePending(false);
      }}>人物3枚参照を追加</button>}
    </div>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="API形式のワークフローJSON"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; loadFile(file); }} />
    {!draft && loaded && !workflows.length && <p class="environment-settings-note">ComfyUIで書き出したAPI形式JSONを追加してください。</p>}
    {removePending && selected && <div class="model-connection-result">
      <p>{selected.name}を削除します。ComfyUIの元ファイルと生成結果は保持されます。</p>
      <div class="paint-entry-actions"><button type="button" disabled={busy} onClick={() => void remove()}>削除する</button>
        <button type="button" disabled={busy} onClick={() => setRemovePending(false)}>取消し</button></div>
    </div>}
    {busy && <p role="status">処理しています…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
