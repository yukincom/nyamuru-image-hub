import { useMemo, useState } from 'preact/hooks';
import { Check, ExternalLink, Pencil } from 'lucide-preact';
import type { MangaDocument } from '../types.ts';
import { availableScenarioCandidates, confirmScenarioCorrespondence, linkScenarioSpeaker, parseScenario, releaseScenarioCorrespondence, scenarioBubbleEntries, scenarioCharacter, useScenarioBubbleText, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import '../styles/scenario.css';

interface Props {
  document: MangaDocument;
  onChange: (document: MangaDocument) => void;
  onNavigate: (pageIndex: number, panelIndex: number, bubbleIndex?: number, overlay?: boolean) => void;
}

function CorrespondenceChoice({ document, location, onChange, onNavigate }: Props & { location: ScenarioBubbleLocation }) {
  const [selection, setSelection] = useState('');
  const [error, setError] = useState('');
  const candidates = availableScenarioCandidates(document, location);
  const chosen = candidates.find(candidate => candidate.dialogues.map(d => d.id).join('|') === selection) ?? candidates[0];
  const page = document.manga.pages[location.pageIndex];
  const bubble = location.overlay ? page.page_overlay!.bubbles![location.bubbleIndex] : page.panels[location.panelIndex].bubbles[location.bubbleIndex];
  return <div class="scenario-choice">
    <div><strong>{location.overlay ? 'ページ前景' : `コマ${page.panels[location.panelIndex].id}`}・吹き出し{location.bubbleIndex + 1}</strong>
      <button type="button" onClick={() => onNavigate(location.pageIndex, location.panelIndex, location.bubbleIndex, location.overlay)}><ExternalLink size={14} />位置を見る</button></div>
    <p>OCR：<span class="scenario-prose">{bubble.scenarioMatch?.ocrText || '読み取りなし'}</span></p>
    {candidates.length ? <>
      <label>入れるセリフ<select aria-label={`吹き出し${location.bubbleIndex + 1}に入れるセリフ`} value={chosen?.dialogues.map(d => d.id).join('|')} onChange={event => setSelection(event.currentTarget.value)}>
        {candidates.map(candidate => <option value={candidate.dialogues.map(d => d.id).join('|')}>
          {Math.round(candidate.score * 100)}％ · {candidate.dialogues[0].speaker}「{candidate.dialogues.map(d => d.text).join(' / ').slice(0, 90)}」
        </option>)}
      </select></label>
      <p class="scenario-prose">{chosen?.dialogues.map(d => d.text).join('\n')}</p>
      <button type="button" onClick={() => {
        if (!chosen) return;
        const next = structuredClone(document);
        try { confirmScenarioCorrespondence(next, location, chosen.dialogues.map(d => d.id)); onChange(next); setError(''); }
        catch (caught) { setError(caught instanceof Error ? caught.message : '対応を変更できませんでした。'); }
      }}><Check size={14} />このセリフを入れる</button>
    </> : <p>このページ・コマに未使用の候補はありません。シナリオにないセリフも、そのまま使えます。</p>}
    <button type="button" onClick={() => {
      const next = structuredClone(document);
      const target = scenarioBubbleEntries(next).find(entry => entry.pageIndex === location.pageIndex && entry.panelIndex === location.panelIndex && entry.bubbleIndex === location.bubbleIndex && Boolean(entry.overlay) === Boolean(location.overlay));
      if (target) { useScenarioBubbleText(target.bubble); onChange(next); }
    }}><Check size={14} />現在の本文を使う</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export default function ScenarioReview({ document, onChange, onNavigate }: Props) {
  const source = document.manga.scenario;
  const script = useMemo(() => source ? parseScenario(source.text) : null, [source?.text]);
  const [error, setError] = useState('');
  const entries = scenarioBubbleEntries(document);
  const unknownSpeakers = [...new Set(script?.panels.flatMap(panel => panel.dialogues.map(d => d.speaker)) ?? [])]
    .filter(name => !scenarioCharacter(document.manga.characters, name));
  const pending = entries.filter(entry => !entry.bubble.scenarioMatch || entry.bubble.scenarioMatch.status === 'review');
  const assignedIds = new Set(entries.flatMap(entry => entry.bubble.scenarioMatch?.sourceIds ?? []));
  const unplaced = script?.panels.flatMap(panel => panel.dialogues).filter(dialogue => !assignedIds.has(dialogue.id)).length ?? 0;
  return <section class="scenario-review">
    <h2>シナリオ</h2>
    <p>セリフとト書きの元データです。対応が決まった本文はシナリオを使います。それ以外はOCRを仮入力し、追加のセリフや改行はネーム側で自由に編集できます。</p>
    {!source || !script ? <p>新規作成で、資料テキストの「# シナリオ」を読み込みます。ページ・コマごとに「名前「セリフ」」とト書きを記載してください。</p> : <>
      <p>{source.fileName} · 自動対応は一致率70％以上。{pending.length ? `候補を選べる吹き出し：${pending.length}件（本文は使用できます）。` : 'すべての吹き出しで使用する本文が決まっています。'}{unplaced > 0 && `未配置のセリフ：${unplaced}件。`}</p>
      {unknownSpeakers.length > 0 && <div class="scenario-notice">
        <p>登場人物の名前と異なる話者だけ、対応する人物を選んでください。別名としてこの作品に記憶します。</p>
        {unknownSpeakers.map(name => <label>{name}<select aria-label={`話者「${name}」に対応する登場人物`} value="" onChange={event => {
          const next = structuredClone(document);
          try { linkScenarioSpeaker(next, name, event.currentTarget.value); onChange(next); setError(''); }
          catch (caught) { setError(caught instanceof Error ? caught.message : '話者を対応付けできませんでした。'); }
        }}><option value="">登場人物を選択</option>{document.manga.characters.map(character => <option value={character.localId}>{character.name}</option>)}</select></label>)}
        {error && <p role="alert">{error}</p>}
      </div>}
      {script.warnings.map(warning => <p class="scenario-notice" role="status">{warning}</p>)}
      {pending.length > 0 && <section aria-label="対応を選ぶ吹き出し"><h3>対応を選ぶ吹き出し</h3>
        {pending.map(entry => <div key={`${entry.pageIndex}-${entry.overlay ? 'overlay' : entry.panelIndex}-${entry.bubbleIndex}`}><h4>{document.manga.pages[entry.pageIndex].page}ページ</h4>
          <CorrespondenceChoice document={document} location={entry} onChange={onChange} onNavigate={onNavigate} />
        </div>)}
      </section>}
      <section aria-label="シナリオとネームの対応"><h3>シナリオとネーム</h3>
        {script.panels.map(original => {
          const pageIndex = document.manga.pages.findIndex(page => page.page === original.page);
          const panelIndex = document.manga.pages[pageIndex]?.panels.findIndex(panel => panel.id === original.panel) ?? -1;
          return <section class="scenario-panel" key={`${original.page}-${original.panel}`}>
            <h4>{original.page}ページ・コマ{original.panel}{panelIndex >= 0 && <button type="button" onClick={() => onNavigate(pageIndex, panelIndex)}><ExternalLink size={14} />ネームで見る</button>}</h4>
            {panelIndex < 0 && <p class="scenario-notice">このコマはまだネームにありません。元の文章は保持しています。</p>}
            {original.action && <p class="scenario-prose"><strong>ト書き</strong><br />{original.action}</p>}
            {original.dialogues.map(dialogue => {
              const matched = entries.find(entry => entry.bubble.scenarioMatch?.sourceIds.includes(dialogue.id));
              return <div class="scenario-dialogue" key={dialogue.id}>
                <div><strong>{dialogue.speaker}</strong><p class="scenario-prose">{dialogue.text}</p>{dialogue.emphasis && <small>強調：{dialogue.emphasis}</small>}</div>
                <div>{matched ? <>
                  <button type="button" onClick={() => onNavigate(matched.pageIndex, matched.panelIndex, matched.bubbleIndex, matched.overlay)}><ExternalLink size={14} />{matched.overlay ? 'ページ前景' : `コマ${document.manga.pages[matched.pageIndex].panels[matched.panelIndex].id}`}・吹き出し{matched.bubbleIndex + 1}</button>
                  <small>{matched.bubble.scenarioMatch?.status === 'manual' ? '本文を編集済み' : matched.bubble.scenarioMatch?.status === 'confirmed' ? '選択済み' : '自動対応'} · {Math.round((matched.bubble.scenarioMatch?.score ?? 0) * 100)}％</small>
                  <details><summary>OCRと現在の本文</summary><p class="scenario-prose">OCR：{matched.bubble.scenarioMatch?.ocrText}</p><p class="scenario-prose">現在：{matched.bubble.text}</p>
                    <CorrespondenceChoice document={document} location={matched} onChange={onChange} onNavigate={onNavigate} />
                    <button type="button" onClick={() => {
                      const next = structuredClone(document); releaseScenarioCorrespondence(next, matched); onChange(next);
                    }}><Pencil size={14} />対応だけ選び直す（本文は保持）</button>
                  </details>
                </> : <span>対応する吹き出しが未指定</span>}</div>
              </div>;
            })}
          </section>;
        })}
      </section>
      <details><summary>読み込んだ元データ</summary><pre class="scenario-prose">{source.text}</pre></details>
    </>}
  </section>;
}
