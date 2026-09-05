import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCards, setCards, getUiConfig, setUiConfig, onStorageChange } from "../../lib/storage";
import type { CardRecord, ListColumnId, UiConfig, ViewMode } from "../../lib/types";
import { DEFAULT_UI_CONFIG } from "../../lib/types";
import { usePlayer } from "../../hooks/usePlayer";

export type { ViewMode };

export function useGrid() {
  const [cards, setCardsState] = useState<CardRecord[]>([]);
  const [uiConfig, setUiConfigState] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [syncing, setSyncing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    getCards().then((c) => setCardsState(c.slice().sort((a, b) => a.order - b.order)));
    getUiConfig().then(setUiConfigState);
    return onStorageChange((changes) => {
      if (changes.cards) setCardsState(changes.cards.slice().sort((a, b) => a.order - b.order));
      if (changes.uiConfig) setUiConfigState(changes.uiConfig);
    });
  }, []);

  /** Persists any subset of the screen-state config (view mode, archive open, list columns). */
  const updateUiConfig = useCallback((patch: Partial<UiConfig>) => {
    setUiConfigState((prev) => {
      const next = { ...prev, ...patch };
      setUiConfig(next);
      return next;
    });
  }, []);

  const setView = useCallback((v: ViewMode) => updateUiConfig({ view: v }), [updateUiConfig]);
  const toggleArchiveOpen = useCallback(
    () =>
      setUiConfigState((prev) => {
        const next = { ...prev, archiveOpen: !prev.archiveOpen };
        setUiConfig(next);
        return next;
      }),
    []
  );
  const setListColumns = useCallback(
    (order: ListColumnId[], sizing: Partial<Record<ListColumnId, number>>) =>
      updateUiConfig({ listColumnOrder: order, listColumnSizing: sizing }),
    [updateUiConfig]
  );

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 1800);
  }, []);

  const allSorted = useMemo(() => cards.slice().sort((a, b) => a.order - b.order), [cards]);
  const ordered = useMemo(() => allSorted.filter((c) => !c.archived), [allSorted]);
  const archivedCards = useMemo(() => allSorted.filter((c) => c.archived), [allSorted]);

  const persistCard = useCallback((updated: CardRecord) => {
    setCardsState((prev) => {
      const next = prev.map((c) => (c.id === updated.id ? updated : c));
      setCards(next);
      return next;
    });
  }, []);

  const player = usePlayer({ cards, ordered, persistCard });
  const { playingId, setPlayingId, setIsPlaying } = player;

  const requestSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await chrome.runtime.sendMessage({ type: "sync" });
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // Kick a sync on first open so a fresh grid page always tries to pick up open tabs.
  useEffect(() => {
    requestSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reorders the visible (non-archived) list; archived cards keep their existing order untouched. */
  const persistOrder = useCallback((newVisible: CardRecord[]) => {
    setCardsState((prev) => {
      const archivedOnly = prev.filter((c) => c.archived);
      const withOrder = newVisible.map((c, i) => ({ ...c, order: i }));
      const merged = [...withOrder, ...archivedOnly];
      setCards(merged);
      return merged;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const reorder = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        setOverId(null);
        return;
      }
      const arr = ordered.slice();
      const from = arr.findIndex((c) => c.id === dragId);
      const to = arr.findIndex((c) => c.id === targetId);
      if (from === -1 || to === -1) return;
      arr.splice(to, 0, arr.splice(from, 1)[0]);
      persistOrder(arr);
      setDragId(null);
      setOverId(null);
    },
    [dragId, ordered, persistOrder]
  );

  const goto = useCallback(
    async (card: CardRecord) => {
      if (!card.tabId) return;
      try {
        const tab = await chrome.tabs.get(card.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(card.tabId, { active: true });
      } catch {
        toast("That tab isn't open anymore — try Sync");
      }
    },
    [toast]
  );

  /** Dead (or archived) cards can be reopened — re-links tabId and un-archives. */
  const reopenTab = useCallback(
    async (card: CardRecord) => {
      try {
        const tab = await chrome.tabs.create({ url: card.url });
        persistCard({ ...card, tabId: tab.id ?? null, archived: false });
      } catch {
        toast("Couldn't reopen that tab");
      }
    },
    [persistCard, toast]
  );

  // Closing a tab is the only removal action now — it just goes "dead" (cached
  // data + playback stay intact) until a re-sync re-links it to a reopened tab.
  const closeTab = useCallback(async (card: CardRecord) => {
    if (!card.tabId) return;
    try {
      await chrome.tabs.remove(card.tabId);
    } catch {
      // already gone
    }
    setCardsState((prev) => {
      const next = prev.map((c) => (c.id === card.id ? { ...c, tabId: null } : c));
      setCards(next);
      return next;
    });
  }, []);

  /** "Clean" — moves every dead (closed-tab) card into the Archive, doesn't delete anything. */
  const archiveDead = useCallback(() => {
    const isDead = (c: CardRecord) => c.status !== "pending" && c.tabId === null && !c.archived;
    setCardsState((prev) => {
      const next = prev.map((c) => (isDead(c) ? { ...c, archived: true } : c));
      setCards(next);
      return next;
    });
    if (playingId && cards.some((c) => c.id === playingId && isDead(c))) {
      setPlayingId(null);
      setIsPlaying(false);
    }
  }, [cards, playingId, setPlayingId, setIsPlaying]);

  /** Permanently deletes an archived card — the only true delete left in the app. */
  const removeArchived = useCallback((id: string) => {
    setCardsState((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setCards(next);
      return next;
    });
  }, []);

  return {
    ...player,
    cards: ordered,
    archivedCards,
    archiveOpen: uiConfig.archiveOpen,
    toggleArchiveOpen,
    syncing,
    requestSync,
    view: uiConfig.view,
    setView,
    listColumnOrder: uiConfig.listColumnOrder,
    listColumnSizing: uiConfig.listColumnSizing,
    setListColumns,
    expandedId,
    toggleExpand,
    dragId,
    overId,
    setDragId,
    setOverId,
    reorder,
    goto,
    reopenTab,
    closeTab,
    archiveDead,
    removeArchived,
    settingsOpen,
    setSettingsOpen,
    toast: toastMsg,
    pushToast: toast,
  };
}
