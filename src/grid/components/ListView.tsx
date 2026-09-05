import { useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Pause, Play, Trash2 } from "lucide-react";
import type { CardRecord, ListColumnId, TrackRecord } from "../../lib/types";
import Scrobbler from "./Scrobbler";

const COLLAPSED_HEIGHT = 160; // ~5 track rows
const TRACK_ROW_HEIGHT = 30; // approx height of one track row (py-[7px]*2 + line height)
const META_HEIGHT = 80; // left column's height (52px thumbnail + 14px top/bottom padding)
const NO_ROWS: object[] = [];

const COLUMN_DEFS: ColumnDef<object>[] = [
  { id: "title", header: "Title", minSize: 200 },
  { id: "artist", header: "Artist", minSize: 90 },
  { id: "album", header: "Album", minSize: 90 },
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
  columnOrder: ListColumnId[];
  columnSizing: Partial<Record<ListColumnId, number>>;
  onColumnsChange: (order: ListColumnId[], sizing: Partial<Record<ListColumnId, number>>) => void;
  onPlay: (id: string) => void;
  onPlayTrack: (cardId: string, trackId: string) => void;
  onScrub: (cardId: string, trackId: string, fraction: number) => void;
  onGoto: (card: CardRecord) => void;
  onClose: (card: CardRecord) => void;
  onReopen: (card: CardRecord) => void;
}

export default function ListView({
  cards,
  playingId,
  isAudioPlaying,
  pos,
  dur,
  waveforms,
  bpms,
  columnOrder,
  columnSizing,
  onColumnsChange,
  onPlay,
  onPlayTrack,
  onScrub,
  onGoto,
  onClose,
  onReopen,
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
      case "bpm": {
        // Only ever computed for whichever track is actually loaded — blank for
        // everything else until you play it (lazy, no upfront analysis pass).
        const bpm = bpms[track.trackId];
        const analyzing = isCurrent && bpm === undefined;
        return (
          <div className="truncate text-xs" style={{ color: isDead ? "#5b5854" : "#8d8a85" }}>
            {analyzing ? "…" : bpm == null ? "" : bpm}
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
        const isDead = !isSkeleton && c.tabId === null;
        const isUnplayable = c.status === "unplayable" || c.status === "error";
        const playable = c.status === "ready";
        const gotoDisabled = isSkeleton;
        const closeDisabled = isSkeleton || isDead;
        const isCardPlaying = playingId === c.id;
        const expanded = expandedRows.has(c.id);

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
                {isSkeleton && <div className="absolute inset-0 bg-card-skel animate-shimmer" />}
                {!isSkeleton && c.artUrl && (
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
                {isSkeleton ? (
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
                    title={isDead ? "Reopen tab" : "Go to tab"}
                    onClick={() => !gotoDisabled && (isDead ? onReopen(c) : onGoto(c))}
                    style={{
                      color: gotoDisabled ? "#413f3c" : "#8d8a85",
                      cursor: gotoDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <ExternalLink size={13} />
                  </span>
                  <span
                    title="Close tab"
                    onClick={() => !closeDisabled && onClose(c)}
                    style={{
                      color: closeDisabled ? "#413f3c" : "#8d8a85",
                      cursor: closeDisabled ? "not-allowed" : "pointer",
                    }}
                  >
                    <Trash2 size={13} />
                  </span>
                </div>
              </div>
            </div>

            <div
              className="relative flex flex-1 flex-col justify-center overflow-x-auto py-2"
              style={{ minHeight: META_HEIGHT }}
            >
              {isSkeleton ? (
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
                          className="flex items-center gap-4 py-[7px] hover:bg-white/[0.035]"
                          style={{
                            background: isCurrent ? "rgba(29,160,195,.07)" : "transparent",
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                        >
                          <div className="w-[26px] flex-none text-right text-[11px]" style={{ color: isCurrent ? "#1da0c3" : "#5b5854" }}>
                            {i + 1}
                          </div>
                          <div className="w-[34px] flex-none text-center text-accent" style={{ opacity: isCurrent ? 1 : 0 }}>
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
