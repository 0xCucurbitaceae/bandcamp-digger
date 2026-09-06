import { Coffee, ExternalLink, Zap } from "lucide-react";
import ListView from "../grid/components/ListView";
import Toast from "../grid/components/Toast";
import PlayerBar from "../grid/components/PlayerBar";
import { useLabel } from "./hooks/useLabel";

export default function App() {
  const l = useLabel();
  const total = l.cards.length;
  const status =
    l.loadedCount < total ? `${l.loadedCount} / ${total} releases loaded` : `${total} releases`;

  return (
    <div className="min-h-screen bg-bg pb-[92px] font-sans text-text">
      <div className="flex items-baseline gap-[18px] px-11 pb-5 pt-11">
        <div className="text-[15px] font-semibold tracking-wide">{l.collection?.name || l.labelId}</div>
        <div className="text-xs text-subtext">{status}</div>
        <div className="flex-1" />

        <div
          onClick={l.togglePlaybackMode}
          title="Switch between playing one track per release and the full album"
          className="flex cursor-pointer select-none items-center gap-[6px] text-xs text-subtext hover:text-text"
        >
          {l.playbackMode === "single" ? <Zap size={13} /> : <Coffee size={13} />}
          <span>{l.playbackMode === "single" ? "One track" : "Full album"}</span>
        </div>

        <div className="h-3.5 w-px bg-border" />

        <a
          href={l.collection?.url}
          target="_blank"
          rel="noreferrer"
          className="flex select-none items-baseline gap-[7px] text-xs text-subtext no-underline hover:text-text"
        >
          <ExternalLink size={12} />
          <span>Bandcamp</span>
        </a>
      </div>

      <div className="mx-11 h-px bg-border" />

      {!l.loaded ? null : total === 0 ? (
        <div className="px-11 py-16 text-sm text-subtext">
          Nothing here — open a Bandcamp label or artist page and hit “Listen to all”.
        </div>
      ) : (
        <ListView
          cards={l.cards}
          tabBacked={false}
          playingId={l.playingId}
          isAudioPlaying={l.isPlaying}
          pos={l.pos}
          dur={l.dur}
          waveforms={l.waveforms}
          bpms={l.bpms}
          columnOrder={l.listColumnOrder}
          columnSizing={l.listColumnSizing}
          onColumnsChange={l.setListColumns}
          onPlay={(id) => l.play(id)}
          onPlayTrack={(id, trackId) => l.play(id, trackId)}
          onScrub={l.scrubTrack}
          onGoto={l.openRelease}
        />
      )}

      <PlayerBar
        audioRef={l.audioRef}
        current={l.current}
        isPlaying={l.isPlaying}
        setIsPlaying={l.setIsPlaying}
        pos={l.pos}
        dur={l.dur}
        volume={l.volume}
        onSeek={l.seek}
        onVolumeChange={l.setVolumeFraction}
        onPrev={() => l.step(-1)}
        onNext={() => l.step(1)}
        onEnded={l.handleEnded}
        onTimeUpdate={l.handleTimeUpdate}
        onDurationChange={l.handleDurationChange}
        onError={l.handleAudioError}
        onGoto={() => l.current && l.openRelease(l.current)}
        onScrollToPlaying={l.scrollToPlaying}
      />

      <Toast message={l.toast} />
    </div>
  );
}
