import { useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Library, Pause, Play, Trash2, Wand2 } from "lucide-react";
import type { CardRecord, ListColumnId, TrackRecord } from "../../lib/types";
import Scrobbler from "./Scrobbler";

const COLLAPSED_HEIGHT = 160; // ~5 track rows
const TRACK_ROW_HEIGHT = 30; // approx height of one track row (py-[7px]*2 + line height)
const META_HEIGHT = 80; // left column's height (52px thumbnail + 14px top/bottom padding)
const NO_ROWS: object[] = [];

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const COLUMN_DEFS: ColumnDef<object>[] = [
  { id: "title", header: "Title", minSize: 200 },
  { id: "artist", header: "Artist", minSize: 90 },
  { id: "album", header: "Album", minSize: 90 },
  { id: "duration", header: "Time", minSize: 48, maxSize: 100 },
  { id: "bpm", header: "BPM", minSize: 48, maxSize: 100 },
];

/** Moves `id` to sit where `target` currently is. */
function moveColumn(order: ListColumnId[], id: ListColumnId, target: ListColumnId): ListColumnId[] {
  if (id === target) return order;
  const arr = order.slice();
  const from = arr.indexOf(id);
  const to = arr.indexOf(target);
  if (from === -1 || to === -1) return order;
  arr.splice(to, 0, arr.splice(from, 1)[0]);
  return arr;
}

interface Props {
  cards: CardRecord[];
  playingId: string | null;
  isAudioPlaying: boolean;
  pos: number;
  dur: number;
  waveforms: Record<string, number[]>;
  bpms: Record<string, number | null>;
  /** decoded lengths — only consulted for tracks whose bandcamp data had no duration */
  durations: Record<string, number>;
  /** track ids whose waveform/BPM analysis is queued or running */
  analyzing: Set<string>;
  columnOrder: ListColumnId[];
  columnSizing: Partial<Record<ListColumnId, number>>;
  onColumnsChange: (order: ListColumnId[], sizing: Partial<Record<ListColumnId, number>>) => void;
  onPlay: (id: string) => void;
  onPlayTrack: (cardId: string, trackId: string) => void;
  onScrub: (cardId: string, trackId: string, fraction: number) => void;
  /** magic wand — analyse every track of this release without playing anything */
  onAnalyze: (cardId: string) => void;
  /** magic wand on a single track row — same, for one track */
  onAnalyzeTrack: (cardId: string, trackId: string) => void;
  /** opens this release's artist/label's whole catalogue as a new collection */
  onListenToArtist: (card: CardRecord) => void;
  onGoto: (card: CardRecord) => void;
  /** tab-grid only — a label collection's releases have no tab behind them */
  onClose?: (card: CardRecord) => void;
  onReopen?: (card: CardRecord) => void;
  /** false on the label page: no tab actions, and a null tabId isn't "dead" */
  tabBacked?: boolean;
}

export default function ListView({
  cards,
  playingId,
  isAudioPlaying,
  pos,
  dur,
  waveforms,
  bpms,
  durations,
  analyzing,
  columnOrder,
  columnSizing,
  onColumnsChange,
  onPlay,
  onPlayTrack,
  onScrub,
  onAnalyze,
  onAnalyzeTrack,
  onListenToArtist,
  onGoto,
  onClose,
  onReopen,
  tabBacked = true,
}: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dragCol, setDragCol] = useState<ListColumnId | null>(null);

  const table = useReactTable({
    data: NO_ROWS,
    columns: COLUMN_DEFS,
    state: { columnOrder, columnSizing },
    columnResizeMode: "onChange",
    onColumnOrderChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (o: string[]) => string[])(columnOrder) : updater;
      onColumnsChange(next as ListColumnId[], columnSizing);
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === "function" ? (updater as (s: typeof columnSizing) => typeof columnSizing)(columnSizing) : updater;
      onColumnsChange(columnOrder, next);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const headers = table.getHeaderGroups()[0].headers;

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const cellContent = (columnId: string, card: CardRecord, track: TrackRecord, isCurrent: boolean, isDead: boolean) => {
    switch (columnId) {
      case "title": {
        const disabled = !track.streamUrl;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div onClick={(e) => e.stopPropagation()} className="flex-none">
              <Scrobbler
                peaks={waveforms[track.trackId] ?? null}
                progress={isCurrent && dur > 0 ? pos / dur : 0}
                hasRealProgress={isCurrent && dur > 0}
                disabled={disabled}
                onScrub={(fraction) => onScrub(card.id, track.trackId, fraction)}
              />
            </div>
            {!track.streamUrl && <AlertTriangle size={11} className="flex-none text-warn" />}
            <div className="truncate text-[13px]" style={{ color: isCurrent ? "#1da0c3" : isDead ? "#5b5854" : "#f0efed" }}>
              {track.title}
            </div>
          </div>
        );
      }
      case "artist":
        return (
          <div className="truncate text-xs" style={{ color: isDead ? "#5b5854" : "#8d8a85" }}>
            {card.artist}
          </div>
        );
      case "album":
        return (
          <div className="truncate text-xs" style={{ color: isDead ? "#5b5854" : "#8d8a85" }}>
            {card.album}
          </div>
        );
      case "duration": {
        // Free from data-tralbum at extraction time for anything scraped since
        // this column existed; older cards (and releases bandcamp omits it on)
        // fall back to the decode, which only happens if something analyses the
        // track anyway — the wand, or playing it.
        const seconds = track.duration ?? durations[track.trackId];
        return (
          <div className="truncate pr-2 text-xs tabular-nums" style={{ color: isDead ? "#5b5854" : "#8d8a85" }}>
            {seconds == null ? (analyzing.has(track.trackId) ? "…" : "") : formatDuration(seconds)}
          </div>
        );
      }
      case "bpm": {
        // Computed only for whichever track is actually loaded, plus whatever
        // the magic wand asks for — blank for everything else (no upfront pass).
        const bpm = bpms[track.trackId];
        const pending = analyzing.has(track.trackId);
        return (
          <div className="flex items-center gap-2 pr-2 text-xs" style={{ color: isDead ? "#5b5854" : "#8d8a85" }}>
            <span className="flex-1 truncate">{pending ? "…" : bpm == null ? "" : bpm}</span>
            {/* Nothing to load once it has a value, so the wand only offers itself
                on tracks that have never been analysed. */}
            {!pending && bpm === undefined && track.streamUrl && (
              <span
                title="Load waveform + BPM for this track (doesn't play)"
                onClick={(e) => {
                  e.stopPropagation();
                  onAnalyzeTrack(card.id, track.trackId);
                }}
                className="flex-none cursor-pointer opacity-0 hover:text-accent group-hover:opacity-100"
              >
                <Wand2 size={11} />
              </span>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col px-11 pb-11 pt-[22px]">
      <div className="flex items-center gap-4 border-b border-border pb-[9px] text-[11px] uppercase tracking-wider text-subtext">
        <div className="w-[230px] flex-none" />
        <div className="w-[26px] flex-none" />
        <div className="w-[34px] flex-none" />
        {headers.map((header) => (
          <div
            key={header.id}
            draggable
            onDragStart={() => setDragCol(header.column.id as ListColumnId)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragCol) onColumnsChange(moveColumn(columnOrder, dragCol, header.column.id as ListColumnId), columnSizing);
              setDragCol(null);
            }}
            style={{ width: header.getSize() }}
            className="relative flex-none cursor-grab select-none pr-2 hover:text-text"
            title="Drag to reorder"
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
            <div
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
              onClick={(e) => e.stopPropagation()}
              className="absolute -right-2 top-1/2 h-4 w-2 -translate-y-1/2 cursor-col-resize select-none touch-none hover:bg-accent/40"
            />
          </div>
        ))}
      </div>
      {cards.map((c) => {
        const isSkeleton = c.status === "pending";
        // A label/wishlist release is known (art, title, artist) before its
        // tracklist is; a tab-grid card at least has the tab's own page title
        // captured at snapshot time — either is enough to stop shimmering.
        const metaKnown = !!(c.album || c.title);
        // Dead = tab closed. Independent of extraction status — a card can be
        // both still-pending AND dead (closed before it ever loaded), and it's
        // exactly those that most need a working "reopen" instead of being stuck.
        const isDead = tabBacked && c.tabId === null;
        const isUnplayable = c.status === "unplayable" || c.status === "error";
        const playable = c.status === "ready";
        const gotoDisabled = isSkeleton && !metaKnown && !isDead;
        const closeDisabled = isDead;
        const isCardPlaying = playingId === c.id;
        const expanded = expandedRows.has(c.id);
        const analyzeDisabled = !c.tracks.some((t) => t.streamUrl);
        const cardAnalyzing = c.tracks.some((t) => analyzing.has(t.trackId));

        return (
          <div
            key={c.id}
            data-playing={isCardPlaying}
            className="flex gap-4 border-b border-[#1e1d1c]"
            style={{ opacity: isDead ? 0.4 : isUnplayable ? 0.72 : 1 }}
          >
            <div className="flex w-[230px] flex-none gap-[13px] py-[14px]">
              <div
                onClick={() => playable && onPlay(c.id)}
                className="relative h-[52px] w-[52px] flex-none overflow-hidden bg-card"
                style={{ cursor: playable ? "pointer" : "default" }}
              >
                {isSkeleton && !c.artUrl && <div className="absolute inset-0 bg-card-skel animate-shimmer" />}
                {c.artUrl && (
                  <img
                    src={c.artUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ filter: isUnplayable ? "saturate(.3) brightness(.75)" : isDead ? "grayscale(1)" : "none" }}
                  />
                )}
                {isCardPlaying && (
                  <div title="now playing" className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                    {isAudioPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1 pt-[1px]">
                {isSkeleton && !metaKnown && isDead ? (
                  // Closed before the tab even had a title to capture — nothing
                  // is loading, so don't shimmer as if it were.
                  <div className="truncate text-xs text-[#5b5854]">Unknown release — tab closed</div>
                ) : isSkeleton && !metaKnown ? (
                  <div className="flex flex-col gap-[7px]">
                    <div className="h-[9px] w-[76%] animate-shimmer bg-card-skel" />
                    <div className="h-[9px] w-[54%] animate-shimmer bg-card-skel" />
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="truncate text-[13px] font-semibold" style={{ color: isDead ? "#7d7a76" : "#f0efed" }}>
                      {c.album || c.title}
                    </div>
                    <div className="truncate text-xs" style={{ color: isDead ? "#5b5854" : "#8d8a85" }}>
                      {c.artist}
                    </div>
                  </div>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-[14px] text-[13px] leading-none">
                  <span
                    title={isDead ? "Reopen tab" : tabBacked ? "Go to tab" : "Open on Bandcamp"}
                    onClick={() => !gotoDisabled && (isDead ? onReopen?.(c) : onGoto(c))}
                    style={{
                      color: gotoDisabled ? "#413f3c" : "#8d8a85",
                      cursor: gotoDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <ExternalLink size={13} />
                  </span>
                  <span
                    title={
                      analyzeDisabled
                        ? "No playable tracks to analyse"
                        : "Load waveforms + BPM for every track (doesn't play)"
                    }
                    onClick={() => !analyzeDisabled && onAnalyze(c.id)}
                    style={{
                      color: analyzeDisabled ? "#413f3c" : cardAnalyzing ? "#1da0c3" : "#8d8a85",
                      cursor: analyzeDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <Wand2 size={13} className={cardAnalyzing ? "animate-pulse" : undefined} />
                  </span>
                  <span
                    title="Listen to this artist's whole catalogue"
                    onClick={() => onListenToArtist(c)}
                    className="cursor-pointer text-[#8d8a85] hover:text-text"
                  >
                    <Library size={13} />
                  </span>
                  {tabBacked && (
                    <span
                      title="Close tab"
                      onClick={() => !closeDisabled && onClose?.(c)}
                      style={{
                        color: closeDisabled ? "#413f3c" : "#8d8a85",
                        cursor: closeDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <Trash2 size={13} />
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div
              className="relative flex flex-1 flex-col justify-center overflow-x-auto py-2"
              style={{ minHeight: META_HEIGHT }}
            >
              {isSkeleton && isDead ? (
                // Closed before it ever loaded — nothing is actively fetching,
                // so an animated shimmer here would be a lie. Static instead.
                <div className="py-[7px] text-xs text-[#5b5854]">Tab closed before this loaded — reopen to fetch its tracks</div>
              ) : isSkeleton ? (
                <div className="flex items-center gap-4 py-[7px]">
                  <div className="w-[26px] flex-none" />
                  <div className="w-[34px] flex-none" />
                  {headers.map((h) => (
                    <div key={h.id} className="h-[9px] flex-none animate-shimmer bg-card-skel" style={{ width: h.getSize() }} />
                  ))}
                </div>
              ) : (
                <>
                  <div style={expanded ? undefined : { maxHeight: COLLAPSED_HEIGHT, overflowY: "auto" }}>
                    {c.tracks.map((t, i) => {
                      const isCurrent = isCardPlaying && t.trackId === c.selectedTrackId;
                      // Dead (closed-tab) releases stay playable from cache — only fade the styling.
                      const disabled = !t.streamUrl;
                      return (
                        <div
                          key={t.trackId}
                          onClick={() => !disabled && onPlayTrack(c.id, t.trackId)}
                          className="group flex items-center gap-4 py-[7px] hover:bg-white/[0.035]"
                          style={{
                            background: isCurrent ? "rgba(29,160,195,.07)" : "transparent",
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                        >
                          <div className="w-[26px] flex-none text-right text-[11px]" style={{ color: isCurrent ? "#1da0c3" : "#8d8a85" }}>
                            {i + 1}
                          </div>
                          <div
                            className={`w-[34px] flex-none text-center text-accent ${
                              isCurrent ? "opacity-100" : disabled ? "opacity-0" : "opacity-0 group-hover:opacity-60"
                            }`}
                          >
                            {isCurrent && isAudioPlaying ? (
                              <Pause size={9} fill="currentColor" className="mx-auto" />
                            ) : (
                              <Play size={9} fill="currentColor" className="mx-auto" />
                            )}
                          </div>
                          {headers.map((h) => (
                            <div key={h.id} className="flex-none" style={{ width: h.getSize() }}>
                              {cellContent(h.column.id, c, t, isCurrent, isDead)}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {c.tracks.length * TRACK_ROW_HEIGHT > COLLAPSED_HEIGHT && (
                    <div
                      onClick={() => toggleRow(c.id)}
                      title={expanded ? "Collapse" : "Expand"}
                      className="absolute inset-x-0 bottom-0 flex h-9 cursor-pointer items-end justify-center text-subtext hover:text-text"
                      style={expanded ? undefined : { background: "linear-gradient(to bottom, transparent, #131313 90%)" }}
                    >
                      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
