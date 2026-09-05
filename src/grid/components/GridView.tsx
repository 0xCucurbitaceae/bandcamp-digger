import { Fragment, useEffect, useRef, useState } from "react";
import Card from "./Card";
import TrackList from "./TrackList";
import type { CardRecord } from "../../lib/types";

interface Props {
  cards: CardRecord[];
  minCardWidth: number;
  playingId: string | null;
  isAudioPlaying: boolean;
  overId: string | null;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onPlay: (id: string) => void;
  onPlayTrack: (cardId: string, trackId: string) => void;
  onGoto: (card: CardRecord) => void;
  onClose: (card: CardRecord) => void;
  onReopen: (card: CardRecord) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (id: string) => void;
}

/** Reads how many columns `repeat(auto-fill, minmax(...))` actually rendered, so the
 *  expanded-track panel can be placed right after the row that holds the expanded card. */
function useRenderedColumnCount(ref: React.RefObject<HTMLElement>) {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter((t) => t.endsWith("px"));
      if (tracks.length > 0) setCols(tracks.length);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

export default function GridView({
  cards,
  minCardWidth,
  playingId,
  isAudioPlaying,
  overId,
  expandedId,
  onToggleExpand,
  onPlay,
  onPlayTrack,
  onGoto,
  onClose,
  onReopen,
  onDragStart,
  onDragOver,
  onDrop,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useRenderedColumnCount(gridRef);

  const expandedIndex = expandedId ? cards.findIndex((c) => c.id === expandedId) : -1;
  const expandedCard = expandedIndex !== -1 ? cards[expandedIndex] : null;
  const rowEndIndex =
    expandedIndex !== -1
      ? Math.min(Math.floor(expandedIndex / Math.max(1, cols)) * cols + cols - 1, cards.length - 1)
      : -1;
  const isDeadCard = !!expandedCard && expandedCard.status !== "pending" && expandedCard.tabId === null;

  return (
    <div
      ref={gridRef}
      className="grid gap-x-[30px] gap-y-11 px-11 py-11"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))` }}
    >
      {cards.map((c, i) => (
        <Fragment key={c.id}>
          <Card
            card={c}
            isPlaying={playingId === c.id}
            isAudioPlaying={isAudioPlaying}
            isOver={overId === c.id}
            onToggleExpand={() => onToggleExpand(c.id)}
            onPlay={() => onPlay(c.id)}
            onGoto={() => onGoto(c)}
            onClose={() => onClose(c)}
            onReopen={() => onReopen(c)}
            onDragStart={() => onDragStart(c.id)}
            onDragOver={(e) => {
              e.preventDefault();
              onDragOver(c.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop(c.id);
            }}
          />

          {i === rowEndIndex && expandedCard && (
            <div
              style={{ gridColumn: "1 / -1" }}
              className="-mt-2 mb-1 flex flex-col border-t border-border pb-1.5 pt-[18px]"
            >
              <div className="flex items-baseline gap-[10px] pb-[9px]">
                <div className="text-xs font-semibold text-text">{expandedCard.album}</div>
                <div className="text-[11px] text-subtext">{expandedCard.artist}</div>
                <div className="flex-1" />
                <div
                  onClick={() => onToggleExpand(expandedCard.id)}
                  className="cursor-pointer select-none text-[11px] text-subtext hover:text-text"
                >
                  close ✕
                </div>
              </div>
              <div
                className="grid items-center gap-[14px] border-b border-[#1e1d1c] pb-[7px] text-[11px] uppercase tracking-wider text-subtext"
                style={{ gridTemplateColumns: "22px 16px 1fr" }}
              >
                <div className="text-right">#</div>
                <div />
                <div>Title</div>
              </div>
              <TrackList
                tracks={expandedCard.tracks}
                selectedTrackId={expandedCard.selectedTrackId}
                isCardPlaying={playingId === expandedCard.id}
                isAudioPlaying={isAudioPlaying}
                dead={isDeadCard}
                onPlayTrack={(trackId) => onPlayTrack(expandedCard.id, trackId)}
              />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
