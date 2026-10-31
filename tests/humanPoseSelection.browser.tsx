// HTMLを一時的にpublicへコピーして開く。文書はメモリ内だけで、素材は実bridgeから読む。
import { render } from 'preact';
import { useState } from 'preact/hooks';
import PageOverlayInspector from '../src/components/PageOverlayInspector';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { parseMangaYaml, toStoredMangaYaml } from '../src/lib/manga';
import type { CanvasElementSelection } from '../src/types';
import '../src/styles/global.css';

const initial = createEmptyWorkspaceDocument();
initial.manga.meta.episode_id = 'human-pose-browser-review';
initial.manga.characters = [{ name: '検証用人物', localId: 'pose-review-person', role: '確認用', scope: 'episode' }];
initial.manga.pages[0].page_overlay = { frame: false, layer: 'above_panel_frames', bubbles: [], figures: [
  { name: '検証用人物', kind: 'person', refId: 'pose-review-person', action: '元のアクション', size: 'full',
    bbox: { x: 10, y: 10, w: 40, h: 80 } },
] };

function Fixture() {
  const [doc, setDoc] = useState(initial);
  const [saved, setSaved] = useState('');
  const [selection, setSelection] = useState<CanvasElementSelection>({ scope: 'page_overlay', type: 'figure', index: 0 });
  const page = doc.manga.pages[0];
  return <main style="padding:24px;max-width:900px;margin:auto">
    <h1>ページ前景のポーズ検証</h1>
    <p>文書はこの画面のメモリ内だけで編集します。実際の30ポーズをローカル連携から読み込みます。</p>
    <button class="secondary-button" onClick={() => setSaved(toStoredMangaYaml(doc))}>検証用OMNYを保存</button>
    <button class="secondary-button" disabled={!saved} onClick={() => setDoc(parseMangaYaml(saved))}>検証用OMNYを再読込</button>
    <textarea aria-label="保存したOMNY" readOnly rows={3} value={saved} style="width:100%" />
    {page.page_overlay && <PageOverlayInspector manga={doc.manga} panels={page.panels} overlay={page.page_overlay}
      pageIndex={0} selectedElement={selection} canvasSelectionScrollRequest={0}
      onSelectElement={value => value && setSelection(value)} onScenarioChoice={() => {}}
      onTextCategory={() => {}} onSelectedText={() => {}} onHandwrittenHistoryBoundary={() => {}}
      onGenerateText={() => {}}
      onChange={value => {
        const next = structuredClone(doc); next.manga.pages[0].page_overlay = value; setDoc(next);
      }} />}
  </main>;
}
render(<Fixture />, document.getElementById('pose-test-root')!);
