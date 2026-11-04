import type { SeriesReferenceTextCandidate } from './workspaceIntake.ts';
import { isLanClient } from '../clientRuntime.ts';
import { listBrowserCatalogs, loadBrowserCatalog, saveBrowserCatalog } from '../browserCatalog.ts';
import { postJson, bridgeUrl } from './transport.ts';

export interface SeriesCatalogLoadResult {
  found: boolean;
  seriesId: string;
  seriesName: string;
  omnyYaml: string;
  revision: string;
}

export interface SeriesCatalogSummary {
  seriesId: string;
  seriesName: string;
  updatedAt: string;
  seriesDirectory: string;
  seriesTextFileName: string;
}

export interface SeriesReferenceTextSelection {
  seriesDirectory: string;
  relativePath: string;
  fileName: string;
  text: string;
  kind?: SeriesReferenceTextCandidate['kind'];
}

export interface DeletedSeriesCharacter {
  deletionId: string;
  characterCatalogId: string;
  characterName: string;
  deletedAt: string;
  expiresAt: string;
}

export interface SeriesCharacterTextLink {
  linked: boolean;
  needsRelink: boolean;
  seriesId: string;
  seriesDirectory: string;
  relativePath: string;
  fileName: string;
  text: string;
  deletedCharacters: DeletedSeriesCharacter[];
}

function deletedSeriesCharacters(value: unknown): DeletedSeriesCharacter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.deletion_id !== 'string' || !/^deleted-[A-Za-z0-9-]{1,100}$/u.test(item.deletion_id)
      || typeof item.character_catalog_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(item.character_catalog_id)) return [];
    return [{
      deletionId: item.deletion_id,
      characterCatalogId: item.character_catalog_id,
      characterName: typeof item.character_name === 'string' && item.character_name.trim() ? item.character_name.trim() : '削除した人物',
      deletedAt: typeof item.deleted_at === 'string' ? item.deleted_at : '',
      expiresAt: typeof item.expires_at === 'string' ? item.expires_at : '',
    }];
  });
}

function seriesCharacterTextLink(payload: Record<string, unknown>, fallbackSeriesId: string): SeriesCharacterTextLink {
  const seriesId = typeof payload.series_id === 'string' ? payload.series_id : fallbackSeriesId;
  if (seriesId !== fallbackSeriesId) throw new Error('人物参照テキストのシリーズが一致しません');
  return {
    linked: payload.linked === true,
    needsRelink: payload.needs_relink === true,
    seriesId,
    seriesDirectory: typeof payload.series_directory === 'string' ? payload.series_directory : '',
    relativePath: typeof payload.relative_path === 'string' ? payload.relative_path : '',
    fileName: typeof payload.file_name === 'string' ? payload.file_name : '',
    text: typeof payload.text === 'string' ? payload.text : '',
    deletedCharacters: deletedSeriesCharacters(payload.deleted_characters),
  };
}

export async function listSeriesCatalogs(): Promise<SeriesCatalogSummary[]> {
  if (isLanClient) return (await listBrowserCatalogs()).map(item => ({ ...item, seriesDirectory: '', seriesTextFileName: '' }));
  const payload = await postJson('/api/series/list', {}, 10_000) as Record<string, unknown>;
  const entries = Array.isArray(payload.series) ? payload.series : [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.series_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.series_id)
      || typeof item.series_name !== 'string' || !item.series_name.trim()) return [];
    return [{
      seriesId: item.series_id,
      seriesName: item.series_name,
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
      seriesDirectory: typeof item.series_directory === 'string' ? item.series_directory : '',
      seriesTextFileName: typeof item.series_text_file_name === 'string' ? item.series_text_file_name : '',
    }];
  });
}

export async function chooseSeriesReferenceText(
  seriesId: string,
  defaultDirectory = '',
): Promise<SeriesReferenceTextSelection | null> {
  const payload = await postJson('/api/series/reference-text/choose', {
    series_id: seriesId,
    default_directory: defaultDirectory,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const seriesDirectory = typeof payload.series_directory === 'string' ? payload.series_directory : '';
  const relativePath = typeof payload.relative_path === 'string' ? payload.relative_path : '';
  const fileName = typeof payload.file_name === 'string' ? payload.file_name : '';
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (!seriesDirectory || !relativePath || !fileName) {
    throw new Error('シリーズ資料テキストを受け取れませんでした');
  }
  return { seriesDirectory, relativePath, fileName, text };
}

export async function getSeriesCharacterTextStatus(seriesId: string): Promise<SeriesCharacterTextLink> {
  const payload = await postJson('/api/series/character-text/status', {
    series_id: seriesId,
  }, 10_000) as Record<string, unknown>;
  return seriesCharacterTextLink(payload, seriesId);
}

export async function linkSeriesCharacterText(
  seriesName: string,
  seriesId: string,
  defaultDirectory = '',
): Promise<SeriesCharacterTextLink | null> {
  const payload = await postJson('/api/series/character-text/link', {
    series_name: seriesName,
    series_id: seriesId,
    default_directory: defaultDirectory,
  }, 5 * 60_000) as Record<string, unknown>;
  if (payload.cancelled === true) return null;
  const result = seriesCharacterTextLink(payload, seriesId);
  if (!result.linked || !result.fileName || !result.relativePath) {
    throw new Error('人物の参照テキストを紐づけられませんでした');
  }
  return result;
}

export async function syncSeriesCharacterText(
  seriesId: string,
  markdown: string,
  activeCharacterIds: readonly string[],
  archive?: { characterCatalogId: string; characterName: string; omnyYaml: string },
): Promise<SeriesCharacterTextLink> {
  const payload = await postJson('/api/series/character-text/sync', {
    series_id: seriesId,
    markdown,
    active_character_ids: activeCharacterIds,
    ...(archive ? { archive: {
      character_catalog_id: archive.characterCatalogId,
      character_name: archive.characterName,
      omny_yaml: archive.omnyYaml,
    } } : {}),
  }, 20_000) as Record<string, unknown>;
  if (payload.ok !== true) throw new Error('人物の参照テキストを同期できませんでした');
  return seriesCharacterTextLink(payload, seriesId);
}

export async function restoreSeriesCharacterText(
  seriesId: string,
  deletionId: string,
): Promise<{ found: boolean; characterName: string; omnyYaml: string }> {
  const payload = await postJson('/api/series/character-text/restore', {
    series_id: seriesId,
    deletion_id: deletionId,
  }, 10_000) as Record<string, unknown>;
  if (payload.series_id !== seriesId || payload.deletion_id !== deletionId || (payload.found !== true && payload.found !== false)) {
    throw new Error('人物の復元データの応答形式が正しくありません');
  }
  if (!payload.found) return { found: false, characterName: '', omnyYaml: '' };
  if (typeof payload.omny_yaml !== 'string' || !payload.omny_yaml.trim()) {
    throw new Error('人物の復元データを読み込めませんでした');
  }
  return {
    found: true,
    characterName: typeof payload.character_name === 'string' ? payload.character_name : '削除した人物',
    omnyYaml: payload.omny_yaml,
  };
}

export async function loadSeriesCatalog(seriesName: string, seriesId = ''): Promise<SeriesCatalogLoadResult> {
  if (isLanClient) return loadBrowserCatalog(seriesName, seriesId);
  const payload = await postJson('/api/series/load', {
    series_name: seriesName,
    series_id: seriesId,
  }, 10_000) as Record<string, unknown>;
  const found = payload.found === true;
  const returnedSeriesId = typeof payload.series_id === 'string' ? payload.series_id : '';
  const returnedSeriesName = typeof payload.series_name === 'string' ? payload.series_name : '';
  const omnyYaml = typeof payload.omny_yaml === 'string' ? payload.omny_yaml : '';
  const revision = typeof payload.revision === 'string' && /^[a-f0-9]{64}$/.test(payload.revision) ? payload.revision : '';
  if (payload.found !== true && payload.found !== false) throw new Error('シリーズ共通カタログの応答形式が正しくありません');
  if (returnedSeriesId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(returnedSeriesId)) {
    throw new Error('シリーズ共通カタログの内部IDが正しくありません');
  }
  if (found && (!returnedSeriesId || !returnedSeriesName.trim() || !omnyYaml.trim() || !revision)) {
    throw new Error('シリーズ共通カタログの応答形式が正しくありません');
  }
  return {
    found,
    seriesId: returnedSeriesId,
    seriesName: returnedSeriesName || seriesName,
    omnyYaml,
    revision,
  };
}

export async function saveSeriesCatalog(
  seriesName: string,
  seriesId: string,
  omnyYaml: string,
  expectedRevision: string,
  options: {
    seriesDirectory?: string;
    seriesTextRelativePath?: string;
  } = {},
): Promise<{ seriesId: string; directory: string; revision: string }> {
  if (isLanClient) return saveBrowserCatalog(seriesName, seriesId, omnyYaml, expectedRevision);
  const payload = await postJson('/api/series/save', {
    series_name: seriesName,
    series_id: seriesId,
    omny_yaml: omnyYaml,
    expected_revision: expectedRevision,
    series_directory: options.seriesDirectory ?? '',
    series_text_relative_path: options.seriesTextRelativePath ?? '',
  }, 10_000) as Record<string, unknown>;
  if (payload.ok !== true
    || typeof payload.series_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(payload.series_id)
    || typeof payload.revision !== 'string' || !/^[a-f0-9]{64}$/.test(payload.revision)) {
    throw new Error('シリーズ共通カタログを保存できませんでした');
  }
  return {
    seriesId: payload.series_id,
    directory: typeof payload.directory === 'string' ? payload.directory : '',
    revision: payload.revision,
  };
}

export interface SeriesCatalogDraftSession {
  token: string;
  seriesId: string;
  episodeId: string;
}

export async function beginSeriesCatalogDraft(
  seriesName: string,
  seriesId: string,
  episodeId: string,
): Promise<SeriesCatalogDraftSession> {
  const payload = await postJson('/api/series/draft/begin', {
    series_name: seriesName,
    series_id: seriesId,
    episode_id: episodeId,
  }, 30_000) as Record<string, unknown>;
  if (payload.ok !== true
    || typeof payload.draft_token !== 'string' || !/^[a-f0-9]{32}$/.test(payload.draft_token)
    || payload.series_id !== seriesId || payload.episode_id !== episodeId) {
    throw new Error('新規作成の仮保存を準備できませんでした');
  }
  return { token: payload.draft_token, seriesId, episodeId };
}

export async function discardSeriesCatalogDraft(token: string): Promise<boolean> {
  const payload = await postJson('/api/series/draft/discard', { draft_token: token }, 30_000) as Record<string, unknown>;
  if (payload.ok !== true || payload.draft_token !== token
    || (payload.discarded !== true && payload.discarded !== false)) {
    throw new Error('保存していない人物データを破棄できませんでした');
  }
  return payload.discarded;
}

export async function commitSeriesCatalogDraft(token: string): Promise<boolean> {
  const payload = await postJson('/api/series/draft/commit', { draft_token: token }, 30_000) as Record<string, unknown>;
  if (payload.ok !== true || payload.draft_token !== token
    || (payload.committed !== true && payload.committed !== false)) {
    throw new Error('人物データの保存を確定できませんでした');
  }
  return payload.committed;
}

/** 再読み込みやウィンドウ終了時も、仮保存の破棄要求だけは送る。 */
export function discardSeriesCatalogDraftOnPageExit(token: string): void {
  if (!token || typeof fetch !== 'function') return;
  void fetch(bridgeUrl('/api/series/draft/discard'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft_token: token }),
    keepalive: true,
  }).catch(() => undefined);
}

export async function discardUnsavedSeriesCatalog(
  seriesName: string,
  seriesId: string,
  episodeId: string,
): Promise<boolean> {
  const payload = await postJson('/api/series/discard-unsaved', {
    series_name: seriesName,
    series_id: seriesId,
    episode_id: episodeId,
  }, 10_000) as Record<string, unknown>;
  if (payload.ok !== true || (payload.deleted !== true && payload.deleted !== false) || payload.series_id !== seriesId) {
    throw new Error('保存していないシリーズの内部データを破棄できませんでした');
  }
  return payload.deleted;
}
