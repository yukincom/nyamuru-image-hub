import type { LayoutRecognitionResult } from '../lib/localBridge';
import CharacterReadProgress, { type CharacterReadProgressState } from './CharacterReadProgress';

interface AnalysisItem {
  id: string;
  file: { name: string };
  analysis: LayoutRecognitionResult | null;
  error?: string;
}

export default function NewLayoutAnalysisFeed({ items, message, characterProgress }: {
  items: readonly AnalysisItem[];
  message: string | null;
  characterProgress?: CharacterReadProgressState | null;
}) {
  // ページは先頭から逐次解析される。選択ページとは独立に、完了分を新しい順で表示する。
  const completed = items.map((item, index) => ({ item, pageNumber: index + 1 }))
    .filter(({ item }) => item.analysis || item.error).reverse();
  return <div class="new-layout-feedback">
    {characterProgress ? <CharacterReadProgress progress={characterProgress} /> : message && <p class="new-layout-message" role="status">{message}</p>}
    {completed.length > 0 && <div class="new-layout-analysis-feed" role="region" aria-label="解析の記録（新しい順）" tabIndex={0} onKeyDown={(event) => {
      // 記録をスクロールする矢印キーを、画面全体のページ切り替えへ渡さない。
      if (event.key.startsWith('Arrow')) event.stopPropagation();
    }}>
      {completed.map(({ item, pageNumber }) => {
        const analysis = item.analysis;
        return <details class="new-layout-analysis-details" key={item.id} open>
          <summary>
            <span>{analysis ? `解析詳細 · コマ${analysis.detectedPanelCount} / 文字${analysis.ocrLines.length}` : '解析できませんでした'}</span>
            <small>PAGE {String(pageNumber).padStart(2, '0')} · {item.file.name}</small>
          </summary>
          {item.error && <p class="new-layout-message is-error">{item.error}</p>}
          {analysis && <div class="new-layout-analysis-detail">
            {!analysis.detectedPanels.length && <p class="new-layout-message">{analysis.reason}</p>}
            <span>コマ: {analysis.structureEngine || '検出なし'} · {analysis.detectedPanelCount}領域</span>
            <span>誤検出除外: {analysis.excludedNonPanelCount}領域 · 補助検出 文字{analysis.detectedTextRegionCount} / 顔{analysis.detectedFaceRegionCount} / 身体{analysis.detectedBodyRegionCount}</span>
            <span>人物あたり: {analysis.detectedFigures.length}件</span>
            <span>文字: {analysis.ocrEngine || '検出なし'} · {analysis.ocrLines.length}件</span>
            {analysis.ocrLines.length > 0 && <ul>{analysis.ocrLines.map((line) => <li key={line.id}><strong class={line.needsReview?'is-text-review':''}>{line.text}</strong><small>{line.source}</small></li>)}</ul>}
          </div>}
        </details>;
      })}
    </div>}
  </div>;
}
