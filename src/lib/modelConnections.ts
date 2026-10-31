export interface ImageGenerationConnections {
  workflow: { id: string; name: string; version: number; available: boolean; message: string } | null;
  comfyui: { endpoint: string; status: 'unchecked' | 'connected' | 'unavailable'; version: string; message: string };
  memory_release: { available: boolean };
}

export function imageConnectionSummary(value: object): string {
  const {workflow,comfyui} = value as Partial<ImageGenerationConnections>;
  return [comfyui?.message, workflow ? `${workflow.name}: ${workflow.message}` : '環境設定 → モデルで、使用するワークフローを選んでください。'].filter(Boolean).join('\n');
}

/** Connection, valid bindings and actual inference are distinct observations. */
export function decodeImageGenerationConnections(raw: unknown): ImageGenerationConnections {
  const value = raw as ImageGenerationConnections | null;
  const workflow = value?.workflow, comfy = value?.comfyui;
  if (!value || !comfy || ![comfy.endpoint, comfy.version, comfy.message].every(v => typeof v === 'string')
    || !['unchecked', 'connected', 'unavailable'].includes(comfy.status)
    || typeof value.memory_release?.available !== 'boolean'
    || workflow !== null && (!workflow || typeof workflow.id !== 'string' || typeof workflow.name !== 'string'
      || !Number.isSafeInteger(workflow.version) || workflow.version < 1 || typeof workflow.available !== 'boolean'
      || typeof workflow.message !== 'string')) throw new Error('画像生成の接続情報を確認できません');
  return value;
}
