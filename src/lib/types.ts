export type CardStatus = "pending" | "ready" | "unplayable" | "error";

export interface TrackRecord {
  trackId: string;
  title: string;
  /** null = bandcamp has no public stream for this track (still shown, marked unplayable) */
  streamUrl: string | null;
}

export interface CardRecord {
  /** dedupe key = release URL */
  id: string;
  url: string;
  /** null once the tab is closed/unreachable ("dead") */
  tabId: number | null;
  title: string | null;
  favIconUrl: string | null;
  artist: string | null;
  album: string | null;
  /** full tracklist in track_num order, for the per-track playback / expand panel */
  tracks: TrackRecord[];
  /** trackId of whichever track is currently loaded for this card (starts at bandcamp's own default) */
  selectedTrackId: string | null;
  /** convenience mirror of tracks.find(t => t.trackId === selectedTrackId) — kept in sync by background/useGrid */
  track: string | null;
  trackId: string | null;
  streamUrl: string | null;
  artUrl: string | null;
  status: CardStatus;
  /** true only for a confirmed 404/410 — never retried again */
  permanentFailure: boolean;
  /** transient failures so far; a release we can never reach (custom domain,
   *  so outside host_permissions) is given up on rather than retried forever */
  attempts: number;
  refreshedAt: number | null;
  order: number;
  /** moved out of the main grid/list into the Archive section via the "Clean" action */
  archived: boolean;
}

export type PlaybackMode = "single" | "album";

export type ViewMode = "grid" | "list";

/** List-view's resizable/reorderable data columns (the fixed num/play gutter isn't one of these). */
export type ListColumnId = "title" | "artist" | "album" | "bpm";

/** Persisted screen state — so reopening the grid page looks like how it was left. */
export interface UiConfig {
  view: ViewMode;
  archiveOpen: boolean;
  listColumnOrder: ListColumnId[];
  listColumnSizing: Partial<Record<ListColumnId, number>>;
}

export const DEFAULT_UI_CONFIG: UiConfig = {
  view: "grid",
  archiveOpen: false,
  listColumnOrder: ["title", "artist", "album", "bpm"],
  listColumnSizing: { title: 320, artist: 160, album: 160, bpm: 64 },
};

/** A band's whole catalogue, pulled from its /music page and played as one list.
 *  Same CardRecord shape as the tab grid so the list view renders both — these
 *  just never have a tabId. */
export interface LabelCollection {
  /** bandcamp host the grid was read from, e.g. "ninjatune.bandcamp.com" */
  id: string;
  url: string;
  name: string;
  /** one card per release, complete from the moment the collection is created —
   *  the content script reads the whole grid off the page in one go */
  cards: CardRecord[];
}
