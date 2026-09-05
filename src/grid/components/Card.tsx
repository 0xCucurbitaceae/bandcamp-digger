import { AlertTriangle, ExternalLink, Pause, Play, Trash2 } from "lucide-react";
import type { CardRecord } from "../../lib/types";

interface Props {
  card: CardRecord;
  isPlaying: boolean;
  isAudioPlaying: boolean;
  isOver: boolean;
  onToggleExpand: () => void;
  onPlay: () => void;
  onGoto: () => void;
  onClose: () => void;
  onReopen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export default function Card({
  card,
  isPlaying,
  isAudioPlaying,
  isOver,
  onToggleExpand,
  onPlay,
  onGoto,
  onClose,
  onReopen,
  onDragStart,
  onDragOver,
  onDrop,
}: Props) {
  const isSkeleton = card.status === "pending";
  const isDead = !isSkeleton && card.tabId === null;
  const isUnplayable = card.status === "unplayable" || card.status === "error";
  const playable = card.status === "ready";
  const gotoDisabled = isSkeleton;
  const closeDisabled = isSkeleton || isDead;
  const hasMultipleTracks = card.tracks.length > 1;

  return (
    <div
      data-playing={isPlaying}
      draggable={!isSkeleton}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex flex-col gap-[11px] transition-opacity"
      style={{ opacity: isDead ? 0.38 : isUnplayable ? 0.72 : 1 }}
    >
      <div
        className="relative aspect-square overflow-hidden bg-card"
        style={{ outline: isPlaying ? "1px solid #1da0c3" : isOver ? "1px solid #4d4b47" : "none" }}
      >
        {isSkeleton && <div className="absolute inset-0 bg-card-skel animate-shimmer" />}

        {!isSkeleton && card.artUrl && (
          <img
            src={card.artUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: isUnplayable ? "saturate(.3) brightness(.75)" : isDead ? "grayscale(1)" : "none" }}
          />
        )}
        {!isSkeleton && !card.artUrl && <div className="absolute inset-0 bg-card" />}

        {playable && (
          <div
            onClick={() => (hasMultipleTracks ? onToggleExpand() : onPlay())}
            title={hasMultipleTracks ? "Show tracks" : "Play"}
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/30 opacity-0 transition-opacity hover:opacity-100"
            style={isPlaying ? { opacity: 1 } : undefined}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
              title="Play"
              className="flex h-[46px] w-[46px] items-center justify-center"
            >
              {isPlaying && isAudioPlaying ? (
                <Pause size={26} className="text-white drop-shadow" fill="currentColor" />
              ) : (
                <Play size={26} className="text-white drop-shadow" fill="currentColor" />
              )}
            </div>
          </div>
        )}

        {isPlaying && <div title="now playing" className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" />}

        {isUnplayable && <AlertTriangle size={13} className="absolute bottom-[9px] left-[10px] text-warn drop-shadow" />}

        {!isSkeleton && (
          <div
            title="Drag to reorder"
            className="absolute right-2 top-1.5 cursor-grab select-none text-[13px] text-white/45 hover:text-white"
          >
            ⠿
          </div>
        )}
      </div>

      {isSkeleton ? (
        <div className="flex flex-col gap-[7px]">
          <div className="h-[9px] w-[58%] animate-shimmer bg-card-skel" />
          <div className="h-[9px] w-[80%] animate-shimmer bg-card-skel" />
        </div>
      ) : (
        <div className="flex flex-col gap-[3px]">
          <div className="flex min-w-0 items-center gap-[7px]">
            {isPlaying && isAudioPlaying && (
              <div className="flex h-3 flex-none items-end gap-[2px]">
                <div className="w-[2px] animate-eq1 bg-accent" />
                <div className="w-[2px] animate-eq2 bg-accent" />
                <div className="w-[2px] animate-eq3 bg-accent" />
              </div>
            )}
            <div className="truncate text-[13px] font-semibold" style={{ color: isDead ? "#7d7a76" : "#f0efed" }}>
              {card.album || card.title || "Untitled"}
            </div>
          </div>
          <div className="truncate text-xs" style={{ color: isDead ? "#67645f" : "#8d8a85" }}>
            {card.artist || ""}
          </div>
          <div className="truncate text-[11px]" style={{ color: isPlaying ? "#1da0c3" : isDead ? "#5b5854" : "#6d6a66" }}>
            {card.track || ""}
          </div>
        </div>
      )}

      <div className="flex items-center gap-[15px]">
        <span
          title={isDead ? "Reopen tab" : "Go to tab"}
          onClick={() => !gotoDisabled && (isDead ? onReopen() : onGoto())}
          style={{
            color: gotoDisabled ? "#413f3c" : "#8d8a85",
            cursor: gotoDisabled ? "not-allowed" : "pointer",
          }}
        >
          <ExternalLink size={14} />
        </span>
        <span
          title="Close tab"
          onClick={() => !closeDisabled && onClose()}
          style={{
            color: closeDisabled ? "#413f3c" : "#8d8a85",
            cursor: closeDisabled ? "not-allowed" : "pointer",
          }}
        >
          <Trash2 size={14} />
        </span>
      </div>
    </div>
  );
}
