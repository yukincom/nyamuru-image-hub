import { Download, FileUp, Plus } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import standardOmaySource from '../content/standard.omay.yaml?raw';
import { omayFileName, parseOmayYaml, toArtworkSettingsYaml, toOmayYaml } from '../lib/manga';
import { appendArtworkSettings, applyArtworkSettings, artworkNumberControls, artworkSettingsFromSource, getArtworkMode, getArtworkSettings, isInternalArtworkGroup, setArtworkNumber } from '../lib/artworkRules';
import { toEditableMangaFormat } from '../lib/artworkEnglish';
import { getOutputSettings, OUTPUT_DPI_OPTIONS, OUTPUT_FORMAT_OPTIONS, withOutputSettings } from '../lib/finishLayout';
import type { ArtworkMode, ArtworkSettingsData, MangaDocument } from '../types';
import { Field, SectionTitle } from './Fields';

interface Props {
  document: MangaDocument;
  onChange: (document: MangaDocument) => void;
  onNotify: (message: string) => void;
}

export default function ArtworkSettings({ document, onChange, onNotify }: Props) {
  const settings = getArtworkSettings(document.manga);
  const omayInput = useRef<HTMLInputElement>(null);
  const mode = getArtworkMode(settings);
  const output = getOutputSettings(document.manga);
  const format = toEditableMangaFormat(document.manga.meta.format);
  const update = (nextSettings: ArtworkSettingsData) => {
    const next = structuredClone(document);
    applyArtworkSettings(next.manga, nextSettings);
    onChange(next);
  };
  const importSettings = (source: string, label: string) => {
    try {
      const omay = parseOmayYaml(source);
      const incoming = omay.artwork_settings ?? artworkSettingsFromSource(omay);
      const next = appendArtworkSettings(settings, incoming, label);
      if (next.groups.length === settings.groups.length) {
        onNotify('同じ設定はすでにあります。チェックの状態は変更していません。');
        return;
      }
      update(next);
      onNotify(`${label}を候補に追加しました。使う項目にチェックを入れてください。`);
    } catch (error) {
      onNotify(`作画設定を読み込めませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`);
    }
  };
  const importOmayFile = async (file?: File) => {
    if (!file) return;
    try { importSettings(await file.text(), file.name); }
    catch (error) { onNotify(`設定ファイルを開けませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`); }
    finally { if (omayInput.current) omayInput.current.value = ''; }
  };
  const download = (archive: boolean) => {
    const source = archive ? toArtworkSettingsYaml(document) : toOmayYaml(document);
    const blob = new Blob([source], { type: 'application/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = omayFileName(document.manga.meta.title).replace('.omay.yaml', archive ? '.settings.omay.yaml' : `.${mode}.omay.yaml`);
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify(archive ? 'OFFの項目も含めて設定の控えを書き出しました' : '選んだ作画方法の生成指示を書き出しました');
  };

  return <div class="artwork-settings">
    <SectionTitle title="作画方法" />
    <fieldset class="artwork-mode-options">
      <legend>どこまでモデルで作りますか？</legend>
      {([
        { value: 'integrated', title: 'ページ全体を一体型で生成する（クラウドのみ）', description: 'ページ全体を、文字やフキダシも含めて仕上げる生成指示を作ります。' },
        { value: 'draft', title: '下書きを生成する', description: 'コマごとに分けて生成し、手描きで描き直し・加筆して仕上げます。' },
      ] as const).map(option => <label key={option.value} class="artwork-mode-option">
        <input type="radio" name="artwork-generation-mode" value={option.value} checked={mode === option.value} onChange={event => {
          if (event.currentTarget.checked) update({ ...settings, mode: option.value as ArtworkMode });
        }} />
        <span><strong>{option.title}</strong><small>{option.description}</small></span>
      </label>)}
    </fieldset>
    <p class="environment-settings-note">この選択だけでは画像生成は始まりません。用紙・コマの設定は「レイアウト」、テキストの設定は「テキスト」にあります。</p>
    <SectionTitle title="完成画像の出力" />
    <div class="field-grid">
      <Field label="カラー指定">
        <select aria-label="完成画像のカラー指定" value={format} onChange={event => {
          try { onChange(withOutputSettings(document, { format: event.currentTarget.value })); }
          catch (error) {
            event.currentTarget.value = format;
            onNotify(error instanceof Error ? error.message : 'カラー指定を確認してください');
          }
        }}>
          {!OUTPUT_FORMAT_OPTIONS.some(option => option.value === format) && <option value={format}>{format || '未指定'}（現在の設定）</option>}
          {OUTPUT_FORMAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
      <Field label="出力解像度" hint="完成原稿のdpi">
        <select aria-label="完成画像の出力解像度" value={output.dpi} onChange={event => {
          try { onChange(withOutputSettings(document, { dpi: Number(event.currentTarget.value) })); }
          catch (error) {
            event.currentTarget.value = String(output.dpi);
            onNotify(error instanceof Error ? error.message : '解像度を確認してください');
          }
        }}>
          {!OUTPUT_DPI_OPTIONS.some(dpi => dpi === output.dpi) && <option value={output.dpi}>{output.dpi} dpi（現在の設定）</option>}
          {OUTPUT_DPI_OPTIONS.map(dpi => <option key={dpi} value={dpi}>{dpi} dpi</option>)}
        </select>
      </Field>
    </div>
    <p class="environment-settings-note">仕上がり {output.width_mm} × {output.height_mm} mm ／ {output.trim_pixels.width} × {output.trim_pixels.height} px。目安はカラー・グレースケールが300〜350 dpi、モノクロが600 dpiです。カラーを変えても解像度は自動変更しません。</p>
    <p class="environment-settings-note">OMNYと生成指示へ反映します。完成原稿の仕様であり、モデルが一度に生成する画素数とは別です。現在のローカル4値ラフは512 × 512 pxの下書き専用で、このカラー・解像度の完成画像は出力しません。</p>
    {settings.groups.filter(group => group.id !== 'page' && !isInternalArtworkGroup(settings, group.id)).map(group => <div class="artwork-rule-group" key={group.id}>
      <label class="artwork-rule-toggle">
        <input type="checkbox" checked={group.enabled} disabled={mode === 'draft' && group.scope === 'integrated'} onChange={event => {
          const next = structuredClone(settings);
          next.groups.find(item => item.id === group.id)!.enabled = event.currentTarget.checked;
          update(next);
        }} />
        <span>{group.label}</span>
        <small>{mode === 'draft' && group.scope === 'integrated' ? '完成原稿でのみ反映' : group.enabled ? '反映する' : '反映しない'}</small>
      </label>
    </div>)}
    {mode === 'integrated' && settings.groups.filter(group => group.id === 'page' || group.enabled).map(group => {
      const controls = artworkNumberControls(settings, group.id).filter(control => control.id === 'backgrounds');
      return controls.map(control => <Field key={group.id + control.id} label={control.label}>
        <input type="number" value={control.value} min={control.min} max={control.max} step={control.step} onChange={event => {
          try {
            if (!event.currentTarget.value.trim()) throw new Error('数値を入力してください');
            update(setArtworkNumber(settings, group.id, control.id, Number(event.currentTarget.value)));
          } catch (error) {
            event.currentTarget.value = String(control.value);
            onNotify(error instanceof Error ? error.message : '数値を確認してください');
          }
        }} />
      </Field>);
    })}
    <details class="environment-settings-details">
      <summary>設定の持ち込み・受け渡し</summary>
      <p class="environment-settings-note">読み込みは候補の追加です。今の設定は上書きせず、追加分はチェックするまで反映しません。</p>
      <div class="omay-actions">
        <button type="button" class="secondary-button" onClick={() => omayInput.current?.click()}><FileUp size={16} />候補を読み込む</button>
        <button type="button" class="secondary-button" onClick={() => importSettings(standardOmaySource, '標準設定')}><Plus size={16} />標準設定を候補に追加</button>
        <button type="button" class="secondary-button" onClick={() => download(true)}><Download size={16} />作画設定の控えを書き出す</button>
      </div>
      <div class="artwork-export-row">
        <span class="environment-settings-note">{mode === 'integrated' ? '完成原稿用' : '手描き仕上げ用の下書き'}の生成指示</span>
        <button type="button" class="secondary-button" onClick={() => download(false)}><Download size={16} />生成用を書き出す</button>
      </div>
      <p class="environment-settings-note">生成用には選んだ作画方法と共通の仕上がり仕様を含めます。作画設定の控えにはOFFの原本も含めます。画像生成やPSD書き出しの実行ではありません。</p>
      <input ref={omayInput} type="file" accept=".yaml,.yml,text/yaml,application/yaml" hidden onChange={event => importOmayFile(event.currentTarget.files?.[0])} />
    </details>
  </div>;
}
