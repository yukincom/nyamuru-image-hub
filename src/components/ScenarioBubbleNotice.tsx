import { textDisplayLabel } from '../lib/displayLabels';
import { useState } from 'preact/hooks';
import type { Bubble, Manga } from '../types.ts';
import { availableScenarioCandidates, scenarioBubbleNeedsReview, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import '../styles/scenario.css';

export interface ScenarioBubbleChoiceProps {
  onScenarioChoice: (location: ScenarioBubbleLocation, sourceIds: readonly string[] | null) => void;
}

export default function ScenarioBubbleNotice({ manga, bubble, location, onScenarioChoice }: ScenarioBubbleChoiceProps & {
  manga: Manga;
  bubble: Bubble;
  location: ScenarioBubbleLocation;
}) {
  const [error, setError] = useState('');
  if (!scenarioBubbleNeedsReview(bubble)) return null;
  const candidates = availableScenarioCandidates({ manga }, location);
  const choose = (ids: readonly string[] | null) => {
    try { onScenarioChoice(location, ids); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '候補を選び直してください。'); }
  };
  return <div class="scenario-inline" onClick={event => event.stopPropagation()}>
    <strong>テキストネームの候補</strong>
    {candidates.length > 0 && <div class="scenario-candidates" aria-label={`${textDisplayLabel(location.bubbleIndex)}のシナリオ候補`}>
      {candidates.map(candidate => <div class="scenario-candidate" key={candidate.dialogues.map(d => d.id).join('|')}>
        <div class="scenario-candidate-body"><span><strong>{candidate.dialogues[0].speaker}</strong><small>{candidate.neighborScore ? '前後の吹き出しから推定 · ' : candidate.contextScore ? '前後コマから推定 · ' : ''}文字一致 {Math.round(candidate.score * 100)}％{candidate.dialogues.length > 1 ? ` · ${candidate.dialogues.length}行をまとめる` : ''}</small></span>
          <span class="scenario-prose">{candidate.dialogues.map(d => d.text).join('\n')}</span></div>
        <label class="scenario-confirm"><input type="checkbox" checked={false} aria-label={`「${candidate.dialogues.map(d => d.text).join('／')}」を確定`} onChange={event => { if(event.currentTarget.checked)choose(candidate.dialogues.map(d => d.id)); }}/><span>確定</span></label>
      </div>)}
    </div>}
    {!candidates.length && <p>選べる未使用の候補がありません。本文はそのまま編集できます。</p>}
    <label class="scenario-no-match"><input type="checkbox" checked={false} aria-label={`${textDisplayLabel(location.bubbleIndex)}は該当なし`} onChange={event => { if(event.currentTarget.checked)choose(null); }}/><span>該当なし</span></label>
    {error && <p role="alert">{error}</p>}
  </div>;
}
