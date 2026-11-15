import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { currentGenerationPreferences } from '../lib/generationPreferences.ts';
import { currentLocalModelPreferences } from '../lib/localModelPreferences.ts';
import { parseComfyWorkflowList, type ComfyWorkflowDefinition, workflowNegativePrompt, workflowPromptUpsampler } from '../lib/comfyWorkflows.ts';
import { loadCharacterReferenceImage, requestComfyWorkflows } from '../lib/localBridge.ts';
import { withNewCreationBridgeSession } from '../lib/localBridgeLifecycle.ts';
import { CHARACTER_REFERENCE_VIEWS } from '../lib/characterReferences.ts';
import { resolveConversationRoute, resolveGenerationRoute } from '../lib/modelRouting.ts';
import { currentConversationPreferences } from '../lib/conversationPreferences.ts';
import type { AgentWorkflowYamlFile } from '../lib/generationHandoff.ts';
import { qwenInputImage } from './generation/inputImages.ts';
import {
  type QwenGenerationPlan,
  type QwenLayerCandidate,
  type QwenLayerReference,
  type QwenReference,
  qwenPlanForWorkflow,
} from '../lib/qwenGeneration.ts';
import {
  runMultiFigureBatch,
  type BatchItemStatus,
  type MultiFigureBatchTask,
} from '../lib/generation/multiFigureBatch.ts';

export interface MultiFigureDialogItem {
  id: string;
  panelIndex: number;
  panelId: number;
  figureIndex: number;
  overlay: boolean;
  label: string;
  plan: QwenGenerationPlan;
  layers: QwenLayerCandidate[];
  loadLayer: (id: string, correction: boolean) => Promise<string>;
  insert: (files: File[], plan: QwenGenerationPlan) => Promise<void>;
}

interface Props {
  items: MultiFigureDialogItem[];
  adultContent?: boolean;
  onOpenSettings?: () => void;
  onExportAgentYaml?: () => AgentWorkflowYamlFile[];
  onClose: () => void;
}

interface ItemState {
  characterAssetId: string;
  layerId: string;
  characterRef?: QwenReference & { assetId: string };
  layerRef?: QwenLayerReference;
  loadError?: string;
  status: BatchItemStatus;
  phase?: string;
  error?: string;
  seconds?: number;
}

const STATUS_LABELS: Record<BatchItemStatus, string> = {
  pending: '待機中',
  running: '生成中',
  releasing: 'メモリ解放中',
  succeeded: '完了・配置済み',
  failed: '失敗',
  cancelled: '中断',
};

export default function MultiFigureGenerationDialog({
  items,
  adultContent = false,
  onOpenSettings,
  onExportAgentYaml,
  onClose,
}: Props) {
  const [execution] = useState(currentGenerationPreferences);
  const cloud = execution.execution === 'cloud';
  const [connection] = useState(currentLocalModelPreferences);
  const [registry, setRegistry] = useState<ComfyWorkflowDefinition[]>([]);
  const [workflowError, setWorkflowError] = useState('');
  const [sharedPrompt, setSharedPrompt] = useState('');
  const [batchRunning, setBatchRunning] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (cloud) return;
    let current = true;
    if (!execution.local.workflowId) {
      setWorkflowError('環境設定 → モデルで、使用するワークフローを選んでください');
      return;
    }
    requestComfyWorkflows('list')
      .then((raw) => {
        if (!current) return;
        const list = parseComfyWorkflowList(raw);
        if (!list.some((item) => item.id === execution.local.workflowId)) {
          throw new Error('選択したワークフローの登録がありません。環境設定を確認してください');
        }
        setRegistry(list);
      })
      .catch((cause) => {
        if (current) setWorkflowError(cause instanceof Error ? cause.message : 'ワークフローを読み込めません');
      });
    return () => { current = false; };
  }, [cloud, execution.local.workflowId]);

  const workflow = useMemo(
    () => registry.find((item) => item.id === execution.local.workflowId) ?? null,
    [registry, execution.local.workflowId],
  );
  const twoImagesPromptless = workflow?.binding.prompt_mode === 'promptless-two-images';
  const defaultNegative = workflow ? workflowNegativePrompt(workflow) : undefined;
  const defaultUpsampler = workflow ? workflowPromptUpsampler(workflow) : undefined;
  const [editedUpsampler, setUpsampler] = useState<boolean>();
  const usePromptUpsampler = editedUpsampler ?? defaultUpsampler;

  const [itemStates, setItemStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(items.map((item) => [item.id, {
      characterAssetId: item.plan.candidates?.[0]?.source.asset_id ?? '',
      layerId: item.layers[0]?.id ?? '',
      status: 'pending' as const,
    }])),
  );

  // 各人物のキャラ設定画と参照レイヤー画像を読み込む
  useEffect(() => {
    let active = true;
    const loadAll = async () => {
      for (const item of items) {
        const current = itemStates[item.id];
        if (!current) continue;
        const candidate = (item.plan.candidates ?? []).find((c) => c.source.asset_id === current.characterAssetId)
          ?? item.plan.candidates?.[0];
        const layer = item.layers.find((l) => l.id === current.layerId) ?? item.layers[0];
        const needsChar = candidate && current.characterRef?.assetId !== candidate.source.asset_id;
        const needsLayer = layer && current.layerRef?.id !== layer.id;
        if (!needsChar && !needsLayer) continue;

        try {
          let charRef = current.characterRef;
          if (needsChar && candidate) {
            const blob = await withNewCreationBridgeSession(() =>
              loadCharacterReferenceImage(candidate.seriesId, candidate.characterCatalogId, candidate.source.asset_id));
            if (!blob) throw new Error(`${candidate.label}の設定画が見つかりません`);
            const encoded = await qwenInputImage(blob, undefined, true);
            charRef = {
              assetId: candidate.source.asset_id,
              label: candidate.label,
              characterKeys: candidate.characterKeys ?? item.plan.characterKeys,
              image: encoded.image,
            };
          }
          let layerRef = current.layerRef;
          if (needsLayer && layer) {
            const dataUrl = await item.loadLayer(layer.id, false);
            layerRef = {
              ...layer,
              image: dataUrl,
            };
          }
          if (!active) return;
          setItemStates((prev) => ({
            ...prev,
            [item.id]: { ...prev[item.id], characterRef: charRef, layerRef: layerRef, loadError: undefined },
          }));
        } catch (error) {
          if (!active) return;
          setItemStates((prev) => ({
            ...prev,
            [item.id]: {
              ...prev[item.id],
              loadError: error instanceof Error ? error.message : '参照画像の読み込みに失敗しました',
            },
          }));
        }
      }
    };
    void loadAll();
    return () => { active = false; };
  }, [items, itemStates]);

  const runnableIds = items
    .filter((item) => {
      const state = itemStates[item.id];
      return state && state.status !== 'succeeded' && state.characterRef && state.layerRef && !state.loadError;
    })
    .map((item) => item.id);

  const startBatch = async (onlyFailed = false) => {
    if (batchRunning || !workflow) return;
    const route = resolveGenerationRoute(execution, connection, adultContent);
    if (route.kind === 'unavailable') {
      setSummaryMessage(route.message);
      return;
    }
    const requiresLlm = workflow.binding.prompt_mode === 'qwen';
    if (requiresLlm) {
      const convRoute = resolveConversationRoute(currentConversationPreferences(), connection, execution.cloud, adultContent);
      if (convRoute.kind === 'unavailable') {
        setSummaryMessage(convRoute.message);
        return;
      }
    }

    const targets = items.filter((item) => {
      const state = itemStates[item.id];
      if (!state || !state.characterRef || !state.layerRef || state.loadError) return false;
      if (onlyFailed) return state.status === 'failed' || state.status === 'cancelled';
      return state.status !== 'succeeded';
    });
    if (!targets.length) {
      setSummaryMessage('生成可能な人物がありません（各人物のキャラクター設定画と参照画像を確認してください）');
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    setBatchRunning(true);
    setSummaryMessage('');

    const tasks: MultiFigureBatchTask[] = targets.map((item) => {
      const state = itemStates[item.id];
      const effectivePlan = qwenPlanForWorkflow(item.plan, workflow);
      return {
        id: item.id,
        label: item.label,
        plan: effectivePlan,
        references: state.characterRef
          ? [{ label: state.characterRef.label, characterKeys: state.characterRef.characterKeys, image: state.characterRef.image }]
          : [],
        reference: state.layerRef,
        prompt: twoImagesPromptless ? '' : (sharedPrompt.trim() || effectivePlan.prompt),
        ...(defaultNegative !== undefined ? { negativePrompt: defaultNegative } : {}),
        ...(defaultUpsampler !== undefined ? { usePromptUpsampler: Boolean(usePromptUpsampler) } : {}),
        figureChroma: true,
        chromaKeyColor: '#00FF00',
        insert: item.insert,
      };
    });

    try {
      const result = await runMultiFigureBatch({
        tasks,
        workflow,
        comfyuiUrl: connection.comfyuiUrl,
        requiresLlm,
        llmModelAlias: connection.llmAlias,
        signal: abort.signal,
        onUpdate: (update) => {
          if (!aliveRef.current) return;
          setItemStates((prev) => ({
            ...prev,
            [update.id]: {
              ...prev[update.id],
              status: update.status,
              phase: update.phase,
              error: update.error,
              seconds: update.seconds ?? prev[update.id]?.seconds,
            },
          }));
        },
      });
      if (!aliveRef.current) return;
      if (result.memoryReleaseAborted) {
        setSummaryMessage(`メモリ解放を確認できないため停止しました（完了 ${result.succeeded}件 / 失敗 ${result.failed}件）`);
      } else {
        setSummaryMessage(`一括生成が完了しました（成功 ${result.succeeded}件 / 失敗 ${result.failed}件）`);
      }
    } catch (error) {
      if (aliveRef.current) {
        setSummaryMessage(error instanceof Error ? error.message : '一括生成を開始できませんでした');
      }
    } finally {
      if (aliveRef.current) setBatchRunning(false);
      abortRef.current = null;
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    onClose();
  };

  const hasRetryable = items.some((item) => {
    const s = itemStates[item.id]?.status;
    return s === 'failed' || s === 'cancelled';
  });

  return (
    <section
      class="layer-generation-dialog qwen-generation-dialog"
      style={{ maxWidth: '860px', width: 'min(860px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="multi-figure-generation-title"
    >
      <header>
        <div>
          <h2 id="multi-figure-generation-title">複数人物生成（{items.length}人）</h2>
          <p>
            {cloud ? '外部エージェント（OMNY / OMAY）' : (workflow?.name ?? 'ワークフロー読込中')}
            {' · '}1人ずつ生成し、各画像ごとにモデルを解放してから次の人物へ進みます
          </p>
        </div>
        <button type="button" onClick={handleClose}>閉じる</button>
      </header>

      {workflowError && (
        <p class="dialog-error">
          {workflowError}
          {onOpenSettings && (
            <> <button type="button" onClick={onOpenSettings}>環境設定を開く</button></>
          )}
        </p>
      )}

      {cloud && (
        <div class="qwen-cloud-box" style={{ margin: '12px 0' }}>
          <p>外部エージェント設定時は、OMNY / OMAY（YAML）を書き出してエージェントで生成してください。</p>
          {onExportAgentYaml && (
            <button
              type="button"
              class="primary-button"
              onClick={() => {
                const files = onExportAgentYaml();
                for (const file of files) {
                  const url = URL.createObjectURL(new Blob([file.yaml], { type: 'application/yaml;charset=utf-8' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = file.fileName;
                  a.click();
                  URL.revokeObjectURL(url);
                }
                setSummaryMessage(`${files.map((f) => f.fileName).join('、')} を書き出しました`);
              }}
            >
              OMNY（YAML）を書き出す
            </button>
          )}
        </div>
      )}

      {!cloud && !twoImagesPromptless && workflow && (
        <label style={{ display: 'grid', gap: '4px', margin: '10px 0' }}>
          <span>共通プロンプト（空欄時は各人物の既定文を使用）</span>
          <textarea
            rows={2}
            value={sharedPrompt}
            disabled={batchRunning}
            onInput={(e) => setSharedPrompt(e.currentTarget.value)}
            placeholder="例: キャラクターの表情やポーズの補足"
          />
        </label>
      )}

      {!cloud && twoImagesPromptless && (
        <p class="dialog-hint" style={{ margin: '8px 0' }}>
          ワークフロー内蔵のプロンプトを使用します。各人物の「image_1（キャラ設定画のアングル）」と「image_2（ポーズ・あたり）」を確認して一括生成してください。
        </p>
      )}
      {!cloud && defaultUpsampler !== undefined && (
        <label class="qwen-checkbox" style={{ margin: '8px 0', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={Boolean(usePromptUpsampler)}
            disabled={batchRunning}
            onChange={(e) => setUpsampler(e.currentTarget.checked)}
          />
          <span>プロンプト自動補強（Prompt Upsampler）を使う（負荷が増えます）</span>
        </label>
      )}

      <div style={{ display: 'grid', gap: '10px', margin: '12px 0' }}>
        {items.map((item, idx) => {
          const state = itemStates[item.id];
          const candidates = item.plan.candidates ?? [];
          return (
            <fieldset key={item.id} style={{ padding: '10px', display: 'grid', gap: '8px' }}>
              <legend style={{ fontWeight: 600 }}>
                {idx + 1}. {item.overlay ? 'ページ前景' : `コマ ${item.panelId}`} · {item.label}（{item.plan.width}×{item.plan.height}）
                {' — '}
                <span>{STATUS_LABELS[state.status]}{state.phase ? `（${state.phase}）` : ''}{state.seconds ? ` (${state.seconds}秒)` : ''}</span>
              </legend>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', alignItems: 'start' }}>
                <label style={{ display: 'grid', gap: '4px' }}>
                  <span>image_1（キャラクター設定画）</span>
                  {candidates.length > 0 ? (
                    <select
                      disabled={batchRunning || state.status === 'succeeded'}
                      value={state.characterAssetId}
                      onChange={(e) => {
                        const assetId = e.currentTarget.value;
                        setItemStates((prev) => ({
                          ...prev,
                          [item.id]: { ...prev[item.id], characterAssetId: assetId, characterRef: undefined },
                        }));
                      }}
                    >
                      {candidates.map((cand) => {
                        const viewLabel = cand.view
                          ? CHARACTER_REFERENCE_VIEWS.find((v) => v.value === cand.view)?.label ?? cand.view
                          : '';
                        return (
                          <option key={cand.source.asset_id} value={cand.source.asset_id}>
                            {viewLabel ? `${cand.label}（${viewLabel}）` : cand.label}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <span class="dialog-error">登録済みキャラクター設定画がありません</span>
                  )}
                  {state.characterRef?.image && (
                    <img
                      src={state.characterRef.image}
                      alt={state.characterRef.label}
                      style={{ maxHeight: '96px', objectFit: 'contain', borderRadius: '4px', background: 'var(--bg-subtle, #111)' }}
                    />
                  )}
                </label>

                <label style={{ display: 'grid', gap: '4px' }}>
                  <span>image_2（参照ポーズ / あたり）</span>
                  <select
                    disabled={batchRunning || state.status === 'succeeded'}
                    value={state.layerId}
                    onChange={(e) => {
                      const layerId = e.currentTarget.value;
                      setItemStates((prev) => ({
                        ...prev,
                        [item.id]: { ...prev[item.id], layerId, layerRef: undefined },
                      }));
                    }}
                  >
                    {item.layers.map((layer) => (
                      <option key={layer.id} value={layer.id}>{layer.label}</option>
                    ))}
                  </select>
                  {state.layerRef?.image && (
                    <img
                      src={state.layerRef.image}
                      alt={state.layerRef.label}
                      style={{ maxHeight: '96px', objectFit: 'contain', borderRadius: '4px', background: 'var(--bg-subtle, #111)' }}
                    />
                  )}
                </label>
              </div>

              {(state.loadError || state.error) && (
                <p class="dialog-error" style={{ margin: 0 }}>{state.loadError || state.error}</p>
              )}
            </fieldset>
          );
        })}
      </div>

      {summaryMessage && <p style={{ fontWeight: 600 }}>{summaryMessage}</p>}

      <footer style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {!cloud && !batchRunning && (
          <button
            type="button"
            class="primary-button"
            disabled={!workflow || runnableIds.length === 0}
            onClick={() => void startBatch(false)}
          >
            一括生成を開始（{runnableIds.length}人）
          </button>
        )}
        {!cloud && !batchRunning && hasRetryable && (
          <button
            type="button"
            disabled={!workflow}
            onClick={() => void startBatch(true)}
          >
            失敗分のみ再試行
          </button>
        )}
        {batchRunning && (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            生成を中断
          </button>
        )}
        <button type="button" onClick={handleClose}>閉じる</button>
      </footer>
    </section>
  );
}
