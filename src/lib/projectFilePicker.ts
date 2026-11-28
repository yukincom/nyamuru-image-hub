import { chooseBrowserFiles } from './browserFiles.ts';
import { browserWorkspaces } from './browserWorkspace.ts';
import { isLanClient } from './clientRuntime.ts';
import { postJson } from './bridge/transport.ts';
import { withNewCreationBridgeSession } from './localBridgeLifecycle.ts';

export type ProjectFilePicker = (accept: string, multiple?: boolean) => Promise<File[]>;

export interface ProjectImageEntry {
  rel_path: string;
  name: string;
  size: number;
  mtime: number;
}

export interface NativeImageImportOptions {
  splitByPanels: boolean;
  splitTarget: 'figure' | 'background';
  transparentWhite: boolean;
}

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

export async function listProjectImages(
  directory: string,
  seriesId = '',
): Promise<{ directory: string; folderName: string; entries: ProjectImageEntry[] }> {
  if ((!directory && !seriesId) || isLanClient) {
    return { directory: '', folderName: '', entries: [] };
  }
  const payload = await withNewCreationBridgeSession(() => postJson('/api/episode-workspace/list-images', {
    default_directory: directory,
    series_id: seriesId,
  }, 30_000)) as { directory?: string; folder_name?: string; entries?: ProjectImageEntry[] };
  return {
    directory: typeof payload.directory === 'string' ? payload.directory : '',
    folderName: typeof payload.folder_name === 'string' ? payload.folder_name : '',
    entries: Array.isArray(payload.entries) ? payload.entries : [],
  };
}

export async function readProjectImages(directory: string, relPaths: string[], seriesId = ''): Promise<File[]> {
  if (!relPaths.length || (!directory && !seriesId) || isLanClient) return [];
  const payload = await withNewCreationBridgeSession(() => postJson('/api/episode-workspace/read-images', {
    default_directory: directory,
    series_id: seriesId,
    rel_paths: relPaths,
  }, 60_000)) as { files: { name: string; type: string; data: string }[] };
  return (payload.files ?? []).map(file => {
    const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
    return new File([bytes], file.name, { type: file.type || 'image/png' });
  });
}

export async function chooseImportImagesWithOptions(
  directory: string,
  seriesId = '',
): Promise<{
  supported: boolean;
  cancelled: boolean;
  files: File[];
  options: NativeImageImportOptions | null;
}> {
  if (isLanClient) {
    return { supported: false, cancelled: false, files: [], options: null };
  }
  const payload = await withNewCreationBridgeSession(() => postJson('/api/episode-workspace/choose-import-images', {
    default_directory: directory,
    series_id: seriesId,
  }, 5 * 60_000)) as {
    supported?: boolean;
    cancelled?: boolean;
    files?: { name: string; type: string; data: string }[];
    options?: NativeImageImportOptions | null;
  };
  if (payload.supported === false) {
    return { supported: false, cancelled: false, files: [], options: null };
  }
  if (payload.cancelled) {
    return { supported: true, cancelled: true, files: [], options: null };
  }
  const files = (payload.files ?? []).map(file => {
    const bytes = Uint8Array.from(atob(file.data), character => character.charCodeAt(0));
    return new File([bytes], file.name, { type: file.type || 'image/png' });
  });
  return {
    supported: true,
    cancelled: false,
    files,
    options: payload.options ?? { splitByPanels: false, splitTarget: 'figure', transparentWhite: true },
  };
}
