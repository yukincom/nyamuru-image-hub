/** 見込み: 登録ワークフローの会話生成も候補選択で止まり、透過5候補から複数をまとめて採用できる。
 * 合格: 候補2/4を1回で追加。追加失敗時は削除0件、削除再試行で重複追加0件。未完了は採用不可。
 * 範囲: 実Dialog・bridge decoder・lifecycle。設定/HTTP/PNGは模擬、実生成/透過処理/作品保存は対象外。 */
import { render } from 'preact';
import PaintEditor,{PaintLayers} from '../src/components/PaintEditor';
import {usePaintWorkspace,type PaintWorkspaceState} from '../src/lib/paintWorkspace';
import {newPaintLayer,type PaintScene} from '../src/lib/paintDocument';
import type {PaintController} from '../src/lib/paintSession';
import QwenGenerationDialog from '../src/components/QwenGenerationDialog';
import { QWEN_GENERATION_PROFILE, type QwenGenerationConversation, type QwenGenerationPlan } from '../src/lib/qwenGeneration';
import { DEFAULT_GENERATION_PREFERENCES, saveGenerationPreferences } from '../src/lib/generationPreferences';
import { DEFAULT_LOCAL_MODEL_PREFERENCES, saveLocalModelPreferences } from '../src/lib/localModelPreferences';
import type { ComfyWorkflowDefinition } from '../src/lib/comfyWorkflows';
import '../src/styles/global.css';

interface Result {
  done: boolean; passed: boolean; status: 'running' | 'passed' | 'failed' | 'preview';
  checks: string[]; scenarios: string[]; error?: string; requests: Record<string, number>;
  selected: number[]; insertions: number; blockedRequests: number; scope: string;
}
declare global { interface Window { __qwenCandidatesTest: Result } }
const result: Result = { done: false, passed: false, status: 'running', checks: [], scenarios: [],
  requests: {}, selected: [], insertions: 0, blockedRequests: 0,
  scope: '実Dialog・localBridge・lifecycle、メモリ内設定と模擬HTTP/PNG。実モデル・透過処理・作品保存は未検証。' };
window.__qwenCandidatesTest = result;

// The real preference readers use page-local Storage; device preferences are untouched.
const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; }, clear: () => values.clear(),
  getItem: key => values.get(key) ?? null, key: index => Array.from(values.keys())[index] ?? null,
  removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
// Explicit live mode uses only the real runtime lifecycle; generation and manuscript pixels remain synthetic.
const liveRuntime=new URLSearchParams(location.search).has('liveRuntime'),nativeFetch=window.fetch.bind(window);
const endpoint = liveRuntime?'http://127.0.0.1:8188':'http://127.0.0.1:8199';
const workflow: ComfyWorkflowDefinition = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '候補検証ワークフロー', version: 7,
  graph: {
    text: { class_type: 'TextEncode', inputs: { text: 'fixture prompt' } },
    sampler: { class_type: 'Sampler', inputs: { seed: 260921 } },
    output: { class_type: 'SaveImage', inputs: { images: ['sampler', 0], filename_prefix: 'fixture' } },
  },
  binding: { prompt: [{ node: 'text', input: 'text' }], seed: [{ node: 'sampler', input: 'seed' }],
    width: [], height: [], images: [], output: { node: 'output', index: 0 }, prompt_mode: 'qwen', fixed_size: [160, 224] },
};
const otherWorkflow: ComfyWorkflowDefinition = { ...workflow, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '未選択ワークフロー', version: 1 };
saveGenerationPreferences(storage, { ...DEFAULT_GENERATION_PREFERENCES,
  local: { ...DEFAULT_GENERATION_PREFERENCES.local, workflowId: workflow.id } });
saveLocalModelPreferences(storage, { ...DEFAULT_LOCAL_MODEL_PREFERENCES, comfyuiUrl: endpoint });

const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 224;
const context = canvas.getContext('2d')!;
function fixtureImage(index: number, transparent: boolean) {
  context.clearRect(0, 0, 160, 224);
  if (!transparent) { context.fillStyle = '#00ff00'; context.fillRect(0, 0, 160, 224); }
  context.fillStyle = ['#874d79', '#607ba1', '#ba744b', '#598575', '#8c854f'][index];
  context.fillRect(25 + index * 4, 30, 100, 160);
  context.fillStyle = 'black'; context.font = '28px sans-serif'; context.fillText(String(index + 1), 70, 110);
  return canvas.toDataURL('image/png');
}
const finalImages = Array.from({ length: 5 }, (_, index) => fixtureImage(index, true));
type Scenario = 'succeeded' | 'failed' | 'outcome_unknown';
let scenario: Scenario = 'succeeded', conversation: QwenGenerationConversation | null = null;
let job: Record<string, unknown> = {};
let failInsertOnce=false,failCleanupOnce=false,closed=false,insertAttempts=0,cleanupAttempts=0;
let runtimeReady=false,runtimeStops=0;
const inserted: { files: File[]; target: QwenGenerationPlan }[] = [];
const calls: { scenario: Scenario; path: string; body: Record<string, unknown> }[] = [];
const failureMessage = (status: Scenario) => status === 'failed'
  ? '候補3の生成に失敗しました（検証用の固定応答）' : '候補3の結果を確認できません（検証用の固定応答）';
window.fetch = async (input, options) => {
  const url = input instanceof Request ? input.url : String(input);
  const path = new URL(url, location.href).pathname.replace(/^\/__nyamuru\/(?:bridge|supervisor)/, '');
  const body: Record<string, unknown> = options?.body ? JSON.parse(String(options.body)) : {};
  calls.push({ scenario, path, body }); result.requests[path] = (result.requests[path] ?? 0) + 1;
  const bridge = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
  const supervisor = { service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1 };
  if (path === '/api/health') return Response.json(bridge);
  if(path==='/api/image-generation/start'){
    if(liveRuntime){
      const response=await nativeFetch('http://127.0.0.1:8786'+path,options),payload=await response.json();
      if(!response.ok||payload.comfy_ready!==true)throw new Error(payload.error||'実ComfyUIの起動を確認できません');
      runtimeReady=true;return Response.json(payload);
    }
    runtimeReady=true;
    return Response.json({...supervisor,session_token:body.session_token,comfy_ready:true,comfy_started:true,comfy_managed:true});
  }
  if(path==='/api/image-generation/stop'){
    if(liveRuntime){
      const response=await nativeFetch('http://127.0.0.1:8786'+path,options),payload=await response.json();
      if(!response.ok||payload.comfy_stopped!==true)throw new Error(payload.error||'実ComfyUIの終了を確認できません');
      runtimeReady=false;runtimeStops++;return Response.json(payload);
    }
    runtimeReady=false;runtimeStops++;
    return Response.json({...supervisor,comfy_released:true,comfy_stopped:true});
  }
  if (path === '/api/new-creation/start') return Response.json({ ...supervisor, lease_token: 'candidate-fixture' });
  if (path === '/api/new-creation/stop') return Response.json({ ...supervisor, released: true, llm_released: true });
  if (path === '/api/comfy-workflows/list') return Response.json({ ...bridge, workflows: [otherWorkflow, workflow] });
  if (path === '/api/panel-actions/prepare') return Response.json({ ...supervisor, ready: true });
  if (path === '/api/image-generation/prepare') return Response.json({ ...supervisor, llm_stopped: true });
  if (path === '/api/qwen-generation/prepare') {
    if(!runtimeReady)throw new Error('ComfyUI起動前に生成準備されました');
    if (body.candidate_count !== 5 || body.workflow_id !== workflow.id || body.workflow_version !== workflow.version
      || body.comfyui_url !== endpoint || body.width !== 160 || body.height !== 224 || body.chroma_key_color !== '#00FF00'||body.candidate_cutout!==true) {
      throw new Error('5候補・選択ワークフロー/版・接続先・固定寸法・背景色の送信内容が一致しません');
    }
    job = { ...body, request_sha256: 'a'.repeat(64), status: 'prepared', created_at: 1,
      workflow_name: workflow.name, file_name: `qwen_${body.job_id}.png` };
    return Response.json({ ...bridge, ...job });
  }
  if (path === '/api/image-generation/submit') {
    const payload = body.payload as Record<string, unknown>;
    if (payload?.job_id !== job.job_id || payload.request_sha256 !== job.request_sha256) throw new Error('確定済みjobと異なる送信です');
    return Response.json({ ...supervisor, ...job, status: scenario, requires_cutout: true,
      ...(scenario === 'succeeded' ? {} : { error: failureMessage(scenario) }),
      candidate_cutout:true,candidates: finalImages.slice(0, scenario === 'succeeded' ? 5 : 2).map((image, index) => ({ image, index: index + 1, seed: 260921 + index })) });
  }
  if(path==='/api/qwen-generation/reconcile'){
    if(body.job_id!==job.job_id||cleanupAttempts!==1)throw new Error('削除失敗後の照合以外が呼ばれました');
    return Response.json({...bridge,...job,status:'succeeded',candidate_cutout:true,selected_candidates:[2,4],adopted:true,candidates_discarded:false,
      candidates:finalImages.map((image,index)=>({image,index:index+1,seed:260921+index}))});
  }
  if (path === '/api/qwen-generation/select') {
    if(scenario!=='succeeded'||body.job_id!==job.job_id||JSON.stringify(body.candidate_indices)!=='[2,4]')throw new Error('完了jobの候補2/4以外が採用されました');
    if(body.adopted){
      if(inserted.length!==1)throw new Error('レイヤー追加成功前に削除されました');
      cleanupAttempts++;
      if(failCleanupOnce){failCleanupOnce=false;throw new Error('検証用：ComfyUI削除失敗');}
    }else result.selected.push(...body.candidate_indices as number[]);
    return Response.json({...bridge,...job,status:'succeeded',candidate_cutout:true,selected_candidates:[2,4],adopted:body.adopted===true,candidates_discarded:body.adopted===true,
      candidates:finalImages.flatMap((image,index)=>!body.adopted||[1,3].includes(index)?[{image,index:index+1,seed:260921+index}]:[])});
  }
  result.blockedRequests++;
  throw new Error(`Fixture blocked unexpected request: ${path}`);
};
// A page close during a test must not send a real lifecycle request either.
Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => { result.blockedRequests++; return false; } });

const plan: QwenGenerationPlan = { profile: QWEN_GENERATION_PROFILE, documentKey: 'candidate-fixture', pageNumber: 1,
  panelId: 1, overlay: false, ownerKey: 'figure-0', label: '検証人物', width: 160, height: 224,
  prompt: '人物を描く', characterKeys: [], candidates: [] };
const root = document.getElementById('test-root')!;
const paintControl:{current:PaintController|null}={current:null};let workspace:PaintWorkspaceState|null=null;
function PaintProbe(){workspace=usePaintWorkspace();return null;}
const frame={x:0,y:0,w:160,h:224};
const initialPaint:PaintScene={frame,generatedImageSequence:0,owners:[{key:'figure-0',kind:'figure',index:0,label:'原稿の人物',frame,paint:{version:1,dpi:25.4,width:160,height:224,guideInitialized:true,layers:[newPaintLayer('あたり')],folders:[{id:'parent',name:'親',position:0},{id:'child',name:'候補',parentFolderId:'parent',position:0}]}}]};
let ready=false;
const report = document.createElement('output'); report.setAttribute('aria-label', '候補生成の検証結果');
report.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;background:white;color:black;padding:8px;max-width:90vw';
report.textContent = '候補生成を検証中'; document.body.append(report);
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.qwen-generation-dialog button'))
  .find(element => element.textContent?.trim() === name);
async function wait(test: () => boolean, label: string) {
  for (let attempt = 0; attempt < 150; attempt++) { if (test()) return; await tick(); }
  throw new Error(`待機失敗: ${label}`);
}
function check(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
  result.checks.push(label);
}
async function mount(status: Scenario) {
  render(null, root); await tick(); conversation = null; job = {}; scenario = status;
  ready=false;closed=false;
  // The host keeps PaintEditor mounted after fake onClose; disable its background key handler as the real App does while a dialog is open.
  render(<><PaintEditor toolPaletteEnabled={false} initial={initialPaint} assets={[]} page={1} panelIndex={0} overlay={false} initialOwner="figure-0" title="採用検証" controller={paintControl} onReady={()=>{ready=true;}} onApply={async()=>{}} onClose={()=>{}}><PaintProbe/><PaintLayers/></PaintEditor>
    <QwenGenerationDialog plan={plan} onClose={() => {closed=true;}}
    onConversation={value => { conversation = value; }}
    onInsert={async (file, target, adoption) => {
      insertAttempts++;const files=Array.isArray(file)?file:[file];
      if(JSON.stringify(adoption?.indices)!=='[2,4]')throw new Error('採用集合が一致しません');
      if(failInsertOnce){failInsertOnce=false;try{await paintControl.current!.insertImage([files[0],new File(['invalid PNG'],'失敗.png',{type:'image/png'})],plan.ownerKey,{frame,referenceFrame:frame,folderId:'child'},adoption);}catch{throw new Error('検証用：画像の追加失敗');}throw new Error('不正PNGを受け付けた');}
      await paintControl.current!.insertImage(files,plan.ownerKey,{frame,referenceFrame:frame,folderId:'child'},adoption);
      inserted.push({files,target});result.insertions=inserted.length;
    }}/></>, root);
  await wait(() => ready&&Boolean(conversation) && button('5枚を生成する')?.disabled === false, `${status}: 登録ワークフロー読込`);
}
async function generate(status: Scenario) {
  await mount(status);
  const reply = await conversation!.send('生成して', () => true);
  await wait(() => document.querySelectorAll('.qwen-candidate').length === (status === 'succeeded' ? 5 : 2)
    && !conversation?.busy, `${status}: 候補表示`);
  return reply;
}
const selectionButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.qwen-result button.primary-button')).find(element=>element.textContent?.includes('枚を追加')||element.textContent?.includes('削除を再試行'));

async function run() {
  // 見込み: 保存済みIDで一覧中の定義を選べば、版・URL・寸法を保って5候補を作れる。合格: 実要求の各値一致、生成中も追加0件。範囲: 実読込と模擬登録API。
  const reply = await generate('succeeded');
  const prepared = calls.find(call => call.path === '/api/qwen-generation/prepare')!.body;
  check(result.requests['/api/comfy-workflows/list'] === 1 && prepared.workflow_id === workflow.id
    && prepared.workflow_version === 7 && prepared.comfyui_url === endpoint && prepared.width === 160 && prepared.height === 224,
  '保存済みIDを一覧から選び、版7・接続先・固定寸法を生成要求へ渡す');
  check(document.querySelector('.qwen-output-size')?.textContent?.includes(workflow.name), '選択した登録ワークフローを表示');
  check(reply.includes('5枚') && reply.includes('選んで'), '成功時の会話は5候補からの選択を案内');
  check(document.querySelectorAll('.qwen-candidate').length === 5 && result.selected.length === 0 && inserted.length === 0,
    '5候補の表示時点では採用APIも追加callbackも0件');
  check(runtimeReady&&runtimeStops===0,'生成ボタンからComfyUIを準備し、5候補の表示中は起動を保持');
  check(selectionButton()?.disabled && !button('新規レイヤーとして追加'), '候補未選択では確定も追加もできない');

  // 見込み: 選択は候補比較だけに留め、一括追加の成功後に破棄する。失敗時は同じ操作を続けられる。
  // 合格: 2/4のPNGと元対象を1回のcallbackへ渡す。追加失敗は削除0件、削除再試行は再追加0件。範囲: 実Dialog・模擬HTTP/PNG。
  for(const index of [1,3])document.querySelectorAll<HTMLButtonElement>('.qwen-candidate')[index].click();
  await tick();
  check(document.querySelectorAll('.qwen-candidate[aria-pressed="true"]').length===2
    &&document.querySelector<HTMLImageElement>('.qwen-candidate-preview')?.src===finalImages[3]
    &&result.selected.length===0&&inserted.length===0,'候補2/4は透過済みで比較し、選択だけでは追加しない');
  if(new URLSearchParams(location.search).has('preview')){result.status='preview';result.done=true;report.textContent='透過5候補・2/4選択中';return;}
  failInsertOnce=true;failCleanupOnce=true;
  selectionButton()!.click();await wait(()=>document.querySelector('[role="alert"]')?.textContent?.includes('画像の追加失敗')===true&&!conversation?.busy,'追加失敗');
  check(cleanupAttempts===0&&inserted.length===0&&document.querySelectorAll('.qwen-candidate').length===5&&paintControl.current!.snapshot().scene.owners[0].paint.layers.length===1&&paintControl.current!.snapshot().imports.length===0,'2枚目の読込失敗でも原稿・番号・取込画像を確定せず、5候補を保持');
  selectionButton()!.click();await wait(()=>document.querySelector('[role="alert"]')?.textContent?.includes('ComfyUI削除失敗')===true&&!conversation?.busy,'削除失敗');
  check(inserted.length===1&&insertAttempts===2&&cleanupAttempts===1,'追加の再試行は1バッチとして成功し、削除失敗でも追加済みを保持');
  // 見込み: 同じjobの状況確認でも追加済み状態が残り、削除だけを続けられる。
  // 合格: 照合後も削除再試行の表示と追加回数2を保持。範囲: 実Dialog、照合応答は固定。
  button('生成状況を確認')!.click();await wait(()=>result.requests['/api/qwen-generation/reconcile']===1&&!conversation?.busy,'削除失敗後の状況確認');
  check(selectionButton()?.textContent==='未採用画像の削除を再試行'&&insertAttempts===2,'状況確認後も同じjobの追加済み状態を保持');
  selectionButton()!.click();await wait(()=>closed&&!conversation?.busy,'削除だけ再試行');
  check(insertAttempts===2&&inserted.length===1&&cleanupAttempts===2,'削除の再試行で採用レイヤーを重複追加しない');
  check(!runtimeReady&&runtimeStops===1,'全追加と削除の成功後に画面を閉じ、ComfyUIを解放');
  check(result.selected.join(',')==='2,4'&&inserted[0].files.length===2&&inserted[0].target.ownerKey===plan.ownerKey,'候補2/4を元の対象へ別画像としてまとめて渡す');
  for(const [index,file] of inserted[0].files.entries()){
    const actual=new Uint8Array(await file.arrayBuffer()),expected=Uint8Array.from(atob(finalImages[[1,3][index]].split(',')[1]),c=>c.charCodeAt(0));
    check(actual.length===expected.length&&actual.every((byte,i)=>byte===expected[i]),'採用PNGと透過プレビューが一致');
  }
  // 見込み: バッチを既存の描画確定に渡せば同じ親に追加でき、履歴も1操作になる。
  // 合格: 改名可能な生成01/02・元あたり保持・追加再試行無変化、Undo1回/Redoで同じID。範囲: 実PaintEditor、作品ファイル保存は別確認。
  const saved=paintControl.current!.snapshot(),layers=saved.scene.owners[0].paint.layers,added=layers.filter(layer=>layer.generation);
  check(added.map(layer=>layer.name).join(',')==='生成 01,生成 02'&&added.every(layer=>layer.folderId==='child')&&layers.some(layer=>layer.name==='あたり')&&saved.scene.generatedImageSequence===2,'元の入れ子フォルダーに生成01/02を追加し、あたりと通番を保持');
  await paintControl.current!.insertImage(inserted[0].files,plan.ownerKey,{frame,referenceFrame:frame,folderId:'child'},{jobId:String(job.job_id),indices:[2,4]});await tick();
  check(paintControl.current!.snapshot().scene===saved.scene,'同じ採用の再試行は番号も履歴も増やさない');
  workspace!.undo();await tick();check(paintControl.current!.snapshot().scene.owners[0].paint.layers.length===1,'Undo1回で2枚とも戻る');
  workspace!.redo();await tick();check(paintControl.current!.snapshot().scene.owners[0].paint.layers.filter(layer=>layer.generation).map(layer=>layer.id).join(',')===added.map(layer=>layer.id).join(','),'Redoは同じ2枚の名前とIDを復元');
  result.scenarios.push('透過5候補・複数採用・追加失敗・削除再試行');

  // 見込み: 部分失敗を完了と扱わなければ、残った2候補を保持して理由を伝えられる。合格: failed/unknown各々の状態・理由・2枚、採用不可、成功や挿入の誤案内なし。範囲: 終端/未確定応答は固定。
  for (const status of ['failed', 'outcome_unknown'] as const) {
    const partialReply = await generate(status);
    check(partialReply.includes('候補2枚') && partialReply.includes('保持') && partialReply.includes(failureMessage(status))
      && !/5枚生成しました|新規レイヤーとして追加しました/.test(partialReply), `${status}: 会話は2枚保持と理由を伝え、完了・追加を主張しない`);
    check(document.querySelector('.qwen-result > strong')?.textContent === (status === 'failed' ? '失敗' : '結果未確定')
      && document.querySelector('.qwen-result')?.textContent?.includes(failureMessage(status))
      && document.querySelectorAll('.qwen-candidate').length === 2, `${status}: 正しい状態・理由と2候補を表示`);
    document.querySelector<HTMLButtonElement>('.qwen-candidate')!.click(); await tick();
    check(selectionButton()?.disabled && !button('新規レイヤーとして追加')
      && result.selected.join(',') === '2,4' && inserted.length === 1, `${status}: 候補を選んでも確定・追加不可、成功ケース以外の変更0件`);
    // 見込み: 失敗後も閉じる/Escapeを共通終了へ通せば、runtimeだけが残らない。
    // 合格: 明示closeとEscapeそれぞれでstop1回、画面終了。範囲: 実Dialog、HTTPは固定。
    const stopsBefore=runtimeStops;
    if(status==='failed')button('閉じる')!.click();
    else document.querySelector('.qwen-generation-dialog')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await wait(()=>closed&&!conversation?.busy,`${status}: 画面close`);
    check(!runtimeReady&&runtimeStops===stopsBefore+1,`${status}: 閉じる/EscapeでComfyUIを終了`);
    result.scenarios.push(`${status}: 2候補保持・採用不可・誤成功案内なし`);
  }
  check(result.requests['/api/comfy-workflows/list'] === 3 && result.requests['/api/qwen-generation/prepare'] === 3
    && result.requests['/api/image-generation/submit'] === 3 && result.requests['/api/qwen-generation/select'] === 3
    && result.requests['/api/qwen-generation/reconcile']===1 && result.blockedRequests === 0,
  '3ケース各1回の読込・準備・送信、確定1回・削除2回・状況確認1回、生成再送・予期しない通信0件');
  render(null, root);
  result.done = true; result.passed = true; result.status = 'passed';
  report.textContent = `候補生成 PASS：${result.scenarios.length}ケース・${result.checks.length}検査（${liveRuntime?'ComfyUI起動/終了は実処理、生成/PNGは模擬':'HTTP/PNG模擬'}）`;
}
void run().catch(error => {
  render(null, root);
  result.done = true; result.status = 'failed'; result.error = String(error);
  report.textContent = `候補生成 FAIL：${result.error}`;
});
