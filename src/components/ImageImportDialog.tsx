import { useEffect, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { useProjectFilePicker } from './ProjectFileInput';
import type { MangaPage } from '../types';
import type { SplitPanelCharacterPlacement } from './workspace/workspaceImagePlacement';
import {
  matchFilesToPages, splitPageBackgroundsForDocument, splitPageCharactersAndBackgrounds,
} from '../lib/cloudPageSplit';
import { listProjectImages, readProjectImages } from '../lib/projectFilePicker';

interface Props {
  projectDirectory?: string;
  seriesId?: string;
  pages: MangaPage[];
  activePageIndex: number;
  targetPanelNumber?: number | null;
  busy: boolean;
  onDirectImport: (files: File[]) => Promise<void>;
  onSplitImport: (items: SplitPanelCharacterPlacement[]) => Promise<{ placed: number; skippedLocked: number }>;
  onClose: () => void;
}

interface SelectableImageEntry {
  key: string;
  name: string;
  relPath?: string;
  file?: File;
  checked: boolean;
  pageIndex: number | null;
}

export function ImageImportDialog({
  projectDirectory = '',
  seriesId = '',
  pages,
  activePageIndex,
  targetPanelNumber = null,
  busy,
  onDirectImport,
  onSplitImport,
  onClose,
}: Props) {
  const chooseFiles = useProjectFilePicker();
  const [splitByPanels, setSplitByPanels] = useState(false);
  const [splitTarget, setSplitTarget] = useState<'figure' | 'background'>('figure');
  const [transparentWhite, setTransparentWhite] = useState(true);
  const [folderName, setFolderName] = useState('');
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [items, setItems] = useState<SelectableImageEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = busy || importing;
  const checkedItems = items.filter(entry => entry.checked);
  const activeSplitItems = checkedItems.filter(entry => entry.pageIndex !== null);

  useEffect(() => {
    let active = true;
    if (!projectDirectory && !seriesId) return;
    setLoadingFolder(true);
    void listProjectImages(projectDirectory, seriesId).then(res => {
      if (!active) return;
      setFolderName(res.folderName);
      if (res.entries.length) {
        const fakeFiles = res.entries.map(entry => new File([], entry.name));
        const pageMatched = matchFilesToPages(fakeFiles, pages.length);
        const byName = new Map(pageMatched.map(m => [m.file.name, m.pageIndex]));
        setItems(current => {
          const external = current.filter(item => !item.relPath);
          const folderItems: SelectableImageEntry[] = res.entries.map(entry => ({
            key: `rel:${entry.rel_path}`,
            name: entry.rel_path,
            relPath: entry.rel_path,
            checked: false,
            pageIndex: byName.get(entry.name) ?? (pages[activePageIndex] ? activePageIndex : null),
          }));
          return [...folderItems, ...external];
        });
      }
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : '作品フォルダを読み込めませんでした');
    }).finally(() => {
      if (active) setLoadingFolder(false);
    });
    return () => { active = false; };
  }, [projectDirectory, seriesId]);

  const handleChooseExternalFiles = async () => {
    if (running) return;
    setError(null);
    try {
      const files = await chooseFiles('image/png,image/jpeg,image/webp', true);
      if (!files.length) return;
      const matched = matchFilesToPages(files, pages.length);
      if (files.length === 1 && matched[0].pageIndex === null && pages[activePageIndex]) {
        matched[0] = { file: files[0], pageIndex: activePageIndex };
      }
      setItems(current => {
        const next = [...current];
        for (const entry of matched) {
          const existingIndex = next.findIndex(item => !item.relPath && item.name === entry.file.name);
          const item: SelectableImageEntry = {
            key: `ext:${entry.file.name}:${next.length}`,
            name: entry.file.name,
            file: entry.file,
            checked: true,
            pageIndex: entry.pageIndex,
          };
          if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...item, key: next[existingIndex].key };
          else next.push(item);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像ファイルを選択できませんでした');
    }
  };

  const toggleItem = (key: string, checked: boolean) => {
    setItems(current => current.map(entry => (entry.key === key ? { ...entry, checked } : entry)));
    setError(null);
  };

  const updateItemPage = (key: string, value: string) => {
    const pageIndex = value === '' ? null : Number(value);
    setItems(current => current.map(entry => (entry.key === key ? { ...entry, pageIndex } : entry)));
  };

  const handleSubmit = async () => {
    if (!checkedItems.length || running) return;
    setImporting(true);
    setError(null);
    try {
      const relPaths = checkedItems.map(entry => entry.relPath).filter((p): p is string => Boolean(p));
      const loadedFiles = relPaths.length ? await readProjectImages(projectDirectory, relPaths, seriesId) : [];
      const fileByRel = new Map<string, File>();
      relPaths.forEach((rel, i) => {
        if (loadedFiles[i]) fileByRel.set(rel, loadedFiles[i]);
      });

      const resolved = checkedItems
        .map(entry => ({
          entry,
          file: entry.file ?? (entry.relPath ? fileByRel.get(entry.relPath) : undefined),
        }))
        .filter((pair): pair is { entry: SelectableImageEntry; file: File } => Boolean(pair.file));

      if (!resolved.length) {
        setError('読み込める画像ファイルが見つかりませんでした');
        return;
      }

      if (!splitByPanels) {
        await onDirectImport(resolved.map(pair => pair.file));
        onClose();
        return;
      }

      const placements: SplitPanelCharacterPlacement[] = [];
      for (const { entry, file } of resolved) {
        if (entry.pageIndex === null) continue;
        const page = pages[entry.pageIndex];
        if (!page) continue;
        if (splitTarget === 'background') {
          const splitBgs = await splitPageBackgroundsForDocument(file, page);
          for (const result of splitBgs) {
            placements.push({
              pageIndex: entry.pageIndex,
              panelIndex: result.panelIndex,
              targetKind: 'background',
              file: result.file,
              frameMm: result.frameMm,
            });
          }
        } else {
          const { characters, backgrounds } = await splitPageCharactersAndBackgrounds(file, page, transparentWhite);
          for (const result of characters) {
            placements.push({
              pageIndex: entry.pageIndex,
              panelIndex: result.panelIndex,
              targetKind: 'figure',
              figureIndex: result.figureIndex,
              file: result.file,
              frameMm: result.frameMm,
            });
          }
          for (const result of backgrounds) {
            placements.push({
              pageIndex: entry.pageIndex,
              panelIndex: result.panelIndex,
              targetKind: 'background',
              file: result.file,
              frameMm: result.frameMm,
            });
          }
        }
      }
      if (!placements.length) {
        setError(splitTarget === 'background' ? '対応するコマが見つかりませんでした' : '対応するキャラクター枠が見つかりませんでした');
        return;
      }
      await onSplitImport(placements);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像の読み込みに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div class="image-export-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && !running) onClose(); }}>
      <section class="image-export-dialog" role="dialog" aria-modal="true" aria-label="画像読込" style={{ width: 'min(540px, 100%)' }}>
        <header>
          <h2>画像読込</h2>
          <button type="button" class="icon-button" disabled={running} onClick={onClose} aria-label="閉じる">
            <X size={16} />
          </button>
        </header>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <strong style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {folderName || '作品フォルダ'}
            </strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span class="image-export-muted">{checkedItems.length}件選択中</span>
              <button
                type="button"
                class="secondary-button"
                disabled={running}
                onClick={() => void handleChooseExternalFiles()}
              >
                別のファイルを選択
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '6px', maxHeight: '220px', overflow: 'auto', padding: '6px', border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--bg-muted, rgba(0,0,0,0.02))' }}>
            {loadingFolder ? (
              <p class="image-export-muted" style={{ margin: '12px 4px', textAlign: 'center' }}>
                作品フォルダを読み込み中…
              </p>
            ) : items.length === 0 ? (
              <p class="image-export-muted" style={{ margin: '12px 4px', textAlign: 'center' }}>
                画像が見つかりません。「別のファイルを選択」から追加できます。
              </p>
            ) : items.map(entry => {
              const targetPage = entry.pageIndex !== null ? pages[entry.pageIndex] : undefined;
              return (
                <div
                  key={entry.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: splitByPanels && entry.checked ? 'auto minmax(0, 1fr) 120px' : 'auto minmax(0, 1fr)',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    padding: '4px 6px',
                    borderRadius: '6px',
                    background: entry.checked ? 'var(--bg-selected, rgba(16,185,129,0.08))' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={entry.checked}
                    disabled={running}
                    aria-label={entry.name}
                    style={{ width: 'auto', flexShrink: 0, margin: 0 }}
                    onChange={event => toggleItem(entry.key, event.currentTarget.checked)}
                  />
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                    title={entry.name}
                    onClick={() => !running && toggleItem(entry.key, !entry.checked)}
                  >
                    {entry.name}
                  </span>
                  {splitByPanels && entry.checked && (
                    <select
                      value={entry.pageIndex === null ? '' : String(entry.pageIndex)}
                      disabled={running}
                      aria-label={`${entry.name}の配置ページ`}
                      onChange={event => updateItemPage(entry.key, event.currentTarget.value)}
                    >
                      <option value="">スキップ</option>
                      {pages.map((_, pageIdx) => (
                        <option key={pageIdx} value={String(pageIdx)}>
                          {pageIdx + 1}ページ目
                        </option>
                      ))}
                    </select>
                  )}
                  {splitByPanels && !entry.checked && targetPage ? null : null}
                </div>
              );
            })}
          </div>
        </div>

        <fieldset style={{ marginTop: '12px' }}>
          <legend>詳細設定</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 16px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', margin: 0 }}>
              <input
                type="checkbox"
                checked={splitByPanels}
                disabled={running}
                style={{ width: 'auto', flexShrink: 0, margin: 0 }}
                onChange={event => {
                  setSplitByPanels(event.currentTarget.checked);
                  setError(null);
                }}
              />
              <span>コマで分ける</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', margin: 0, opacity: splitByPanels && splitTarget === 'figure' ? 1 : 0.45 }}>
              <input
                type="checkbox"
                checked={transparentWhite}
                disabled={running || !splitByPanels || splitTarget !== 'figure'}
                style={{ width: 'auto', flexShrink: 0, margin: 0 }}
                onChange={event => setTransparentWhite(event.currentTarget.checked)}
              />
              <span>白背景を透過する</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', margin: 0, opacity: splitByPanels ? 1 : 0.45 }}>
              <input
                type="radio"
                name="split-target"
                checked={splitTarget === 'figure'}
                disabled={running || !splitByPanels}
                style={{ width: 'auto', flexShrink: 0, margin: 0 }}
                onChange={() => setSplitTarget('figure')}
              />
              <span>キャラクターへ配置</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', margin: 0, opacity: splitByPanels ? 1 : 0.45 }}>
              <input
                type="radio"
                name="split-target"
                checked={splitTarget === 'background'}
                disabled={running || !splitByPanels}
                style={{ width: 'auto', flexShrink: 0, margin: 0 }}
                onChange={() => setSplitTarget('background')}
              />
              <span>背景へ配置</span>
            </label>
          </div>
        </fieldset>

        {!splitByPanels && (
          <p class="image-export-note">
            {targetPanelNumber != null
              ? `現在のコマ ${targetPanelNumber} の最上位に独立レイヤーとして読み込みます`
              : `${activePageIndex + 1}ページ目のコマ外の最上位に独立レイヤーとして読み込みます`}
          </p>
        )}

        {error && <p class="image-export-error">{error}</p>}

        <footer>
          <button type="button" class="secondary-button" disabled={running} onClick={onClose}>
            閉じる
          </button>
          <button
            type="button"
            class="primary-button"
            disabled={running || checkedItems.length === 0 || (splitByPanels && activeSplitItems.length === 0)}
            onClick={() => void handleSubmit()}
          >
            {importing ? '読み込み中…' : '読み込んで配置'}
          </button>
        </footer>
      </section>
    </div>
  );
}
