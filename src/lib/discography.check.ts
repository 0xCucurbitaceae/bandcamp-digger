// Self-check for the release-grid normaliser — the non-trivial pure logic here
// (URL resolution, merch filtering, artist fallback, dedupe across the two grid
// shapes). The DOM readers around it are thin querySelector glue.
//   node --experimental-strip-types src/lib/discography.check.ts
import assert from "node:assert/strict";
import { normalizeItems } from "./discography.ts";

// A label page: absolute cross-subdomain hrefs, per-item artists, query stripped.
const label = normalizeItems(
  [
    { pageUrl: "https://chloecaillet.bandcamp.com/album/dance-again?label=1785560224&tab=music", title: " Dance Again ", artist: " Chloé Caillet ", artUrl: "https://f4.bcbits.com/img/a2381863169_2.jpg", kind: "album" },
    { pageUrl: "https://x.bandcamp.com/merch/tote", title: "Tote", kind: "package" },
  ],
  "Ninja Tune",
  "https://ninjatune.bandcamp.com"
);
assert.equal(label.length, 1, "merch is dropped");
assert.equal(label[0].url, "https://chloecaillet.bandcamp.com/album/dance-again");
assert.equal(label[0].title, "Dance Again");
assert.equal(label[0].artist, "Chloé Caillet");

// An artist page: relative hrefs, no per-item artist — falls back to the band.
const artist = normalizeItems(
  [{ pageUrl: "/album/kaleidoscope-companion", title: "Kaleidoscope Companion", artist: null, kind: "album" }],
  "DJ Food",
  "https://djfood.bandcamp.com"
);
assert.equal(artist[0].url, "https://djfood.bandcamp.com/album/kaleidoscope-companion");
assert.equal(artist[0].artist, "DJ Food");
assert.equal(artist[0].artUrl, null);

// Rendered <li>s and the lazy-load blob are concatenated, so the same release
// arriving from both must collapse — and the rendered one (first) wins.
const merged = normalizeItems(
  [
    { pageUrl: "/album/dup", title: "Rendered", kind: "album" },
    { pageUrl: "https://djfood.bandcamp.com/album/dup?tab=music", title: "Blob", kind: "album" },
    { pageUrl: "/album/other", title: "Other", kind: "album" },
  ],
  "DJ Food",
  "https://djfood.bandcamp.com"
);
assert.deepEqual(merged.map((i) => i.title), ["Rendered", "Other"]);

// A grid item with no href is skipped rather than throwing.
assert.deepEqual(normalizeItems([{ pageUrl: "", title: "x" }], "B", "https://b.bandcamp.com"), []);

console.log("discography normaliser: ok");
