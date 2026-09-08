import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlaybackMode, setPlaybackMode } from "../lib/storage";
import type { CardRecord, PlaybackMode } from "../lib/types";
import { computeAnalysis, getCachedAnalysis } from "../lib/waveform";

export const isPlayable = (c: CardRecord) => c.status === "ready" && !!c.streamUrl;

interface PendingSeek {
  cardId: string;
  trackId: string;
  fraction: number;
}

interface Args {
  /** every card the surface knows about (used to resolve `playingId`) */
  cards: CardRecord[];
  /** the visible, ordered cards — this is what prev/next walks */
  ordered: CardRecord[];
  /** writes a card back to whichever store owns it (tab grid or label collection) */
  persistCard: (card: CardRecord) => void;
  /** asks the background to mint a fresh signed stream URL for this card, into
   *  whichever store owns it — see refreshTrack in background.ts */
  refreshTrack: (cardId: string) => void;
  onToast: (msg: string) => void;
}

/**
 * Everything audio: the <audio> element, transport, queue walking, per-track
 * selection, waveforms. Owned outside PlayerBar so the list view's per-track
 * scrobbler reads the same position/duration, and shared by the tab grid and
 * the label page — they differ only in where their cards come from.
 */
export function usePlayer({ cards, ordered, persistCard, refreshTrack, onToast }: Args) {
  const [playbackMode, setPlaybackModeState] = useState<PlaybackMode>("single");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [pendingSeek, setPendingSeek] = useState<PendingSeek | null>(null);
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const [bpms, setBpms] = useState<Record<string, number | null>>({});

  useEffect(() => {
    getPlaybackMode().then(setPlaybackModeState);
  }, []);

  const togglePlaybackMode = useCallback(() => {
    setPlaybackModeState((prev) => {
      const next: PlaybackMode = prev === "single" ? "album" : "single";
      setPlaybackMode(next);
      return next;
    });
  }, []);

  const queue = useMemo(() => ordered.filter(isPlayable), [ordered]);
  const current = useMemo(() => cards.find((c) => c.id === playingId) ?? null, [cards, playingId]);

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
  // Cache hits apply immediately (free, no network); a fresh decode waits for
  // `dur > 0` (the <audio> element's own metadata has loaded) so this fetch —
  // for the SAME file the <audio> element is streaming — never races playback
  // for the connection and starves the actual track load.
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
    if (dur === 0) return; // playback hasn't loaded metadata yet — let it win the connection first
    computeAnalysis(trackId, streamUrl, (result) => {
      setWaveforms((prev) => ({ ...prev, [trackId]: result.peaks }));
      setBpms((prev) => ({ ...prev, [trackId]: result.bpm }));
    });
  }, [current?.selectedTrackId, current?.streamUrl, dur]);

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
      onToast("That stream link is dead — try Sync");
      return;
    }
    retriedTrackRef.current = key;
    onToast("Stream link expired — refreshing…");
    refreshTrack(current.id);
    // The refreshed streamUrl arrives via the store's change listener ->
    // `current` updates -> the src-effect above picks up the new URL and
    // resumes playback automatically.
  }, [current, refreshTrack, onToast]);

  const scrollToPlaying = useCallback(() => {
    document.querySelector('[data-playing="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return {
    playbackMode,
    togglePlaybackMode,
    queue,
    current,
    playingId,
    setPlayingId,
    isPlaying,
    setIsPlaying,
    play,
    step,
    selectTrack,
    handleEnded,
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
    scrollToPlaying,
  };
}
