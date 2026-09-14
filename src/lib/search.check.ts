import assert from "node:assert/strict";
import { filterCards } from "./search.ts";
import type { CardRecord } from "./types.ts";

const track = (title: string) => ({ trackId: title, title, streamUrl: null, duration: null });

const card = {
  id: "x",
  url: "https://ninjatune.bandcamp.com/album/black-sands",
  artist: "Bonobo",
  album: "Black Sands",
  title: "Black Sands | Bonobo",
  tracks: [track("Kiara"), track("Kong"), track("Eyesdown")],
} as unknown as CardRecord;

const cards = [card];
const titles = (q: string) => filterCards(cards, q).flatMap((c) => c.tracks.map((t) => t.title));

assert.equal(filterCards(cards, "")[0], card, "empty query passes the cards through untouched");
assert.equal(filterCards(cards, "  ")[0], card, "whitespace-only query too");
assert.deepEqual(titles("bono"), ["Kiara", "Kong", "Eyesdown"], "artist match keeps the whole tracklist");
assert.deepEqual(titles("black sands"), ["Kiara", "Kong", "Eyesdown"], "album match keeps the whole tracklist");
assert.deepEqual(titles("ninjatune"), ["Kiara", "Kong", "Eyesdown"], "label host match keeps the whole tracklist");
assert.deepEqual(titles("kiara"), ["Kiara"], "track-only match narrows to that track");
assert.deepEqual(titles("ko"), ["Kong"], "…and to the matching tracks only");
assert.equal(filterCards(cards, "aphex").length, 0, "no match drops the release");
assert.equal(filterCards(cards, "album/black").length, 0, "url path is not searched");
assert.equal(
  filterCards([{ ...card, artist: null, album: null, title: null }], "bonobo").length,
  0,
  "null fields are skipped"
);
assert.equal(card.tracks.length, 3, "narrowing copies, never mutates the original card");

console.log("search.check ok");
