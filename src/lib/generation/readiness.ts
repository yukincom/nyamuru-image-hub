import type { QwenGenerationPlan, QwenLayerReference, QwenReference } from './ownerPlan.ts';
import { requireHumanPoseGenerationReady } from '../humanPoseSelection.ts';

export interface GenerationBlocker {
  code: string;
  label: string;
  state: 'waiting' | 'action_required';
  detail: string;
}

export interface GenerationReadiness {
  ready: boolean;
  message: string;
  blockers: GenerationBlocker[];
}

interface ReadinessInput {
  working: boolean;
  phase: string;
  attempted: boolean;
  cloud: boolean;
  hasWorkflow: boolean;
  workflowError: string;
  plan: QwenGenerationPlan;
  threeImages: boolean;
  usesPoseImage: boolean;
  targetError: string;
  poseImage: string;
  poseError: string;
  characterLoading: boolean;
  sketchLoading: boolean;
  sourceErrors: { character: string; expression: string };
  references: QwenReference[];
  reference?: QwenLayerReference;
  validateInputs: () => unknown;
}

/** The button and conversation use the same facts; this never starts a model or queues work. */
export function generationReadiness(input: ReadinessInput): GenerationReadiness {
  const blockers: GenerationBlocker[] = [];
  const add = (code: string, label: string, state: GenerationBlocker['state'], detail: string) => {
    blockers.push({ code, label, state, detail });
  };
  if (input.working) {
    add(input.phase === 'ComfyUIを起動中' ? 'comfy_starting' : 'processing',
      input.phase === 'ComfyUIを起動中' ? 'ComfyUI' : '現在の処理', 'waiting',
      input.phase || '現在の処理が終わるまでお待ちください');
  } else if (input.attempted) {
    add('previous_generation', '前の生成', 'action_required',
      '前の生成が開始済みです。結果を確認し、次に生成するときは「新しい生成を準備」を選んでください');
  }
  if (!input.cloud && !input.hasWorkflow) {
    add('workflow', 'ワークフロー', input.workflowError ? 'action_required' : 'waiting',
      input.workflowError || '使用するワークフローを読み込んでいます');
  }
  if (input.characterLoading) {
    add('characters', 'キャラクター設定画', 'waiting', '人物に紐づく設定画を読み込んでいます');
  } else if (input.sourceErrors.character || (input.plan.promptlessTwoImages
    ? input.plan.characterKeys.length > 0 && input.references.length === 0
    : input.plan.characterKeys.some(key => !input.references.some(reference => reference.characterKeys.includes(key))))) {
    add('characters', 'キャラクター設定画', 'action_required',
      input.sourceErrors.character || '人物に紐づく設定画を読み込めません');
  }
  if (input.targetError) add('target', '生成対象', 'action_required', input.targetError);
  let poseProblem = '';
  try { requireHumanPoseGenerationReady(input.plan.humanPose?.selection); }
  catch (error) { poseProblem = error instanceof Error ? error.message : '3Dポーズを確認してください'; }
  if (poseProblem || input.threeImages && !input.usesPoseImage) {
    add('pose', '3Dポーズ', 'action_required', poseProblem || 'image1で3Dモデルを調整して確定してください');
  } else if (input.usesPoseImage && !input.poseImage) {
    add('pose', '3Dポーズ画像', input.poseError ? 'action_required' : 'waiting',
      input.poseError || '確定した3Dポーズの画像を準備しています');
  }
  if (input.sketchLoading) {
    add('expression', 'ネームの表情', 'waiting', 'ネームの表情画像を読み込んでいます');
  } else if (input.threeImages && !input.reference) {
    add('expression', 'ネームの表情', 'action_required',
      input.sourceErrors.expression || 'image3にネームの表情画像を選んでください');
  }
  if (input.threeImages && !input.characterLoading && input.references.length !== 1
    && !blockers.some(blocker => blocker.code === 'characters')) {
    add('characters', 'キャラクター設定画', 'action_required', 'image2にはキャラクター設定画が1枚必要です');
  }
  if (!blockers.length) {
    try { input.validateInputs(); }
    catch (error) { add('inputs', '生成の入力', 'action_required', error instanceof Error ? error.message : '生成の入力を確認してください'); }
  }
  return { ready: blockers.length === 0,
    message: blockers.length ? '準備が整っていません' : '生成の準備が整っています', blockers };
}

/** Also used while the image executor owns the LLM, or when a status explanation fails. */
export function generationReadinessMessage(readiness: GenerationReadiness): string {
  const processing = readiness.blockers.some(blocker => blocker.code === 'comfy_starting' || blocker.code === 'processing');
  return [readiness.message,
    ...readiness.blockers.map(blocker => `・${blocker.label}：${blocker.detail}`),
    processing ? '現在の処理が終わるまでお待ちください。この依頼で追加の生成は開始していません。'
      : 'この依頼では新たな生成を開始していません。準備が整ったら、改めて「生成して」と送ってください。',
  ].join('\n');
}
