import { applyArtworkSettings, artworkNumberControls, getArtworkSettings, setArtworkNumber } from '../lib/artworkRules';
import { FINISH_NUMBER_IDS } from '../lib/finishLayout';
import { useState } from 'preact/hooks';
import PrintSettingsEditor from './PrintSettingsEditor';
import { getPrintSetup, printSummary, savePrintPreferences, withPrintSetup, type PrintSetup } from '../lib/printSettings';
import type { MangaDocument } from '../types';
import { Field, SectionTitle } from './Fields';

interface Props { document: MangaDocument; onChange: (document: MangaDocument) => void; onNotify: (message: string) => void }

export default function FinishLayoutSettings({ document, onChange, onNotify }: Props) {
  const [editing, setEditing] = useState(false);
  const setup = getPrintSetup(document.manga);
  const apply = (next: PrintSetup) => {
    onChange(withPrintSetup(document, next));
    setEditing(false);
    try {
      savePrintPreferences(window.localStorage, next);
      onNotify('印刷設定を適用しました。次の作品でもこの設定を使います。');
    } catch { onNotify('この作品に適用しました。本体への前回設定の保存はできませんでした。'); }
  };
  return <div class="finish-layout-settings">
    {!editing && <SectionTitle title="印刷・原稿設定" />}
    {editing
      ? <PrintSettingsEditor initial={setup} lockedPageCount={document.manga.pages.length || 1} onConfirm={apply} onCancel={() => setEditing(false)} confirmLabel="設定を適用" />
      : <div class="print-summary"><p>{printSummary(setup)}{setup.printer && <small>{setup.printer}{setup.product ? ` ／ ${setup.product}` : ''}</small>}</p><button type="button" class="secondary-button" onClick={() => setEditing(true)}>変更</button></div>}
  </div>;
}

export function FinishTextSettings({ document, onChange, onNotify }: Props) {
  const settings = getArtworkSettings(document.manga);
  return <div class="finish-layout-settings finish-text-settings">
    <SectionTitle title="生成時の見出し・作者名・強調" />
    {settings.groups.filter(group => group.id === 'page' || group.enabled).map(group => {
      const controls = artworkNumberControls(settings, group.id).filter(control => FINISH_NUMBER_IDS.some(id => id === control.id));
      if (!controls.length) return null;
      return <div key={group.id}>
        {group.id !== 'page' && <p class="environment-settings-note">{group.label}</p>}
        <div class="field-grid">
          {controls.map(control => <Field key={control.id} label={control.label.replace('文字', 'テキスト')}>
            <input type="number" min={control.min} max={control.max} step={control.step} value={control.value} onChange={event => {
              try {
                if (!event.currentTarget.value.trim()) throw new Error('数値を入力してください');
                const next = structuredClone(document);
                applyArtworkSettings(next.manga, setArtworkNumber(settings, group.id, control.id, Number(event.currentTarget.value)));
                onChange(next);
              } catch (error) {
                event.currentTarget.value = String(control.value);
                onNotify(error instanceof Error ? error.message : '数値を確認してください');
              }
            }} />
          </Field>)}
        </div>
      </div>;
    })}
    <p class="environment-settings-note">生成画像へ渡す寸法で、完成原稿上のmmです。ネーム上の文字サイズはTツールで調整します。</p>
  </div>;
}
