import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isLanClient } from '../lib/clientRuntime.ts';
import type { MangaDocument } from '../types';
import {
  buildSourceCoverageReport,
  decisionForReport,
  MAX_SOURCE_BYTES,
  type SourceCoverageDecision,
  type SourceCoverageDecisionValue,
  type SourceCoverageReport,
  type SourceCoverageSource,
  type SourceCoverageStatus,
} from '../lib/sourceCoverage.ts';
import type { SourceCoverageSaveResult } from '../lib/localBridge.ts';
import '../styles/sourceCoverage.css';

type CoverageFilter = 'review' | 'all' | SourceCoverageStatus;

export interface SourceCoverageReviewProps {
  document: MangaDocument;
  getOmnySnapshot: () => string;
  source: SourceCoverageSource | null;
  decisions: readonly SourceCoverageDecision[];
  workspaceFolder: string;
  canChooseWorkspaceSource: boolean;
  canSave: boolean;
  onSourceChange: (source: SourceCoverageSource) => void;
  onChooseWorkspaceSource: () => Promise<void>;
  onConnectWorkspace: () => Promise<void>;
  onDecisionsChange: (decisions: SourceCoverageDecision[]) => void;
  onSave: (report: SourceCoverageReport) => Promise<SourceCoverageSaveResult>;
  onNavigate: (tab: 'meta' | 'setting' | 'storyboard' | 'characters' | 'props') => void;
  onNotify: (message: string) => void;
}

const STATUS_LABELS: Record<SourceCoverageStatus, string> = {
  confirmed: '決定的な対応あり',
  ambiguous: '候補が複数',
  unverified: '自動確認できず',
  excluded: '構造行・対象外',
};

const DECISION_LABELS: Record<SourceCoverageDecisionValue, string> = {
  covered: '人が対応済みと確認',
  not_covered: '未反映と確認',
  not_applicable: '反映不要と確認',
};

const WARNING_LABELS: Record<string, string> = {
  unstable_episode_identity: 'エピソードIDが空のため、対象IDは今回のOMNY内容に依存します。',
  source_contains_control_or_bidi_characters: '原文に制御文字または表示方向制御文字があります。表示を目視確認してください。',
  context_only_matches_require_storyboard_review: '舞台設定などに残っていても、コマ・台詞へ反映された証拠がない行があります。',
  substring_matching_skipped_due_to_volume: '入力規模が大きいためsubstring候補だけを省略しました。完全一致は全件確認済みです。',
};

function reportDownload(report: SourceCoverageReport): void {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = `source-coverage-${report.analysis_sha256.slice(0, 16)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function targetTab(locator: string): 'meta' | 'setting' | 'storyboard' | 'characters' | 'props' {
  if (locator.startsWith('/manga/meta/')) return 'meta';
  if (locator.startsWith('/manga/setting/') || locator.startsWith('/manga/series_setting/')) return 'setting';
  if (locator.startsWith('/manga/characters/')) return 'characters';
  if (locator.startsWith('/manga/materials/')) return 'props';
  return 'storyboard';
}

export default function SourceCoverageReview({
  document,
  getOmnySnapshot,
  source,
  decisions,
  workspaceFolder,
  canChooseWorkspaceSource,
  canSave,
  onSourceChange,
  onChooseWorkspaceSource,
  onConnectWorkspace,
  onDecisionsChange,
  onSave,
  onNavigate,
  onNotify,
}: SourceCoverageReviewProps) {
  const [report, setReport] = useState<SourceCoverageReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'source' | 'connect' | 'save' | ''>('');
  const [filter, setFilter] = useState<CoverageFilter>('review');
  const uploadInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setError('');
    if (!source) return () => { active = false; };
    void buildSourceCoverageReport(source, document, { omnyYaml: getOmnySnapshot(), decisions }).then(
      (next) => { if (active) setReport(next); },
      (reason) => { if (active) setError(reason instanceof Error ? reason.message : '原文を照合できませんでした'); },
    );
    return () => { active = false; };
  }, [source, document, getOmnySnapshot, decisions]);

  const targetById = useMemo(() => new Map(report?.targets.map((target) => [target.target_id, target]) ?? []), [report]);
  const displayedUnits = useMemo(() => (report?.source_units ?? []).filter((unit) => {
    if (filter === 'all') return true;
    if (filter === 'review') {
      const currentDecision = report?.human_decisions.find((decision) => (
        decision.source_unit_id === unit.source_unit_id && !decision.stale
      ));
      return unit.kind === 'content' && unit.status !== 'confirmed' && !currentDecision;
    }
    return unit.status === filter;
  }), [report, filter]);

  const chooseWorkspaceSource = async () => {
    setBusy('source');
    try {
      await onChooseWorkspaceSource();
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : '原作・台本を選べませんでした');
    } finally {
      setBusy('');
    }
  };

  const uploadSource = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > MAX_SOURCE_BYTES) throw new Error('原作・台本が5MiBを超えています');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error('原作・台本はUTF-8で保存してください');
      }
      onSourceChange({ fileName: file.name, relativePath: null, text });
      onNotify(`${file.name}を原文確認へ読み込みました`);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : '原作・台本を読み込めませんでした');
    } finally {
      if (uploadInput.current) uploadInput.current.value = '';
    }
  };

  const connectWorkspace = async () => {
    setBusy('connect');
    try {
      await onConnectWorkspace();
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : 'エピソード保存先を関連付けられませんでした');
    } finally {
      setBusy('');
    }
  };

  const saveReport = async () => {
    if (!report) return;
    setBusy('save');
    try {
      const result = await onSave(report);
      onNotify(result.created
        ? `${result.relativePath}へ原文確認reportを保存しました`
        : '同じ原文確認reportは保存済みです');
    } catch (reason) {
      onNotify(`保存できませんでした。JSON downloadは利用できます: ${reason instanceof Error ? reason.message : '不明なエラー'}`);
    } finally {
      setBusy('');
    }
  };

  const updateDecision = (sourceUnitId: string, value: string, note?: string) => {
    if (!report) return;
    const remaining = decisions.filter((decision) => decision.source_unit_id !== sourceUnitId);
    if (!value) {
      onDecisionsChange(remaining);
      return;
    }
    const decision = decisionForReport(report, sourceUnitId, value as SourceCoverageDecisionValue, note ?? '');
    onDecisionsChange([...remaining, decision]);
  };

  return <section class="source-coverage-root" aria-labelledby="source-coverage-title">
    <header class="source-coverage-head">
      <div>
        <span class="source-coverage-eyebrow">LOCAL / DETERMINISTIC / NO LLM</span>
        <h2 id="source-coverage-title">原文の反映確認</h2>
        <p>原作・台本の各行が現在のOMNYに残っている証拠を一覧化します。未一致を自動で「欠落」とは断定せず、作品内容も変更しません。</p>
      </div>
      <div class="source-coverage-source-actions">
        <input ref={uploadInput} type="file" accept=".md,.markdown,.txt,.text,text/plain,text/markdown" hidden onChange={(event) => void uploadSource(event.currentTarget.files?.[0])} />
        <button type="button" class="secondary-button" onClick={() => uploadInput.current?.click()}>端末から選択</button>
        {!isLanClient && <button type="button" class="secondary-button" disabled={!canChooseWorkspaceSource || busy === 'source'} onClick={() => void chooseWorkspaceSource()}>
          {busy === 'source' ? '選択中…' : '作品フォルダから選択'}
        </button>}
      </div>
    </header>

    {!source && <div class="source-coverage-empty">
      <strong>この編集セッションには原作・台本snapshotがありません</strong>
      <p>原文がないことを取りこぼしとは扱いません。監査する1ファイルを明示的に選んでください。</p>
    </div>}

    {source && <>
      <section class="source-coverage-source-card">
        <div><strong>{source.fileName}</strong><span>{source.relativePath ?? '作品フォルダ外・相対pathなし'}</span></div>
        <div><strong>{workspaceFolder || '保存先未関連付け'}</strong><span>原文は表示と照合にだけ使い、OMNYへ埋め込みません</span></div>
      </section>
      {error && <p class="source-coverage-error" role="alert">{error}</p>}
      {!error && !report && <p class="source-coverage-loading" role="status">原文と現在のOMNYを照合しています…</p>}
      {report && <>
        <section class="source-coverage-summary" aria-label="照合結果の件数">
          <div><span>決定的な対応</span><strong>{report.summary.confirmed}</strong></div>
          <div><span>候補が複数</span><strong>{report.summary.ambiguous}</strong></div>
          <div><span>自動確認できず</span><strong>{report.summary.unverified}</strong></div>
          <div><span>構造行・対象外</span><strong>{report.summary.excluded}</strong></div>
          <div class="is-review"><span>人の確認待ち</span><strong>{report.summary.unresolved_after_review}</strong></div>
        </section>

        {report.warnings.length > 0 && <ul class="source-coverage-warnings">
          {report.warnings.map((warning) => <li key={warning}>{WARNING_LABELS[warning] ?? warning}</li>)}
        </ul>}

        <section class="source-coverage-toolbar">
          <label><span>表示</span><select value={filter} onChange={(event) => setFilter(event.currentTarget.value as CoverageFilter)}>
            <option value="review">人の確認待ち</option>
            <option value="all">全行</option>
            <option value="confirmed">決定的な対応あり</option>
            <option value="ambiguous">候補が複数</option>
            <option value="unverified">自動確認できず</option>
            <option value="excluded">構造行・対象外</option>
          </select></label>
          <div>
            {!isLanClient && !canSave && <button type="button" class="secondary-button" disabled={busy === 'connect'} onClick={() => void connectWorkspace()}>{busy === 'connect' ? '関連付け中…' : '保存先を関連付け'}</button>}
            <button type="button" class="secondary-button" onClick={() => reportDownload(report)}>JSON download</button>
            {!isLanClient && <button type="button" class="primary-button" disabled={!canSave || busy === 'save'} onClick={() => void saveReport()}>{busy === 'save' ? '保存中…' : '作品フォルダへ保存'}</button>}
          </div>
        </section>

        <p class={`source-coverage-verdict is-${report.verdict}`}>
          {report.verdict === 'review_required'
            ? `自動確認できない行が${report.summary.unresolved_after_review}件あります。制作は止めませんが、reportは確認待ちです。`
            : report.verdict === 'reviewed_with_gaps'
              ? '未反映と人が確認した行を含むreview済みreportです。'
              : '決定的な対応または人の判断が全対象行にあります。'}
        </p>

        <div class="source-coverage-list">
          {displayedUnits.length === 0 && <p class="source-coverage-empty-filter">この表示条件に該当する行はありません。</p>}
          {displayedUnits.map((unit) => {
            const candidates = unit.candidate_target_ids.flatMap((id) => {
              const target = targetById.get(id);
              return target ? [target] : [];
            });
            const recorded = report.human_decisions.find((decision) => decision.source_unit_id === unit.source_unit_id);
            return <article class={`source-coverage-unit is-${unit.status}`} key={unit.source_unit_id}>
              <div class="source-coverage-unit-head">
                <span>L{unit.start_line}</span>
                <strong>{STATUS_LABELS[unit.status]}</strong>
                {unit.context_retained && <em>舞台・台帳にのみ保持</em>}
                {recorded?.stale && <em class="is-stale">以前の人間判断はOMNY変更後のため再確認</em>}
              </div>
              <pre>{unit.excerpt}</pre>
              {candidates.length > 0 && <div class="source-coverage-candidates">
                {candidates.map((target) => <button type="button" key={target.target_id} onClick={() => onNavigate(targetTab(target.locator))}>
                  <span>{target.layer === 'storyboard_evidenced' ? 'コマ・台詞' : '舞台・台帳'} / {target.kind}</span>
                  <strong>{target.value}</strong>
                  <small>{target.locator}</small>
                </button>)}
                {unit.candidate_total > candidates.length && <p>ほか{unit.candidate_total - candidates.length}候補（report肥大化防止のため省略）</p>}
              </div>}
              {unit.kind === 'content' && <div class="source-coverage-human-review">
                <label><span>人の判断</span><select value={recorded?.decision ?? ''} onChange={(event) => updateDecision(unit.source_unit_id, event.currentTarget.value, recorded?.note)}>
                  <option value="">未判断</option>
                  {Object.entries(DECISION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label class="is-note"><span>任意メモ</span><input value={recorded?.note ?? ''} disabled={!recorded} maxLength={1000} onInput={(event) => {
                  if (recorded) updateDecision(unit.source_unit_id, recorded.decision, event.currentTarget.value);
                }} /></label>
              </div>}
            </article>;
          })}
        </div>
      </>}
    </>}
  </section>;
}
