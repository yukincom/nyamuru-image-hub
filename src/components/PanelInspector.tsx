import BubbleInfoPortal from './BubbleInfoPortal';
import type { ComponentChildren } from 'preact';
import PlacedImageList from './PlacedImageList';
import FigureSizePicker from './FigureSizePicker';
import FigureHumanPoseEditor from './FigureHumanPoseEditor';
import { Ban, Box, Check, Download, FolderOpen, Image as ImageIcon, MessageCircleMore, Plus, RefreshCw, Trash2, UserPlus, WandSparkles, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { ANCHOR_LABELS, ANCHORS, FIGURE_SIZE_LABELS, FIGURE_ROLE_LABELS, FIGURE_ROLES } from '../lib/manga';
import { fallbackBox } from '../lib/canvasGeometry';
import { bubbleTailStyle, setBubbleTailStyle } from '../lib/bubblePresentation.ts';
import { removeBubbleAt } from '../lib/bubbleConnections.ts';
import type { CanvasElementSelection, Manga, Material, Panel } from '../types';
import { isPropPlacement } from '../lib/catalogModel.ts';
import { generatePanelDraftWithComfyUI, listPanelDraftAttempts, reconcilePanelDraftAttempt, reviewPanelDraftAttempt, suggestPanelFigureActions, type PanelDraftAttemptSummary, type PanelDraftResult, type PanelDraftReviewAction } from '../lib/localBridge.ts';
import { applyReconciledPanelActions, buildPanelActionSuggestionRequest } from '../lib/panelActions.ts';
import { withPanelActionServices } from '../lib/localBridgeLifecycle.ts';
import { panelDisplayLabel } from '../lib/displayLabels.ts';
import { buildPanelDraftPlan, MANGA_BASE_PALETTE, type PanelDraftPlan } from '../lib/panelDraft.ts';

const BACKGROUND_DETAIL_OPTIONS = [
  { level: -1, label: '描写なし', description: '単色のみ。背景の具体物や効果を描写しません' },
  { level: 0, label: '感情・効果', description: '具体的な背景を描かず、色や集中線などで感情を演出します' },
  { level: 1, label: '簡易', description: '場所を示す要素を1〜2点だけ描写します' },
  { level: 2, label: '詳細', description: 'ロケーションをしっかり描き込む見せゴマです' },
] as const;
import { Field, SectionTitle } from './Fields';
import BubbleCardTitle from './BubbleCardTitle';
import ScenarioBubbleNotice, { type ScenarioBubbleChoiceProps } from './ScenarioBubbleNotice';
import { panelBackgroundDescription } from '../lib/panelContext.ts';
import { useInspectorSelectionScroll } from './useInspectorSelectionScroll.ts';
import { humanPoseFigureFrame, humanPosePanelCutFrame } from '../lib/humanPoseFraming.ts';
import { getOutputSettings } from '../lib/finishLayout.ts';
import { ownerItemLocked, preservesLockedItems } from '../lib/panelLayers.ts';

interface Props extends ScenarioBubbleChoiceProps {
  onOpenBackground3d:()=>void;
  panelControls?:ComponentChildren;
  painting?: boolean;
  imageImportBusy:boolean;
  guideVisible:(key:string)=>boolean;
  onToggleGuide:(key:string)=>void;
  panelDraftToolbarTarget: HTMLDivElement | null;
  manga: Manga;
  panel: Panel | undefined;
  pageIndex: number;
  panelIndex: number;
  selectedElement: CanvasElementSelection | null;
  canvasSelectionScrollRequest: number;
  episodeWorkspaceToken: string;
  episodeWorkspaceFolder: string;
  seriesId: string;
  episodeId: string;
  getOmnySnapshot: () => string;
  onChooseEpisodeWorkspace: () => Promise<void>;
  onSelectElement: (selection: CanvasElementSelection | null) => void;
  onChange: (panel: Panel,origin?:'manual'|'agent') => void;
  onOpenBackgrounds: () => void;
  onOpenProps: () => void;
  onAdd: () => void;
  onDelete: () => void;
}

interface PanelDraftDialogState {
  plan: PanelDraftPlan;
  status: 'confirm' | 'loading' | 'success' | 'error';
  result?: PanelDraftResult;
  error?: string;
  message?: string;
  attempts: PanelDraftAttemptSummary[];
  historyLoading: boolean;
  persistedJobId?: string;
  persistedRetryAttemptId?: string;
  inFlightAttemptId?: string;
  reviewing?: { attemptId: string; requestNonce: string };
  reviewResolutionRequired?: boolean;
  reviewResolution?: {
    attemptId: string;
    requestNonce: string;
    expectedRevision: number;
    artifactSha256: string;
    decision: PanelDraftReviewAction;
  };
}

function setLinkedMaterial(panel: Panel, material: Material, linked: boolean): void {
  const rows = (panel.assets ?? []).map((key, index) => ({ key, id: panel.assetIds?.[index] ?? '' }));
  const matchingIndex = rows.findIndex((row) => (material.localId && row.id === material.localId) || row.key === material.key);
  if (linked && matchingIndex < 0) rows.push({ key: material.key, id: material.localId ?? '' });
  if (!linked && matchingIndex >= 0) rows.splice(matchingIndex, 1);
  if (rows.length) {
    panel.assets = rows.map((row) => row.key);
    panel.assetIds = rows.map((row) => row.id);
  } else {
    delete panel.assets;
    delete panel.assetIds;
  }
}

export default function PanelInspector({ onOpenBackground3d, panelControls, painting=false, imageImportBusy, guideVisible, onToggleGuide, panelDraftToolbarTarget, manga, panel, pageIndex, panelIndex, selectedElement, canvasSelectionScrollRequest, episodeWorkspaceToken, episodeWorkspaceFolder, seriesId, episodeId, getOmnySnapshot, onChooseEpisodeWorkspace, onSelectElement, onChange, onOpenBackgrounds, onOpenProps, onScenarioChoice, onAdd, onDelete }: Props) {
  const inspectorRef = useInspectorSelectionScroll(canvasSelectionScrollRequest);
  const [generationStatus, setGenerationStatus] = useState<{ kind: 'loading' | 'success' | 'error'; message: string } | null>(null);
  const [panelDraftDialog, setPanelDraftDialog] = useState<PanelDraftDialogState | null>(null);
  const generationRequest = useRef(0);
  const generationInFlight = useRef(false);
  const panelDraftRequest = useRef(0);
  const panelDraftHistoryRequest = useRef(0);
  const panelDraftReviewRequest = useRef(0);
  const latestPanel = useRef(panel);
  const latestOnChange = useRef(onChange);
  latestPanel.current = panel;
  latestOnChange.current = onChange;
  useEffect(() => {
    generationInFlight.current = false;
    generationRequest.current += 1;
    panelDraftRequest.current += 1;
    panelDraftHistoryRequest.current += 1;
    panelDraftReviewRequest.current += 1;
    setGenerationStatus(null);
    setPanelDraftDialog(null);
  }, [pageIndex, panelIndex, panel?.id]);
  useEffect(() => () => {
    generationRequest.current += 1;
    panelDraftRequest.current += 1;
    panelDraftHistoryRequest.current += 1;
    panelDraftReviewRequest.current += 1;
  }, []);
  if (!panel) return <div class="empty-inspector"><div>◫</div><h3>コマを選択してください</h3><p>紙面上のコマをクリックすると、内容を編集できます。</p><button class="primary-button" onClick={onAdd}><Plus size={16} />コマを追加</button></div>;
  const locked=panel.layer?.locked===true;
  const update = (recipe: (draft: Panel) => void) => {
    if(locked)return;
    const next = structuredClone(panel); recipe(next);
    if(!preservesLockedItems(panel.figures,next.figures)||!preservesLockedItems(panel.bubbles,next.bubbles))return;
    onChange(next);
  };
  const hasPersonFigures = (panel.figures ?? []).some((figure) => !isPropPlacement(figure));
  const backgroundMaterials = manga.materials.filter((material) => material.type === 'background');
  const propMaterials = manga.materials.filter((material) => material.type === 'prop');
  const selectCard = (_event: MouseEvent, selection: CanvasElementSelection) => onSelectElement(selection);
  const requestPanelGeneration = async () => {
    if (generationInFlight.current || !panel.action?.trim() || !hasPersonFigures) return;
    generationInFlight.current = true;
    const requestId = generationRequest.current + 1;
    const panelRevision = JSON.stringify(panel);
    generationRequest.current = requestId;
    const phaseMessages = {
      bridge: 'ローカル連携を準備しています…（未起動なら自動で起動します）',
      llm: 'ト書き用LLMを準備しています…（初回はモデルの読み込みに時間がかかります）',
      ready: '現在のアクションとト書きをすり合わせ、人物ごとの文章を整えています…',
    };
    try {
      const result = await withPanelActionServices(
        () => suggestPanelFigureActions(buildPanelActionSuggestionRequest(manga, pageIndex, panelIndex)),
        {
          onPhase: (phase) => { if (requestId === generationRequest.current) setGenerationStatus({ kind: 'loading', message: phaseMessages[phase] }); },
          isCurrent: () => requestId === generationRequest.current && JSON.stringify(latestPanel.current) === panelRevision,
        },
      );
      if (requestId !== generationRequest.current) return;
      const currentPanel = latestPanel.current;
      if (!currentPanel || JSON.stringify(currentPanel) !== panelRevision) {
        setGenerationStatus({ kind: 'error', message: '処理中にコマが編集されたため、自動入力を適用しませんでした。もう一度実行してください。' });
        return;
      }
      if (!result) return;
      const next = structuredClone(currentPanel);
      const applied = applyReconciledPanelActions(next, result.actions);
      if (applied) latestOnChange.current(next,'agent');
      setGenerationStatus({ kind: 'success', message: applied ? `人物${applied}人のアクションをト書きとすり合わせて整えました。` : '変更する内容はありませんでした。現在のアクションを保持しています。' });
    } catch (error) {
      if (requestId !== generationRequest.current) return;
      setGenerationStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'ト書きをアクションに注入できませんでした。',
      });
    } finally {
      if (requestId === generationRequest.current) generationInFlight.current = false;
    }
  };
  const loadPanelDraftHistory = async (plan: PanelDraftPlan) => {
    if (!episodeWorkspaceToken) return;
    const requestId = panelDraftHistoryRequest.current + 1;
    panelDraftHistoryRequest.current = requestId;
    try {
      const attempts = await listPanelDraftAttempts(episodeWorkspaceToken, plan.pageNumber, plan.panelId);
      if (requestId !== panelDraftHistoryRequest.current) return;
      setPanelDraftDialog((current) => current && current.plan.pageNumber === plan.pageNumber && current.plan.panelId === plan.panelId
        ? (() => {
          const resultAttempt = current.result
            ? attempts.find((attempt) => attempt.attemptId === current.result?.attemptId)
            : undefined;
          const requestedReview = current.reviewResolution;
          const requestedReviewConfirmed = Boolean(requestedReview && resultAttempt
            && resultAttempt.attemptId === requestedReview.attemptId
            && resultAttempt.review.requestNonce === requestedReview.requestNonce
            && resultAttempt.review.revision === requestedReview.expectedRevision + 1
            && resultAttempt.review.artifactSha256 === requestedReview.artifactSha256
            && resultAttempt.review.decision === requestedReview.decision);
          const requestedReviewSuperseded = Boolean(requestedReview && resultAttempt
            && resultAttempt.attemptId === requestedReview.attemptId
            && resultAttempt.review.revision > requestedReview.expectedRevision
            && resultAttempt.review.requestNonce !== requestedReview.requestNonce);
          const reviewResolved = !current.reviewResolutionRequired
            || requestedReviewConfirmed
            || requestedReviewSuperseded;
          return {
          ...current,
          attempts,
          historyLoading: false,
          // retry元はbridge台帳で存在確認できたattemptだけにする。
          // health/connect失敗でPOST自体が届かなかったIDを連鎖させない。
          persistedJobId: attempts[0]?.jobId,
          persistedRetryAttemptId: attempts[0]?.attemptId,
          inFlightAttemptId: attempts.some((attempt) => attempt.attemptId === current.inFlightAttemptId)
            ? undefined : current.inFlightAttemptId,
          result: current.result && resultAttempt ? {
            ...current.result,
            review: resultAttempt.review,
            auditEvents: resultAttempt.auditEvents,
          } : current.result,
          reviewResolutionRequired: reviewResolved ? false : current.reviewResolutionRequired,
          reviewResolution: reviewResolved ? undefined : current.reviewResolution,
          status: current.reviewResolutionRequired && reviewResolved ? 'success' : current.status,
          error: current.reviewResolutionRequired && reviewResolved ? undefined : current.error,
          message: current.reviewResolutionRequired
            ? requestedReviewConfirmed
              ? '同じrequest nonceのreview eventを台帳で確認しました。'
              : requestedReviewSuperseded
                ? '別のreview更新が先に確定したため、台帳の最新状態を読み込みました。'
                : 'review保存結果はまだ台帳で確認できません。同じrequest nonceで再確認してください。'
            : current.message,
          };
        })()
        : current);
    } catch (error) {
      if (requestId !== panelDraftHistoryRequest.current) return;
      setPanelDraftDialog((current) => current ? {
        ...current,
        historyLoading: false,
        message: current.reviewResolutionRequired
          ? `review保存結果を台帳で確認できません。同じrequest nonceで再確認してください。 ${error instanceof Error ? error.message : ''}`.trim()
          : error instanceof Error ? error.message : '制作履歴を読み取れませんでした。',
      } : current);
    }
  };
  const openPanelDraftDialog = () => {
    try {
      const plan = buildPanelDraftPlan(manga, pageIndex, panelIndex);
      setPanelDraftDialog({ plan, status: 'confirm', attempts: [], historyLoading: Boolean(episodeWorkspaceToken) });
      if (episodeWorkspaceToken) void loadPanelDraftHistory(plan);
    } catch (error) {
      setGenerationStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '作画用ラフの生成内容を準備できませんでした。',
      });
    }
  };
  const closePanelDraftDialog = () => {
    if (panelDraftDialog?.status === 'loading' || panelDraftDialog?.reviewing
      || panelDraftDialog?.reviewResolutionRequired) return;
    panelDraftRequest.current += 1;
    panelDraftHistoryRequest.current += 1;
    panelDraftReviewRequest.current += 1;
    setPanelDraftDialog(null);
  };
  const choosePanelDraftWorkspace = async () => {
    if (panelDraftDialog?.reviewing || panelDraftDialog?.reviewResolutionRequired) return;
    try {
      await onChooseEpisodeWorkspace();
      setPanelDraftDialog(null);
    } catch (error) {
      setPanelDraftDialog((current) => current ? {
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : '自動保存先を選べませんでした。',
      } : current);
    }
  };
  const requestPanelDraft = async () => {
    if (!panelDraftDialog || panelDraftDialog.status === 'loading' || panelDraftDialog.reviewing
      || panelDraftDialog.reviewResolutionRequired) return;
    if (!episodeWorkspaceToken) {
      setPanelDraftDialog({ ...panelDraftDialog, status: 'error', error: '先にエピソードの自動保存先を選んでください。' });
      return;
    }
    const plan = panelDraftDialog.plan;
    const jobId = panelDraftDialog.persistedJobId ?? crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const retryOfAttemptId = panelDraftDialog.persistedRetryAttemptId;
    const requestId = panelDraftRequest.current + 1;
    panelDraftRequest.current = requestId;
    setPanelDraftDialog({
      ...panelDraftDialog,
      plan,
      status: 'loading',
      error: undefined,
      message: undefined,
      inFlightAttemptId: attemptId,
    });
    try {
      const result = await generatePanelDraftWithComfyUI(plan, {
        workspaceToken: episodeWorkspaceToken,
        seriesId,
        episodeId,
        omnySnapshot: getOmnySnapshot(),
        jobId,
        attemptId,
        retryOfAttemptId,
      });
      if (requestId !== panelDraftRequest.current) return;
      setPanelDraftDialog((current) => current ? {
        ...current,
        plan,
        status: 'success',
        result,
        persistedJobId: result.jobId,
        persistedRetryAttemptId: result.attemptId,
        inFlightAttemptId: undefined,
      } : current);
      void loadPanelDraftHistory(plan);
    } catch (error) {
      if (requestId !== panelDraftRequest.current) return;
      setPanelDraftDialog((current) => ({
        ...(current ?? panelDraftDialog),
        plan, inFlightAttemptId: attemptId,
        status: 'error',
        error: error instanceof Error ? error.message : '作画用ラフを生成できませんでした。',
      }));
      void loadPanelDraftHistory(plan);
    }
  };
  const reconcilePanelDraft = async (attemptId: string) => {
    if (!panelDraftDialog || !episodeWorkspaceToken || panelDraftDialog.status === 'loading' || panelDraftDialog.reviewing
      || panelDraftDialog.reviewResolutionRequired) return;
    const requestId = panelDraftRequest.current + 1;
    panelDraftRequest.current = requestId;
    setPanelDraftDialog({ ...panelDraftDialog, status: 'loading', error: undefined, message: 'ComfyUIのqueueとhistoryを確認しています…' });
    try {
      const reconciled = await reconcilePanelDraftAttempt(episodeWorkspaceToken, attemptId);
      if (requestId !== panelDraftRequest.current) return;
      if ('imageDataUrl' in reconciled) {
        setPanelDraftDialog((current) => current ? {
          ...current,
          status: 'success',
          result: reconciled,
          message: undefined,
          persistedJobId: reconciled.jobId,
          persistedRetryAttemptId: reconciled.attemptId,
          inFlightAttemptId: undefined,
        } : current);
      } else {
        const message = reconciled.status === 'queued'
          ? 'ComfyUIのqueueで生成待ちまたは実行中です。'
          : reconciled.status === 'outcome_unknown'
            ? 'ComfyUIのqueue/historyで完了を確認できません。自動retryは行いません。'
            : reconciled.error?.message ?? '生成は完了していません。';
        setPanelDraftDialog((current) => current ? {
          ...current,
          status: 'confirm',
          message,
          persistedJobId: reconciled.jobId,
          persistedRetryAttemptId: reconciled.attemptId,
          inFlightAttemptId: undefined,
        } : current);
      }
      void loadPanelDraftHistory(panelDraftDialog.plan);
    } catch (error) {
      if (requestId !== panelDraftRequest.current) return;
      setPanelDraftDialog((current) => current ? {
        ...current, status: 'error', error: error instanceof Error ? error.message : '生成状態を確認できませんでした。',
      } : current);
    }
  };
  const reviewPanelDraft = async (decision: PanelDraftReviewAction) => {
    if (!panelDraftDialog?.result || !episodeWorkspaceToken || panelDraftDialog.reviewing
      || panelDraftDialog.status === 'loading' || panelDraftDialog.historyLoading
      || panelDraftDialog.reviewResolutionRequired) return;
    const attemptId = panelDraftDialog.result.attemptId;
    const artifactSha256 = panelDraftDialog.result.verifiedArtifactSha256;
    const expectedRevision = panelDraftDialog.result.review.revision;
    const requestNonce = crypto.randomUUID();
    const requestId = panelDraftReviewRequest.current + 1;
    panelDraftReviewRequest.current = requestId;
    setPanelDraftDialog({
      ...panelDraftDialog,
      reviewing: { attemptId, requestNonce },
      error: undefined,
      message: 'レビュー結果を監査履歴へ保存しています…',
    });
    try {
      const reviewed = await reviewPanelDraftAttempt(
        episodeWorkspaceToken,
        attemptId,
        decision,
        expectedRevision,
        artifactSha256,
        requestNonce,
      );
      if (reviewed.attemptId !== attemptId
        || reviewed.review.requestNonce !== requestNonce
        || reviewed.review.artifactSha256 !== artifactSha256
        || reviewed.review.revision !== expectedRevision + 1
        || reviewed.review.decision !== decision) {
        throw new Error('review応答が要求したattempt・nonce・revisionと一致しません');
      }
      if (requestId !== panelDraftReviewRequest.current) return;
      setPanelDraftDialog((current) => current?.result
        && current.result.attemptId === attemptId
        && current.reviewing?.attemptId === attemptId
        && current.reviewing.requestNonce === requestNonce ? {
        ...current,
        status: 'success',
        reviewing: undefined,
        reviewResolutionRequired: false,
        reviewResolution: undefined,
        error: undefined,
        message: undefined,
        result: { ...current.result, review: reviewed.review },
        attempts: current.attempts.map((attempt) => attempt.attemptId === reviewed.attemptId ? reviewed : attempt),
      } : current);
    } catch (error) {
      if (requestId !== panelDraftReviewRequest.current) return;
      setPanelDraftDialog((current) => current?.result
        && current.result.attemptId === attemptId
        && current.reviewing?.requestNonce === requestNonce ? {
        ...current,
        status: 'error',
        reviewing: undefined,
        reviewResolutionRequired: true,
        reviewResolution: { attemptId, requestNonce, expectedRevision, artifactSha256, decision },
        historyLoading: true,
        message: undefined,
        error: error instanceof Error ? error.message : 'レビュー結果を保存できませんでした。',
      } : current);
      void loadPanelDraftHistory(panelDraftDialog.plan);
    }
  };
  const resolvePanelDraftReview = async () => {
    if (!panelDraftDialog?.result || !episodeWorkspaceToken || panelDraftDialog.reviewing
      || panelDraftDialog.historyLoading || !panelDraftDialog.reviewResolution) return;
    const resolution = panelDraftDialog.reviewResolution;
    const requestId = panelDraftReviewRequest.current + 1;
    panelDraftReviewRequest.current = requestId;
    setPanelDraftDialog({
      ...panelDraftDialog,
      reviewing: { attemptId: resolution.attemptId, requestNonce: resolution.requestNonce },
      error: undefined,
      message: '同じrequest nonceでreview保存結果を再確認しています…',
    });
    try {
      const reviewed = await reviewPanelDraftAttempt(
        episodeWorkspaceToken,
        resolution.attemptId,
        resolution.decision,
        resolution.expectedRevision,
        resolution.artifactSha256,
        resolution.requestNonce,
      );
      if (requestId !== panelDraftReviewRequest.current) return;
      setPanelDraftDialog((current) => current?.result
        && current.result.attemptId === resolution.attemptId
        && current.reviewing?.requestNonce === resolution.requestNonce ? {
        ...current,
        status: 'success',
        reviewing: undefined,
        reviewResolutionRequired: false,
        reviewResolution: undefined,
        error: undefined,
        message: '同じrequest nonceのreview eventを台帳で確認しました。',
        result: { ...current.result, review: reviewed.review },
        attempts: current.attempts.map((attempt) => attempt.attemptId === reviewed.attemptId ? reviewed : attempt),
      } : current);
    } catch (error) {
      if (requestId !== panelDraftReviewRequest.current) return;
      setPanelDraftDialog((current) => current?.reviewResolution?.requestNonce === resolution.requestNonce ? {
        ...current,
        reviewing: undefined,
        reviewResolutionRequired: true,
        historyLoading: true,
        error: error instanceof Error ? error.message : 'review保存結果を再確認できませんでした。',
        message: '台帳の最新review eventを再読込しています…',
      } : current);
      void loadPanelDraftHistory(panelDraftDialog.plan);
    }
  };
  return <><div ref={inspectorRef} class={`panel-inspector ${locked?'is-locked':''}`} aria-disabled={locked}>
    <div class="inspector-sticky-head">
      <strong class="inspector-panel-label">{panelDisplayLabel(panel.id)}</strong>
      <div class="mini-actions"><button disabled={painting||locked} onClick={onDelete} title="コマを削除" aria-label="コマを削除"><Trash2 size={16} /></button></div>
    </div>


    <div class="inspector-fields" inert={locked} aria-disabled={locked}>
    <section class="editor-section inspector-category-section panel-action-section">
      <SectionTitle title="ト書き" />
      <textarea rows={5} value={panel.action ?? ''} placeholder="キャラクターの表情や動作、カメラの指示を入力" aria-label="ト書き" onInput={(event) => update((draft) => { draft.action = event.currentTarget.value || null; })} />
      <div class="panel-generation-assistant">
        <button type="button" class="panel-generation-button" disabled={generationStatus?.kind === 'loading' || !hasPersonFigures || !panel.action?.trim()} title={`${panelDisplayLabel(panel.id)}のト書きと人物のアクションをすり合わせ、重複のない文章に整えます`} onClick={() => void requestPanelGeneration()}>
          <WandSparkles size={17} />{generationStatus?.kind === 'loading' ? 'ト書きとすり合わせ中…' : `${panelDisplayLabel(panel.id)}の人物へ注入`}
        </button>
        {generationStatus && <p class={`panel-generation-status is-${generationStatus.kind}`} role={generationStatus.kind === 'error' ? 'alert' : 'status'}>{generationStatus.message}</p>}
      </div>
    </section>

    <section class="editor-section inspector-category-section panel-background-section">
      <SectionTitle title="背景" />
      <label class="check-row guide-display-control"><input type="checkbox" checked={guideVisible('background')} onChange={()=>onToggleGuide('background')}/><span>あたり画像表示</span></label>
      <details class="bg-selector background-detail-settings">
        <summary>背景詳細度</summary>
        <div class="background-detail-settings-body"><div>{BACKGROUND_DETAIL_OPTIONS.map((option) => <button class={`bg-option bg-option-${option.level} ${panel.bg === option.level ? 'is-active' : ''}`} aria-label={option.description} title={option.description} onClick={() => update((draft) => {
          draft.bg = option.level;
          if (option.level === -1) delete draft.background_description;
          })} key={option.level}><span>{option.label}</span></button>)}</div>
          <button type="button" class="secondary-button background-detail-3d-edit" disabled={locked} onClick={onOpenBackground3d}><Box size={15} />3D編集</button>
        </div>
      </details>
      <div class="background-information-section">
        <SectionTitle title="背景情報" />
        <textarea rows={4} value={panelBackgroundDescription(panel, manga.setting)} disabled={panel.bg === -1} placeholder={panel.bg === -1 ? '「描写なし」では背景情報を使用しません' : '背景レイヤーの場所・構図・パース・光・感情効果'} aria-label="背景情報" onInput={(event) => update((draft) => {
          const value = event.currentTarget.value;
          draft.background_description = value;
        })} />
      </div>
      <div class="background-material-picker">
        <SectionTitle title="背景資料" action={<button class="inline-add" onClick={onOpenBackgrounds}><Plus size={14} />追加</button>} />
        <div class="asset-picker">
          {backgroundMaterials.map((material) => {
            const selected = material.localId
              ? (panel.assetIds ?? []).includes(material.localId)
              : (panel.assets ?? []).includes(material.key);
            return <label class={selected ? 'is-selected' : ''} key={material.localId ?? material.key}>
              <input type="checkbox" checked={selected} onChange={(event) => update((draft) => { setLinkedMaterial(draft, material, event.currentTarget.checked); })} />
              <span class={`material-dot type-${material.type}`} /> <span>{material.key}</span>
            </label>;
          })}
        </div>
      </div>
    </section>

    {Boolean(panel.images?.some(image=>!image.paintScope)) && <details class="editor-section panel-images-section"><summary>追加済みの画像</summary>
      <PlacedImageList title="追加済みの画像" images={panel.images} assets={manga.image_assets} busy={imageImportBusy}
        selectedIndex={selectedElement?.type === 'image' && selectedElement.scope !== 'page' ? selectedElement.index : undefined}
        onSelect={index => onSelectElement(index === null ? null : { type: 'image', index, scope: 'panel' })}
        onChange={images => update(draft => { draft.images = images; })} />
    </details>}

    <section class="editor-section inspector-category-section panel-figure-section">
      <SectionTitle title="人物" action={<button class="inline-add" disabled={!manga.characters.length} onClick={() => { const index = panel.figures?.length ?? 0; const character = manga.characters[0]; update((draft) => { delete draft.no_figures; (draft.figures ??= []).push({ name: character?.name ?? '', kind: 'person', refId: character?.localId, bbox: fallbackBox(panel, 'figure', index), anchor: 'center', size: 'bust-up', role: 'main' }); }); onSelectElement({ type: 'figure', index }); }}><UserPlus size={14} />人物を追加</button>} />
      <label class="check-row" title={hasPersonFigures ? '人物が配置されているため選択できません' : undefined}><input type="checkbox" disabled={hasPersonFigures} checked={!hasPersonFigures && (panel.no_figures ?? false)} onChange={(event) => update((draft) => { event.currentTarget.checked ? draft.no_figures = true : delete draft.no_figures; })} /><span>人物の描画なし</span></label>
      <div class="nested-list">
        {(panel.figures ?? []).map((figure, index) => ({ figure, index })).filter(({ figure }) => !isPropPlacement(figure)).map(({ figure, index }) => <div class={`nested-card selectable-card ${ownerItemLocked(figure)?'is-locked':''} ${figure.splitOverlap ? 'is-split-overlap' : ''} ${figure.analogImport?.analysisReview ? 'is-analysis-review' : ''} ${selectedElement?.type === 'figure' && selectedElement.index === index ? 'is-selected' : ''}`} inert={ownerItemLocked(figure)} aria-disabled={ownerItemLocked(figure)} key={`${figure.refId ?? figure.name}-${index}`} onClick={(event) => selectCard(event, { type: 'figure', index })}>
          <div class="nested-card-head">{(selectedElement?.type === 'figure' && selectedElement.index === index) || figure.splitOverlap
            ? <strong>{selectedElement?.type === 'figure' && selectedElement.index === index ? '選択中' : ''}{figure.splitOverlap && <em class="split-overlap-badge">分割重複</em>}</strong>
            : <span />}
            <button onClick={(event) => { event.stopPropagation(); update((draft) => { draft.figures?.splice(index, 1); }); if (selectedElement?.type === 'figure') onSelectElement(null); }}>×</button></div>
          <div class="field-grid">
            <Field label="登場人物"><select value={figure.refId ?? ''} onChange={(event) => update((draft) => {
              const value = event.currentTarget.value;
              const target = draft.figures![index];
              const character = manga.characters.find((entry) => entry.localId === value);
              if (character) { target.refId = character.localId; target.name = character.name; }
              else delete target.refId;
              if (target.analogImport) {
                target.analogImport.userEdited = true;
                delete target.analogImport.analysisReview;
                delete target.analogImport.analysisReviewMessage;
              }
              target.kind = 'person';
              target.size ??= 'bust-up'; target.role ??= 'main'; delete draft.no_figures;
            })}>
              <option value="">未選択</option>
              {manga.characters.map((character) => <option value={character.localId}>{character.name}</option>)}
            </select></Field>
            <Field label="表示位置"><select value={figure.anchor ?? ''} onChange={(event) => {
              const value = event.currentTarget.value as typeof figure.anchor | '';
              update((draft) => { value ? draft.figures![index].anchor = value : delete draft.figures![index].anchor; });
            }}><option value="">未指定</option>{ANCHORS.map((anchor) => <option value={anchor}>{ANCHOR_LABELS[anchor]}</option>)}</select></Field>
            <Field label="撮影範囲"><FigureSizePicker value={figure.size ?? 'bust-up'} onChange={size => update(draft => { draft.figures![index].size = size; })} /></Field>
            <Field label="あつかい"><select value={figure.role ?? 'main'} onChange={(event) => update((draft) => { draft.figures![index].role = event.currentTarget.value as typeof figure.role; })}>{FIGURE_ROLES.map((role) => <option value={role}>{FIGURE_ROLE_LABELS[role]}</option>)}</select></Field>
            <Field label="アクション" wide><textarea rows={3} value={figure.action ?? ''} placeholder="この人物の表情・姿勢・視線・動作" onInput={(event) => update((draft) => {
              const value = event.currentTarget.value;
              value ? draft.figures![index].action = value : delete draft.figures![index].action;
            })} /></Field>
          </div>
          <FigureHumanPoseEditor key={`${manga.meta.series_id}:${manga.meta.episode_id}:${pageIndex}:${panelIndex}:${figure.layerId ?? index}`}
            cutFrame={humanPosePanelCutFrame(panel, humanPoseFigureFrame(figure, fallbackBox(panel, 'figure', index)))}
            panelContext={{ panel, selectedIndex: index, assets: manga.image_assets ?? [], dpi: getOutputSettings(manga).dpi,
              guides: Object.fromEntries((panel.figures ?? []).map((_, i) => [`figure-${i}`, guideVisible(`figure-${i}`)])) }}
            stages={manga.background_stages} backgroundCaptures={(panel.background_images ?? []).flatMap((image, i) => image.paint?.background3d ? [{ label: `このコマの背景 ${i + 1}`, capture: image.paint.background3d }] : [])}
            aspect={figure.bbox && figure.bbox.h > 0 ? figure.bbox.w / figure.bbox.h : 1} framingLabel={FIGURE_SIZE_LABELS[figure.size ?? 'bust-up']} framingSize={figure.size ?? 'bust-up'}
            value={figure.human_pose} onChange={(value, confirmedFramingSize) => update(draft => {
              if (value) draft.figures![index].human_pose = value;
              else delete draft.figures![index].human_pose;
              if (confirmedFramingSize) draft.figures![index].size = confirmedFramingSize;
            })} />
        </div>)}
      </div>
    </section>

    <section class="editor-section inspector-category-section panel-prop-section">
      <SectionTitle title="小道具" action={<button class="inline-add" onClick={onOpenProps}><Box size={14} />追加</button>} />
      <div class="nested-list">
        {(panel.figures ?? []).map((figure, index) => ({ figure, index })).filter(({ figure }) => isPropPlacement(figure)).map(({ figure, index }) => <div class={`nested-card selectable-card ${ownerItemLocked(figure)?'is-locked':''} ${figure.splitOverlap ? 'is-split-overlap' : ''} ${selectedElement?.type === 'figure' && selectedElement.index === index ? 'is-selected' : ''}`} inert={ownerItemLocked(figure)} aria-disabled={ownerItemLocked(figure)} key={`${figure.refId ?? figure.name}-${index}`} onClick={(event) => selectCard(event, { type: 'figure', index })}>
          <div class="nested-card-head">{(selectedElement?.type === 'figure' && selectedElement.index === index) || figure.splitOverlap
            ? <strong>{selectedElement?.type === 'figure' && selectedElement.index === index ? '選択中' : ''}{figure.splitOverlap && <em class="split-overlap-badge">分割重複</em>}</strong>
            : <span />}
            <button onClick={(event) => { event.stopPropagation(); update((draft) => {
              const target = draft.figures?.[index];
              const material = propMaterials.find((entry) => (target?.refId && entry.localId === target.refId) || entry.key === target?.name);
              if (material) setLinkedMaterial(draft, material, false);
              draft.figures?.splice(index, 1);
            }); if (selectedElement?.type === 'figure') onSelectElement(null); }}>×</button></div>
          <div class="field-grid">
            <Field label="小道具"><select value={figure.refId ?? ''} onChange={(event) => update((draft) => {
              const target = draft.figures![index];
              const previous = propMaterials.find((entry) => (target.refId && entry.localId === target.refId) || entry.key === target.name);
              const prop = propMaterials.find((entry) => entry.localId === event.currentTarget.value);
              if (previous) setLinkedMaterial(draft, previous, false);
              if (prop) { target.refId = prop.localId; target.name = prop.key; setLinkedMaterial(draft, prop, true); }
              else delete target.refId;
              target.kind = 'prop'; delete target.size; delete target.role;
            })}><option value="">未選択</option>{propMaterials.map((material) => <option value={material.localId}>{material.key}</option>)}</select></Field>
            <Field label="表示位置"><select value={figure.anchor ?? ''} onChange={(event) => {
              const value = event.currentTarget.value as typeof figure.anchor | '';
              update((draft) => { value ? draft.figures![index].anchor = value : delete draft.figures![index].anchor; });
            }}><option value="">未指定</option>{ANCHORS.map((anchor) => <option value={anchor}>{ANCHOR_LABELS[anchor]}</option>)}</select></Field>
          </div>
        </div>)}
      </div>
    </section>

    <BubbleInfoPortal request={canvasSelectionScrollRequest} disabled={locked} label={`${panelDisplayLabel(panel.id)}の吹き出し情報`}>
    <section class="editor-section inspector-category-section panel-bubble-section">
      <SectionTitle title="フキダシ" action={<button class="inline-add" onClick={() => { const index = panel.bubbles.length; update((draft) => { draft.bubbles.push({ text: '', shape: 'normal', bbox: fallbackBox(panel, 'bubble', index) }); }); onSelectElement({ type: 'bubble', index }); }}><MessageCircleMore size={14} />追加</button>} />
      <div class="nested-list">
        {panel.bubbles.map((bubble, index) => <div class={`nested-card bubble-card selectable-card ${ownerItemLocked(bubble)?'is-locked':''} ${bubble.splitOverlap ? 'is-split-overlap' : ''} ${selectedElement?.type === 'bubble' && selectedElement.index === index ? 'is-selected' : ''}`} inert={ownerItemLocked(bubble)} aria-disabled={ownerItemLocked(bubble)} key={index} onClick={(event) => selectCard(event, { type: 'bubble', index })}>
          <div class="nested-card-head"><BubbleCardTitle number={index + 1} selected={selectedElement?.type === 'bubble' && selectedElement.index === index} splitOverlap={bubble.splitOverlap} /><button onClick={(event) => { event.stopPropagation(); update((draft) => { removeBubbleAt(draft.bubbles, index); }); if (selectedElement?.type === 'bubble') onSelectElement(null); }}>×</button></div>
          {manga.scenario && <ScenarioBubbleNotice manga={manga} bubble={bubble} location={{ pageIndex, panelIndex, bubbleIndex: index }} onScenarioChoice={onScenarioChoice} />}
          <div class="field-grid">
            <Field label="話者"><select value={bubble.speakerId ?? ''} onChange={(event) => update((draft) => { const character = manga.characters.find((entry) => entry.localId === event.currentTarget.value); if (character) { draft.bubbles[index].speakerId = character.localId; draft.bubbles[index].speaker = character.name; } else { delete draft.bubbles[index].speakerId; delete draft.bubbles[index].speaker; } })}><option value="">話者なし</option>{manga.characters.map((character) => <option value={character.localId}>{character.name}</option>)}</select></Field>

          </div>
          <Field label="しっぽ"><select value={bubbleTailStyle(bubble)} onChange={(event)=>update((draft)=>setBubbleTailStyle(draft.bubbles[index],event.currentTarget.value as 'none'|'normal'|'thinking'))}><option value="none">なし</option><option value="normal">通常のしっぽ</option><option value="thinking">thinking（丸2〜4個）</option></select></Field>
          {index > 0 && <div class="bubble-join-control">
            <Field label="結合先"><select value={bubble.join_to === undefined ? '' : String(bubble.join_to)} onChange={(event) => { const value=event.currentTarget.value;update((draft) => { value ? draft.bubbles[index].join_to=Number(value) : delete draft.bubbles[index].join_to; }); }}>
              <option value="">結合しない</option>
              {panel.bubbles.slice(0, index).map((_, targetIndex) => <option value={String(targetIndex + 1)}>フキダシ {targetIndex + 1}</option>)}
            </select></Field>
          </div>}
        </div>)}
      </div>
    </section>
    </BubbleInfoPortal>

    <section class="editor-section inspector-category-section panel-text-section">
      <SectionTitle title="通常文字" />
      <div class="nested-list">
        {(panel.screen_text ?? []).map((screenText, index) => <div class={`nested-card selectable-card ${screenText.splitOverlap ? 'is-split-overlap' : ''} ${selectedElement?.type === 'screen_text' && selectedElement.index === index ? 'is-selected' : ''}`} key={index} onClick={(event) => selectCard(event, { type: 'screen_text', index })}>
          <div class="nested-card-head"><strong>TEXT {index + 1}{selectedElement?.type === 'screen_text' && selectedElement.index === index ? ' · 選択中' : ''}{screenText.splitOverlap && <em class="split-overlap-badge">分割重複</em>}</strong><button onClick={(event) => { event.stopPropagation(); update((draft) => { draft.screen_text?.splice(index, 1); if (!draft.screen_text?.length) delete draft.screen_text; }); if (selectedElement?.type === 'screen_text') onSelectElement(null); }}>×</button></div>
          <Field label="文字" wide><textarea rows={2} value={screenText.text} placeholder="紙面へ置く文字" onInput={(event) => update((draft) => { draft.screen_text![index].text = event.currentTarget.value; })} /></Field>
        </div>)}
      </div>
    </section>
    <button class="add-panel-bottom panel-add-section" onClick={onAdd}><Plus size={16} />新しいコマを追加</button>
    {panelControls}
    </div>
  </div>
  {panelDraftToolbarTarget && createPortal(
    <button type="button" class="panel-draft-toolbar-button" title="選択中のコマのラフ生成内容を確認" aria-haspopup="dialog" disabled={Boolean(panelDraftDialog)} onClick={openPanelDraftDialog}>
      <ImageIcon size={15} />{panelDisplayLabel(panel.id)}・4値ラフ（Animagine）…
    </button>, panelDraftToolbarTarget,
  )}
  {panelDraftDialog && typeof window !== 'undefined' && createPortal(<>
    <button class="drawer-backdrop" onClick={closePanelDraftDialog} disabled={panelDraftDialog.status === 'loading' || Boolean(panelDraftDialog.reviewing) || Boolean(panelDraftDialog.reviewResolutionRequired)} aria-label="作画用ラフ生成を閉じる" />
    <section class="panel-draft-dialog" role="dialog" aria-modal="true" aria-labelledby="panel-draft-title" aria-busy={panelDraftDialog.status === 'loading' || Boolean(panelDraftDialog.reviewing)}>
      <div class="drawer-head panel-draft-dialog-head">
        <div>
          <small>ページ {panelDraftDialog.plan.pageNumber}・{panelDisplayLabel(panelDraftDialog.plan.panelId)}</small>
          <h2 id="panel-draft-title">作画用4値ラフを1枚生成</h2>
        </div>
        <button type="button" onClick={closePanelDraftDialog} disabled={panelDraftDialog.status === 'loading' || Boolean(panelDraftDialog.reviewing) || Boolean(panelDraftDialog.reviewResolutionRequired)} aria-label="閉じる"><X size={16} /></button>
      </div>
      <div class="panel-draft-dialog-body">
        <div class={`panel-draft-workspace ${episodeWorkspaceToken ? 'is-ready' : 'is-missing'}`}>
          <div><strong>自動保存先</strong><span>{episodeWorkspaceToken ? `${episodeWorkspaceFolder}/draft_data/nyamuru` : '未選択'}</span></div>
          {!episodeWorkspaceToken && <button type="button" class="secondary-button" onClick={() => void choosePanelDraftWorkspace()}><FolderOpen size={15} />保存先を選ぶ</button>}
        </div>
        {panelDraftDialog.result
          ? <div class="panel-draft-result">
            <img src={panelDraftDialog.result.imageDataUrl} alt={`ページ${panelDraftDialog.plan.pageNumber} ${panelDisplayLabel(panelDraftDialog.plan.panelId)}の作画用4値ラフ`} />
            <p>Animagine XL 3.1の生成結果を4値へ正規化し、不変artifactとして自動保存しました。OMNY本文やコマ画像は自動更新していません。</p>
            <dl class="panel-draft-provenance">
              <div><dt>Version</dt><dd>{panelDraftDialog.result.attemptNumber}</dd></div>
              <div><dt>Job</dt><dd>{panelDraftDialog.result.jobId}</dd></div>
              <div><dt>Attempt / Comfy prompt</dt><dd>{panelDraftDialog.result.attemptId}</dd></div>
              <div><dt>保存先</dt><dd>{panelDraftDialog.result.artifacts.manga_base_composite?.workspaceRelativePath}</dd></div>
              <div><dt>SHA-256</dt><dd>{panelDraftDialog.result.artifacts.manga_base_composite?.sha256}</dd></div>
              <div><dt>レビュー</dt><dd>{panelDraftDialog.result.review.decision === 'accepted' ? '採用候補' : panelDraftDialog.result.review.decision === 'rejected' ? '見送り' : '未確認'}</dd></div>
            </dl>
            <div class="panel-draft-review-actions" aria-label="生成結果の人間レビュー">
              <button type="button" disabled={Boolean(panelDraftDialog.reviewing) || panelDraftDialog.historyLoading || Boolean(panelDraftDialog.reviewResolutionRequired)} class={panelDraftDialog.result.review.decision === 'accepted' ? 'is-selected' : ''} onClick={() => void reviewPanelDraft('accepted')}><Check size={15} />採用候補</button>
              <button type="button" disabled={Boolean(panelDraftDialog.reviewing) || panelDraftDialog.historyLoading || Boolean(panelDraftDialog.reviewResolutionRequired)} class={panelDraftDialog.result.review.decision === 'rejected' ? 'is-selected' : ''} onClick={() => void reviewPanelDraft('rejected')}><Ban size={15} />見送り</button>
            </div>
          </div>
          : <>
            <p>選択中のコマだけを作画用ラフとして生成します。押すたびに新しいattemptを明示作成し、入力OMNY・plan・workflow・生成PNGを自動保存します。</p>
            <dl class="panel-draft-settings">
              <div><dt>プロファイル</dt><dd>{panelDraftDialog.plan.profile}</dd></div>
              <div><dt>モデル</dt><dd>{panelDraftDialog.plan.checkpoint}</dd></div>
              <div><dt>画像</dt><dd>{panelDraftDialog.plan.width} × {panelDraftDialog.plan.height}px・1枚</dd></div>
              <div><dt>Steps / CFG</dt><dd>{panelDraftDialog.plan.steps} / {panelDraftDialog.plan.cfg}</dd></div>
              <div><dt>Seed</dt><dd>{panelDraftDialog.plan.seed}</dd></div>
            </dl>
            <label class="panel-draft-prompt">
              <span>ポジティブプロンプト</span>
              <textarea rows={6} readOnly value={panelDraftDialog.plan.positivePrompt} />
            </label>
            <label class="panel-draft-prompt">
              <span>ネガティブプロンプト</span>
              <textarea rows={4} readOnly value={panelDraftDialog.plan.negativePrompt} />
            </label>
          </>}
        <ul class="panel-draft-palette" aria-label="manga-base 4値パレット">
          <li><span style={{ backgroundColor: MANGA_BASE_PALETTE.ink }} />黒 {MANGA_BASE_PALETTE.ink}<small>線・確定黒ベタ</small></li>
          <li><span style={{ backgroundColor: MANGA_BASE_PALETTE.denseTone }} />赤 {MANGA_BASE_PALETTE.denseTone}<small>濃トーン候補</small></li>
          <li><span style={{ backgroundColor: MANGA_BASE_PALETTE.lightTone }} />水色 {MANGA_BASE_PALETTE.lightTone}<small>薄トーン候補</small></li>
          <li><span style={{ backgroundColor: MANGA_BASE_PALETTE.paper }} />白 {MANGA_BASE_PALETTE.paper}<small>紙・背景</small></li>
        </ul>
        {panelDraftDialog.status === 'loading' && <p class="panel-draft-message is-loading" role="status">ComfyUIで生成しています。初回はモデル読込に時間がかかります…</p>}
        {panelDraftDialog.status === 'error' && <p class="panel-draft-message is-error" role="alert">{panelDraftDialog.error}</p>}
        {panelDraftDialog.message && <p class="panel-draft-message is-info" role="status">{panelDraftDialog.message}</p>}
        {panelDraftDialog.reviewResolutionRequired && !panelDraftDialog.historyLoading && panelDraftDialog.reviewResolution
          && <button type="button" class="secondary-button" disabled={Boolean(panelDraftDialog.reviewing)} onClick={() => void resolvePanelDraftReview()}><RefreshCw size={14} />同じnonceでreviewを再確認</button>}
        {(panelDraftDialog.historyLoading || panelDraftDialog.attempts.length > 0) && <section class="panel-draft-history" aria-label="このコマの制作履歴">
          <div class="panel-draft-history-head"><strong>制作履歴</strong>{panelDraftDialog.historyLoading && <span>読込中…</span>}</div>
          {panelDraftDialog.attempts.map((attempt) => <article key={attempt.attemptId}>
            <div><strong>v{attempt.attemptNumber}</strong><span class={`is-${attempt.status}`}>{attempt.status}</span><small>{attempt.review.decision}</small></div>
            <code>{attempt.attemptId}</code>
            {attempt.artifacts.manga_base_composite && <small>{attempt.artifacts.manga_base_composite.workspaceRelativePath}</small>}
            {(attempt.status === 'queued' || attempt.status === 'outcome_unknown' || attempt.status === 'created')
              && <button type="button" onClick={() => void reconcilePanelDraft(attempt.attemptId)} disabled={panelDraftDialog.status === 'loading' || Boolean(panelDraftDialog.reviewing) || Boolean(panelDraftDialog.reviewResolutionRequired)}><RefreshCw size={14} />ComfyUIで再確認</button>}
          </article>)}
        </section>}
        <div class="panel-draft-dialog-actions">
          {panelDraftDialog.result
            ? <>
              <a class="secondary-button" href={panelDraftDialog.result.imageDataUrl} download={panelDraftDialog.result.fileName}><Download size={16} />4値PNGを保存</a>
              <button type="button" class="primary-button" disabled={Boolean(panelDraftDialog.reviewing) || Boolean(panelDraftDialog.reviewResolutionRequired)} onClick={() => void requestPanelDraft()}><ImageIcon size={16} />新しいversionを生成</button>
            </>
            : <button type="button" class="primary-button" disabled={panelDraftDialog.status === 'loading' || Boolean(panelDraftDialog.reviewing) || Boolean(panelDraftDialog.reviewResolutionRequired) || !episodeWorkspaceToken} onClick={() => void requestPanelDraft()}>
              <ImageIcon size={16} />{panelDraftDialog.status === 'loading' ? '生成して保存中…' : panelDraftDialog.status === 'error' ? '新しいattemptで再生成' : '生成して自動保存'}
            </button>}
          <button type="button" class="secondary-button" disabled={panelDraftDialog.status === 'loading' || Boolean(panelDraftDialog.reviewing) || Boolean(panelDraftDialog.reviewResolutionRequired)} onClick={closePanelDraftDialog}>閉じる</button>
        </div>
      </div>
    </section>
  </>, window.document.body)}
  </>;
}
