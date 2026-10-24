export interface ImageGenerationConnections {
  qwen: { label: string; runtime: string; available: boolean; message: string; models: { role: 'generation' | 'text_encoder' | 'vae'; file: string }[]; steps: number; resolution: number; entrypoint: 'generate_selected' };
  comfyui: { endpoint: string; status: 'unchecked' | 'connected' | 'unavailable'; version: string; message: string };
}

export const IMAGE_GENERATION_MODEL_KEY = 'nyamuru.image-generation-model.v1';
export const QWEN_AGENT_MODEL = 'qwen-image-2.1-turbo';
export function connectedImageModel(storage: Pick<Storage, 'getItem'>): string | null {
  return storage.getItem(IMAGE_GENERATION_MODEL_KEY) === QWEN_AGENT_MODEL ? QWEN_AGENT_MODEL : null;
}

export function imageConnectionSummary(value: object): string {
  const {qwen,comfyui} = value as Partial<ImageGenerationConnections>;
  return [qwen?.available === true ? 'Qwen Turboの実行環境とモデルファイルを確認しました。' : 'Qwen Turboの実行環境またはモデルファイルを確認できません。',
    comfyui?.status === 'connected' ? '別に起動したComfyUIサーバーにも接続できました。' : comfyui?.status === 'unavailable' ? '別に起動したComfyUIサーバーには接続できません。' : ''].filter(Boolean).join('\n');
}

/** Fail closed so an incomplete response cannot look like a verified connection. */
export function decodeImageGenerationConnections(raw: unknown): ImageGenerationConnections {
  const value = raw as ImageGenerationConnections | null;
  const qwen = value?.qwen, comfy = value?.comfyui;
  if (!qwen || !comfy || typeof qwen.available !== 'boolean'
    || ![qwen.label, qwen.runtime, qwen.message, comfy.endpoint, comfy.version, comfy.message].every(v => typeof v === 'string' && v.length <= 500)
    || !Array.isArray(qwen.models) || qwen.models.length !== 3
    || !qwen.models.every(v => v && ['generation', 'text_encoder', 'vae'].includes(v.role) && typeof v.file === 'string' && v.file.length <= 500)
    || new Set(qwen.models.map(v => v.role)).size !== 3
    || !Number.isSafeInteger(qwen.steps) || qwen.steps < 1 || !Number.isSafeInteger(qwen.resolution) || qwen.resolution < 1
    || qwen.entrypoint !== 'generate_selected' || !['unchecked', 'connected', 'unavailable'].includes(comfy.status)) {
    throw new Error('画像生成の接続情報を確認できません');
  }
  return { qwen, comfyui: comfy };
}
