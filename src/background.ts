import { parseTralbum, fetchExtract, decodeEntities, BROWSER_HEADERS } from "./lib/bandcamp";
import type { TralbumData } from "./lib/bandcamp";
import { parseDiscographyHtml } from "./lib/discography";
import type { DiscographyItem } from "./lib/discography";
import { getCards, setCards, getCollection, setCollection, updateCards, updateCollection } from "./lib/storage";
import type { CollectionKind } from "./lib/storage";
import type { CardRecord } from "./lib/types";

const BANDCAMP_MATCH = "*://*.bandcamp.com/*";
const FETCH_STAGGER_MS = 2000;
// Releases on a custom domain aren't in host_permissions, so their fetch can
// never succeed; without a cap the page's 60s resume would retry them forever.
const MAX_ATTEMPTS = 3;

chrome.action.onClicked.addListener(() => openGrid());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/index.html") });
});

// Every outbound bandcamp fetch — tab sync and label catalogue loads alike —
// goes through one chain so the 2s stagger is global. Two surfaces each doing
// their own 2s would halve the real interval and push us into the error rate
// BANDCAMP.md measured at 1.2s.
let fetchChain: Promise<unknown> = Promise.resolve();

// Cards an earlier sync is still extracting. The grid page re-kicks sync every
// 60s to restart a queue a torn-down service worker took with it; without this
// a kick landing mid-backlog would queue the whole remainder a second time.
const inFlightCards = new Set<string>();

function enqueueFetch<T>(job: () => Promise<T>): Promise<T> {
  const run = fetchChain.then(job, job);
  fetchChain = run
    .catch(() => undefined)
    .then(() => new Promise((r) => setTimeout(r, FETCH_STAGGER_MS)));
  return run;
}

async function openGrid() {
  const url = chrome.runtime.getURL("src/grid/index.html");
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// Reads data-tralbum straight off the DOM. Runs inside the target page's
// isolated world via chrome.scripting — must stay a self-contained function,
// no closures over module-scope code.
function readTralbumAttr(): string | null {
  const el = document.querySelector("[data-tralbum]");
  return el ? el.getAttribute("data-tralbum") : null;
}

async function domExtract(tabId: number): Promise<string | null> {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readTralbumAttr,
    });
    return result ?? null;
  } catch {
    return null; // e.g. tab navigated away mid-injection, or restricted page
  }
}

function nowMs() {
  return Date.now();
}

function applyTralbum(card: CardRecord, data: TralbumData): CardRecord {
  // defaultTrack is null when nothing on the release is publicly streamable
  // (e.g. purchase-only) — still keep `tracks` so the UI shows them, disabled.
  return {
    ...card,
    artist: data.artist,
    album: data.album,
    tracks: data.tracks,
    selectedTrackId: data.defaultTrack?.trackId ?? null,
    track: data.defaultTrack?.title ?? null,
    trackId: data.defaultTrack?.trackId ?? null,
    streamUrl: data.defaultTrack?.streamUrl ?? null,
    artUrl: data.artUrl,
    status: data.defaultTrack ? "ready" : "unplayable",
    refreshedAt: nowMs(),
  };
}

async function extractOne(card: CardRecord, tab: chrome.tabs.Tab | undefined): Promise<CardRecord> {
  // Path 1: DOM read, only for tabs that are actually loaded — never wakes a dormant tab.
  if (tab?.id && tab.status === "complete" && !tab.discarded) {
    const raw = await domExtract(tab.id);
    if (raw) {
      try {
        const data = parseTralbum(JSON.parse(raw));
        if (data) return applyTralbum(card, data);
      } catch {
        // fall through to fetch fallback
      }
    }
  }

  // Path 2: background fetch fallback (dormant tabs, or DOM read failed).
  const outcome = await fetchExtract(card.url);
  switch (outcome.kind) {
    case "ok":
      return applyTralbum(card, outcome.data);
    case "no-tracklist":
      return { ...card, status: "unplayable", refreshedAt: nowMs() };
    case "not-found":
      return { ...card, status: "error", permanentFailure: true, refreshedAt: nowMs() };
    case "transient":
      // Still pending, but one attempt closer to being given up on — a release
      // on a domain we hold no permission for can never succeed.
      return { ...card, attempts: card.attempts + 1 };
  }
}

/**
 * Re-extracts a single card to mint a fresh signed stream URL — used when
 * playback hits a 410 (the signature expired; BANDCAMP.md notes old
 * signatures can outlive 37+ days but do eventually die).
 *
 * Deliberately skips the DOM-read path even if the tab is open: the DOM is
 * whatever HTML the page loaded with — reading it again returns the exact
 * same (now-expired) signed URL, since nothing re-renders it. Only an actual
 * network fetch makes Bandcamp mint a new signature, so this always uses
 * `fetchExtract` directly.
 *
 * Re-extraction naturally resets to the release's default track, so whichever
 * track was actually selected/playing is restored afterward with just its
 * refreshed streamUrl — the user's manual track choice isn't lost.
 *
 * `collectionKind`+`collectionId` selects the store: a label or wishlist
 * collection's releases carry the same signed URLs and expire the same way,
 * so they get the same recovery.
 */
async function refreshTrack(cardId: string, collectionKind?: CollectionKind, collectionId?: string): Promise<void> {
  const cards = collectionId && collectionKind ? (await getCollection(collectionKind, collectionId))?.cards ?? [] : await getCards();
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;

  const outcome = await fetchExtract(card.url);
  let refreshed: CardRecord;
  switch (outcome.kind) {
    case "ok":
      refreshed = applyTralbum(card, outcome.data);
      break;
    case "no-tracklist":
      refreshed = { ...card, status: "unplayable", refreshedAt: nowMs() };
      break;
    case "not-found":
      refreshed = { ...card, status: "error", permanentFailure: true, refreshedAt: nowMs() };
      break;
    case "transient":
      return; // nothing to apply — leave the card as-is
  }

  const kept = card.selectedTrackId ? refreshed.tracks.find((t) => t.trackId === card.selectedTrackId) : null;
  const merged: CardRecord = kept
    ? { ...refreshed, selectedTrackId: kept.trackId, track: kept.title, trackId: kept.trackId, streamUrl: kept.streamUrl }
    : refreshed;

  if (collectionId && collectionKind) {
    await applyCollectionCard(collectionKind, collectionId, merged);
    return;
  }
  await updateCards((latest) => latest.map((c) => (c.id === cardId ? { ...c, ...merged } : c)));
}

/**
 * `auto` marks the grid page's 60s resume kick rather than a user pressing
 * Sync. Only automatic kicks respect MAX_ATTEMPTS — a release on a domain we
 * hold no host permission for can never succeed, and the resume would retry it
 * every minute forever. Pressing Sync still retries it, so a card that failed
 * for a since-fixed reason isn't stuck for good.
 */
async function sync(auto = false) {
  const tabs = await chrome.tabs.query({ url: BANDCAMP_MATCH });
  const tabsByUrl = new Map(tabs.filter((t) => t.url).map((t) => [t.url as string, t]));

  // Skeletons + tab re-linking, applied to the freshest stored list: a
  // previous sync's fetch queue is still writing extracted cards in while
  // this runs, and a plain read-then-write here would undo them.
  const cards = await updateCards((stored) => {
    const existingByUrl = new Map(stored.map((c) => [c.url, c]));

    // Re-link dead cards whose URL matches a live tab again.
    for (const [url, tab] of tabsByUrl) {
      const existing = existingByUrl.get(url);
      if (existing && existing.tabId !== tab.id) existing.tabId = tab.id ?? null;
    }

    // Add skeletons for newly-found tabs, most recently opened first, so the
    // freshest release lands at the top of the grid/list. `lastAccessed`
    // (Chrome 121+) stands in for the tab's open date; without it a tab counts
    // as just-opened, which keeps discovery order for older Chrome.
    const now = Date.now();
    const openedAt = (t: chrome.tabs.Tab) => (t as { lastAccessed?: number }).lastAccessed ?? now;
    const newTabs = [...tabsByUrl.values()]
      .filter((t) => !existingByUrl.has(t.url as string))
      .sort((a, b) => openedAt(b) - openedAt(a));
    // Orders sit below every existing card's, so new arrivals stack on top
    // without disturbing an order the user has dragged into place.
    let nextOrder = Math.min(0, ...stored.map((c) => c.order)) - newTabs.length;
    for (const tab of newTabs) {
      const fresh: CardRecord = {
        id: tab.url as string,
        url: tab.url as string,
        tabId: tab.id ?? null,
        title: tab.title ?? null,
        favIconUrl: tab.favIconUrl ?? null,
        artist: null,
        album: null,
        tracks: [],
        selectedTrackId: null,
        track: null,
        trackId: null,
        streamUrl: null,
        artUrl: null,
        status: "pending",
        permanentFailure: false,
        attempts: 0,
        refreshedAt: null,
        order: nextOrder++,
        archived: false,
      };
      stored.push(fresh);
    }

    // A card whose URL no longer has a live tab goes dead (tabId: null); never removed here.
    return stored.map((c) => (tabsByUrl.has(c.url) ? c : { ...c, tabId: null }));
  });

  const domJobs: CardRecord[] = [];
  const fetchJobs: CardRecord[] = [];
  for (const c of cards) {
    if (c.permanentFailure) continue;
    // status !== "pending" is normally done; also re-extract a "ready"/"unplayable"
    // card that was previously saved with an empty tracklist (self-heals older
    // bugs where a solo track or a wholly-unplayable release lost its tracks[]
    // entirely, without requiring a storage wipe).
    const needsExtraction =
      c.status === "pending" || ((c.status === "ready" || c.status === "unplayable") && c.tracks.length === 0);
    if (!needsExtraction) continue;
    if (inFlightCards.has(c.id)) continue;
    if (auto && c.attempts >= MAX_ATTEMPTS) continue;
    inFlightCards.add(c.id);
    const tab = c.tabId ? tabsByUrl.get(c.url) : undefined;
    if (tab?.status === "complete" && !tab.discarded) domJobs.push(c);
    else fetchJobs.push(c);
  }

  const applyUpdate = async (updated: CardRecord) => {
    // Serialized: 100 tabs extract concurrently, and an unsynchronized
    // read-modify-write means all but the last writer lose their update.
    await updateCards((latest) =>
      latest.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
    );
  };

  await Promise.all(
    domJobs.map(async (c) => {
      try {
        await applyUpdate(await extractOne(c, tabsByUrl.get(c.url)));
      } finally {
        inFlightCards.delete(c.id);
      }
    })
  );

  // Not awaited: a queue shared with a big label load can be minutes deep, and
  // the UI already updates live off storage — only the spinner would be waiting.
  for (const c of fetchJobs) {
    enqueueFetch(() => extractOne(c, tabsByUrl.get(c.url)))
      .then(applyUpdate)
      .finally(() => inFlightCards.delete(c.id));
  }
}

// --- label catalogues & wishlists --------------------------------------------
// Both are just a named batch of releases (label discography, fan wishlist) —
// same CardRecord shape, same one-page-per-collection storage. See
// storage.ts's CollectionKind for the two supported kinds.

/** Rewrites one card inside a collection, re-reading first so concurrent
 *  track loads don't clobber each other (same pattern as the grid's applyUpdate). */
async function applyCollectionCard(kind: CollectionKind, id: string, updated: CardRecord) {
  await updateCollection(kind, id, (col) => ({
    ...col,
    cards: col.cards.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
  }));
}

function cardFromRelease(item: DiscographyItem, order: number): CardRecord {
  return {
    id: item.url,
    url: item.url,
    tabId: null,
    title: item.title,
    favIconUrl: null,
    artist: item.artist,
    album: item.title,
    tracks: [],
    selectedTrackId: null,
    track: null,
    trackId: null,
    streamUrl: null,
    artUrl: item.artUrl,
    status: "pending",
    permanentFailure: false,
    attempts: 0,
    refreshedAt: null,
    order,
    archived: false,
  };
}

/**
 * Stores the batch of releases the content script read off the page (a
 * label/artist discography grid, or a fan's wishlist) and opens the
 * collection page on it. Re-clicking the button refreshes the release list
 * while keeping every tracklist already fetched — reloading those would cost
 * another full walk.
 */
async function openCollection(kind: CollectionKind, id: string, url: string, name: string, items: DiscographyItem[]) {
  const existing = await getCollection(kind, id);
  const byUrl = new Map((existing?.cards ?? []).map((c) => [c.url, c]));
  const cards = items.map((item, i) => {
    const prev = byUrl.get(item.url);
    return prev ? { ...prev, order: i } : cardFromRelease(item, i);
  });

  await setCollection(kind, { id, url, name, cards });
  const pageUrl = chrome.runtime.getURL(
    `src/label/index.html?id=${encodeURIComponent(id)}&kind=${kind}`
  );
  const open = await chrome.tabs.query({ url: pageUrl });
  if (open[0]?.id) await chrome.tabs.update(open[0].id, { active: true });
  else await chrome.tabs.create({ url: pageUrl });
}

/**
 * "Listen to this artist's whole catalogue" from anywhere a release URL is
 * known — the same thing the content script's injected button does, minus
 * needing to actually visit the artist's page first. Bandcamp's /music page
 * is plain server-rendered HTML (verified live), so this is a background
 * fetch + regex parse (`parseDiscographyHtml`), same shape as `fetchExtract`.
 */
async function fetchDiscographyFor(releaseUrl: string): Promise<{ id: string; url: string; name: string; items: DiscographyItem[] } | null> {
  let origin: string;
  try {
    origin = new URL(releaseUrl).origin;
  } catch {
    return null;
  }

  for (const path of ["/music", "/"]) {
    let res: Response;
    try {
      res = await fetch(origin + path, { headers: BROWSER_HEADERS, redirect: "follow" });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const html = await res.text();
    const disco = parseDiscographyHtml(html, origin, decodeEntities);
    if (disco && disco.items.length > 0) {
      return { id: new URL(origin).host, url: origin, name: disco.bandName || new URL(origin).host, items: disco.items };
    }
  }
  return null;
}

// Collections already being walked, so the page's resume kick doesn't queue twice.
const loadingCollections = new Set<string>();

/** Walks the releases that still have no tracklist. Resumable by design: the
 *  page re-kicks this every 60s in case the service worker was torn down. */
async function loadCollection(kind: CollectionKind, id: string) {
  const loadKey = `${kind}:${id}`;
  if (loadingCollections.has(loadKey)) return;
  const col = await getCollection(kind, id);
  if (!col) return;
  loadingCollections.add(loadKey);
  try {
    const pending = col.cards.filter(
      (c) => c.status === "pending" && !c.permanentFailure && c.attempts < MAX_ATTEMPTS
    );
    for (const c of pending) {
      const updated = await enqueueFetch(() => extractOne(c, undefined));
      await applyCollectionCard(kind, id, updated);
    }
  } finally {
    loadingCollections.delete(loadKey);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "sync") {
    sync(msg.auto === true).then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
  if (msg?.type === "loadCollection" && typeof msg.id === "string") {
    // Fire-and-forget: this can run for minutes on a big catalogue/wishlist,
    // and the page follows along through storage changes.
    loadCollection(msg.kind === "wishlist" ? "wishlist" : "label", msg.id);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "openLabel") {
    openCollection("label", msg.id, msg.url, msg.name, msg.items).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "openWishlist") {
    openCollection("wishlist", msg.id, msg.url, msg.name, msg.items).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "openLabelFromRelease" && typeof msg.url === "string") {
    // Triggered from a single release row (list view) rather than the artist's
    // own page — fetches that artist's catalogue in the background first.
    fetchDiscographyFor(msg.url).then((disco) => {
      if (disco) openCollection("label", disco.id, disco.url, disco.name, disco.items).then(() => sendResponse({ ok: true }));
      else sendResponse({ ok: false });
    });
    return true;
  }
  if (msg?.type === "refreshTrack" && msg.cardId) {
    // `collectionKind`+`collectionId` route the refreshed card back to a
    // label/wishlist collection instead of the tab grid — those releases
    // expire exactly the same way.
    refreshTrack(msg.cardId, msg.collectionKind, msg.collectionId).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
