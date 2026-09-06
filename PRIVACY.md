# Privacy Policy — Bandcamp Tab Merger

**Last updated:** 2026-09-06

Bandcamp Tab Merger is a browser extension that merges your open Bandcamp
tabs — or a whole label's or artist's catalogue — into a single page with a
shared player. This document explains what data it touches and where it
goes.

## What the extension can see

- **Open tabs**: the extension reads the URL, title, and favicon of your
  open browser tabs, filtered to `*.bandcamp.com` pages, so it can build the
  grid. It does not read tabs on any other site.
- **Bandcamp pages you visit**: the extension adds a "Listen to all" button
  to Bandcamp pages that show a release grid (a label's or artist's page).
  Doing so means its code runs on `*.bandcamp.com` pages, where it reads the
  public release grid already on the page — release titles, artists, artwork,
  and links. It reads nothing else from the page, and runs on no other site.
- **Bandcamp page content**: for each Bandcamp tab, it reads the release's
  public track listing (artist, album, track names, artwork, and the
  streaming URL Bandcamp's own page player already uses) — either directly
  from that tab's page, or by fetching the same public page URL in the
  background.
- **Audio stream**: to draw a waveform and estimate BPM, the extension
  fetches and locally decodes the track's own public stream (the same file
  Bandcamp's page player would stream) inside your browser.

## What the extension does NOT do

- It does not collect, transmit, or sell any data to the developer or any
  third party. There is no analytics, telemetry, or remote server involved.
- It does not read or interact with any site other than `bandcamp.com` and
  its media CDN (`bcbits.com`).
- It does not access your Bandcamp account, purchase history, payment
  information, or require you to log in to anything.
- It does not bypass purchases or paywalls — it only streams the same
  public, unpurchased preview/stream files Bandcamp's own page already
  serves to any visitor.

## Where data is stored

Everything the extension knows (which tabs you've merged, any label or
artist catalogues you've opened, their track data, your grid layout, and
playback preferences) is stored locally in your browser via the standard
`chrome.storage.local` API. It never leaves your device, is never synced to
any server the developer controls, and is deleted if you remove the
extension.

## Permissions used, and why

| Permission | Why |
|---|---|
| `tabs` | Find your open Bandcamp tabs, focus/close/reopen them from the grid. |
| `scripting` | Read the already-loaded page's track data for tabs that are open. |
| Content script on `bandcamp.com` | Show the "Listen to all" button on release-grid pages and read that public grid. |
| `storage` | Save your grid, track data, and preferences locally. |
| Host access to `bandcamp.com`, `bcbits.com` | Fetch release pages and stream audio for tracks, including for tabs that are dormant/asleep. |

## Contact

Questions about this policy: open an issue on the project's GitHub
repository.
