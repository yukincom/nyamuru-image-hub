import type { QwenAdoption, QwenGenerationPlan, QwenJob, QwenLayerReference, QwenReference } from '../qwenGeneration.ts';
import { executeImageGeneration, buildImageGenerationPayload, resolveGenerationTarget } from '../qwenGeneration.ts';
import type { ComfyWorkflowDefinition } from '../comfyWorkflows.ts';
import { prepareImageGenerationJob, reconcileImageGenerationJob, selectImageGenerationCandidate, submitImageGenerationJob } from '../bridge/generationJobs.ts';
import { withImageGenerationServices, withNewCreationBridgeSession } from '../localBridgeLifecycle.ts';
import { adoptAndInsertCandidates, dataUrlToPngFile, prepareGeneratedInsertionFile } from './insertion.ts';

export type BatchItemStatus = 'pending' | 'running' | 'releasing' | 'succeeded' | 'failed' | 'cancelled';

export interface MultiFigureBatchTask {
  id: string;
  label: string;
  plan: QwenGenerationPlan;
  references: QwenReference[];
  reference?: QwenLayerReference;
  prompt?: string;
  negativePrompt?: string;
  usePromptUpsampler?: boolean;
  chromaKeyColor?: string;
  figureChroma?: boolean;
  insert: (files: File[], plan: QwenGenerationPlan, adoption?: QwenAdoption) => Promise<void>;
}

export interface MultiFigureBatchUpdate {
  id: string;
  status: BatchItemStatus;
  phase?: string;
  error?: string;
  seconds?: number;
  job?: QwenJob;
}

export function isMemoryReleaseFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('モデル解放')
    || message.includes('利用終了を確認できません')
    || message.includes('ComfyUIのidle')
    || message.includes('nyamuru_memory_release')
    || message.includes('後片付けを確認できません');
}

function jobToFile(job: QwenJob): File {
  if (!job.image || !job.fileName) throw new Error('差し込む画像がありません');
  return dataUrlToPngFile(job.image, job.fileName);
}

/**
 * run_pipeline.py と同じ契約で複数人物を1人ずつ直列に生成する。
 * - 各人物の生成完了後（成功・失敗問わず）に /nyamuru/memory/release による全モデル解放を待ってから次へ進む。
 * - 1人の生成が失敗しても全体を止めず記録して次の人物へ進む。
 * - メモリ解放自体が確認できない場合は、次の人物を送らず安全に停止する。
 */
export async function runMultiFigureBatch(options: {
  tasks: readonly MultiFigureBatchTask[];
  workflow: ComfyWorkflowDefinition;
  comfyuiUrl: string;
  requiresLlm: boolean;
  llmModelAlias?: string;
  runtimeToken?: string;
  signal: AbortSignal;
  onUpdate: (update: MultiFigureBatchUpdate) => void;
}): Promise<{ succeeded: number; failed: number; memoryReleaseAborted: boolean }> {
  const { tasks, workflow, comfyuiUrl, requiresLlm, llmModelAlias, runtimeToken, signal, onUpdate } = options;
  let succeeded = 0;
  let failed = 0;
  let memoryReleaseAborted = false;

  for (const task of tasks) {
    if (signal.aborted) {
      onUpdate({ id: task.id, status: 'cancelled' });
      continue;
    }

    const startedAt = Date.now();
    onUpdate({ id: task.id, status: 'running', phase: '準備中' });

    try {
      const targetPlan = resolveGenerationTarget(task.plan, false);
      const twoImagesPromptless = workflow.binding.prompt_mode === 'promptless-two-images';
      const effectivePlan: QwenGenerationPlan = {
        ...task.plan,
        prompt: twoImagesPromptless ? '' : (task.prompt ?? task.plan.prompt),
        promptlessTwoImages: twoImagesPromptless,
      };
      const basePayload = buildImageGenerationPayload(
        effectivePlan,
        task.references,
        task.reference?.kind === 'paint' ? task.reference.image : undefined,
        task.reference?.kind === 'sketch' ? task.reference.image : undefined,
      );
      const workflowPayload = {
        ...basePayload,
        workflow_id: workflow.id,
        workflow_version: workflow.version,
        comfyui_url: comfyuiUrl,
        ...(task.negativePrompt !== undefined ? { negative_prompt: task.negativePrompt } : {}),
        ...(task.usePromptUpsampler !== undefined ? { use_prompt_upsampler: task.usePromptUpsampler } : {}),
        ...(task.figureChroma ? { chroma_key_color: task.chromaKeyColor, candidate_cutout: true } : { candidate_cutout: true }),
      };

      let currentJob: QwenJob | undefined;
      const execution = await executeImageGeneration({
        id: crypto.randomUUID(),
        payload: workflowPayload,
        plan: targetPlan,
        isCurrent: () => !signal.aborted,
        prepare: async (id, payload) => prepareImageGenerationJob(id, payload),
        submit: (prepared, token) => submitImageGenerationJob(prepared, token),
        reconcile: reconcileImageGenerationJob,
        onJob: (job) => {
          currentJob = job;
          onUpdate({ id: task.id, status: 'running', job });
        },
        insert: async (job) => {
          const preparedFile = await prepareGeneratedInsertionFile(jobToFile(job), targetPlan, Boolean(job.workflowId));
          await task.insert([preparedFile], targetPlan);
        },
        services: (prepare, generate, serviceOptions) => withImageGenerationServices(prepare, generate, {
          ...serviceOptions,
          ...(runtimeToken ? { runtimeToken } : {}),
          signal,
          requiresLlm,
          ...(llmModelAlias ? { llmModelAlias } : {}),
          onPhase: (value) => {
            const label = {
              bridge: '準備中',
              llm: '準備中',
              translate: '生成指示を保存中',
              suspend: 'LLMを停止中',
              generate: '画像を生成中',
              restore: 'メモリ解放中',
            }[value];
            onUpdate({
              id: task.id,
              status: value === 'restore' ? 'releasing' : 'running',
              phase: label,
              job: currentJob,
            });
          },
        }),
      });
      if (signal.aborted) {
        onUpdate({ id: task.id, status: 'cancelled' });
        continue;
      }
      if (!execution.inserted && execution.job?.candidates?.length) {
        onUpdate({ id: task.id, status: 'running', phase: 'レイヤーへ配置中', job: execution.job });
        const finished = await adoptAndInsertCandidates({
          job: execution.job,
          indices: [execution.job.candidates[0].index],
          target: targetPlan,
          selectCandidate: (job, indices, adopted) =>
            withNewCreationBridgeSession(() => selectImageGenerationCandidate(job, indices, adopted)),
          insertFiles: (files, adoption) => task.insert(files, targetPlan, adoption),
        });
        currentJob = finished;
      }
      if (signal.aborted) {
        onUpdate({ id: task.id, status: 'cancelled' });
        continue;
      }
      succeeded += 1;
      onUpdate({
        id: task.id,
        status: 'succeeded',
        seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        job: currentJob,
      });
    } catch (error) {
      if (signal.aborted) {
        onUpdate({ id: task.id, status: 'cancelled' });
        continue;
      }
      if (isMemoryReleaseFailure(error)) {
        memoryReleaseAborted = true;
        failed += 1;
        onUpdate({
          id: task.id,
          status: 'failed',
          error: `メモリ解放を確認できないため、次の人物は送らず停止しました: ${error instanceof Error ? error.message : String(error)}`,
        });
        break;
      }
      failed += 1;
      onUpdate({
        id: task.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      });
    }
  }

  return { succeeded, failed, memoryReleaseAborted };
}
