import { Download, FileUp, Plus } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import standardOmaySource from '../content/standard-settings.yaml?raw';
import { omayFileName, parseOmayYaml, toArtworkSettingsYaml, toOmayYaml } from '../lib/manga';
import { appendArtworkSettings, applyArtworkSettings, artworkNumberControls, artworkSettingsFromSource, getArtworkSettings, isInternalArtworkGroup, setArtworkNumber } from '../lib/artworkRules';
import type { ArtworkSettingsData, MangaDocument } from '../types';
import { Field } from './Fields';

interface Props {
  document: MangaDocument;
  onChange: (document: MangaDocument) => void;
  onNotify: (message: string) => void;
  section?: 'rules' | 'omay' | 'all';
}

export default function ArtworkSettings({ document, onChange, onNotify, section = 'all' }: Props) {
  const savedSettings = getArtworkSettings(document.manga);
  const settings: ArtworkSettingsData = { ...savedSettings, mode: 'integrated' };
  const omayInput = useRef<HTMLInputElement>(null);
  const update = (nextSettings: ArtworkSettingsData) => {
    const next = structuredClone(document);
    applyArtworkSettings(next.manga, nextSettings);
    // The retired mode remains round-trippable; it no longer restricts the editor.
    if (savedSettings.mode === undefined) delete next.manga.artwork_settings!.mode;
    else next.manga.artwork_settings!.mode = savedSettings.mode;
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
    const generationDocument = { ...document, manga: { ...document.manga, artwork_settings: settings } };
    const source = archive ? toArtworkSettingsYaml(document) : toOmayYaml(generationDocument);
    const blob = new Blob([source], { type: 'application/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = omayFileName(document.manga.meta.title, archive ? 'settings' : 'generation');
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify(archive ? 'OFFの項目も含めて設定の控えを書き出しました' : '生成指示を書き出しました');
  };

  const show=(target:'rules'|'omay')=>section==='all'||section===target;
  return <div class="artwork-settings">
    {show('rules')&&<p class="environment-settings-note">ページ全体・コマ・人物の生成は、キャンバスの右クリックから選びます。実行するモデルは「モデル設定」で変更できます。</p>}
    {show('rules')&&<>{settings.groups.filter(group => group.id !== 'page' && !isInternalArtworkGroup(settings, group.id)).map(group => <div class="artwork-rule-group" key={group.id}>
      <label class="artwork-rule-toggle">
        <input type="checkbox" checked={group.enabled} onChange={event => {
          const next = structuredClone(settings);
          next.groups.find(item => item.id === group.id)!.enabled = event.currentTarget.checked;
          update(next);
        }} />
        <span>{group.label}</span>
        <small>{group.enabled ? '反映する' : '反映しない'}</small>
      </label>
    </div>)}
    {settings.groups.filter(group => group.id === 'page' || group.enabled).map(group => {
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
    })}</>}
    {show('omay')&&<details class="environment-settings-details" open={section==='omay'}>
      <summary>設定の持ち込み・受け渡し</summary>
      <p class="environment-settings-note">読み込みは候補の追加です。今の設定は上書きせず、追加分はチェックするまで反映しません。</p>
      <div class="omay-actions">
        <button type="button" class="secondary-button" onClick={() => omayInput.current?.click()}><FileUp size={16} />候補を読み込む</button>
        <button type="button" class="secondary-button" onClick={() => importSettings(standardOmaySource, '標準設定')}><Plus size={16} />標準設定を候補に追加</button>
        <button type="button" class="secondary-button" onClick={() => download(true)}><Download size={16} />作画設定の控えを書き出す</button>
      </div>
      <div class="artwork-export-row">
        <span class="environment-settings-note">この作品の作画設定を含む生成指示</span>
        <button type="button" class="secondary-button" onClick={() => download(false)}><Download size={16} />生成用を書き出す</button>
      </div>
      <p class="environment-settings-note">生成用には作品の作画設定と仕上がり仕様を含めます。作画設定の控えにはOFFの原本も含めます。画像生成やPSD書き出しの実行ではありません。</p>
      <input ref={omayInput} type="file" accept=".yaml,.yml,text/yaml,application/yaml" hidden onChange={event => importOmayFile(event.currentTarget.files?.[0])} />
    </details>}
  </div>;
}
