import { useState } from 'preact/hooks';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FilePlus2, Trash2 } from 'lucide-preact';
import { pagePreviewGridPosition } from '../lib/pageSpread';
import type { MangaDocument } from '../types';

interface Props {
  document: MangaDocument;
  activePage: number;
  collapsed: boolean;
  onCollapse: () => void;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDuplicatePage: () => void;
  onDeletePage: () => void;
  onReorderPage: (from: number, to: number) => void;
}

export default function PageSidebar(props: Props) {
  const { document, activePage, collapsed } = props;
  const manga = document.manga;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const resetDrag = () => { setDragIndex(null); setOverIndex(null); };
  return (
    <aside id="mobile-pages-pane" class={`page-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div class="sidebar-boundary-rail">
        <button class="collapse-button sidebar-edge-toggle" onClick={props.onCollapse} aria-label={collapsed ? 'ページ一覧を開く' : 'ページ一覧を閉じる'} title={collapsed ? 'ページ一覧を開く' : 'ページ一覧を閉じる'}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {!collapsed && <>
        <div class="page-list">
          {manga.pages.map((page, index) => {
            const gridPosition = pagePreviewGridPosition(index);
            return (
              <div
                class={`page-card ${activePage === index ? 'is-active' : ''} ${dragIndex === index ? 'is-dragging' : ''} ${dragIndex !== null && dragIndex !== index && overIndex === index ? (dragIndex < index ? 'is-drop-after' : 'is-drop-before') : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => props.onSelectPage(index)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelectPage(index); } }}
                draggable
                onDragStart={(event) => { setDragIndex(index); if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); } }}
                onDragOver={(event) => { if (dragIndex === null) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; setOverIndex(index); }}
                onDragLeave={() => { if (overIndex === index) setOverIndex(null); }}
                onDrop={(event) => { event.preventDefault(); if (dragIndex !== null && dragIndex !== index) props.onReorderPage(dragIndex, index); resetDrag(); }}
                onDragEnd={resetDrag}
                title="ドラッグでページ順を入れ替え"
                style={{ gridRow: gridPosition.row, gridColumn: gridPosition.column }}
                key={`${page.page}-${index}`}
              >
                <div class="page-thumb" style={{ width: Math.min(66, 93 * page.canvas.w / page.canvas.h), height: Math.min(93, 66 * page.canvas.h / page.canvas.w) }}>
                  <svg class="page-thumb-svg" viewBox={`0 0 ${page.canvas.w} ${page.canvas.h}`} aria-hidden="true">
                    {page.panels.map((panel) => panel.shape.type === 'rect'
                      ? <rect class={`thumb-panel bg-${panel.bg}`} x={panel.shape.x} y={panel.shape.y} width={panel.shape.w} height={panel.shape.h} key={panel.id} />
                      : <polygon class={`thumb-panel bg-${panel.bg}`} points={panel.shape.points.map((point) => point.join(',')).join(' ')} key={panel.id} />)}
                  </svg>
                  <span class="paper-corner" />
                </div>
                <strong class="page-card-number">{String(index + 1).padStart(2, '0')}</strong>
                <span class="page-move">
                  <button type="button" disabled={index === 0} onClick={(event) => { event.stopPropagation(); props.onReorderPage(index, index - 1); }} aria-label={`ページ ${index + 1} を上へ移動`} title="上へ移動"><ChevronUp size={13} /></button>
                  <button type="button" disabled={index === manga.pages.length - 1} onClick={(event) => { event.stopPropagation(); props.onReorderPage(index, index + 1); }} aria-label={`ページ ${index + 1} を下へ移動`} title="下へ移動"><ChevronDown size={13} /></button>
                </span>
              </div>
            );
          })}
        </div>
        <button class="add-page-button" onClick={props.onAddPage}><FilePlus2 size={17} />ページを追加</button>
        <div class="sidebar-tools">
          <button onClick={props.onDuplicatePage} disabled={!manga.pages.length}><Copy size={15} />複製</button>
          <button onClick={props.onDeletePage} disabled={manga.pages.length <= 1}><Trash2 size={15} />削除</button>
        </div>
      </>}
    </aside>
  );
}
