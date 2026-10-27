import { useMemo, useState } from 'preact/hooks';
import { ExternalLink } from 'lucide-preact';
import type { MangaDocument } from '../types.ts';
import { linkScenarioSpeaker, parseScenario, scenarioBubbleEntries, scenarioBubbleNeedsReview, scenarioCharacter, scenarioOriginIds, type ScenarioBubbleLocation } from '../lib/scenario.ts';
import '../styles/scenario.css';

interface Props {
  document: MangaDocument;
  onChange: (document: MangaDocument) => void;
  onNavigate: (pageIndex: number, panelIndex: number, bubbleIndex?: number, overlay?: boolean) => void;
}

function CorrespondenceChoice({ document, location, onNavigate }: Props & { location: ScenarioBubbleLocation }) {
  const page = document.manga.pages[location.pageIndex];
  const bubble = location.overlay ? page.page_overlay!.bubbles![location.bubbleIndex] : page.panels[location.panelIndex].bubbles[location.bubbleIndex];
  return <div class="scenario-choice">
    <div><strong>{location.overlay ? 'ページ前景' : `コマ${page.panels[location.panelIndex].id}`}・吹き出し{location.bubbleIndex + 1}</strong>
      <button type="button" onClick={() => onNavigate(location.pageIndex, location.panelIndex, location.bubbleIndex, location.overlay)}><ExternalLink size={14} />吹き出し情報で確認</button></div>
    <p>OCR：<span class="scenario-prose">{bubble.scenarioMatch?.ocrText ?? bubble.text}</span></p>
  </div>;
}

export default function ScenarioReview({ document, onChange, onNavigate }: Props) {
  const source = document.manga.scenario;
  const script = useMemo(() => source ? parseScenario(source.text) : null, [source?.text]);
  const [error, setError] = useState('');
  const entries = scenarioBubbleEntries(document);
  const unknownSpeakers = [...new Set(script?.panels.flatMap(panel => panel.dialogues.map(d => d.speaker)) ?? [])]
    .filter(name => !scenarioCharacter(document.manga.characters, name));
  const pending = entries.filter(entry => scenarioBubbleNeedsReview(entry.bubble));
  const assignedIds = new Set(entries.flatMap(entry => [...scenarioOriginIds(entry.bubble)]));
  const unplaced = script?.panels.flatMap(panel => panel.dialogues).filter(dialogue => !assignedIds.has(dialogue.id)).length ?? 0;
  return <section class="scenario-review">
    <h2>シナリオ</h2>
    <p>読み込んだセリフとト書きの控えです。候補の確認は文字ツールの情報タブで行います。確定時に本文をコピーして連携を切り、以後はネーム側の編集内容を保存・生成に使います。</p>
    {!source || !script ? <p>新規作成で、資料テキストの「# シナリオ」を読み込みます。ページ・コマごとに「名前「セリフ」」とト書きを記載してください。</p> : <>
      <p>{source.fileName} · 自動対応は文字一致70％超の一意な候補。70％以下は前後の吹き出しから候補を推定します。{pending.length ? `未確認の吹き出し：${pending.length}件（本文は使用できます）。` : 'すべての吹き出しで使用する本文が決まっています。'}{unplaced > 0 && `未配置のセリフ：${unplaced}件。`}</p>
      {unknownSpeakers.length > 0 && <div class="scenario-notice">
        <p>登場人物の名前と異なる話者だけ、対応する人物を選んでください。今後の取り込みに使う別名として記憶し、確定済みの本文・話者は変更しません。</p>
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
              const matched = entries.find(entry => scenarioOriginIds(entry.bubble).includes(dialogue.id));
              return <div class="scenario-dialogue" key={dialogue.id}>
                <div><strong>{dialogue.speaker}</strong><p class="scenario-prose">{dialogue.text}</p>{dialogue.emphasis && <small>強調：{dialogue.emphasis}</small>}</div>
                <div>{matched ? <>
                  <button type="button" onClick={() => onNavigate(matched.pageIndex, matched.panelIndex, matched.bubbleIndex, matched.overlay)}><ExternalLink size={14} />{matched.overlay ? 'ページ前景' : `コマ${document.manga.pages[matched.pageIndex].panels[matched.panelIndex].id}`}・吹き出し{matched.bubbleIndex + 1}</button>
                  <small>{matched.bubble.scenarioMatch?.status === 'manual' ? '本文を編集済み' : matched.bubble.scenarioMatch?.status === 'confirmed' ? '確定済み' : '自動対応済み'} · 取込時の文字一致 {Math.round((matched.bubble.scenarioMatch?.score ?? 0) * 100)}％ · 連携終了</small>
                  <details><summary>OCRと現在の本文</summary><p class="scenario-prose">OCR：{matched.bubble.scenarioMatch?.ocrText}</p><p class="scenario-prose">現在：{matched.bubble.text}</p>
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
