import { useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { useProjectFilePicker } from './ProjectFileInput';
import type { MangaPage } from '../types';
import type { SplitPanelCharacterPlacement } from './workspace/workspaceImagePlacement';
import { matchFilesToPages, splitPageImageForDocument, type PageFileMatch } from '../lib/cloudPageSplit';

interface Props {
  pages: MangaPage[];
  activePageIndex: number;
  busy: boolean;
  onSinglePageImport: () => void;
  onSplitImport: (items: SplitPanelCharacterPlacement[]) => Promise<{ placed: number; skippedLocked: number }>;
  onClose: () => void;
}

export function ImageImportDialog({
  pages,
  activePageIndex,
  busy,
  onSinglePageImport,
  onSplitImport,
  onClose,
}: Props) {
  const chooseFiles = useProjectFilePicker();
  const [splitByPanels, setSplitByPanels] = useState(false);
  const [transparentWhite, setTransparentWhite] = useState(true);
  const [matches, setMatches] = useState<PageFileMatch[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = busy || splitting;
  const activeMatches = matches.filter((entry): entry is { file: File; pageIndex: number } => entry.pageIndex !== null);

  const handleChooseFiles = async () => {
    if (running) return;
    setError(null);
    try {
      const files = await chooseFiles('image/png,image/jpeg,image/webp', true);
      if (!files.length) return;
      const matched = matchFilesToPages(files, pages.length);
      if (files.length === 1 && matched[0].pageIndex === null && pages[activePageIndex]) {
        matched[0] = { file: files[0], pageIndex: activePageIndex };
      }
      setMatches(matched);
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像ファイルを選択できませんでした');
    }
  };

  const updateMatchPage = (index: number, value: string) => {
    const pageIndex = value === '' ? null : Number(value);
    setMatches(current => current.map((entry, idx) => (idx === index ? { ...entry, pageIndex } : entry)));
  };

  const handleSplitSubmit = async () => {
    if (!activeMatches.length || running) return;
    setSplitting(true);
    setError(null);
    try {
      const placements: SplitPanelCharacterPlacement[] = [];
      for (const match of activeMatches) {
        const page = pages[match.pageIndex];
        if (!page) continue;
        const splitResults = await splitPageImageForDocument(match.file, page, transparentWhite);
        for (const result of splitResults) {
          placements.push({
            pageIndex: match.pageIndex,
            panelIndex: result.panelIndex,
            figureIndex: result.figureIndex,
            file: result.file,
          });
        }
      }
      if (!placements.length) {
        setError('対応するキャラクター枠が見つかりませんでした');
        return;
      }
      await onSplitImport(placements);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像の分割配置に失敗しました');
    } finally {
      setSplitting(false);
    }
  };

  return (
    <div class="image-export-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && !running) onClose(); }}>
      <section class="image-export-dialog" role="dialog" aria-modal="true" aria-label="画像読込" style={{ width: 'min(520px, 100%)' }}>
        <header>
          <h2>画像読込</h2>
          <button type="button" class="icon-button" disabled={running} onClick={onClose} aria-label="閉じる">
            <X size={16} />
          </button>
        </header>

        <fieldset>
          <legend>読み込み方法</legend>
          <label>
            <input
              type="checkbox"
              checked={splitByPanels}
              disabled={running}
              onChange={event => {
                setSplitByPanels(event.currentTarget.checked);
                setError(null);
              }}
            />
            <span>コマで分ける（クラウド生成画像を自動分割して配置）</span>
          </label>
          {splitByPanels && (
            <label>
              <input
                type="checkbox"
                checked={transparentWhite}
                disabled={running}
                onChange={event => setTransparentWhite(event.currentTarget.checked)}
              />
              <span>白背景を透過する（外側の白を透明化）</span>
            </label>
          )}
        </fieldset>

        {!splitByPanels ? (
          <p class="image-export-note">
            現在のページ（{activePageIndex + 1}ページ目）に1枚の画像をそのまま読み込みます。
          </p>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <button
                type="button"
                class="secondary-button"
                disabled={running}
                onClick={() => void handleChooseFiles()}
              >
                ページ画像を選択（複数可）
              </button>
              <span class="image-export-muted">
                {matches.length ? `${matches.length}ファイル選択済み` : '01.png, 02.png などの連番画像を選択'}
              </span>
            </div>

            {matches.length > 0 && (
              <div style={{ display: 'grid', gap: '6px', maxHeight: '220px', overflow: 'auto', padding: '4px 0' }}>
                {matches.map((match, index) => {
                  const targetPage = match.pageIndex !== null ? pages[match.pageIndex] : undefined;
                  const figureCount = targetPage
                    ? targetPage.panels.reduce((sum, panel) => sum + (panel.figures?.length ?? 0), 0)
                    : 0;
                  return (
                    <div
                      key={`${match.file.name}-${index}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) 140px auto',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        padding: '4px 8px',
                        border: '1px solid var(--line)',
                        borderRadius: '6px',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={match.file.name}>
                        {match.file.name}
                      </span>
                      <select
                        value={match.pageIndex === null ? '' : String(match.pageIndex)}
                        disabled={running}
                        onChange={event => updateMatchPage(index, event.currentTarget.value)}
                      >
                        <option value="">スキップ</option>
                        {pages.map((_, pageIdx) => (
                          <option key={pageIdx} value={String(pageIdx)}>
                            {pageIdx + 1}ページ目
                          </option>
                        ))}
                      </select>
                      <span class="image-export-muted" style={{ whiteSpace: 'nowrap' }}>
                        {targetPage ? `${targetPage.panels.length}コマ / ${figureCount}人` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <p class="image-export-note">
              水色の区切り線（またはコマ比率）でコマを分割し、各コマ内のキャラクターを左から順にあたりの上へ新規レイヤーとして追加します。既存のあたりやロック中のフォルダは上書きしません。
            </p>
          </div>
        )}

        {error && <p class="image-export-error">{error}</p>}

        <footer>
          <button type="button" class="secondary-button" disabled={running} onClick={onClose}>
            閉じる
          </button>
          {!splitByPanels ? (
            <button type="button" class="primary-button" disabled={running} onClick={onSinglePageImport}>
              画像を選択して配置
            </button>
          ) : (
            <button
              type="button"
              class="primary-button"
              disabled={running || !activeMatches.length}
              onClick={() => void handleSplitSubmit()}
            >
              {splitting ? '分割して配置中...' : `読み込んで配置（${activeMatches.length}ページ）`}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
