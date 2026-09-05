// Self-check for the discography parser — the one bit of non-trivial pure logic
// here (entity-decoded JSON attribute, plus relative page_urls on an artist page
// vs absolute cross-subdomain ones on a label page).
//   node --experimental-strip-types src/lib/bandcamp.check.ts
import assert from "node:assert/strict";
import { parseDiscography } from "./bandcamp.ts";

const page = (band: string, items: unknown) =>
  `<div data-band="${band.replace(/"/g, "&quot;")}"></div>` +
  `<ol data-client-items="${JSON.stringify(items).replace(/"/g, "&quot;").replace(/&(?!quot;)/g, "&amp;")}"></ol>`;

// label page: absolute urls on other subdomains, query stripped, artist per item
const label = parseDiscography(
  page('{"name":"Ninja Tune"}', [
    { page_url: "https://cortoalto.bandcamp.com/album/thief?label=1785560224&tab=music", title: "THIEF", artist: "corto.alto", art_id: 4143550446, type: "album" },
    { page_url: "https://x.bandcamp.com/merch/tote", title: "Tote", type: "package" },
  ]),
  "https://ninjatune.bandcamp.com"
);
assert.equal(label?.bandName, "Ninja Tune");
assert.equal(label?.items.length, 1, "non-release items are dropped");
assert.equal(label?.items[0].url, "https://cortoalto.bandcamp.com/album/thief");
assert.equal(label?.items[0].artist, "corto.alto");
assert.equal(label?.items[0].artUrl, "https://f4.bcbits.com/img/a4143550446_10.jpg");

// artist page: relative urls resolve against the origin, artist falls back to the band
const artist = parseDiscography(
  page('{"name":"corto.alto"}', [{ page_url: "/album/435", title: "435", type: "album" }]),
  "https://cortoalto.bandcamp.com"
);
assert.equal(artist?.items[0].url, "https://cortoalto.bandcamp.com/album/435");
assert.equal(artist?.items[0].artist, "corto.alto");

// a page with no catalogue at all (e.g. a bare album page) isn't a discography
assert.equal(parseDiscography("<div data-band='{}'></div>", "https://x.bandcamp.com"), null);

console.log("bandcamp discography parser: ok");
