import { render } from 'preact';
import { useState } from 'preact/hooks';
import App from '../src/components/App';
import sampleYaml from '../src/content/sample.yaml?raw';
import { parseMangaYaml, STORAGE_KEY, toStoredMangaYaml } from '../src/lib/manga';
import { prepareImageAsset, createImagePlacement, imageSha256 } from '../src/lib/imagePlacement';
import { saveFigureCropAssets, deleteFigureCropAssets, loadFigureCropAsset } from '../src/lib/figureCropStore';
import { saveCharacterReferenceImage, loadCharacterReferenceImage } from '../src/lib/localBridge';
import { characterImageCacheId } from '../src/lib/browserCatalog';
import { isLanClient } from '../src/lib/clientRuntime';
import '../src/styles/global.css';

if (location.origin !== 'http://127.0.0.1:4339' || !isLanClient) throw Error('Dedicated folder test origin required');
// Model-settings UI uses a clearly labelled fixture; never contact resident services.
const originalFetch = window.fetch.bind(window);
const generationEvents:string[]=[];
let showGenerationEvents=()=>{},preparedJob:Record<string,unknown>|undefined;
const recordGeneration=(step:string)=>{generationEvents.push(step);showGenerationEvents();};
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/__nyamuru/')) return originalFetch(input, init);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const identity = { service: 'nyamuru-image-hub-local-bridge', layout_protocol_version: 3 };
  if (url.pathname === '/__nyamuru/bridge/api/health') return Response.json(identity);
  if (['/__nyamuru/supervisor/api/new-creation/start', '/__nyamuru/supervisor/api/new-creation/stop'].includes(url.pathname)) {
    return Response.json({ service: 'nyamuru-image-hub-bridge-supervisor', protocol_version: 1, lease_token: 'fixture-only', released: true, llm_released:true });
  }
  const supervisor={service:'nyamuru-image-hub-bridge-supervisor',protocol_version:1};
  if(url.pathname==='/__nyamuru/bridge/api/agent/status')return Response.json({...identity,connected:true,model:'検証用エージェント（実推論なし）'});
  if(url.pathname==='/__nyamuru/bridge/api/voice/classify')return Response.json({...identity,text:body.text,label:body.text.includes('生成して')||body.text.includes('生成してください')?'generate_request':'other_request',confidence:1,model:'検証用分類',elapsed_ms:0});
  if(url.pathname==='/__nyamuru/bridge/api/agent/chat')return Response.json({...identity,model:'検証用エージェント',message:{role:'assistant',content:null,tool_calls:[{id:'fixture-connect',type:'function',function:{name:'image_generation',arguments:JSON.stringify({action:'connect'})}}]}});
  if(url.pathname==='/__nyamuru/supervisor/api/panel-actions/prepare')return Response.json(supervisor);
  if(url.pathname==='/__nyamuru/supervisor/api/image-generation/prepare'){recordGeneration('文章LLM停止（模擬）');return Response.json({...supervisor,llm_stopped:true});}
  if(url.pathname==='/__nyamuru/bridge/api/qwen-generation/prepare'){
    recordGeneration(`登録資料 ${body.references.length}枚 → 英訳保存（模擬）`);
    preparedJob={...body,status:'prepared',request_sha256:'a'.repeat(64),created_at:1,width:128,height:192};
    return Response.json({...identity,...preparedJob});
  }
  if(url.pathname==='/__nyamuru/supervisor/api/image-generation/submit'){
    if(!preparedJob||body.payload.job_id!==preparedJob.job_id)throw Error('生成対象が一致しません');
    recordGeneration('生成送信 1回（模擬）');
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=192;
    const context=canvas.getContext('2d')!;context.fillStyle='#198caa';context.fillRect(0,0,128,192);context.fillStyle='white';context.font='20px sans-serif';context.fillText('QA',42,100);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    return Response.json({...supervisor,...preparedJob,status:'succeeded',file_name:`qwen_${preparedJob.job_id}.png`,image:canvas.toDataURL('image/png'),image_sha256:await imageSha256(blob)});
  }
  if (url.pathname === '/__nyamuru/bridge/api/image-generation/connections') return Response.json({ ...identity,
    qwen: { label: 'Qwen-Image-2.1 Turbo', runtime: 'ComfyUI Python', available: true, message: '検証用の接続情報を表示しています',
      models: [{ role: 'generation', file: 'diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors' },
        { role: 'text_encoder', file: 'text_encoders/qwen3vl_8b_int8_convrot.safetensors' }, { role: 'vae', file: 'vae/qwen_image_2.1_vae_bf16.safetensors' }],
      steps: 8, resolution: 1024, entrypoint: 'generate_selected' },
    comfyui: { endpoint: body.comfyui_url || 'http://127.0.0.1:8188', status: body.check_comfyui ? 'unavailable' : 'unchecked', version: '',
      message: body.check_comfyui ? '検証用：未接続の表示' : '接続はまだ確認していません' },
  });
  return Response.json({ ...identity, error: 'この検証画面では実サービスを呼びません' }, { status: 403 });
};
const root = await navigator.storage.getDirectory();
const series = await root.getDirectoryHandle('検証シリーズ', { create: true });
const episode = await series.getDirectoryHandle('第1話', { create: true });
async function seedText(directory: FileSystemDirectoryHandle, name: string, text: string) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable(); await writer.write(text); await writer.close(); return handle;
}
const script = await seedText(episode, '台本.txt', '# 星の喫茶室\n\n- サブタイトル：雨の日\n- 話数：第1話\n- 場所：喫茶店\n- 時間帯：夕方\n- 天候：雨\n\n## あらすじ\n主人公が友人を待っている。');
const settings = await seedText(series, '人物設定.txt', '# 登場人物\n\n## アオ\n- 名前：アオ\n- 役割：喫茶店の店員\n');
let seriesPicker = series, episodePicker = episode, referencePicker = settings;
async function prepareManyReferences() {
  seriesPicker = await root.getDirectoryHandle('資料一覧検証', { create: true });
  episodePicker = await seriesPicker.getDirectoryHandle('新規エピソード', { create: true });
  for (let index = 1; index <= 20; index++) {
    await seedText(seriesPicker, `人物設定_${String(index).padStart(2, '0')}_放課後の喫茶室で使う衣装と表情と立ち姿の参照資料_確認用の長いファイル名.md`,
      `# 登場人物\n## キャラクター\n### 検証人物${index}\n#### 人物像\n資料一覧と人物画面のスクロールを確認するための人物です。\n`);
  }
  return '資料一覧検証フォルダーに20件の資料を用意しました。シリーズフォルダーとして選択してください。';
}
async function chooseReplacementReference() {
  referencePicker = await seedText(seriesPicker, '差し替えた人物設定.txt', '# 登場人物\n## 差し替え人物\n- 名前：差し替え人物\n');
  return '次の資料選択で「差し替えた人物設定.txt」を返します。';
}
async function inspectReferenceOriginals() {
  let count = 0;
  for await (const [name, handle] of (seriesPicker as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'file' && name.startsWith('人物設定_')) count++;
  }
  return `元の資料ファイル: ${count}件（一覧から削除しても原本を保持）`;
}
// Only the pickers are substituted; file reads/writes and IndexedDB handles are browser-native.
Object.assign(window, {
  showDirectoryPicker: async () => sessionStorage.getItem('qa-folder') === 'series' ? seriesPicker : episodePicker,
  showOpenFilePicker: async () => [sessionStorage.getItem('qa-folder') === 'series' ? referencePicker : script],
  showSaveFilePicker: async () => { throw Error('Standalone project saving is forbidden'); },
});
const png=await new Promise<Blob>(resolve=>{
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=48;
  const context=canvas.getContext('2d')!;context.fillStyle='#d79741';context.fillRect(0,0,32,48);
  canvas.toBlob(value=>resolve(value!),'image/png');
});
async function prepareImages() {
  const source = parseMangaYaml(sampleYaml);
  source.manga.meta.title = 'このPCのフォルダー保存';
  const current = localStorage.getItem(STORAGE_KEY);
  source.manga.meta.episode_id = current ? parseMangaYaml(current).manga.meta.episode_id : 'browser-folder-ui-fixture';
  source.manga.meta.series_id = 'browser-folder-ui-series';
  const asset = await prepareImageAsset(new File([png], '原本.png', { type: 'image/png' }));
  await saveFigureCropAssets([{ id: asset.storageId, blob: png }]);
  source.manga.image_assets = [asset];
  source.manga.pages[0].panels[0].images = [createImagePlacement(asset, { x: 40, y: 80, w: 30, h: 30 })];
  const figure=source.manga.pages[0].panels[0].figures![0];
  const owner = source.manga.characters.find(character=>character.localId===figure.refId)??source.manga.characters[0]; owner.scope = 'series'; owner.catalog_id ||= 'browser-folder-character';
  const reference = await saveCharacterReferenceImage(png, '人物資料.png', source.manga.meta.series_id, owner.catalog_id);
  source.manga.materials.push({ key: 'フォルダー検証人物資料', type: 'character', scope: 'series', keywords: [], characterId: owner.localId,
    character_catalog_id: owner.catalog_id, catalog_id: 'browser-folder-reference', source_image: reference.sourceImage });
  localStorage.setItem(STORAGE_KEY, toStoredMangaYaml(source));
  location.reload();
}
async function inspectFile() {
  const file = await (await episode.getFileHandle('作品.nyamuru')).getFile();
  const value = JSON.parse(await file.text());
  return `保存実体: 第1話/作品.nyamuru / ${file.size} bytes / ${value.snapshot.document.manga.meta.title} / 原本画像 ${value.snapshot.assets.length} / 人物資料画像 ${value.characterImages.length}`;
}
async function clearCache() {
  const value = JSON.parse(await (await (await episode.getFileHandle('作品.nyamuru')).getFile()).text());
  const ids = value.snapshot.assets.map((asset: { id: string }) => asset.id);
  for (const item of value.characterImages) ids.push(characterImageCacheId(item.seriesId, item.characterId, item.assetId));
  await deleteFigureCropAssets(ids);
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.setItem('qa-folder', 'episode');
  location.reload();
}
async function checkRestoredImages() {
  const doc = parseMangaYaml(localStorage.getItem(STORAGE_KEY)!);
  const assets = doc.manga.image_assets ?? [];
  for (const asset of assets) if (!await loadFigureCropAsset(asset.storageId)) throw Error('原本が復元されていません');
  const references = doc.manga.materials.filter(item => item.source_image);
  for (const item of references) if (!await loadCharacterReferenceImage(doc.manga.meta.series_id, item.character_catalog_id!, item.source_image!.asset_id)) throw Error('人物資料が復元されていません');
  if (!assets.length || !references.length) throw Error('画像付き作品を開いてください');
  return `PASS: 空キャッシュから原本画像 ${assets.length}・人物資料画像 ${references.length} を復元`;
}
const creationHeaderPositions = new Map<string, number>();
async function inspectCreationLayout(): Promise<string> {
  const dialog = document.querySelector<HTMLElement>('.new-dialog');
  const body = dialog?.querySelector<HTMLElement>('.new-dialog-body');
  const navigation = dialog?.querySelector<HTMLElement>('.new-step-navigation');
  if (!dialog || !body || !navigation) throw Error('新規作成を開いてください');
  const bounds = dialog.getBoundingClientRect();
  const buttons = [...navigation.querySelectorAll<HTMLButtonElement>('button')];
  const back = buttons.find(button => button.textContent?.includes('戻る'));
  const forward = buttons.find(button => /次へ|設定完了/.test(button.textContent ?? ''));
  if (!back) throw Error('上部の戻るがありません');
  const rect = back.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > innerHeight + 1 || rect.bottom > body.getBoundingClientRect().top) throw Error('画面枠または操作欄が見切れています');
  if (forward) {
    const nextRect = forward.getBoundingClientRect();
    if (Math.abs(rect.top - nextRect.top) > 1 || Math.abs(rect.height - nextRect.height) > 1) throw Error('戻ると次への位置・高さが揃っていません');
  }
  const key = `${innerWidth}x${innerHeight}`;
  const previous = creationHeaderPositions.get(key);
  if (previous !== undefined && Math.abs(previous - rect.top) > 1) throw Error('手順によって操作欄の位置が変わっています');
  creationHeaderPositions.set(key, rect.top);
  const originalScroll = body.scrollTop;
  body.scrollTop = body.scrollHeight;
  if (Math.abs(back.getBoundingClientRect().top - rect.top) > 1) throw Error('スクロールすると操作欄が動いています');
  const content = body.querySelector<HTMLElement>('.new-creation-content');
  if (content && content.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1) throw Error('本文の末尾へ到達できません');
  body.scrollTop = originalScroll;
  return `PASS: ${dialog.querySelector('#new-creation-step-title')?.textContent} / ${key} / 戻る上端 ${rect.top}px / 固定操作欄・末尾到達・ボタン整列`;
}
function Controls() {
  const [result, setResult] = useState('検証用フォルダーと接続情報を使用。実作品・モデル処理・Mac Studioの保存先には触れません。');
  const [generationTrace,setGenerationTrace]=useState('生成送信 0回');
  showGenerationEvents=()=>setGenerationTrace(generationEvents.join(' → '));
  const [choice, setChoice] = useState(sessionStorage.getItem('qa-folder') || 'episode');
  const run = (action: () => Promise<string | void>) => async () => { try { const message = await action(); if (message) setResult(message); } catch (error) { setResult(`FAIL: ${String(error)}`); } };
  return <aside style="padding:8px;background:#fff4d5;position:fixed;left:0;bottom:0;max-width:100%;max-height:45vh;overflow:auto;z-index:3000"><details><summary>検証操作</summary>
    <label>選択する検証フォルダー<select value={choice} onChange={event => { setChoice(event.currentTarget.value); sessionStorage.setItem('qa-folder', event.currentTarget.value); }}><option value="episode">第1話</option><option value="series">検証シリーズ</option></select></label>
    <button onClick={run(prepareImages)}>画像付き作品を準備</button>
    <button onClick={run(inspectFile)}>保存実体を確認</button>
    <button onClick={run(clearCache)}>画像キャッシュを消して白紙起動</button>
    <button onClick={run(checkRestoredImages)}>復元した画像を検証</button>
    <button onClick={run(prepareManyReferences)}>多数の資料を準備</button>
    <button onClick={run(chooseReplacementReference)}>差し替え資料を選択</button>
    <button onClick={run(inspectReferenceOriginals)}>資料の原本を確認</button>
    <button onClick={run(inspectCreationLayout)}>新規作成の配置を検証</button>
    <output aria-label="模擬生成の実行記録" style="display:block">{generationTrace}</output>
    <output style="display:block;white-space:pre-wrap" aria-live="polite">{result}</output>
  </details></aside>;
}
render(<Controls />, document.getElementById('test-controls')!);
render(<App />, document.getElementById('app')!);
