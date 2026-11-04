import type { NewSeriesMode } from '../../lib/newProjectSettings';
import type { MangaDocument } from '../../types';
import type { ImportedStorySetting } from '../../lib/settingTextImport.ts';

interface Props {
  continueFromNewSetting: () => Promise<void>;
  newSeriesMode: NewSeriesMode;
  newCharacterDocument: MangaDocument | null;
  updateNewSeriesSetting: (key: 'genre' | 'target_audience' | 'situation', value: string) => void;
  patchNewCharacterDocument: (recipe: (draft: MangaDocument) => boolean | void) => MangaDocument;
  setNewSettingMessage: (value: string) => void;
  newWorkSetting: ImportedStorySetting;
  updateNewWorkSetting: (key: keyof ImportedStorySetting, value: string) => void;
  newSettingMessage: string;
}

export default function NewSettingStep({
  continueFromNewSetting, newSeriesMode, newCharacterDocument, updateNewSeriesSetting,
  patchNewCharacterDocument, setNewSettingMessage, newWorkSetting, updateNewWorkSetting,
  newSettingMessage,
}: Props) {
  return (
    <form id="new-setting-form" class="new-setting-step" aria-labelledby="new-creation-step-title" onSubmit={(event) => { event.preventDefault(); void continueFromNewSetting(); }}>
      {newSeriesMode !== 'none' && newCharacterDocument && <section class="new-setting-group is-series">
        <h4>シリーズの舞台</h4>
        <div class="new-setting-fields">
          <label><span>ジャンル</span><input value={newCharacterDocument.manga.series_setting.genre ?? ''} placeholder="例：SF・ファンタジー" onInput={(event) => updateNewSeriesSetting('genre', event.currentTarget.value)} /></label>
          <label><span>対象読者</span><input value={newCharacterDocument.manga.series_setting.target_audience ?? ''} placeholder="例：少年・少女" onInput={(event) => updateNewSeriesSetting('target_audience', event.currentTarget.value)} /></label>
          <label><span>成人指定</span><input type="checkbox" style={{ width: '18px', height: '18px', margin: '5px 0', padding: 0, accentColor: 'var(--accent)' }} checked={newCharacterDocument.manga.series_setting.adult_content === true} onChange={(event) => {
            patchNewCharacterDocument((draft) => { draft.manga.series_setting.adult_content = event.currentTarget.checked; });
            setNewSettingMessage('');
          }} /></label>
          <label class="is-wide"><span>世界観</span><textarea rows={4} value={newCharacterDocument.manga.series_setting.situation} placeholder="シリーズを通して共通する舞台や世界観" onInput={(event) => updateNewSeriesSetting('situation', event.currentTarget.value)} /></label>
        </div>
      </section>}
      <section class="new-setting-group is-episode">
        <h4>今回のエピソードの舞台・状況</h4>
        <div class="new-setting-fields">
          <label><span>場所</span><input value={newWorkSetting.location} placeholder="例：放課後の教室" onInput={(event) => updateNewWorkSetting('location', event.currentTarget.value)} /></label>
          <label><span>時間帯</span><input value={newWorkSetting.time} placeholder="例：夕方" onInput={(event) => updateNewWorkSetting('time', event.currentTarget.value)} /></label>
          <label><span>天候</span><input value={newWorkSetting.weather} placeholder="例：雨" onInput={(event) => updateNewWorkSetting('weather', event.currentTarget.value)} /></label>
          <label class="is-wide"><span>あらすじ <em>必須</em></span><textarea rows={8} required value={newWorkSetting.situation} placeholder="この話で何が起きるかを入力してください" onInput={(event) => updateNewWorkSetting('situation', event.currentTarget.value)} /></label>
        </div>
      </section>
      <p class="new-setting-message">背景ごとの3Dモデルは、作品作成後に「舞台設定」→「背景作画資料」の各カードから登録できます。シリーズ共通にすると別エピソードでも再利用できます。</p>
      {newSettingMessage && <p class="new-setting-message" role="status">{newSettingMessage}</p>}
    </form>
  );
}
