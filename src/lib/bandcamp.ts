// Extraction contract lives in BANDCAMP.md at repo root — read that before
// touching this file. Two traps: (1) a non-browser fetch gets a stripped
// page with no data-tralbum, (2) data-audiourl on the stripped page belongs
// to <li class="recommended-album"> footer items, never the release itself.

export interface TralbumTrack {
  trackId: string;
  title: string;
  streamUrl: string | null;
}

export interface TralbumData {
  artist: string;
  album: string;
  /** the track bandcamp's own page loads by default — not always trackinfo[0].
   *  null when NOTHING on the release is publicly streamable (still has `tracks`
   *  for display — e.g. a purchase-only single still shows its track, disabled). */
  defaultTrack: TralbumTrack | null;
  tracks: TralbumTrack[];
  artUrl: string | null;
}

interface RawTrackInfo {
  track_id?: number | string;
  title?: string;
  file?: { "mp3-128"?: string };
}

interface RawTralbum {
  artist?: string;
  art_id?: number | string;
  current?: {
    title?: string;
    track_id?: number | string;
    art_id?: number | string;
    file?: { "mp3-128"?: string };
  };
  trackinfo?: RawTrackInfo[];
}

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};

export function decodeEntities(s: string): string {
  return s.replace(/&quot;|&#39;|&amp;|&lt;|&gt;/g, (m) => ENTITIES[m]);
}

function artUrlFromId(artId: number | string | undefined): string | null {
  if (artId === undefined || artId === null) return null;
  return `https://f4.bcbits.com/img/a${artId}_10.jpg`;
}

/**
 * Parses an already-JSON-parsed data-tralbum blob into what a card needs.
 * Keeps every track, even ones bandcamp doesn't offer a public stream for
 * (streamUrl: null) — the UI flags those rather than hiding them, so the
 * tracklist a release shows matches what bandcamp's own page shows.
 */
export function parseTralbum(blob: RawTralbum): TralbumData | null {
  const rawTracks = blob.trackinfo ?? [];
  let tracks: TralbumTrack[] = rawTracks
    .filter((t) => t.track_id !== undefined && t.track_id !== null)
    .map((t) => ({
      trackId: String(t.track_id),
      title: t.title ?? "",
      streamUrl: t.file?.["mp3-128"] ?? null,
    }));

  // A standalone /track/ page's `trackinfo` is sometimes empty (or missing this
  // track) — the track's own data lives in `current` instead. Fold it in so a
  // solo track never ends up with an empty tracklist.
  const current = blob.current;
  const currentTrack: TralbumTrack | null =
    current?.track_id !== undefined && current?.track_id !== null
      ? {
          trackId: String(current.track_id),
          title: current.title ?? "",
          streamUrl: current.file?.["mp3-128"] ?? null,
        }
      : null;
  if (currentTrack && !tracks.some((t) => t.trackId === currentTrack.trackId)) {
    tracks = [currentTrack, ...tracks];
  }

  if (tracks.length === 0) return null; // genuine extraction failure — no track data at all

  const playable = tracks.filter((t) => t.streamUrl);
  // A release can have real tracks but none publicly streamable (purchase-only) —
  // still return the tracklist so the UI can show it, just with no defaultTrack.
  const defaultTrack =
    playable.length === 0
      ? null
      : tracks.find((t) => t.trackId === currentTrack?.trackId && t.streamUrl) ?? playable[0];

  return {
    artist: blob.artist ?? "",
    album: current?.title ?? tracks[0]?.title,
    defaultTrack,
    tracks,
    artUrl: artUrlFromId(current?.art_id ?? blob.art_id),
  };
}

/** DOM path: attribute values are already entity-decoded by the browser. */
export function parseFromDom(doc: Document): TralbumData | null {
  const el = doc.querySelector("[data-tralbum]");
  const raw = el?.getAttribute("data-tralbum");
  if (!raw) return null;
  try {
    return parseTralbum(JSON.parse(raw));
  } catch {
    return null;
  }
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export type FetchOutcome =
  | { kind: "ok"; data: TralbumData }
  | { kind: "no-tracklist" }
  | { kind: "not-found" } // 404/410 — permanent, never retry
  | { kind: "transient" }; // anything else — retry later

/** Fallback path: fetch the release page by URL (works on dormant tabs, never touches the tab itself). */
export async function fetchExtract(url: string): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  } catch {
    return { kind: "transient" };
  }

  if (res.status === 404 || res.status === 410) return { kind: "not-found" };
  if (!res.ok) return { kind: "transient" };

  const html = await res.text();
  const match = /data-tralbum="([^"]*)"/.exec(html);
  if (!match) return { kind: "transient" }; // likely a stripped/non-browser response — worth retrying

  let blob: RawTralbum;
  try {
    blob = JSON.parse(decodeEntities(match[1]));
  } catch {
    return { kind: "transient" };
  }

  const data = parseTralbum(blob);
  return data ? { kind: "ok", data } : { kind: "no-tracklist" };
}
