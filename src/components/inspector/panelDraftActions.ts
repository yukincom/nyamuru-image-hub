import { type PanelDraftPlan, buildPanelDraftPlan } from '../../lib/panelDraft.ts';
import { type PanelDraftResult, type PanelDraftAttemptSummary, type PanelDraftReviewAction, listPanelDraftAttempts, generatePanelDraftWithComfyUI, reconcilePanelDraftAttempt, reviewPanelDraftAttempt } from '../../lib/localBridge.ts';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { Manga } from '../../types';

export interface PanelDraftDialogState {
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

interface CreatePanelDraftActionsInputs {
  episodeWorkspaceToken: string;
  panelDraftHistoryRequest: Cell<number>;
  setPanelDraftDialog: Dispatch<StateUpdater<PanelDraftDialogState | null>>;
  manga: Manga;
  pageIndex: number;
  panelIndex: number;
  setGenerationStatus: Dispatch<StateUpdater<{ kind: "loading" | "success" | "error"; message: string; } | null>>;
  panelDraftDialog: PanelDraftDialogState | null;
  panelDraftRequest: Cell<number>;
  panelDraftReviewRequest: Cell<number>;
  onChooseEpisodeWorkspace: () => Promise<void>;
  seriesId: string;
  episodeId: string;
  getOmnySnapshot: () => string;
}

export function createPanelDraftActions({ episodeWorkspaceToken, panelDraftHistoryRequest, setPanelDraftDialog, manga, pageIndex, panelIndex, setGenerationStatus, panelDraftDialog, panelDraftRequest, panelDraftReviewRequest, onChooseEpisodeWorkspace, seriesId, episodeId, getOmnySnapshot }: CreatePanelDraftActionsInputs) {
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
  return { openPanelDraftDialog, closePanelDraftDialog, choosePanelDraftWorkspace, reviewPanelDraft, resolvePanelDraftReview, reconcilePanelDraft, requestPanelDraft };
}

type Cell<T> = { current: T };
