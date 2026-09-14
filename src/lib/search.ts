import type { CardRecord } from "./types";

/** Everything about a release *other than* its tracklist: artist, album, its own
 *  title, and the bandcamp host it came from (the label — cards carry no label
 *  field of their own). */
function releaseMatches(card: CardRecord, q: string): boolean {
  const host = card.url.replace(/^https?:\/\//, "").split("/")[0];
  return [card.artist, card.album, card.title, host].some((f) => f?.toLowerCase().includes(q));
}

/**
 * Free-text filter over a list of releases. A release whose own metadata matches
 * comes through whole; one that matches only through a track or two comes through
 * narrowed to *those* tracks, so searching a song title gives you the song rather
 * than the album around it.
 *
 * The narrowed copies are display-only — the player resolves whatever it is
 * playing out of the unfiltered pool, so a running album keeps every track.
 */
export function filterCards(cards: CardRecord[], query: string): CardRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.flatMap((card) => {
    if (releaseMatches(card, q)) return [card];
    const tracks = card.tracks.filter((t) => t.title.toLowerCase().includes(q));
    return tracks.length ? [{ ...card, tracks }] : [];
  });
}
