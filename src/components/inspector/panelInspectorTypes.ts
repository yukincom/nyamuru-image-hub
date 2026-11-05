import type { ScenarioBubbleChoiceProps } from '../ScenarioBubbleNotice';
import type { TextCategory, CanvasTextKind } from '../../lib/canvasText';
import type { Manga, Panel, CanvasElementSelection } from '../../types';

export interface Props extends ScenarioBubbleChoiceProps {
  onTextCategory:(category:TextCategory)=>void;
  onSelectedText:(text:string)=>void;
  onOpenBackground3d:()=>void;
  onHandwrittenHistoryBoundary:()=>void;
  onGenerateText:(kind:CanvasTextKind,index:number)=>void;
  generationBusy?:boolean;
  painting?: boolean;
  imageImportBusy:boolean;
  guideVisible:(key:string)=>boolean;
  onToggleGuide:(key:string)=>void;
  panelDraftToolbarTarget: HTMLDivElement | null;
  manga: Manga;
  panel: Panel | undefined;
  pageIndex: number;
  panelIndex: number;
  selectedElement: CanvasElementSelection | null;
  canvasSelectionScrollRequest: number;
  episodeWorkspaceToken: string;
  episodeWorkspaceFolder: string;
  seriesId: string;
  episodeId: string;
  getOmnySnapshot: () => string;
  onChooseEpisodeWorkspace: () => Promise<void>;
  onSelectElement: (selection: CanvasElementSelection | null) => void;
  onChange: (panel: Panel,origin?:'manual'|'agent') => void;
  onOpenBackgrounds: () => void;
  onOpenProps: () => void;
  onAdd: () => void;
  onDelete: () => void;
}
