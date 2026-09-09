import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCards, updateCards, getUiConfig, setUiConfig, onStorageChange } from "../../lib/storage";
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

  // Every write here goes through `updateCards`, which re-reads storage inside
  // a serialized chain. Writing this page's whole array back instead would
  // revert every card the background extracted since the last storage event.
  // Local state is still set optimistically so the UI doesn't wait on a round trip.
  const persistCard = useCallback((updated: CardRecord) => {
    setCardsState((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    updateCards((cards) => cards.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
  }, []);

  const player = usePlayer({
    cards,
    ordered,
    persistCard,
    refreshTrack: (cardId) => chrome.runtime.sendMessage({ type: "refreshTrack", cardId }),
    onToast: toast,
  });
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

  // Kick a sync on first open so a fresh grid page always tries to pick up open
  // tabs, then keep kicking. The extraction queue lives entirely in the service
  // worker's memory and staggers out over minutes on a big tab set, so a worker
  // torn down partway through takes the rest of the backlog with it — cards
  // just stay "pending" with nothing left to retry them. A fresh worker only
  // picks the leftovers up when something asks it to, so the page asks every
  // 60s (same resume the collection page already does). `auto` tells the
  // background this is the heartbeat, not the user: it skips cards that have
  // already burned MAX_ATTEMPTS, which pressing Sync still retries.
  useEffect(() => {
    requestSync();
    const timer = setInterval(() => chrome.runtime.sendMessage({ type: "sync", auto: true }), 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reorders the visible (non-archived) list; archived cards keep their existing order untouched. */
  const persistOrder = useCallback((newVisible: CardRecord[]) => {
    const orderById = new Map(newVisible.map((c, i) => [c.id, i]));
    const reorder = (cards: CardRecord[]) =>
      cards.map((c) => (orderById.has(c.id) ? { ...c, order: orderById.get(c.id) as number } : c));
    setCardsState(reorder);
    updateCards(reorder);
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
    const kill = (cards: CardRecord[]) => cards.map((c) => (c.id === card.id ? { ...c, tabId: null } : c));
    setCardsState(kill);
    updateCards(kill);
  }, []);

  /** "Clean" — moves every dead (closed-tab) card into the Archive, doesn't delete anything. */
  const archiveDead = useCallback(() => {
    const isDead = (c: CardRecord) => c.status !== "pending" && c.tabId === null && !c.archived;
    const archive = (cards: CardRecord[]) => cards.map((c) => (isDead(c) ? { ...c, archived: true } : c));
    setCardsState(archive);
    updateCards(archive);
    if (playingId && cards.some((c) => c.id === playingId && isDead(c))) {
      setPlayingId(null);
      setIsPlaying(false);
    }
  }, [cards, playingId, setPlayingId, setIsPlaying]);

  /** Same as the injected page's "Listen to all" button, triggered from a
   *  single release row instead — fetches that artist's whole catalogue in
   *  the background and opens it as a label collection. */
  const listenToArtist = useCallback(
    async (card: CardRecord) => {
      toast("Reading artist's catalogue…");
      const res = await chrome.runtime.sendMessage({ type: "openLabelFromRelease", url: card.url });
      if (!res?.ok) toast("Couldn't read that artist's catalogue");
    },
    [toast]
  );

  /** Permanently deletes an archived card — the only true delete left in the app. */
  const removeArchived = useCallback((id: string) => {
    const drop = (cards: CardRecord[]) => cards.filter((c) => c.id !== id);
    setCardsState(drop);
    updateCards(drop);
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
    listenToArtist,
    archiveDead,
    removeArchived,
    settingsOpen,
    setSettingsOpen,
    toast: toastMsg,
    pushToast: toast,
  };
}
