import { Check, ClipboardCheck } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { Bubble, Manga } from '../types.ts';
import { availableScenarioCandidates, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import '../styles/scenario.css';

export interface ScenarioBubbleChoiceProps {
  onScenarioChoice: (location: ScenarioBubbleLocation, sourceIds: readonly string[] | null) => void;
}

export default function ScenarioBubbleNotice({ manga, bubble, location, onScenarioChoice, onOpen }: ScenarioBubbleChoiceProps & {
  manga: Manga;
  bubble: Bubble;
  location: ScenarioBubbleLocation;
  onOpen?: () => void;
}) {
  const [error, setError] = useState('');
  const candidates = availableScenarioCandidates({ manga }, location);
  const pending = !bubble.scenarioMatch || bubble.scenarioMatch.status === 'review';
  const choose = (ids: readonly string[] | null) => {
    try { onScenarioChoice(location, ids); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '候補を選び直してください。'); }
  };
  const choices = <>
    {candidates.length > 0 && <div class="scenario-candidates" aria-label={`吹き出し${location.bubbleIndex + 1}のシナリオ候補`}>
      {candidates.map(candidate => <button type="button" class="scenario-candidate" key={candidate.dialogues.map(d => d.id).join('|')} onClick={() => choose(candidate.dialogues.map(d => d.id))}>
        <span><Check size={14} /><strong>{candidate.dialogues[0].speaker}</strong><small>一致 {Math.round(candidate.score * 100)}％{candidate.dialogues.length > 1 ? ` · ${candidate.dialogues.length}つをまとめる` : ''}</small></span>
        <span class="scenario-prose">{candidate.dialogues.map(d => d.text).join('\n')}</span>
      </button>)}
    </div>}
    <div class="scenario-inline-actions">
      <button type="button" onClick={() => choose(null)}><Check size={14} />確認済み</button>
      {onOpen && <button type="button" onClick={onOpen}><ClipboardCheck size={14} />シナリオを見る</button>}
    </div>
  </>;
  return <div class="scenario-inline">
    {pending ? choices
      : <details><summary>候補を確認</summary>{choices}</details>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
