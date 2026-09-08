import { Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import type { CardRecord } from "../../lib/types";

interface Props {
  audioRef: React.RefObject<HTMLAudioElement>;
  current: CardRecord | null;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  pos: number;
  dur: number;
  volume: number;
  onSeek: (fraction: number) => void;
  onVolumeChange: (fraction: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
  onTimeUpdate: (t: number) => void;
  onDurationChange: (d: number) => void;
  onError: () => void;
  onGoto: () => void;
  onScrollToPlaying: () => void;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? "0" + r : r}`;
}

export default function PlayerBar({
  audioRef,
  current,
  isPlaying,
  setIsPlaying,
  pos,
  dur,
  volume,
  onSeek,
  onVolumeChange,
  onPrev,
  onNext,
  onEnded,
  onTimeUpdate,
  onDurationChange,
  onError,
  onGoto,
  onScrollToPlaying,
}: Props) {
  const pct = dur > 0 ? Math.round((pos / dur) * 1000) / 10 : 0;

  return (
    <div className="group fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg">
      <audio
        ref={audioRef}
        // start buffering the moment a stream URL is set, before the play() call lands
        preload="auto"
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onDurationChange={(e) => onDurationChange(e.currentTarget.duration || 0)}
        onEnded={onEnded}
        onError={onError}
      />
      <div
        onClick={(e) => {
          if (!dur) return;
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        }}
        className="relative h-[2px] cursor-pointer bg-border transition-all group-hover:h-[6px]"
      >
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center gap-[26px] px-11 py-4">
        <div className="flex flex-none items-center gap-4">
          <span onClick={onPrev} title="Previous" className="cursor-pointer text-subtext hover:text-text">
            <SkipBack size={16} />
          </span>
          <div
            onClick={() => setIsPlaying(!isPlaying)}
            title="Play / pause"
            className="flex min-w-[22px] cursor-pointer items-center justify-center text-text hover:text-accent"
          >
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </div>
          <span onClick={onNext} title="Next" className="cursor-pointer text-subtext hover:text-text">
            <SkipForward size={16} />
          </span>
        </div>

        <div className="h-[26px] w-px flex-none bg-border" />

        <div
          onClick={onScrollToPlaying}
          title="Scroll to the playing item"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
        >
          <div className="h-[38px] w-[38px] flex-none overflow-hidden bg-card">
            {current?.artUrl && <img src={current.artUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="flex min-w-0 flex-col gap-[2px]">
            <div className="truncate text-xs font-semibold">{current?.track || "Nothing playing"}</div>
            <div className="truncate text-[11px] text-subtext">
              {current ? `${current.artist ?? ""} — ${current.album ?? ""}` : "—"}
            </div>
          </div>
        </div>

        <div className="flex flex-none items-center gap-[7px] text-[11px] text-subtext">
          <span>{fmt(pos)}</span>
          <span className="opacity-45">/</span>
          <span>{fmt(dur)}</span>
        </div>

        <div className="flex w-[118px] flex-none items-center gap-[9px]">
          <Volume2 size={14} className="text-faint" />
          <div
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onVolumeChange((e.clientX - r.left) / r.width);
            }}
            className="relative h-[2px] flex-1 cursor-pointer bg-[#2f2e2c]"
          >
            <div className="absolute inset-y-0 left-0 bg-subtext" style={{ width: `${volume * 100}%` }} />
          </div>
        </div>

        <div
          onClick={onGoto}
          className="flex-none cursor-pointer select-none whitespace-nowrap text-[11px] text-subtext hover:text-text"
        >
          go to tab ↗
        </div>
      </div>
    </div>
  );
}
