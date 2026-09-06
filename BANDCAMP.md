# Task: extract streamable MP3 URLs from Bandcamp pages

Given a Bandcamp album or track URL, produce a tracklist with a directly
playable MP3 URL for each track.

## Two traps — read before writing code

**1. Bandcamp serves a stripped page to non-browser requests.**
With a bare `curl`/`fetch` (default headers), the `data-tralbum` blob is simply
absent and the page looks like it has no tracks. You must send browser-like
headers:

    User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
    Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8
    Accept-Language: en-US,en;q=0.9
    Accept-Encoding: gzip, deflate, br
    Sec-Fetch-Dest: document
    Sec-Fetch-Mode: navigate
    Sec-Fetch-Site: none

**2. `data-audiourl` is NOT the page's own music. Never read it.**
This is the dangerous one because it fails silently. On the stripped page the
only `data-audiourl` attributes belong to `<li class="recommended-album">`
elements in the footer — other artists' recommended releases. They contain
real, working, playable MP3s. If you read them you get a player that works
perfectly and plays entirely the wrong music.

Always read `data-tralbum`. Never `data-audiourl`.

## Method

1. Fetch the page with the headers above, following redirects.
2. Extract the `data-tralbum="..."` attribute value.
3. HTML-entity-decode it (`&quot;` `&#39;` `&amp;` `&lt;` `&gt;`), then `JSON.parse`.
4. Read `trackinfo[]`. Per track:
   - `title`
   - `track_num`
   - `duration` (seconds, float)
   - `track_id` (stable identifier)
   - `file["mp3-128"]` — the stream URL
5. Drop tracks where `file["mp3-128"]` is missing (not publicly streamable).

Album URLs return the full tracklist; `/track/` URLs return a single track.
Real stream URLs are hosted on `t4.bcbits.com`.

## URL expiry — this determines your architecture

The stream URLs are signed and carry a `ts` timestamp. The signature is
re-minted on **every** page fetch, so two fetches of the same page give
different signatures.

**But old signatures keep working.** A URL minted 37 days earlier still
streamed fine when tested. So:

- **Do** cache stream URLs in your database and refresh them periodically.
- **Don't** resolve them per play — it adds seconds of latency to every track
  and hammers Bandcamp for no benefit.

Store `track_id` alongside the URL and a `refreshed_at` timestamp so you can
re-run enrichment over the stalest rows. Treat the exact TTL as unknown: 37
days is a measured lower bound, not a guarantee. Make playback failure
trigger a re-fetch rather than assuming URLs are permanent.

## Rate limiting

At a 1.2s interval, ~13% of requests failed with transient network errors
(not 404s). At 2s the failure rate was ~2%. Use 2s.

Record every outcome so runs are resumable, but **separate transient failures
from permanent ones**. Naively recording all failures means a resumed run
skips the transient ones forever. Retry anything that isn't 404/410; leave
genuine 404s alone — those are releases pulled from Bandcamp and will never
come back.

Expected real-world outcome on an aged link collection: ~94% of links yield
tracks, ~5% are 404, ~1% have no tracklist.

## Verification — prove you got the right music

Trap 2 produces plausible-looking wrong results, so verify explicitly:

1. On a `/track/` URL, check the extracted track title matches the page's
   `og:title` meta tag. If it doesn't, you're reading recommendations.
2. Range-request a stream URL and confirm the response is `HTTP 206` with
   `Content-Type: audio/mpeg`, and that the bytes identify as
   `MPEG ADTS, layer III, v1, 128 kbps`.
3. Sanity-check track counts: a 20-track album should yield 20 tracks, not 6.

## Reference shape

```js
const m = pageHtml.match(/data-tralbum="([^"]*)"/);
if (!m) return null;                     // stripped page — check your headers
const blob = JSON.parse(decodeEntities(m[1]));

const tracks = (blob.trackinfo || [])
  .map((t, i) => ({
    position: t.track_num || i + 1,
    title: t.title,
    durationSeconds: t.duration ? Math.round(t.duration) : null,
    trackId: String(t.track_id),
    streamUrl: (t.file || {})["mp3-128"] || null,
  }))
  .filter((t) => t.streamUrl);

// blob.artist and blob.current.title give artist / album name
```

## Scope

This is for a personal link library, streaming the same public 128kbps files
Bandcamp's own page player uses. Keep the request rate low and polite, don't
download or re-host audio, and don't build anything that bypasses purchase or
paywalls.

## This extension's use of it

`src/lib/bandcamp.ts` implements this contract with two entry points:

- `parseFromDom(doc)` — used when a tab's page is already loaded; the DOM's
  `data-tralbum` attribute is already entity-decoded by the browser, so no
  manual decode step is needed there.
- `fetchExtract(url)` — the fallback above, verbatim: browser headers,
  entity-decode, 404/410 vs. transient distinction. Used for dormant/
  discarded tabs (never reloads them) and whenever the DOM read fails.

The 2s stagger and retry/permanent-failure bookkeeping live in
`src/background.ts`'s sync loop, not in `bandcamp.ts` itself.

### Runtime 410s on the stream itself, not the page

The 404/410 handling above is for fetching the **release page** (a pulled
release, permanent). A signed stream URL (`t4.bcbits.com/stream/...`) is a
separate thing that can independently expire mid-session — this project's
BANDCAMP.md guidance said old signatures survive 37+ days as a measured
lower bound, not a guarantee, and playback failure should trigger a
re-fetch rather than assuming URLs are permanent. That's implemented as:
the `<audio>` element's `error` event → `useGrid`'s `handleAudioError` →
a `refreshTrack` message to the background service worker → `extractOne`
re-run for just that card, minting a fresh signed URL → the specific
track the user had selected is restored (only its `streamUrl` changes, not
`selectedTrackId`) → the existing streamUrl-change effect swaps `audio.src`
and resumes playback automatically. Retried once per track selection, not
looped — a second failure on the same track surfaces a toast instead of
retrying forever.
