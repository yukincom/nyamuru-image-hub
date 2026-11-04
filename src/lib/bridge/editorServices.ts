import { withNewCreationBridgeSession, withPanelActionServices } from '../localBridgeLifecycle.ts';
import { postBridgeJson, postJson, verifiedPngSha256 } from './transport.ts';
import { currentLocalModelPreferences, normalizeComfyuiUrl } from '../localModelPreferences.ts';
import { decodeImageGenerationConnections } from '../modelConnections.ts';
import { currentGenerationPreferences } from '../generationPreferences.ts';
import type { HumanPoseCatalog } from '../humanPoseTypes.ts';
import { parseHumanPoseCatalog, humanPoseSelectable } from '../humanPoseSelection.ts';
import { decodeHumanPoseScene } from '../humanPoseSceneAssets.ts';
import type { AgentRequest, AgentReply } from '../agentChat.ts';

/** The local helper returns a native .clip; no project save is performed. */
export async function requestClipExport(page:import('../clipExport.ts').ClipExportPage):Promise<Blob> {
  return withNewCreationBridgeSession(async()=>{
    const value=await postBridgeJson('/api/export/clip',page,270_000) as Record<string,unknown>;
    if(value.profile!=='nyamuru-clip-v1'||typeof value.clip_data!=='string')throw new Error('CLIP書き出しの応答を確認できませんでした');
    const binary=atob(value.clip_data);
    if(!binary.startsWith('CSFCHUNK')||binary.length!==value.byte_length)throw new Error('CLIP書き出しデータが不完全です');
    return new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:'application/octet-stream'});
  });
}

export async function getImageGenerationConnections(comfyuiUrl = currentLocalModelPreferences().comfyuiUrl, checkComfyui = false) {
  const endpoint = normalizeComfyuiUrl(comfyuiUrl);
  return withNewCreationBridgeSession(async () => decodeImageGenerationConnections(await postBridgeJson('/api/image-generation/connections', {
    comfyui_url: endpoint, check_comfyui: checkComfyui, workflow_id: currentGenerationPreferences().local.workflowId,
  }, 15_000)));
}

/** Verify the selected definition without creating another device setting. */
export async function connectAgentImageGeneration(isCurrent: () => boolean = () => true) {
  if (!currentGenerationPreferences().local.workflowId) throw new Error('環境設定 → モデルで、使用するComfyUIワークフローを選んでください');
  const result = await getImageGenerationConnections(undefined, true);
  if (!isCurrent()) throw new Error('接続を中止しました');
  if (!result.workflow?.available) throw new Error(result.workflow?.message || result.comfyui.message);
  return result;
}

export function requestComfyWorkflows(action: 'list' | 'save' | 'delete' | 'check' | 'info', body: object = {}): Promise<unknown> {
  return withNewCreationBridgeSession(() => postBridgeJson(`/api/comfy-workflows/${action}`, body, 30_000));
}

/** 一度検証したsnapshotから一覧とPNGを読み、原本に変更があれば表示しない。 */
export async function loadHumanPoseCatalog(): Promise<HumanPoseCatalog> {
  const payload = await postJson('/api/human-pose/catalog', {}) as Record<string, unknown>;
  const catalog = parseHumanPoseCatalog(payload);
  const previews: Record<string, string> = {};
  if (!payload.previews || typeof payload.previews !== 'object' || Array.isArray(payload.previews)) {
    throw new Error('人体ポーズの一覧画像がありません');
  }
  const received = payload.previews as Record<string, unknown>;
  await Promise.all(catalog.poses.filter(humanPoseSelectable).map(async pose => {
    const encoded = received[pose.id], record = pose.asset_files.preview!;
    if (typeof encoded !== 'string' || encoded.length > 12 * 1024 * 1024) throw new Error('人体ポーズの一覧画像が不正です');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    if (bytes.length !== record.byte_size || await verifiedPngSha256(blob) !== record.sha256) {
      throw new Error('人体ポーズの一覧画像とカタログが一致しません');
    }
    previews[pose.id] = `data:image/png;base64,${encoded}`;
  }));
  return { ...catalog, previews };
}

export async function loadHumanPoseScene(poseId: string, catalogSha256: string, bodyModel?: import('../humanPoseTypes.ts').HumanPoseBodyModel) {
  const payload = await postJson('/api/human-pose/scene', { pose_id: poseId, catalog_sha256: catalogSha256, include_base: false, ...(bodyModel ? { body_model: bodyModel } : {}) });
  return decodeHumanPoseScene(payload, poseId, catalogSha256, bodyModel);
}

/** Voice and typed commands share the existing local bridge identity check. */
export function requestVoiceCommand(action:'voice/transcribe'|'voice/classify',body:object):Promise<unknown>{
  return withNewCreationBridgeSession(()=>postJson(`/api/${action}`,body,action==='voice/transcribe'?90_000:70_000));
}

export async function getAgentConnection():Promise<{connected:boolean;model:string}>{
  const value=await withNewCreationBridgeSession(()=>postJson('/api/agent/status',{},8_000)) as Record<string,unknown>;
  if(typeof value.connected!=='boolean'||typeof value.model!=='string')throw new Error('LLMの接続を確認できません');
  return {connected:value.connected,model:value.model};
}

export function withAgentServices<T>(task:()=>Promise<T>,isCurrent:()=>boolean){return withPanelActionServices(task,{isCurrent});}
export async function requestAgentReply(body:AgentRequest):Promise<AgentReply>{
  const value=await postJson('/api/agent/chat',body,210_000) as AgentReply;
  if(!value?.message||value.message.role!=='assistant'||typeof value.model!=='string'||
    (value.message.content!==null&&typeof value.message.content!=='string')||
    (value.message.tool_calls!==undefined&&(!Array.isArray(value.message.tool_calls)||value.message.tool_calls.some(c=>!c||c.type!=='function'||typeof c.id!=='string'||typeof c.function?.name!=='string'||typeof c.function?.arguments!=='string'))))throw Error('エージェントの応答形式を確認できません');
  return value;
}
