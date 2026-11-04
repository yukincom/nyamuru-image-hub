import { ChevronLeft, ChevronRight } from 'lucide-preact';
import type { NewCreationStep, NewSeriesMode } from '../../lib/newProjectSettings';
import type { NewLayoutTask } from '../../lib/newLayoutPreview';
import type { EpisodeWorkspace } from '../../lib/localBridge';
import type { ImportedStorySetting } from '../../lib/settingTextImport.ts';

interface Props {
  newCreationStep: NewCreationStep;
  seriesCatalogSaving: boolean;
  newLayoutTask: NewLayoutTask;
  returnToSeriesSelection: () => Promise<void>;
  setNewCreationStep: (value: NewCreationStep) => void;
  editingNewPrintSetup: boolean;
  newPrintConfirmed: boolean;
  setEditingNewPrintSetup: (value: boolean) => void;
  newSeriesMode: NewSeriesMode;
  newEpisodeWorkspace: EpisodeWorkspace | null;
  newSeriesPreparing: boolean;
  newWorkspaceSelecting: boolean;
  characterTextBusy: boolean;
  continueFromNewCharacters: () => Promise<void>;
  newWorkSetting: ImportedStorySetting;
}

export default function NewProjectNavigation({
  newCreationStep, seriesCatalogSaving, newLayoutTask, returnToSeriesSelection, setNewCreationStep,
  editingNewPrintSetup, newPrintConfirmed, setEditingNewPrintSetup, newSeriesMode,
  newEpisodeWorkspace, newSeriesPreparing, newWorkspaceSelecting, characterTextBusy,
  continueFromNewCharacters, newWorkSetting,
}: Props) {
  return (
    <div class="new-dialog-navigation">
      <ol class="new-creation-steps" aria-label="新規作成の手順">
        <li class={newCreationStep === 'series' ? 'is-active' : ''} aria-current={newCreationStep === 'series' ? 'step' : undefined}><span>1</span>シリーズ</li>
        <li class={newCreationStep === 'characters' ? 'is-active' : ''} aria-current={newCreationStep === 'characters' ? 'step' : undefined}><span>2</span>登場人物</li>
        <li class={newCreationStep === 'setting' ? 'is-active' : ''} aria-current={newCreationStep === 'setting' ? 'step' : undefined}><span>3</span>舞台設定</li>
        <li class={newCreationStep === 'layout' ? 'is-active' : ''} aria-current={newCreationStep === 'layout' ? 'step' : undefined}><span>4</span>ページ設定</li>
      </ol>
      <div class="new-step-toolbar">
        <div class="new-step-heading">
          <h3 id="new-creation-step-title">{{ series: 'シリーズ', characters: '登場人物', setting: '舞台設定', layout: 'ページ設定' }[newCreationStep]}</h3>
          <p>{{ series: '作品の種類・保存先・資料を選びます。', characters: '人物の設定と資料を確認します。', setting: '舞台と今回のあらすじを確認します。', layout: '用紙サイズや印刷条件を設定します。' }[newCreationStep]}</p>
        </div>
        <nav class="new-step-navigation" aria-label="作成手順の移動">
          <button type="button" class="secondary-button" disabled={newCreationStep === 'series' || seriesCatalogSaving || newLayoutTask !== 'idle'} onClick={() => {
            if (newCreationStep === 'characters') void returnToSeriesSelection();
            else if (newCreationStep === 'setting') setNewCreationStep('characters');
            else if (newCreationStep === 'layout') {
              if (editingNewPrintSetup && newPrintConfirmed) setEditingNewPrintSetup(false);
              else setNewCreationStep('setting');
            }
          }}><ChevronLeft size={15} aria-hidden="true" />戻る</button>
          <div class="new-step-forward">
            {newCreationStep === 'series' && <button type="submit" form="new-series-form" class="primary-button" disabled={!newSeriesMode || !newEpisodeWorkspace || newSeriesPreparing || newWorkspaceSelecting}>{newSeriesPreparing ? '準備中…' : '次へ'}<ChevronRight size={15} aria-hidden="true" /></button>}
            {newCreationStep === 'characters' && <button type="button" class="primary-button" disabled={seriesCatalogSaving || characterTextBusy} onClick={() => void continueFromNewCharacters()}>{seriesCatalogSaving ? '保存中…' : '次へ'}<ChevronRight size={15} aria-hidden="true" /></button>}
            {newCreationStep === 'setting' && <button type="submit" form="new-setting-form" class="primary-button" disabled={seriesCatalogSaving || !newWorkSetting.situation.trim()}>{seriesCatalogSaving ? '保存中…' : '次へ'}<ChevronRight size={15} aria-hidden="true" /></button>}
            {newCreationStep === 'layout' && editingNewPrintSetup && <button type="submit" form="new-print-form" class="primary-button" disabled={newLayoutTask !== 'idle'}>設定完了</button>}
          </div>
        </nav>
      </div>
    </div>
  );
}
