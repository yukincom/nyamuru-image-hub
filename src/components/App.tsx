import { useState } from 'preact/hooks';
import { reconcileSplitOverlapFlags } from '../lib/panelTemplates';
import { createInitialWorkspace, type WorkspaceStartupState } from '../lib/workspaceStartup.ts';
import { useWorkspaceModel } from './workspace/useWorkspaceModel';
import WorkspaceView from './workspace/WorkspaceView';

function initialWorkspace(): WorkspaceStartupState {
  const startup = createInitialWorkspace();
  reconcileSplitOverlapFlags(startup.document);
  return startup;
}

export default function App() {
  const [startupWorkspace] = useState<WorkspaceStartupState>(initialWorkspace);
  return <EditorApp startupWorkspace={startupWorkspace}/>;
}

function EditorApp({ startupWorkspace }: { startupWorkspace: WorkspaceStartupState }) {
  const model = useWorkspaceModel(startupWorkspace);
  return <WorkspaceView model={model} />;
}
