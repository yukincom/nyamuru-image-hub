import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImageGenerationConnections, IMAGE_GENERATION_MODEL_KEY, QWEN_AGENT_MODEL } from '../src/lib/modelConnections.ts';
import { connectAgentImageGeneration, getImageGenerationConnections } from '../src/lib/localBridge.ts';
import { LOCAL_MODEL_PREFERENCES_STORAGE_KEY, DEFAULT_LOCAL_MODEL_PREFERENCES } from '../src/lib/localModelPreferences.ts';

const response = () => ({
  qwen: { label: 'Qwen-Image-2.1 Turbo', runtime: 'ComfyUI Python', available: true, message: 'ファイル確認済み',
    models: [{ role: 'generation', file: 'turbo.safetensors' }, { role: 'text_encoder', file: 'encoder.safetensors' }, { role: 'vae', file: 'vae.safetensors' }], steps: 8, resolution: 1024, entrypoint: 'generate_selected' },
  comfyui: { endpoint: 'http://localhost:8199', status: 'unchecked', version: '', message: '未確認' },
});
test('connection results distinguish file availability from a live server probe', () => {
  assert.equal(decodeImageGenerationConnections(response()).comfyui.status, 'unchecked');
  for (const value of [null, {}, { ...response(), qwen: { ...response().qwen, available: 'yes' } },
    { ...response(), comfyui: { ...response().comfyui, status: 'ready' } },
    { ...response(), qwen: { ...response().qwen, models: null } }]) {
    assert.throws(() => decodeImageGenerationConnections(value), /接続情報/);
  }
});
test('UI and agent use the saved endpoint through the existing bridge transport, without submitting generation', async () => {
  const before = { window: globalThis.window, fetch: globalThis.fetch };
  const calls = [];
  globalThis.window = { setTimeout, clearTimeout, localStorage: { getItem: key => key === LOCAL_MODEL_PREFERENCES_STORAGE_KEY
    ? JSON.stringify({ ...DEFAULT_LOCAL_MODEL_PREFERENCES, comfyuiUrl: 'http://localhost:8199' }) : null } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (/\/api\/new-creation\/(start|stop)$/.test(String(url))) return new Response(JSON.stringify({
      service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1, lease_token: 'fixture', released: true,
    }), { status: 200 });
    return new Response(JSON.stringify({ ...response(), service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 }), { status: 200 });
  };
  try {
    const result = await getImageGenerationConnections(undefined, true);
    assert.equal(result.comfyui.endpoint, 'http://localhost:8199');
    const operation = calls.find(call => call.url.endsWith('/api/image-generation/connections'));
    assert.deepEqual(JSON.parse(operation.options.body), { comfyui_url: 'http://localhost:8199', check_comfyui: true });
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/api/new-creation/start', '/api/health', '/api/image-generation/connections', '/api/new-creation/stop']);
    calls.length = 0;
    await assert.rejects(getImageGenerationConnections('http://example.com', true), /localhost/);
    assert.equal(calls.length, 0);
  } finally { globalThis.window = before.window; globalThis.fetch = before.fetch; }
});


test('connecting the built-in agent saves only a verified executor and never submits a job',async()=>{
  const before={window:globalThis.window,fetch:globalThis.fetch};
  try{
    for(const state of ['available','missing','cancelled','storage-failure']){
      let saved;const requests=[];
      globalThis.window={setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem:(key,value)=>{
        if(state==='storage-failure')throw Error('保存できません');assert.equal(key,IMAGE_GENERATION_MODEL_KEY);saved=value;
      }}};
      globalThis.fetch=async(url)=>{
        requests.push(String(url));
        if(/new-creation/.test(String(url)))return Response.json({service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1,lease_token:'fixture',released:true});
        const value=response();value.qwen.available=state!=='missing';value.qwen.message='実行環境なし';
        return Response.json({...value,service:'nyamuru-image-hub-local-bridge',layout_protocol_version:3});
      };
      if(state==='available'){await connectAgentImageGeneration();assert.equal(saved,QWEN_AGENT_MODEL);}
      else {await assert.rejects(connectAgentImageGeneration(()=>state!=='cancelled'));assert.equal(saved,undefined);}
      assert.ok(requests.every(url=>!/qwen-generation|image-generation\/(prepare|submit)/.test(url)));
    }
  }finally{globalThis.window=before.window;globalThis.fetch=before.fetch;}
});
