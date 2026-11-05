import type { AgentPreferences } from '../lib/agentPreferences';
import type { MangaDocument } from '../types';
import type { PaintCursorMode } from '../lib/paintPreferences';
import type { PcFontFamily } from '../lib/bubbleFonts';
import type { SettingsTab } from './EnvironmentSettings.tsx';

export interface EnvironmentSettingsProps {
  initialTab?: SettingsTab;
  prepareDocumentSettings?: () => Promise<void>;
  onOpenAgent?:()=>void;
  hasDocument?: boolean;
  onExportOmny?: () => void;
  agentProfile?:AgentPreferences; onChangeAgentProfile?:(profile:AgentPreferences)=>void;
  historySteps?:number;onChangeHistorySteps?:(value:number)=>void;
  editGuide?:boolean; onChangeEditGuide?:(enabled:boolean)=>void;
  paintSmoothing?:number; onChangePaintSmoothing?:(value:number)=>void;
  paintCursorMode?:PaintCursorMode; onChangePaintCursorMode?:(value:PaintCursorMode)=>void;
  paintBleedPx?: number;
  onChangePaintBleed?: (value:number)=>void;
  document: MangaDocument;
  onChangeDocument: (document: MangaDocument) => void;
  onNotify: (message: string) => void;
  showGuides: boolean;
  spreadView: boolean;
  pageCount: number;
  frameLineWidthMm: number;
  rowGapMm: number;
  columnGapMm: number;
  onChangeShowGuides: (enabled: boolean) => void;
  onChangeSpreadView: (enabled: boolean) => void;
  onChangeFrameLineWidth: (value: number) => void;
  onChangeRowGap: (value: number) => void;
  onChangeColumnGap: (value: number) => void;
  fontFamilies?: readonly PcFontFamily[];
  onRequestFonts?: () => void;
  saveDirectory?: string;
  projectBusy?: boolean;
  onChangeSaveDirectory?: () => void;
}
