import { usePaintWorkspace } from '../lib/paintWorkspace';
import { Download, ImagePlus, Save, Settings, X, FilePlus2, FolderOpen, Redo2, Undo2 } from 'lucide-preact';

interface Props {
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onImportImage: () => void;
  onExportImage: () => void;
  onNew: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
  workspaceBlocked: boolean;
  busy: boolean;
  saveDirectory?: string;
  onOpen: () => void;
  onSave: () => void;
}

export default function Header({ hasDocument, canUndo, canRedo, busy, saveDirectory, onUndo, onRedo, onImportImage, onExportImage, onNew, onOpen, onSave, onSettings, settingsOpen, workspaceBlocked }: Props) {
  const paint=usePaintWorkspace();
  return (
    <header class="app-header">
      <div class="brand-wrap">
        <div class="brand-mark" aria-hidden="true"><span>🐱</span></div>
        <div class="brand-copy">
          <h1>NYAMURU - Image Hub</h1>
        </div>
      </div>

      <div class="header-actions">
        <button class="icon-button history-button" data-project-history onClick={paint?paint.undo:onUndo} disabled={workspaceBlocked || (paint?!paint.canUndo:!canUndo)} title="元に戻す (Ctrl+Z)" aria-label="元に戻す"><Undo2 size={18} /></button>
        <button class="icon-button history-button" data-project-history onClick={paint?paint.redo:onRedo} disabled={workspaceBlocked || (paint?!paint.canRedo:!canRedo)} title="やり直す (Ctrl+Shift+Z)" aria-label="やり直す"><Redo2 size={18} /></button>
        <button class="secondary-button header-image-button" onClick={onImportImage} disabled={!hasDocument || busy || workspaceBlocked} title="現在のページへ画像を読み込む"><ImagePlus size={17} />画像読込</button>
        <button class="secondary-button header-image-button" onClick={onExportImage} disabled={!hasDocument || busy || workspaceBlocked} title="ページ範囲と形式を選んで画像を書き出す"><Download size={17} />画像書出</button>
        <button class="primary-button new-button" onClick={onNew} disabled={busy || workspaceBlocked} title="新しい漫画を作成"><FilePlus2 size={17} />新規</button>
        <button class="secondary-button import-button" title="作品フォルダを開く" aria-label="作品フォルダを開く" onClick={onOpen} disabled={busy || workspaceBlocked}><FolderOpen size={17} />開く</button>
        <button class="primary-button" data-project-save disabled={!hasDocument || busy || workspaceBlocked} onClick={onSave} title={saveDirectory ? `${saveDirectory} に保存 (⌘S / Ctrl+S)` : '保存先フォルダを選んで保存 (⌘S / Ctrl+S)'}><Save size={17} />{busy ? '処理中…' : '保存'}</button>
        <button type="button" class="icon-button header-settings-button" data-environment-settings title={settingsOpen ? '環境設定を閉じる' : '環境設定'} aria-label={settingsOpen ? '環境設定を閉じる' : '環境設定'} aria-expanded={settingsOpen} aria-controls="environment-dialog" onClick={onSettings} disabled={busy && !settingsOpen}>{settingsOpen ? <X size={21} strokeWidth={2.5} /> : <Settings size={18} />}</button>
      </div>
    </header>
  );
}
