import { useEffect, useState } from "react";
import { ExternalLink, LayoutGrid, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import Scrobbler from "../grid/components/Scrobbler";
import { fmt } from "../grid/components/PlayerBar";
import { fetchPosition, getNowPlaying, onNowPlayingChange } from "../lib/nowPlaying";
import type { NowPlaying, PlayerCommand } from "../lib/nowPlaying";

const GRID_URL = chrome.runtime.getURL("src/grid/index.html");
const POLL_MS = 250;

const focusTab = (url: string) => chrome.runtime.sendMessage({ type: "focusTab", url });

/**
 * Mini player in the toolbar popup. Owns no audio of its own: it mirrors
 * whatever the grid/collection page published as `nowPlaying` and sends
 * transport commands back to that page (see usePlayer's popup mirror).
 *
 * The popup is only reachable at all while a merger page is open — with none
 * open the background clears the popup so the toolbar click opens the page
 * instead.
 */
export default function App() {
  const [np, setNp] = useState<NowPlaying | null>(null);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    getNowPlaying().then(setNp);
    return onNowPlayingChange(setNp);
  }, []);

  // The playhead is polled off the owning page rather than published — see
  // fetchPosition. Only runs while the popup is actually open.
  const surfaceId = np?.surfaceId;
  useEffect(() => {
    if (!surfaceId) return;
    let live = true;
    const tick = async () => {
      const p = await fetchPosition(surfaceId);
      if (live && p !== null) setPos(p);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [surfaceId]);

  // No page replies to a command, so the message port just closes — swallow the
  // resulting rejection rather than logging it on every button press.
  const send = (msg: Record<string, unknown>) =>
    chrome.runtime.sendMessage({ ...msg, surfaceId }).catch(() => {});

  const command = (action: PlayerCommand) => {
    if (!np) return;
    send({ type: "playerCommand", action });
    // The owning page republishes `nowPlaying`, so button state follows on its
    // own — except play/pause, which is worth reflecting instantly.
    if (action === "toggle") setNp({ ...np, isPlaying: !np.isPlaying });
  };

  const dur = np?.dur ?? 0;
  const progress = dur > 0 ? Math.min(1, pos / dur) : 0;

  /** Moves the bar immediately — `pos` only catches up on the next poll. */
  const seek = (fraction: number) => {
    if (!np || dur <= 0) return;
    setPos(fraction * dur);
    send({ type: "playerCommand", action: "seek", fraction });
  };

  return (
    <div className="w-[300px] bg-bg p-3 font-sans text-text">
      <div className="flex items-center gap-3">
        <div className="h-[46px] w-[46px] flex-none overflow-hidden bg-card">
          {np?.artUrl && <img src={np.artUrl} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="truncate text-xs font-semibold">{np?.track || "Nothing playing"}</div>
          <div className="truncate text-[11px] text-subtext">{np?.artist || "—"}</div>
          <div className="truncate text-[11px] text-faint">{np?.album || ""}</div>
        </div>
      </div>

      <div className="mt-3">
        <Scrobbler
          peaks={np?.peaks ?? null}
          progress={progress}
          hasRealProgress={dur > 0}
          disabled={!np || dur <= 0}
          onScrub={seek}
          className="h-[30px] w-full"
        />
        <div className="mt-1 flex items-baseline gap-[6px] text-[11px] text-subtext">
          <span>{fmt(pos)}</span>
          <span className="opacity-45">/</span>
          <span>{fmt(dur)}</span>
          <div className="flex-1" />
          {np?.bpm ? <span className="text-faint">{Math.round(np.bpm)} BPM</span> : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-6 border-t border-border pt-3">
        <span
          onClick={() => command("prev")}
          title="Previous"
          className="cursor-pointer text-subtext hover:text-text"
        >
          <SkipBack size={16} />
        </span>
        <span
          onClick={() => command("toggle")}
          title="Play / pause"
          className="cursor-pointer text-text hover:text-accent"
        >
          {np?.isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </span>
        <span
          onClick={() => command("next")}
          title="Next"
          className="cursor-pointer text-subtext hover:text-text"
        >
          <SkipForward size={16} />
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px]">
        <span
          onClick={() => np && focusTab(np.releaseUrl)}
          title="Open this release on Bandcamp"
          className={`flex select-none items-center gap-[6px] ${
            np ? "cursor-pointer text-subtext hover:text-text" : "text-faint"
          }`}
        >
          <ExternalLink size={12} />
          <span>Bandcamp tab</span>
        </span>
        <span
          onClick={() => focusTab(np?.pageUrl || GRID_URL)}
          title="Open the merged page"
          className="flex cursor-pointer select-none items-center gap-[6px] text-accent hover:text-accent-hover"
        >
          <LayoutGrid size={12} />
          <span>Merged page</span>
        </span>
      </div>
    </div>
  );
}
