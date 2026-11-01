import { useEffect, useRef, useState } from 'preact/hooks';
import { requestComfyWorkflows } from '../lib/localBridge';
import { normalizeComfyuiUrl } from '../lib/localModelPreferences';
import {
  QWEN_FIGURE_WORKFLOW, isStandardQwenVariant, comfyLiteralInputs, comfyNodeLabel, parseComfyWorkflowBinding, parseComfyWorkflowCheck,
  parseComfyWorkflowFile, parseComfyWorkflowInfo, parseComfyWorkflowList, parseSavedComfyWorkflow,
  type ComfyApiGraph, type ComfyInputBinding, type ComfyWorkflowBinding, type ComfyWorkflowCheck,
  type ComfyWorkflowDefinition, type ComfyWorkflowInfo, type ComfyWorkflowSave,
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
  sizeMode: 'mapped' | 'fixed';
  fixedSize: [number, number];
}
function editWorkflow(workflow: ComfyWorkflowDefinition): Draft {
  return { id: workflow.id, expectedVersion: workflow.version, name: workflow.name,
    graph: structuredClone(workflow.graph), binding: structuredClone(workflow.binding),
    sizeMode: workflow.binding.fixed_size ? 'fixed' : 'mapped',
    fixedSize: workflow.binding.fixed_size ? [...workflow.binding.fixed_size] : [0, 0] };
}

function InputBindings({ label, graph, value, kind, disabled, onChange }: {
  label: string; graph: ComfyApiGraph; value: ComfyInputBinding[]; kind: 'string' | 'number';
  disabled: boolean; onChange: (value: ComfyInputBinding[]) => void;
}) {
  const nodes = Object.entries(graph).filter(([id]) => comfyLiteralInputs(graph, id, kind).length);
  return <fieldset>
    <legend>{label}</legend>
    {value.map((sink, index) => <div class="field-grid" key={index}>
      <Field label={`受け渡し先 ${index + 1}`}><select aria-label={`${label} ${index + 1} ノード`} value={sink.node} disabled={disabled}
        onChange={event => onChange(value.map((item, i) => i === index ? { node: event.currentTarget.value, input: '' } : item))}>
        <option value="">ノードを選択</option>
        {sink.node && !nodes.some(([id]) => id === sink.node) && <option value={sink.node}>見つからないノード（{sink.node}）</option>}
        {nodes.map(([id, node]) => <option key={id} value={id}>{comfyNodeLabel(id, node)}</option>)}
      </select></Field>
      <Field label="入力"><select aria-label={`${label} ${index + 1} 入力`} value={sink.input} disabled={disabled || !sink.node}
        onChange={event => onChange(value.map((item, i) => i === index ? { ...item, input: event.currentTarget.value } : item))}>
        <option value="">入力を選択</option>
        {sink.input && !comfyLiteralInputs(graph, sink.node, kind).includes(sink.input) && <option value={sink.input}>見つからない入力（{sink.input}）</option>}
        {comfyLiteralInputs(graph, sink.node, kind).map(input => <option key={input} value={input}>{input}</option>)}
      </select></Field>
      <button type="button" class="secondary-button" disabled={disabled} aria-label={`${label} ${index + 1} の対応を外す`}
        onClick={() => onChange(value.filter((_, i) => i !== index))}>この対応を外す</button>
    </div>)}
    <div class="paint-entry-actions"><button type="button" class="secondary-button" disabled={disabled}
      onClick={() => onChange([...value, { node: '', input: '' }])}>{label}の受け渡し先を追加</button></div>
  </fieldset>;
}

export default function LocalImageModelSettings({ endpoint, onChange, workflowId, onWorkflowChange, onOpenAgent }: Props) {
  const [workflows, setWorkflows] = useState<ComfyWorkflowDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [info, setInfo] = useState<ComfyWorkflowInfo | null>(null);
  const [check, setCheck] = useState<ComfyWorkflowCheck | null>(null);
  const [removePending, setRemovePending] = useState(false);
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
  useEffect(() => { setInfo(null); setCheck(null); }, [endpoint]);
  useEffect(() => { setCheck(null); setRemovePending(false); }, [workflowId]);

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
        name: file.name.replace(/\.json$/i, ''), graph, sizeMode: 'mapped', fixedSize: [0, 0],
        binding: { prompt: [], seed: [], width: [], height: [], images: [], output: { node: '', index: 0 }, prompt_mode: 'plain', fixed_size: null },
      });
      setCheck(null); setRemovePending(false);
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
        width: editing.sizeMode === 'mapped' ? editing.binding.width : [],
        height: editing.sizeMode === 'mapped' ? editing.binding.height : [],
        fixed_size: editing.sizeMode === 'fixed' ? editing.fixedSize : null,
      }, editing.graph);
      const body: ComfyWorkflowSave = { name: editing.name.trim(), graph: editing.graph, binding,
        ...(editing.id ? { id: editing.id, expected_version: editing.expectedVersion } : {}) };
      const saved = parseSavedComfyWorkflow(await requestComfyWorkflows('save', { ...body }));
      if (editing.id && (saved.id !== editing.id || saved.version <= (editing.expectedVersion ?? 0))) throw new Error('更新した登録のIDと版を確認できません。一覧を読み直してください');
      if (!current()) return;
      setWorkflows(previous => previous.some(item => item.id === saved.id)
        ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
      setLoaded(true); setDraft(null); setCheck(null);
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
      setRemovePending(false); setCheck(null);
      onWorkflowChange('');
      setNotice(`${removing.name}の登録を解除しました。`);
    });
  }
  const bindingEditor = (label: string, key: 'prompt' | 'seed' | 'width' | 'height', kind: 'string' | 'number') => draft &&
    <InputBindings label={label} graph={draft.graph} value={draft.binding[key]} kind={kind} disabled={busy} onChange={value => changeBinding({ [key]: value })} />;

  return <section class="local-image-model-settings" aria-label="ローカル画像生成">
    <SectionTitle title="ローカル画像生成" />
    <Field label="ComfyUI接続先" wide><input aria-label="ComfyUI接続先" value={endpoint} disabled={busy}
      placeholder="http://127.0.0.1:8188" spellcheck={false} onInput={event => onChange(event.currentTarget.value)} /></Field>
    <p class="environment-settings-note">処理するMac上の接続先です。空欄ならサーバーの設定を使います。</p>
    <div class="paint-entry-actions"><button type="button" class="secondary-button" disabled={busy} onClick={() => void operation(async current => {
      const result = parseComfyWorkflowInfo(await requestComfyWorkflows('info', { comfyui_url: normalizeComfyuiUrl(endpoint) }));
      if (current()) { setInfo(result); setCheck(null); }
    })}>接続を確認</button></div>
    {info && <p role="status">ComfyUIに接続できました{info.version && `（${info.version}）`}。画像生成は行っていません。<br /><code>{info.endpoint}</code></p>}
    <Field label="使用するワークフロー" wide><select aria-label="使用するワークフロー" value={workflowId} disabled={busy || Boolean(draft)}
      onChange={event => { setCheck(null); setNotice(''); onWorkflowChange(event.currentTarget.value); }}>
      <option value="">未選択</option>
      {workflowId && !selected && <option value={workflowId}>{loaded ? '選択した登録が見つかりません' : '登録を読み込んでいます'}</option>}
      {workflows.filter(item=>item.id===workflowId||!isStandardQwenVariant(item.id)).map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
    </select></Field>
    <div class="paint-entry-actions">
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft)} onClick={() => void refresh()}>一覧を読み直す</button>
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft)} onClick={() => chooseFile(null)}>ファイルから追加</button>
      {loaded&&!workflows.some(item=>item.id===QWEN_FIGURE_WORKFLOW)&&<button type="button" class="secondary-button" disabled={busy || Boolean(draft)} onClick={() => {
        const graph = structuredClone(threeImageGraph);
        setDraft({ name: 'nyamuru_qwen_turbo_3images', graph, binding: parseComfyWorkflowBinding(threeImageBinding, graph),
          sizeMode: 'mapped', fixedSize: [0, 0] });
        setCheck(null);
        setRemovePending(false);
      }}>人物3枚参照を追加</button>}
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft) || !selected} onClick={() => selected && chooseFile(selected)}>ファイルから更新</button>
      <button type="button" class="secondary-button" disabled={busy || Boolean(draft) || !selected} onClick={() => { if (selected) { setDraft(editWorkflow(selected)); setCheck(null); setRemovePending(false); } }}>入出力の設定</button>
    </div>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="API形式のワークフローJSON"
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; loadFile(file); }} />
    {!draft && <>
      {loaded && !workflows.length && <p class="environment-settings-note">ComfyUIで書き出したAPI形式JSONを追加してください。</p>}
      {selected && <p class="environment-settings-note">{selected.name} · 版 {selected.version} · 参照画像 {selected.binding.images.length}枚{selected.binding.fixed_size && ` · ${selected.binding.fixed_size[0]} × ${selected.binding.fixed_size[1]}px`}</p>}
      <div class="paint-entry-actions">
        <button type="button" class="secondary-button" disabled={busy || !selected} onClick={() => void operation(async current => {
          if (!selected) return;
          const result = parseComfyWorkflowCheck(await requestComfyWorkflows('check', { id: selected.id, comfyui_url: normalizeComfyuiUrl(endpoint) }));
          if (current()) setCheck(result);
        })}>利用可否を確認</button>
        <button type="button" class="secondary-button" disabled={busy || !selected} onClick={() => setRemovePending(true)}>登録解除</button>
        {onOpenAgent && <button type="button" class="secondary-button" disabled={busy} onClick={onOpenAgent}>エージェントに話す</button>}
      </div>
    </>}
    {check && <div class="model-connection-result" role="status">
      <strong>{check.available ? 'この定義の入出力を確認しました。実生成は未確認です。' : 'この定義は現在利用できません。'}</strong>
      {check.errors.length > 0 && <ul>{check.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      <code>{check.endpoint}</code>
    </div>}
    {removePending && selected && <div class="model-connection-result">
      <p>{selected.name}の登録を解除します。ComfyUIの元ファイルと生成結果は保持されます。</p>
      <div class="paint-entry-actions"><button type="button" disabled={busy} onClick={() => void remove()}>登録を解除する</button>
        <button type="button" disabled={busy} onClick={() => setRemovePending(false)}>取消し</button></div>
    </div>}
    {draft && <details class="environment-settings-details" open>
      <summary>{draft.id ? 'ワークフローを更新' : 'ワークフローを追加'}</summary>
      <Field label="ワークフロー名" wide><input aria-label="ワークフロー名" value={draft.name} disabled={busy} maxLength={200}
        onInput={event => changeDraft({ name: event.currentTarget.value })} /></Field>
      <Field label="指示文の扱い" wide><select aria-label="指示文の扱い" value={draft.binding.prompt_mode} disabled={busy}
        onChange={event => changeBinding({ prompt_mode: event.currentTarget.value as ComfyWorkflowBinding['prompt_mode'] })}>
        <option value="plain">確認した指示文をそのまま渡す</option>
        <option value="qwen">Qwen用の指示・英訳・文字定型を使う</option>
        <option value="qwen-three-images">Qwen人物3枚参照（ネーム・設定画・3D）</option>
      </select></Field>
      <p class="environment-settings-note">入力の対応先を選択して保存してください。対応先以外のグラフは保持されます。</p>
      {bindingEditor('指示文', 'prompt', 'string')}
      {bindingEditor('シード', 'seed', 'number')}
      <Field label="出力寸法" wide><select aria-label="出力寸法の指定" value={draft.sizeMode} disabled={busy}
        onChange={event => changeDraft({ sizeMode: event.currentTarget.value === 'fixed' ? 'fixed' : 'mapped' })}>
        <option value="mapped">ニャムルの幅・高さを渡す</option><option value="fixed">ワークフローの固定寸法を使う</option>
      </select></Field>
      {draft.sizeMode === 'mapped' ? <>{bindingEditor('幅', 'width', 'number')}{bindingEditor('高さ', 'height', 'number')}</> :
        <div class="field-grid">{(['幅', '高さ'] as const).map((label, index) => <Field label={`固定${label}（px）`} key={label}>
          <input type="number" min={32} max={4096} step={1} aria-label={`固定${label}`} value={draft.fixedSize[index] || ''} disabled={busy}
            onInput={event => changeDraft({ fixedSize: index === 0 ? [Number(event.currentTarget.value), draft.fixedSize[1]] : [draft.fixedSize[0], Number(event.currentTarget.value)] })} />
        </Field>)}</div>}
      <details class="environment-settings-details" open={draft.binding.images.length > 0}><summary>参照画像（{draft.binding.images.length}枚）</summary>
        <p class="environment-settings-note">必要な枚数分を追加し、生成時の参照順に対応付けます。</p>
        {draft.binding.images.map((slot, index) => <div key={index}>
          <InputBindings label={`参照画像${index + 1}`} graph={draft.graph} value={slot} kind="string" disabled={busy}
            onChange={value => changeBinding({ images: draft.binding.images.map((item, i) => i === index ? value : item) })} />
          <button type="button" class="secondary-button" disabled={busy} aria-label={`参照画像${index + 1}の枠を外す`}
            onClick={() => changeBinding({ images: draft.binding.images.filter((_, i) => i !== index) })}>この参照画像の枠を外す</button>
        </div>)}
        <div class="paint-entry-actions"><button type="button" disabled={busy || draft.binding.images.length >= 10}
          onClick={() => changeBinding({ images: [...draft.binding.images, []] })}>参照画像の枠を追加</button></div>
      </details>
      <div class="field-grid">
        <Field label="完成画像の出力ノード"><select aria-label="完成画像の出力ノード" value={draft.binding.output.node} disabled={busy}
          onChange={event => changeBinding({ output: { ...draft.binding.output, node: event.currentTarget.value } })}>
          <option value="">出力ノードを選択</option>
          {draft.binding.output.node && !Object.hasOwn(draft.graph, draft.binding.output.node) && <option value={draft.binding.output.node}>見つからないノード（{draft.binding.output.node}）</option>}
          {Object.entries(draft.graph).map(([id, node]) => <option key={id} value={id}>{comfyNodeLabel(id, node)}</option>)}
        </select></Field>
        <Field label="出力ノード内の画像"><select aria-label="出力ノード内の画像" value={draft.binding.output.index} disabled={busy}
          onChange={event => changeBinding({ output: { ...draft.binding.output, index: Number(event.currentTarget.value) } })}>
          {Array.from({ length: 64 }, (_, index) => <option key={index} value={index}>{index + 1}枚目</option>)}
        </select></Field>
      </div>
      <div class="paint-entry-actions"><button type="button" class="primary-button" disabled={busy} onClick={() => void save()}>{draft.id ? '変更を保存' : '登録する'}</button>
        <button type="button" class="secondary-button" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>取消し</button></div>
    </details>}
    {busy && <p role="status">処理しています…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
