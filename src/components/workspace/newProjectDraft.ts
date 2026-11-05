import type { NewLayoutTask } from '../../lib/newLayoutPreview';
import { emptyNewWorkSetting } from '../../lib/newProjectSettings';
import type { MangaDocument } from '../../types';
import type { WorkspaceState } from './useWorkspaceState';

export function createDraftActions({
  setNewCharacterReadProgress, newLayoutTaskRef, setNewLayoutTask, setNewSourceSnapshot,
  setNewReferenceFileName, setNewReferenceMessage, setNewReferenceSelecting,
  setNewSuggestedEpisodeReference, setNewWorkTitle, setNewEpisodeNumber, setNewWorkSetting,
  setNewSettingMessage, newSeriesSelectionGeneration, setNewSeriesDirectory, setNewSeriesReference,
  setNewSeriesReferences, setNewSeriesReferenceCandidates, setNewSelectedSeriesReferencePaths,
  setNewSeriesDirectorySelecting, setNewSeriesDirectoryMessage, setNewSeriesReferenceSelecting,
  setNewSeriesReferenceMessage, newCharacterDocumentRef, setNewCharacterDocumentState,
}: WorkspaceState) {
  const updateNewLayoutTask = (task: NewLayoutTask) => {
    if (task === 'idle') setNewCharacterReadProgress(null);
    newLayoutTaskRef.current = task;
    setNewLayoutTask(task);
  };

  const clearNewReferenceText = () => {
    setNewSourceSnapshot(null);
    setNewReferenceFileName('');
    setNewReferenceMessage('');
    setNewReferenceSelecting(false);
    setNewSuggestedEpisodeReference(null);
    setNewWorkTitle('');
    setNewEpisodeNumber('');
    setNewWorkSetting(emptyNewWorkSetting());
    setNewSettingMessage('');
  };

  const clearNewSeriesReference = () => {
    newSeriesSelectionGeneration.current += 1;
    setNewSeriesDirectory('');
    setNewSeriesReference(null);
    setNewSeriesReferences([]);
    setNewSeriesReferenceCandidates([]);
    setNewSelectedSeriesReferencePaths([]);
    setNewSeriesDirectorySelecting(false);
    setNewSeriesDirectoryMessage('');
    setNewSeriesReferenceSelecting(false);
    setNewSeriesReferenceMessage('');
  };

  const setNewCharacterDocument = (next: MangaDocument | null) => {
    newCharacterDocumentRef.current = next;
    setNewCharacterDocumentState(next);
  };
  return { updateNewLayoutTask, setNewCharacterDocument, clearNewSeriesReference, clearNewReferenceText };
}
