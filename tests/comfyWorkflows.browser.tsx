// 見込み: 実設定UIを通せば、選択・mapping・競合・取消しの状態境界をモデルなしで確認できる。
// 合格: 下記各操作の保存内容と件数が一致。範囲: 実DOM、模擬API/Storage/OSファイル選択。作品Undoのpropsは未接続で検証対象外。
import { render } from 'preact';
import { useState } from 'preact/hooks';
import LocalImageModelSettings from '../src/components/LocalImageModelSettings';
import { loadGenerationPreferences, saveGenerationPreferences } from '../src/lib/generationPreferences';
import { loadLocalModelPreferences, saveLocalModelPreferences } from '../src/lib/localModelPreferences';
import { comfyFixture, importGraph, WORKFLOW_A, WORKFLOW_B, WORKFLOW_C } from './comfyWorkflows.bridge-fixture';
import '../src/styles/global.css';

interface Result {
  done: boolean; passed: boolean; status: 'running' | 'passed' | 'failed'; checks: string[];
  error?: string; apiCalls?: string[]; apiWrites?: number; storageWrites?: number;
  fileChooserRequests?: number; blockedRequests?: number; selectedId?: string; scope: string;
}
declare global { interface Window { __comfyWorkflowTest: Result } }
const result: Result = { done: false, passed: false, status: 'running', checks: [],
  scope: '実LocalImageModelSettings・模擬bridge/Storage/ファイル選択。実生成・実API・ディスク保存・作品Undoは対象外。' };
window.__comfyWorkflowTest = result;
const values = new Map<string, string>();
let storageWrites = 0, fileChooserRequests = 0, blockedRequests = 0;
const storage = { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); storageWrites++; } };
const initial = loadGenerationPreferences(storage);
saveGenerationPreferences(storage, { ...initial, local: { ...initial.local, workflowId: WORKFLOW_A } });
storageWrites = 0;
window.fetch = async input => { blockedRequests++; throw new Error(`Fixture blocked unexpected network request: ${String(input)}`); };
const nativeFileClick = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
  if (this.type === 'file' && this.getAttribute('aria-label') === 'API形式のワークフローJSON') { fileChooserRequests++; return; }
  nativeFileClick.call(this);
};

const root = document.getElementById('test-root')!;
function Fixture() {
  const [preferences, setPreferences] = useState(() => loadGenerationPreferences(storage));
  const [local, setLocal] = useState(() => loadLocalModelPreferences(storage));
  const [error, setError] = useState('');
  return <main style="max-width:900px;margin:24px auto;padding:16px 24px;background:var(--paper);">
    <h1>ComfyUI登録設定の検証</h1>
    <p>登録API・端末保存・OSのファイル選択はメモリ内の検証用です。実生成と作品のUndoは確認しません。</p>
    <LocalImageModelSettings endpoint={local.comfyuiUrl} workflowId={preferences.local.workflowId}
      onChange={comfyuiUrl => {
        try { setLocal(saveLocalModelPreferences(storage, { ...local, comfyuiUrl })); setError(''); }
        catch (failure) { setError(String(failure)); }
      }}
      onWorkflowChange={workflowId => {
        try { setPreferences(saveGenerationPreferences(storage, { ...preferences, local: { ...preferences.local, workflowId } })); setError(''); }
        catch (failure) { setError(String(failure)); }
      }} />
    {error && <p role="alert">{error}</p>}
  </main>;
}
const mount = () => render(<Fixture />, root);
const tick = () => new Promise(resolve => setTimeout(resolve, 35));
const visible = (element: Element | null | undefined) => Boolean(element?.getClientRects().length);
const button = (name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(element =>
  visible(element) && (element.getAttribute('aria-label') === name || element.textContent?.trim() === name));
const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => root.querySelector<T>(`[aria-label="${name}"]`);
async function wait(test: () => boolean, label: string) {
  for (let i = 0; i < 120; i++) { if (test()) return; await tick(); }
  throw new Error(`Timeout: ${label}`);
}
const isBusy = () => Array.from(root.querySelectorAll('[role="status"]')).some(element => element.textContent?.trim() === '処理しています…');
async function click(name: string) {
  const element = button(name);
  if (!element || element.disabled) throw new Error(`Button unavailable: ${name}`);
  element.click(); await tick();
}
async function change(name: string, value: string, event = 'change') {
  const element = field(name);
  if (!element || element.disabled || !visible(element)) throw new Error(`Field unavailable: ${name}`);
  element.value = value; element.dispatchEvent(new Event(event, { bubbles: true })); await tick();
}
function check(condition: boolean, label: string) { if (!condition) throw new Error(label); result.checks.push(label); }
function upload(graph: unknown, name: string) {
  const input = field<HTMLInputElement>('API形式のワークフローJSON');
  if (!input) throw new Error('File input missing');
  const files = new DataTransfer();
  files.items.add(new File([JSON.stringify(graph)], name, { type: 'application/json' }));
  input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}
async function mapping(label: string, node: string, input: string, index = 1) {
  await click(`${label}の受け渡し先を追加`);
  await change(`${label} ${index} ノード`, node);
  await change(`${label} ${index} 入力`, input);
}
const selection = () => field<HTMLSelectElement>('使用するワークフロー')?.value;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function run() {
  mount();
  await wait(() => field<HTMLSelectElement>('使用するワークフロー')?.options.length === 3 && !button('一覧を読み直す')?.disabled, '初期一覧');

  // 見込み: 選択IDは保存済み端末設定から再読込できる。合格: B選択後の再mountもB、登録API書込0。範囲: 実selectと模擬Storage。
  await change('使用するワークフロー', WORKFLOW_B);
  check(loadGenerationPreferences(storage).local.workflowId === WORKFLOW_B, 'Bの選択を端末設定へ保存');
  render(null, root); await tick(); mount();
  await wait(() => selection() === WORKFLOW_B && field<HTMLSelectElement>('使用するワークフロー')?.options.length === 3 && !button('一覧を読み直す')?.disabled, 'Bを再表示');
  check(selection() === WORKFLOW_B && comfyFixture.snapshot().writes === 0, '再表示後もB、選択だけでは登録を書き換えない');

  // 見込み: 接続と利用可否確認は生成・登録保存を起こさない。合格: info/checkのみ、書込0件。範囲: 実buttonsと模擬API。
  await click('接続を確認'); await wait(() => !isBusy(), '接続確認');
  await click('利用可否を確認'); await wait(() => !isBusy(), '利用可否確認');
  check(comfyFixture.snapshot().calls.some(call => call.action === 'info') && comfyFixture.snapshot().calls.some(call => call.action === 'check')
    && comfyFixture.snapshot().writes === 0, '接続・利用可否確認は登録保存も生成も行わない');

  // 見込み: OSファイル選択の取消しはdraftを作らない。合格: cancel後はAPI/端末書込増分0、選択B不変。範囲: file cancelイベントを模擬。
  const beforeCancel = comfyFixture.snapshot(), beforeStorage = storageWrites, beforeChooser = fileChooserRequests;
  await click('ファイルから更新');
  field<HTMLInputElement>('API形式のワークフローJSON')!.dispatchEvent(new Event('cancel', { bubbles: true })); await tick();
  check(fileChooserRequests === beforeChooser + 1 && comfyFixture.snapshot().calls.length === beforeCancel.calls.length
    && comfyFixture.snapshot().writes === beforeCancel.writes && storageWrites === beforeStorage
    && selection() === WORKFLOW_B && !field('ワークフロー名'), 'ファイル取消しは書込0件・B保持');

  // 見込み: APIファイル読込だけでは対応を推測保存しない。合格: 空mapping draftと書込0、取消しでB維持。範囲: File読込と実draft UI。
  await click('ファイルから追加'); upload(importGraph, 'cancelled-import.json');
  await wait(() => Boolean(field('ワークフロー名')) && !isBusy(), '追加draft');
  check(!field('指示文 1 ノード') && comfyFixture.snapshot().writes === 0, 'ファイル読込だけでは対応付け・登録を自動確定しない');
  await click('取消し');
  check(selection() === WORKFLOW_B && comfyFixture.snapshot().writes === 0, '登録draftの取消しで既存選択と一覧を保持');

  // 見込み: 明示対応だけを保存すれば原グラフと参照順が維持される。合格: 複数prompt/1画像/寸法/outputが一致、graph不変。範囲: 実UI→模擬save。
  await click('ファイルから追加'); upload(importGraph, 'new-workflow.json');
  await wait(() => Boolean(field('ワークフロー名')) && !isBusy(), '登録draft');
  await change('ワークフロー名', '明示して登録したC', 'input');
  await change('指示文の扱い', 'qwen');
  await mapping('指示文', 'text', 'text'); await mapping('指示文', 'text', 'extra', 2);
  await mapping('シード', 'sampler', 'seed'); await mapping('幅', 'size', 'width'); await mapping('高さ', 'size', 'height');
  const referenceDetails = Array.from(root.querySelectorAll('details')).find(element => element.querySelector('summary')?.textContent?.startsWith('参照画像'));
  if (!referenceDetails) throw new Error('Reference details missing');
  if (!referenceDetails.open) referenceDetails.querySelector('summary')!.click(); await tick();
  await click('参照画像の枠を追加'); await mapping('参照画像1', 'reference', 'image');
  await change('完成画像の出力ノード', 'output'); await change('出力ノード内の画像', '1');
  await click('登録する'); await wait(() => !field('ワークフロー名') && !isBusy(), '登録完了');
  const created = comfyFixture.get(WORKFLOW_C);
  check(created.name === '明示して登録したC' && created.version === 1
    && same(created.binding.prompt, [{ node: 'text', input: 'text' }, { node: 'text', input: 'extra' }])
    && same(created.binding.images, [[{ node: 'reference', input: 'image' }]])
    && same(created.binding.width, [{ node: 'size', input: 'width' }])
    && same(created.binding.height, [{ node: 'size', input: 'height' }])
    && created.binding.fixed_size === null && created.binding.output.node === 'output' && created.binding.output.index === 1
    && created.binding.prompt_mode === 'qwen' && same(created.graph, importGraph), '明示した複数対応・参照順・寸法・出力位置を原グラフとともに保存');
  check(selection() === WORKFLOW_B && loadGenerationPreferences(storage).local.workflowId === WORKFLOW_B, '新規登録で選択Bを勝手に変更しない');

  // 見込み: 更新版の照合失敗は保存済み定義を壊さない。合格: 元ID/版で送信、競合後のserver不変、draft保持、取消しでC選択維持。範囲: 実file更新と模擬競合。
  await change('使用するワークフロー', WORKFLOW_C);
  await click('ファイルから更新');
  const updatedGraph = structuredClone(importGraph); updatedGraph.sampler.inputs.steps = 12;
  upload(updatedGraph, 'updated-workflow.json'); await wait(() => Boolean(field('ワークフロー名')) && !isBusy(), '更新draft');
  await change('ワークフロー名', '保存しない更新案', 'input');
  await change('出力寸法の指定', 'fixed'); await change('固定幅', '512', 'input'); await change('固定高さ', '768', 'input');
  comfyFixture.advanceVersion(WORKFLOW_C);
  const beforeConflict = comfyFixture.get(WORKFLOW_C), beforeConflictWrites = comfyFixture.snapshot().writes;
  await click('変更を保存');
  await wait(() => !isBusy() && Array.from(root.querySelectorAll('[role="alert"]')).some(element => element.textContent?.includes('別の端末で更新')), '版競合の表示');
  const lastSave = comfyFixture.snapshot().calls.filter(call => call.action === 'save').at(-1)!;
  check(lastSave.body.id === WORKFLOW_C && lastSave.body.expected_version === 1
    && same(comfyFixture.get(WORKFLOW_C), beforeConflict) && comfyFixture.snapshot().writes === beforeConflictWrites
    && field<HTMLInputElement>('ワークフロー名')?.value === '保存しない更新案' && selection() === WORKFLOW_C,
  '版競合時は保存済み定義・選択を維持して更新draftを残す');
  await click('取消し');
  check(selection() === WORKFLOW_C && loadGenerationPreferences(storage).local.workflowId === WORKFLOW_C, '競合後の取消しでもCの選択を保持');

  // 見込み: 確認した版だけを解除すれば他の登録を保持できる。合格: 最新版でCのみ削除、選択空、A/B不変、再表示も未選択。範囲: 実解除UIと模擬保存。
  await click('一覧を読み直す'); await wait(() => !isBusy(), '最新一覧');
  const kept = [comfyFixture.get(WORKFLOW_A), comfyFixture.get(WORKFLOW_B)];
  await click('登録解除'); await click('登録を解除する'); await wait(() => selection() === '' && !isBusy(), '解除完了');
  const afterDelete = comfyFixture.snapshot();
  check(afterDelete.workflows.length === 2 && same(afterDelete.workflows, kept)
    && loadGenerationPreferences(storage).local.workflowId === '', 'Cの解除だけが保存され、選択を未選択へ戻す');
  render(null, root); await tick(); mount();
  await wait(() => selection() === '' && field<HTMLSelectElement>('使用するワークフロー')?.options.length === 3 && !button('一覧を読み直す')?.disabled, '解除後再表示');
  check(selection() === '' && field<HTMLSelectElement>('使用するワークフロー')?.options.length === 3, '解除後もA/Bを保持して未選択で再表示');
  check(blockedRequests === 0, '実ネットワーク・生成API呼出し0件');
}

const report = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ol');
report.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:20000;background:white;color:black;border:1px solid #777;padding:12px;max-width:540px;max-height:50vh;overflow:auto';
summary.textContent = 'ComfyUI設定を検証中'; report.append(summary, list); document.body.append(report);
void run().then(() => {
  result.passed = true; result.status = 'passed'; summary.textContent = `ComfyUI設定 PASS ${result.checks.length}`;
}).catch(error => {
  result.error = String(error); result.status = 'failed'; summary.textContent = `ComfyUI設定 FAIL: ${String(error)}`; report.open = true;
}).finally(() => {
  result.done = true; result.apiCalls = comfyFixture.snapshot().calls.map(call => call.action); result.apiWrites = comfyFixture.snapshot().writes;
  result.storageWrites = storageWrites; result.fileChooserRequests = fileChooserRequests; result.blockedRequests = blockedRequests;
  result.selectedId = loadGenerationPreferences(storage).local.workflowId;
  HTMLInputElement.prototype.click = nativeFileClick;
  for (const label of result.checks) { const item = document.createElement('li'); item.textContent = label; list.append(item); }
});
