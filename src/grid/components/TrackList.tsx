import { AlertTriangle, Pause, Play } from "lucide-react";
import type { TrackRecord } from "../../lib/types";

interface Props {
  tracks: TrackRecord[];
  selectedTrackId: string | null;
  /** true when this card is the one currently loaded in the player */
  isCardPlaying: boolean;
  isAudioPlaying: boolean;
  dead: boolean;
  onPlayTrack: (trackId: string) => void;
}

export default function TrackList({ tracks, selectedTrackId, isCardPlaying, isAudioPlaying, dead, onPlayTrack }: Props) {
  return (
    <div className="flex flex-col">
      {tracks.map((t, i) => {
        const isCurrent = isCardPlaying && t.trackId === selectedTrackId;
        // Dead (closed-tab) cards stay playable from cache — only a genuinely
        // unstreamable track is actually disabled. `dead` only fades the styling.
        const disabled = !t.streamUrl;
        return (
          <div
            key={t.trackId}
            onClick={() => !disabled && onPlayTrack(t.trackId)}
            className="grid grid-cols-[22px_16px_1fr] items-center gap-[10px] border-b border-[#1e1d1c] py-[7px] last:border-b-0"
            style={{
              background: isCurrent ? "rgba(29,160,195,.07)" : "transparent",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <div className="text-right text-[11px]" style={{ color: isCurrent ? "#1da0c3" : "#5b5854" }}>
              {i + 1}
            </div>
            <div className="text-accent" style={{ opacity: isCurrent ? 1 : 0 }}>
              {isCurrent && isAudioPlaying ? <Pause size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {!t.streamUrl && <AlertTriangle size={11} className="flex-none text-warn" />}
              <div
                className="truncate text-[13px]"
                style={{ color: isCurrent ? "#1da0c3" : dead ? "#5b5854" : "#a9a6a1" }}
              >
                {t.title}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
