import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCards,
  setCards,
  getPlaybackMode,
  setPlaybackMode,
  getUiConfig,
  setUiConfig,
  onStorageChange,
} from "../../lib/storage";
import type { CardRecord, ListColumnId, PlaybackMode, UiConfig, ViewMode } from "../../lib/types";
import { DEFAULT_UI_CONFIG } from "../../lib/types";
import { computeAnalysis, getCachedAnalysis } from "../../lib/waveform";

const isPlayable = (c: CardRecord) => c.status === "ready" && !!c.streamUrl;

export type { ViewMode };

interface PendingSeek {
  cardId: string;
  trackId: string;
  fraction: number;
}

export function useGrid() {
  const [cards, setCardsState] = useState<CardRecord[]>([]);
  const [playbackMode, setPlaybackModeState] = useState<PlaybackMode>("single");
  const [uiConfig, setUiConfigState] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  // Audio playback: owned here (not in PlayerBar) so other views — the list
  // view's per-track scrobbler — can read/drive the same position & duration.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [pendingSeek, setPendingSeek] = useState<PendingSeek | null>(null);
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const [bpms, setBpms] = useState<Record<string, number | null>>({});

  useEffect(() => {
    getCards().then((c) => setCardsState(c.slice().sort((a, b) => a.order - b.order)));
    getPlaybackMode().then(setPlaybackModeState);
    getUiConfig().then(setUiConfigState);
    return onStorageChange((changes) => {
      if (changes.cards) setCardsState(changes.cards.slice().sort((a, b) => a.order - b.order));
      if (changes.playbackMode) setPlaybackModeState(changes.playbackMode);
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
    () => setUiConfigState((prev) => {
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
  const queue = useMemo(() => ordered.filter(isPlayable), [ordered]);
  const current = useMemo(() => cards.find((c) => c.id === playingId) ?? null, [cards, playingId]);

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

  const togglePlaybackMode = useCallback(() => {
    setPlaybackModeState((prev) => {
      const next: PlaybackMode = prev === "single" ? "album" : "single";
      setPlaybackMode(next);
      return next;
    });
  }, []);

  const persistCard = useCallback((updated: CardRecord) => {
    setCardsState((prev) => {
      const next = prev.map((c) => (c.id === updated.id ? updated : c));
      setCards(next);
      return next;
    });
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

  /** Loads a specific track into a card (from the expand panel / list sub-rows) — doesn't itself start playback. */
  const selectTrack = useCallback(
    (cardId: string, trackId: string) => {
      const card = cards.find((c) => c.id === cardId);
      const track = card?.tracks.find((t) => t.trackId === trackId);
      if (!card || !track) return;
      persistCard({ ...card, selectedTrackId: track.trackId, track: track.title, trackId: track.trackId, streamUrl: track.streamUrl });
    },
    [cards, persistCard]
  );

  const play = useCallback(
    (id: string, trackId?: string) => {
      if (trackId) selectTrack(id, trackId);
      setPlayingId((prevId) => {
        const samePlace = prevId === id && (!trackId || cards.find((c) => c.id === id)?.selectedTrackId === trackId);
        if (samePlace) {
          setIsPlaying((p) => !p);
          return prevId;
        }
        setIsPlaying(true);
        return id;
      });
    },
    [cards, selectTrack]
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (queue.length === 0) return;
      const i = queue.findIndex((c) => c.id === playingId);
      const next = queue[(i + dir + queue.length) % queue.length];
      if (next) play(next.id);
    },
    [queue, playingId, play]
  );

  /** Called on the <audio> "ended" event. In "album" mode, keeps advancing through
   *  the current release's remaining playable tracks before moving to the next card. */
  const handleEnded = useCallback(() => {
    if (playbackMode === "album" && current) {
      const tracks = current.tracks;
      const idx = tracks.findIndex((t) => t.trackId === current.selectedTrackId);
      const next = tracks.slice(idx + 1).find((t) => t.streamUrl);
      if (next) {
        selectTrack(current.id, next.trackId);
        return;
      }
    }
    step(1);
  }, [playbackMode, current, selectTrack, step]);

  // --- audio element wiring -------------------------------------------------

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const streamUrl = current?.streamUrl ?? null;
    if (streamUrl && audio.src !== streamUrl) {
      audio.src = streamUrl;
      setPos(0);
      setDur(0);
    }
    if (!streamUrl) {
      audio.removeAttribute("src");
      setPos(0);
      setDur(0);
    }
  }, [current?.streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current?.streamUrl) return;
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [isPlaying, current?.streamUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Real waveform + BPM — one decode, only for the track that's actually
  // loaded right now, only once per track for the session (see waveform.ts).
  useEffect(() => {
    const trackId = current?.selectedTrackId;
    const streamUrl = current?.streamUrl;
    if (!trackId || !streamUrl) return;
    const cached = getCachedAnalysis(trackId);
    if (cached) {
      setWaveforms((prev) => (prev[trackId] ? prev : { ...prev, [trackId]: cached.peaks }));
      setBpms((prev) => (trackId in prev ? prev : { ...prev, [trackId]: cached.bpm }));
      return;
    }
    computeAnalysis(trackId, streamUrl, (result) => {
      setWaveforms((prev) => ({ ...prev, [trackId]: result.peaks }));
      setBpms((prev) => ({ ...prev, [trackId]: result.bpm }));
    });
  }, [current?.selectedTrackId, current?.streamUrl]);

  const handleTimeUpdate = useCallback((t: number) => setPos(t), []);

  const handleDurationChange = useCallback(
    (d: number) => {
      setDur(d);
      setPendingSeek((pending) => {
        if (pending && pending.cardId === playingId && pending.trackId === current?.selectedTrackId && d > 0) {
          if (audioRef.current) audioRef.current.currentTime = pending.fraction * d;
          return null;
        }
        return pending;
      });
    },
    [playingId, current?.selectedTrackId]
  );

  /** Footer seek bar — only meaningful once a track is loaded. */
  const seek = useCallback(
    (fraction: number) => {
      if (audioRef.current && dur > 0) audioRef.current.currentTime = fraction * dur;
    },
    [dur]
  );

  const setVolumeFraction = useCallback((fraction: number) => {
    setVolume(Math.max(0, Math.min(1, fraction)));
  }, []);

  /** List-view scrobbler: seek immediately if that track is already loaded & current,
   *  otherwise select+play it and apply the seek once its metadata loads. */
  const scrubTrack = useCallback(
    (cardId: string, trackId: string, fraction: number) => {
      const isLoadedCurrent = playingId === cardId && current?.selectedTrackId === trackId && dur > 0;
      if (isLoadedCurrent) {
        if (audioRef.current) audioRef.current.currentTime = fraction * dur;
        if (!isPlaying) setIsPlaying(true);
      } else {
        setPendingSeek({ cardId, trackId, fraction });
        play(cardId, trackId);
      }
    },
    [playingId, current?.selectedTrackId, dur, isPlaying, play]
  );

  // A signed stream URL eventually expires (410 Gone) even though it can outlive
  // 37+ days — retry once per track selection by re-extracting a fresh one.
  const retriedTrackRef = useRef<string | null>(null);
  useEffect(() => {
    retriedTrackRef.current = null; // a newly selected track gets its own retry budget
  }, [current?.id, current?.selectedTrackId]);

  const handleAudioError = useCallback(() => {
    if (!current?.selectedTrackId) return;
    const key = `${current.id}:${current.selectedTrackId}`;
    if (retriedTrackRef.current === key) {
      toast("That stream link is dead — try Sync");
      return;
    }
    retriedTrackRef.current = key;
    toast("Stream link expired — refreshing…");
    chrome.runtime.sendMessage({ type: "refreshTrack", cardId: current.id });
    // The refreshed streamUrl arrives via onStorageChange -> `current` updates ->
    // the src-effect above picks up the new URL and resumes playback automatically.
  }, [current, toast]);

  // ---------------------------------------------------------------------------

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

  const scrollToPlaying = useCallback(() => {
    const el = document.querySelector('[data-playing="true"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

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
  }, [cards, playingId]);

  /** Permanently deletes an archived card — the only true delete left in the app. */
  const removeArchived = useCallback((id: string) => {
    setCardsState((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setCards(next);
      return next;
    });
  }, []);

  return {
    cards: ordered,
    archivedCards,
    archiveOpen: uiConfig.archiveOpen,
    toggleArchiveOpen,
    queue,
    current,
    playingId,
    isPlaying,
    setIsPlaying,
    syncing,
    requestSync,
    play,
    step,
    handleEnded,
    playbackMode,
    togglePlaybackMode,
    view: uiConfig.view,
    setView,
    listColumnOrder: uiConfig.listColumnOrder,
    listColumnSizing: uiConfig.listColumnSizing,
    setListColumns,
    expandedId,
    toggleExpand,
    selectTrack,
    dragId,
    overId,
    setDragId,
    setOverId,
    reorder,
    goto,
    reopenTab,
    scrollToPlaying,
    closeTab,
    archiveDead,
    removeArchived,
    settingsOpen,
    setSettingsOpen,
    toast: toastMsg,
    pushToast: toast,
    audioRef,
    pos,
    dur,
    volume,
    seek,
    setVolumeFraction,
    scrubTrack,
    handleTimeUpdate,
    handleDurationChange,
    handleAudioError,
    waveforms,
    bpms,
  };
}
