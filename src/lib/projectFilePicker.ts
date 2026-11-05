import { chooseBrowserFiles } from './browserFiles.ts';
import { browserWorkspaces } from './browserWorkspace.ts';
import { isLanClient } from './clientRuntime.ts';
import { postJson } from './bridge/transport.ts';
import { withNewCreationBridgeSession } from './localBridgeLifecycle.ts';

export type ProjectFilePicker = (accept: string, multiple?: boolean) => Promise<File[]>;

/** Both pickers receive the registered folder on every invocation. */
export async function chooseProjectFiles(directory: string, accept: string, multiple = false, seriesId = ''): Promise<File[]> {
  if (!directory) return chooseBrowserFiles(accept, multiple);
  if (isLanClient) return browserWorkspaces.chooseFiles(directory, accept, multiple);
  const payload = await withNewCreationBridgeSession(() => postJson('/api/episode-workspace/choose-files', {
    default_directory: directory, series_id: seriesId, accept, multiple,
  }, 5 * 60_000)) as { cancelled?: boolean; files: { name: string; type: string; data: string }[] };
  if (payload.cancelled) return [];
  return payload.files.map(file => {
    const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
    return new File([bytes], file.name, { type: file.type });
  });
}
