/**
 * What's loaded in the player right now, published by whichever surface (tab
 * grid or collection page) owns the <audio> element, so the toolbar popup can
 * render a mini player without owning any audio of its own.
 *
 * Lives in `storage.session` rather than `storage.local`: it changes on every
 * play/pause and is meaningless across a browser restart — no reason to write
 * it to disk next to the cards.
 */

export interface NowPlaying {
  /** identifies the page that owns playback, so a command from the popup is
   *  obeyed by exactly one surface even when a grid and a collection page are
   *  both open with a track loaded */
  surfaceId: string;
  /** that page's own URL — "open page" focuses it */
  pageUrl: string;
  /** the bandcamp release URL — "open tab" focuses (or opens) it */
  releaseUrl: string;
  track: string | null;
  artist: string | null;
  album: string | null;
  artUrl: string | null;
  isPlaying: boolean;
  /** length of the loaded track, 0 until the <audio> element reports it */
  dur: number;
  /** decoded waveform for the loaded track, once analysis has run — see waveform.ts */
  peaks: number[] | null;
  bpm: number | null;
}

export type PlayerCommand = "toggle" | "prev" | "next" | "seek";

/** Playhead position isn't part of `NowPlaying`: it moves several times a
 *  second, and republishing the whole record (peaks included) that often would
 *  churn for nothing. The popup asks the owning surface for it directly
 *  instead, so nothing is spent while no popup is open. */
export async function fetchPosition(surfaceId: string): Promise<number | null> {
  const res = await chrome.runtime
    .sendMessage({ type: "playerPosition", surfaceId })
    .catch(() => null);
  return typeof res?.pos === "number" ? res.pos : null;
}

const KEY = "nowPlaying";

export async function getNowPlaying(): Promise<NowPlaying | null> {
  const { [KEY]: np } = await chrome.storage.session.get(KEY);
  return (np as NowPlaying | undefined) ?? null;
}

export async function setNowPlaying(np: NowPlaying): Promise<void> {
  await chrome.storage.session.set({ [KEY]: np });
}

/** Best-effort clear when the owning page goes away — no-op if another surface
 *  has since taken over playback. */
export async function clearNowPlaying(surfaceId: string): Promise<void> {
  const np = await getNowPlaying();
  if (np?.surfaceId === surfaceId) await chrome.storage.session.remove(KEY);
}

export function onNowPlayingChange(cb: (np: NowPlaying | null) => void) {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "session" || !changes[KEY]) return;
    cb((changes[KEY].newValue as NowPlaying | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
