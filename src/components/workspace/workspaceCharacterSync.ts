import { useEffect } from 'preact/hooks';
import { isLanClient } from '../../lib/clientRuntime';
import { startNewCreationBridgeSession, stopNewCreationBridgeSession } from '../../lib/localBridgeLifecycle.ts';
import { getSeriesCharacterTextStatus, type SeriesCharacterTextLink } from '../../lib/localBridge';
import type { MangaDocument } from '../../types';
import type { WorkspaceState } from './useWorkspaceState';

interface Actions {
  syncCharacterText: (source: MangaDocument, archive?: { characterCatalogId: string; characterName: string; omnyYaml: string; }) => Promise<SeriesCharacterTextLink | null>;
}

export function useCharacterSync({
  showNewDialog, tab, document, setCharacterTextLink, characterEditorBridgeToken, characterTextSyncTimer,
  characterTextLink, characterTextBusy, setToast,
}: WorkspaceState, {
  syncCharacterText,
}: Actions) {
  useEffect(() => {
    if (isLanClient || showNewDialog || tab !== 'characters') return;
    const seriesId = document.manga.meta.series_id;
    if (!document.manga.meta.series.trim() || !seriesId) {
      setCharacterTextLink(null);
      return;
    }
    let ignored = false;
    let leaseToken = '';
    void startNewCreationBridgeSession()
      .then(async (session) => {
        leaseToken = session.token;
        if (ignored) {
          await stopNewCreationBridgeSession(session.token).catch(() => undefined);
          return;
        }
        characterEditorBridgeToken.current = session.token;
        const status = await getSeriesCharacterTextStatus(seriesId);
        if (!ignored) setCharacterTextLink(status.linked || status.needsRelink || status.deletedCharacters.length ? status : null);
      })
      .catch(() => undefined);
    return () => {
      ignored = true;
      window.clearTimeout(characterTextSyncTimer.current);
      if (leaseToken && characterEditorBridgeToken.current === leaseToken) characterEditorBridgeToken.current = null;
      if (leaseToken) void stopNewCreationBridgeSession(leaseToken).catch(() => undefined);
    };
  }, [tab, document.manga.meta.series_id, showNewDialog]);

  useEffect(() => {
    window.clearTimeout(characterTextSyncTimer.current);
    const source = document;
    const link = characterTextLink;
    const shouldSync = !isLanClient && !showNewDialog && link?.linked
      && source.manga.meta.series_id === link.seriesId
      && tab === 'characters'
      && !characterTextBusy;
    if (!shouldSync) return;
    characterTextSyncTimer.current = window.setTimeout(() => {
      void syncCharacterText(source)
        .then((synced) => {
          if (!synced) return;
          setCharacterTextLink(synced);
        })
        .catch((error) => setToast(`人物テキストを同期できませんでした: ${error instanceof Error ? error.message : '不明なエラー'}`));
    }, 1200);
    return () => window.clearTimeout(characterTextSyncTimer.current);
  }, [document, characterTextLink?.linked, characterTextLink?.seriesId, showNewDialog, tab, characterTextBusy]);
}
