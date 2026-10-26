import { render } from 'preact';
import { useState } from 'preact/hooks';
import EnvironmentSettings from '../src/components/EnvironmentSettings';
import { createEmptyWorkspaceDocument } from '../src/lib/workspaceStartup';
import { GENERATION_PREFERENCES_STORAGE_KEY, LEGACY_CLOUD_MODEL_PREFERENCES_KEY, loadGenerationPreferences } from '../src/lib/generationPreferences';
import { LOCAL_MODEL_PREFERENCES_STORAGE_KEY, loadLocalModelPreferences } from '../src/lib/localModelPreferences';
import { getOutputSettings } from '../src/lib/finishLayout';
import '../src/styles/global.css';

const initial = createEmptyWorkspaceDocument();
let requests = 0;
window.fetch = async input => { requests++; throw new Error(`Fixture blocked a model request: ${String(input)}`); };
const saved = () => JSON.stringify({
  generation: loadGenerationPreferences(localStorage),
  local: loadLocalModelPreferences(localStorage),
  requests,
}, null, 2);

function Fixture() {
  const [doc, setDoc] = useState(initial), [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState(saved), [notice, setNotice] = useState('');
  const [changes, setChanges] = useState(0);
  const noChange = () => {};
  return <main style="height:100dvh;display:grid;grid-template-rows:auto minmax(0,1fr);">
    <div style="padding:8px 16px;background:white;border-bottom:1px solid #aaa;display:flex;align-items:center;gap:12px;">
      <strong>環境設定のブラウザー検証</strong>
      <button type="button" onClick={() => { setRevision(value => value + 1); setSummary(saved()); }}>保存済みの設定で再表示</button>
      <button type="button" onClick={() => {
        [GENERATION_PREFERENCES_STORAGE_KEY, LOCAL_MODEL_PREFERENCES_STORAGE_KEY, LEGACY_CLOUD_MODEL_PREFERENCES_KEY].forEach(key => localStorage.removeItem(key));
        requests = 0; setRevision(value => value + 1); setSummary(saved());
      }}>検証データを初期化</button>
      <details><summary>保存内容</summary><pre id="settings-persistence" style="position:absolute;right:12px;top:55px;z-index:100;background:white;padding:16px;border:1px solid #888;max-width:80vw;overflow:auto;">{summary}</pre></details>
      <details><summary>作品の設定</summary><pre id="document-settings">{JSON.stringify({ changes, output: getOutputSettings(doc.manga) }, null, 2)}</pre></details>
      <span role="status">{notice}</span>
    </div>
    <div style="min-height:0;" onInput={() => setTimeout(() => setSummary(saved()), 0)} onChange={() => setTimeout(() => setSummary(saved()), 0)}>
      <EnvironmentSettings key={revision} document={doc} onChangeDocument={next => { setDoc(next); setChanges(count => count + 1); }} onNotify={setNotice}
        showGuides={true} spreadView={false} pageCount={doc.manga.pages.length}
        frameLineWidthMm={0.6} rowGapMm={5} columnGapMm={3}
        onChangeShowGuides={noChange} onChangeSpreadView={noChange}
        onChangeFrameLineWidth={noChange} onChangeRowGap={noChange} onChangeColumnGap={noChange} />
    </div>
  </main>;
}
render(<Fixture />, document.getElementById('test-root')!);
