import { qwenJobLocation, type QwenJob } from '../../lib/qwenGeneration.ts';

export const generationStatusLabel = {
  preparing: '入力を準備中', prepared: '生成準備済み', queued: '生成待ち', running: '生成中',
  succeeded: '生成完了', failed: '失敗', outcome_unknown: '結果未確定',
};

interface Props {
  job: QwenJob;
  busy: boolean;
  selectedCandidate: number | null;
  selectedCandidates: number[];
  inserted: boolean;
  canPrepareNewGeneration: boolean;
  onChoose: (index: number) => void;
  onSelect: () => Promise<void>;
  onInsert: () => Promise<void>;
  onRemove: () => Promise<void>;
  onPrepare: () => void;
}

/** Display the current result; selection, insertion, and cleanup remain dialog operations. */
export default function GenerationCandidates({
  job, busy, selectedCandidate, selectedCandidates, inserted, canPrepareNewGeneration,
  onChoose, onSelect, onInsert, onRemove, onPrepare,
}: Props) {
  const chosen = job.selectedCandidates ?? selectedCandidates;
  return <section class="qwen-result" aria-live="polite">
    <strong>{generationStatusLabel[job.status]}</strong>
    {job.error && <p>{job.error}</p>}
    {job.workflowName && <p>{job.workflowName} · 版{job.workflowVersion} · {job.width} × {job.height} px</p>}
    {job.generationPrompt && <details>
      <summary>送信した指示とシード</summary>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{job.generationPrompt}</pre>
      <p>{job.candidateSeeds?.join(', ')}</p>
    </details>}
    {job.documentKey && <small>{qwenJobLocation(job)}</small>}
    {job.candidates?.length && !job.image && <>
      <div class="qwen-candidates" role="group" aria-label="生成候補">
        {job.candidates.map(candidate => <button
          type="button" class="qwen-candidate" disabled={busy} key={candidate.index}
          aria-pressed={job.candidateCutout ? chosen.includes(candidate.index) : selectedCandidate === candidate.index}
          onClick={() => onChoose(candidate.index)}
        >
          <img src={candidate.image} alt={`候補${candidate.index}・シード${candidate.seed}`} />
          <span>候補{candidate.index} · seed {candidate.seed}</span>
        </button>)}
      </div>
      {selectedCandidate !== null && <img
        class="qwen-candidate-preview"
        src={job.candidates.find(candidate => candidate.index === selectedCandidate)?.image}
        alt={`選択中の候補${selectedCandidate}`}
      />}
      <button
        class="primary-button"
        disabled={busy || job.status !== 'succeeded' || (job.candidateCutout
          ? !chosen.length || !job.candidates.length && !job.selectedCandidates
          : selectedCandidate === null)}
        onClick={() => void onSelect()}
      >{job.candidateCutout
          ? inserted ? '未採用画像の削除を再試行' : `選択した${chosen.length}枚を追加`
          : job.requiresCutout ? '選んだ1枚の背景を透過する' : '選んだ1枚を採用する'}</button>
    </>}
    {job.image && <>
      <img src={job.image} alt={`${job.label}の生成結果`} />
      <div class="paint-entry-actions">
        <a href={job.image} download={job.fileName}>生成画像を保存</a>
        <button disabled={busy} onClick={() => void onInsert()}>新規レイヤーとして追加</button>
        <button disabled={busy} onClick={() => void onRemove()}>破棄する</button>
      </div>
    </>}
    {canPrepareNewGeneration && <button disabled={busy} onClick={onPrepare}>新しい生成を準備</button>}
  </section>;
}
