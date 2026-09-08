# Chrome Web Store listing — draft

## Short description (max 132 chars)

Merge your open Bandcamp tabs into one grid with a shared player — grid or
list view, drag to reorder, play across every release.

(114 chars)

## Detailed description

Stop tab-hopping between Bandcamp releases. Bandcamp Tab Merger grabs every
Bandcamp tab you have open and lays them out on one page — artwork, artist,
album, and track — with a single player that plays straight through your
whole queue.

**Grid or list view** — browse album covers, or switch to a dense list with
resizable, reorderable columns (title, artist, album, and a lazily-computed
BPM).

**Play across every tab** — one shared player queue. Choose "one track per
release" or "full album" playback, drag cards to reorder the queue, and jump
straight to any track in a release's expandable tracklist.

**Works with dormant tabs** — releases you've let Chrome/Brave put to sleep
still show up and stay playable; the extension never wakes a tab just to
read it.

**Tab-aware** — go to a release's tab, close it (it stays in the grid,
playable from cache), reopen a closed one, or archive closed tabs out of the
way with one click.

**Nothing leaves your browser** — no accounts, no analytics, no server. See
the privacy policy for exactly what it reads and why.

This is a personal listening tool for releases you already have open — it
streams the same public files Bandcamp's own page player uses, and never
bypasses a purchase or paywall.

## Category

Productivity (or: Tools)

## Privacy policy URL

https://github.com/0xCucurbitaceae/bandcamp-digger/blob/main/PRIVACY.md

## Permission justifications (for the dashboard's permission-justification fields)

- **tabs**: "Used to find the user's open Bandcamp tabs and to focus, close,
  or reopen them from the merged grid."
- **scripting**: "Used to read the already-loaded Bandcamp page's public
  track data from tabs the user has open, so playback doesn't require a
  page reload."
- **storage**: "Used to save the user's merged grid, track data, and
  preferences locally in the browser."
- **host permission (bandcamp.com)**: "Used to read public release/track
  data from Bandcamp pages, including for tabs that are dormant/asleep."
- **host permission (bcbits.com)**: "Used to stream track audio for
  playback and waveform/BPM display — the same public CDN Bandcamp's own
  page player uses."

## Assets still needed before submitting

- [ ] At least one screenshot, 1280x800 or 640x400 (grid view and/or list
      view with a few releases loaded looks best)
- [ ] Optional: small promo tile, 440x280
- [ ] Optional: marquee promo tile, 1400x560
- [ ] Google Developer account + $5 one-time registration fee
