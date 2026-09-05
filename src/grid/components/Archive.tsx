import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { CardRecord } from "../../lib/types";

interface Props {
  cards: CardRecord[];
  open: boolean;
  onToggleOpen: () => void;
  onReopen: (card: CardRecord) => void;
  onRemove: (id: string) => void;
}

export default function Archive({ cards, open, onToggleOpen, onReopen, onRemove }: Props) {
  if (cards.length === 0) return null;

  return (
    <div className="mx-11 mb-11 flex flex-col border-t border-border pt-5">
      <div
        onClick={onToggleOpen}
        className="flex cursor-pointer select-none items-baseline gap-[9px] text-subtext hover:text-text"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <div className="text-[11px] uppercase tracking-wider">Archive</div>
        <div className="text-[11px]">{cards.length === 1 ? "1 closed tab" : `${cards.length} closed tabs`}</div>
      </div>

      {open && (
        <div className="mt-3.5 flex flex-col">
          {cards.map((c) => (
            <div
              key={c.id}
              className="grid items-center gap-4 border-b border-[#1e1d1c] py-[9px]"
              style={{ gridTemplateColumns: "34px 1.4fr 1fr 1fr 116px" }}
            >
              <div className="relative h-[34px] w-[34px] overflow-hidden bg-card">
                {c.artUrl && <img src={c.artUrl} alt="" className="h-full w-full object-cover grayscale" />}
              </div>
              <div className="truncate text-[13px] text-[#7d7a76]">{c.album || c.title}</div>
              <div className="truncate text-xs text-[#5b5854]">{c.artist}</div>
              <div className="truncate text-xs text-[#5b5854]">{c.track}</div>
              <div className="flex items-center justify-end gap-4 text-[11px]">
                <span
                  onClick={() => onReopen(c)}
                  className="cursor-pointer select-none text-subtext hover:text-text"
                >
                  reopen tab
                </span>
                <span
                  title="Remove from archive"
                  onClick={() => onRemove(c.id)}
                  className="cursor-pointer select-none text-subtext hover:text-danger"
                >
                  <Trash2 size={12} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
