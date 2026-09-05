import { Coffee, LayoutGrid, List, RefreshCw, Settings as SettingsIcon, Sparkles, Zap } from "lucide-react";
import { useGrid } from "./hooks/useGrid";
import Archive from "./components/Archive";
import GridView from "./components/GridView";
import ListView from "./components/ListView";
import PlayerBar from "./components/PlayerBar";
import SettingsDrawer from "./components/SettingsDrawer";
import Toast from "./components/Toast";

const MIN_CARD_WIDTH = 196; // ponytail: fixed, add a settings control if users ever ask for it

export default function App() {
  const g = useGrid();

  const deadCount = g.cards.filter((c) => c.status !== "pending" && c.tabId === null).length;
  const liveCount = g.cards.length - deadCount;

  return (
    <div className="min-h-screen bg-bg pb-[92px] font-sans text-text">
      <div className="flex items-baseline gap-[18px] px-11 pb-5 pt-11">
        <div className="text-[15px] font-semibold tracking-wide">Bandcamp Tab Merger</div>
        <div className="text-xs text-subtext">
          {liveCount} tabs{deadCount ? ` · ${deadCount} closed` : ""}
        </div>
        <div className="flex-1" />

        <div
          onClick={g.togglePlaybackMode}
          title="Switch between playing one track per release and the full album"
          className="flex cursor-pointer select-none items-center gap-[6px] text-xs text-subtext hover:text-text"
        >
          {g.playbackMode === "single" ? <Zap size={13} /> : <Coffee size={13} />}
          <span>{g.playbackMode === "single" ? "One track" : "Full album"}</span>
        </div>

        <div className="h-3.5 w-px bg-border" />

        <div className="flex items-center gap-3 text-[13px] leading-none">
          <LayoutGrid
            size={14}
            onClick={() => g.setView("grid")}
            className="cursor-pointer"
            style={{ color: g.view === "grid" ? "#f0efed" : "#8d8a85" }}
          />
          <List
            size={14}
            onClick={() => g.setView("list")}
            className="cursor-pointer"
            style={{ color: g.view === "list" ? "#f0efed" : "#8d8a85" }}
          />
        </div>

        <div className="h-3.5 w-px bg-border" />

        <div className="text-[11px] text-faint">{g.syncing ? "syncing…" : "synced"}</div>
        {deadCount > 0 && (
          <div
            onClick={g.archiveDead}
            title="Move every closed-tab card into the Archive"
            className="flex cursor-pointer select-none items-baseline gap-[7px] border-b border-subtext/40 pb-0.5 text-xs text-subtext hover:border-text/40 hover:text-text"
          >
            <Sparkles size={12} />
            <span>Clean</span>
          </div>
        )}
        <div
          onClick={g.requestSync}
          className="flex cursor-pointer select-none items-baseline gap-[7px] border-b border-accent/40 pb-0.5 text-xs text-accent hover:border-accent-hover hover:text-accent-hover"
        >
          <RefreshCw size={12} className={g.syncing ? "animate-spin" : ""} />
          <span>Sync</span>
        </div>
        <span
          title="Settings"
          onClick={() => g.setSettingsOpen(true)}
          className="cursor-pointer text-subtext hover:text-text"
        >
          <SettingsIcon size={14} />
        </span>
      </div>

      <div className="mx-11 h-px bg-border" />

      {g.cards.length === 0 ? (
        <div className="px-11 py-16 text-sm text-subtext">
          No Bandcamp tabs found yet. Open some releases, then hit Sync.
        </div>
      ) : g.view === "list" ? (
        <ListView
          cards={g.cards}
          playingId={g.playingId}
          isAudioPlaying={g.isPlaying}
          pos={g.pos}
          dur={g.dur}
          waveforms={g.waveforms}
          columnOrder={g.listColumnOrder}
          columnSizing={g.listColumnSizing}
          onColumnsChange={g.setListColumns}
          onPlay={(id) => g.play(id)}
          onPlayTrack={(id, trackId) => g.play(id, trackId)}
          onScrub={g.scrubTrack}
          onGoto={g.goto}
          onClose={g.closeTab}
          onReopen={g.reopenTab}
        />
      ) : (
        <GridView
          cards={g.cards}
          minCardWidth={MIN_CARD_WIDTH}
          playingId={g.playingId}
          isAudioPlaying={g.isPlaying}
          overId={g.overId}
          expandedId={g.expandedId}
          onToggleExpand={g.toggleExpand}
          onPlay={(id) => g.play(id)}
          onPlayTrack={(id, trackId) => g.play(id, trackId)}
          onGoto={g.goto}
          onClose={g.closeTab}
          onReopen={g.reopenTab}
          onDragStart={g.setDragId}
          onDragOver={(id) => g.overId !== id && g.setOverId(id)}
          onDrop={g.reorder}
        />
      )}

      <Archive
        cards={g.archivedCards}
        open={g.archiveOpen}
        onToggleOpen={g.toggleArchiveOpen}
        onReopen={g.reopenTab}
        onRemove={g.removeArchived}
      />

      <PlayerBar
        audioRef={g.audioRef}
        current={g.current}
        isPlaying={g.isPlaying}
        setIsPlaying={g.setIsPlaying}
        pos={g.pos}
        dur={g.dur}
        volume={g.volume}
        onSeek={g.seek}
        onVolumeChange={g.setVolumeFraction}
        onPrev={() => g.step(-1)}
        onNext={() => g.step(1)}
        onEnded={g.handleEnded}
        onTimeUpdate={g.handleTimeUpdate}
        onDurationChange={g.handleDurationChange}
        onGoto={() => g.current && g.goto(g.current)}
        onScrollToPlaying={g.scrollToPlaying}
      />

      <Toast message={g.toast} />

      <SettingsDrawer open={g.settingsOpen} onClose={() => g.setSettingsOpen(false)} />
    </div>
  );
}
