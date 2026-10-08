// Our view lives on Bandcamp's own URLs: `?view=digger` swaps the page for it
// (see content/listenAll.ts), `?view=bandcamp` forces the native page even
// when the "digger by default" setting is on. The merged-tabs grid is the only
// page of ours with its own chrome-extension:// URL.

export type PageView = "digger" | "bandcamp";

export function viewOf(url: string): PageView | null {
  try {
    const v = new URL(url).searchParams.get("view");
    return v === "digger" || v === "bandcamp" ? v : null;
  } catch {
    return null;
  }
}

export function withView(url: string, view: PageView): string {
  const u = new URL(url);
  u.searchParams.set("view", view);
  return u.toString();
}

/** The artist/label catalogue, in our view, for any of its release URLs. */
export function artistDiggerUrl(releaseUrl: string): string {
  return withView(`${new URL(releaseUrl).origin}/music`, "digger");
}

// --- wishlist keys -----------------------------------------------------------
// The wishlisted set is keyed so it can be checked without bandcamp's ids:
// a release by its URL (query/hash dropped — tab URLs carry ?from=… noise),
// a track by its id, which every TrackRecord already has.

export function releaseKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export const trackKey = (trackId: string) => `t${trackId}`;
