import { parseTralbum, fetchExtract } from "./lib/bandcamp";
import type { TralbumData } from "./lib/bandcamp";
import type { DiscographyItem } from "./lib/discography";
import { releaseKey, trackKey, viewOf } from "./lib/digger";
import { getCards, getCollection, setCollection, updateCards, updateCollection, updateWishlisted, parseKind } from "./lib/storage";
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

/** The merged-tabs page — the one page of ours with its own URL; every other
 *  view lives on a Bandcamp URL (lib/digger.ts). Focuses the window too:
 *  tabs.update({ active }) only switches tabs inside that tab's own window, so
 *  a grid sitting in another window stayed hidden behind whatever was in front. */
async function openGrid() {
  const url = chrome.runtime.getURL("src/grid/index.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
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
    itemId: data.itemId,
    itemType: data.itemType,
    bandId: data.bandId,
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
  // A tab showing our own view (?view=digger) is a catalogue being browsed,
  // not a release the user opened to dig through — keep it out of the grid.
  const tabs = (await chrome.tabs.query({ url: BANDCAMP_MATCH })).filter((t) => t.url && viewOf(t.url) !== "digger");
  const tabsByUrl = new Map(tabs.map((t) => [t.url as string, t]));

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
        itemId: null,
        itemType: null,
        bandId: null,
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

// --- collections: label catalogues, wishlists, single albums -----------------
// Each is a named batch of releases read off the Bandcamp page the user is on,
// shown there by our view (content/listenAll.ts) — same CardRecord shape, same
// one-key-per-collection storage. See storage.ts's CollectionKind.

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
    itemId: null,
    itemType: null,
    bandId: null,
  };
}

/**
 * Stores the batch of releases the content script read off the page.
 * Reopening the view refreshes the release list while keeping every tracklist
 * already fetched — reloading those would cost another full walk. A single
 * album page hands over its own data-tralbum as `data`, so it needs no fetch
 * at all (and gets freshly signed stream URLs for free).
 */
async function storeCollection(
  kind: CollectionKind,
  id: string,
  url: string,
  name: string,
  items: DiscographyItem[],
  data: TralbumData | null
) {
  const existing = await getCollection(kind, id);
  const byUrl = new Map((existing?.cards ?? []).map((c) => [c.url, c]));
  const cards = items.map((item, i) => {
    const card = { ...(byUrl.get(item.url) ?? cardFromRelease(item, i)), order: i };
    return data ? applyTralbum(card, data) : card;
  });
  await setCollection(kind, { id, url, name, cards });

  if (kind === "wishlist") {
    // The whole wishlist was just read off the fan's page — the one
    // authoritative answer to what's on it, so it replaces what we knew.
    await updateWishlisted((set) => {
      set.clear();
      for (const item of items) {
        set.add(releaseKey(item.url));
        if (item.trackId) set.add(trackKey(item.trackId));
      }
    });
  }
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

// --- native Bandcamp wishlist --------------------------------------------------
// Bandcamp only honours the fan's session from a script on one of its own pages
// (see lib/wishlist.ts), so the POST itself is made by the content script in an
// open Bandcamp tab. Any tab will do: Bandcamp's own fan pages wishlist every
// band's releases from bandcamp.com, so the host it's posted to doesn't matter.

interface WishlistRequest {
  add: boolean;
  /** the release — also how its ids get looked up when the card predates them */
  url: string;
  /** set → wishlist this one track rather than the release */
  trackId?: string | null;
  itemId?: string | null;
  itemType?: "album" | "track" | null;
  bandId?: string | null;
  /** a tab already showing this release, tried first */
  tabId?: number | null;
}

type WishlistResult = { ok: true } | { ok: false; error: "lookup" | "no-tab" | "logged-out" | "failed" };

async function setWishlisted(req: WishlistRequest, senderTabId: number | undefined): Promise<WishlistResult> {
  let { itemId, itemType, bandId } = req;
  if (!itemId || !bandId) {
    // A card extracted before these ids were kept: one page fetch finds them.
    const outcome = await fetchExtract(req.url);
    if (outcome.kind !== "ok") return { ok: false, error: "lookup" };
    ({ itemId, itemType, bandId } = outcome.data);
    if (!itemId || !bandId) return { ok: false, error: "lookup" };
  }
  const item = req.trackId
    ? { itemId: req.trackId, itemType: "track" as const, bandId }
    : { itemId, itemType: itemType ?? "album", bandId };

  // The sender first: when our view is embedded in a Bandcamp page, that tab's
  // own content script is right there. Our grid page has none — it just fails over.
  const bandcampTabs = (await chrome.tabs.query({ url: BANDCAMP_MATCH })).map((t) => t.id);
  const candidates = [...new Set([senderTabId, req.tabId, ...bandcampTabs])].filter(
    (id): id is number => typeof id === "number"
  );
  let result: WishlistResult = { ok: false, error: "no-tab" };
  for (const tabId of candidates) {
    try {
      const r = (await chrome.tabs.sendMessage(tabId, { type: "collectItem", add: req.add, ...item }, { frameId: 0 })) as
        | WishlistResult
        | undefined;
      if (r) {
        result = r;
        break;
      }
    } catch {
      // no content script in that tab (not a Bandcamp page, or one loaded before an extension reload)
    }
  }
  if (!result.ok) return result;

  // A single-track release is one wishlist item under both keys.
  const keys = req.trackId
    ? [trackKey(req.trackId)]
    : [releaseKey(req.url), ...(item.itemType === "track" ? [trackKey(item.itemId)] : [])];
  await updateWishlisted((set) => keys.forEach((k) => (req.add ? set.add(k) : set.delete(k))));
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "sync") {
    sync(msg.auto === true).then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
  if (msg?.type === "loadCollection" && typeof msg.id === "string") {
    // Fire-and-forget: this can run for minutes on a big catalogue/wishlist,
    // and the page follows along through storage changes.
    loadCollection(parseKind(msg.kind), msg.id);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "storeCollection" && typeof msg.id === "string") {
    storeCollection(parseKind(msg.kind), msg.id, msg.url, msg.name, msg.items, msg.data ?? null).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  if (msg?.type === "wishlist" && typeof msg.url === "string") {
    setWishlisted(msg, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg?.type === "refreshTrack" && msg.cardId) {
    // `collectionKind`+`collectionId` route the refreshed card back to a
    // collection instead of the tab grid — those releases expire exactly the
    // same way.
    refreshTrack(msg.cardId, msg.collectionKind && parseKind(msg.collectionKind), msg.collectionId).then(() =>
      sendResponse({ ok: true })
    );
    return true;
  }
  return false;
});
