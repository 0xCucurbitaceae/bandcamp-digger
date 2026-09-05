import { parseTralbum, fetchExtract, fetchDiscography } from "./lib/bandcamp";
import type { TralbumData } from "./lib/bandcamp";
import { getCards, setCards, getLabel, setLabel } from "./lib/storage";
import type { CardRecord, LabelCollection } from "./lib/types";

const BANDCAMP_MATCH = "*://*.bandcamp.com/*";
const FETCH_STAGGER_MS = 2000;
const LABEL_MENU_ID = "label-tracks";

chrome.action.onClicked.addListener(() => openGrid());

// Every outbound bandcamp fetch — tab sync and label catalogue loads alike —
// goes through one chain so the 2s stagger is global. Two surfaces each doing
// their own 2s would halve the real interval and push us into the error rate
// BANDCAMP.md measured at 1.2s.
let fetchChain: Promise<unknown> = Promise.resolve();

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
      return card; // leave as-is, retried on next sync
  }
}

async function sync() {
  const tabs = await chrome.tabs.query({ url: BANDCAMP_MATCH });
  const tabsByUrl = new Map(tabs.filter((t) => t.url).map((t) => [t.url as string, t]));

  let cards = await getCards();
  const existingByUrl = new Map(cards.map((c) => [c.url, c]));

  // Add skeletons for newly-found tabs; re-link dead cards whose URL matches a tab again.
  for (const tab of tabs) {
    if (!tab.url) continue;
    const existing = existingByUrl.get(tab.url);
    if (!existing) {
      const fresh: CardRecord = {
        id: tab.url,
        url: tab.url,
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
        refreshedAt: null,
        order: cards.length,
        archived: false,
      };
      cards.push(fresh);
      existingByUrl.set(tab.url, fresh);
    } else if (existing.tabId !== tab.id) {
      existing.tabId = tab.id ?? null; // re-link a dead card
    }
  }

  // A card whose URL no longer has a live tab goes dead (tabId: null); never removed here.
  cards = cards.map((c) => (tabsByUrl.has(c.url) ? c : { ...c, tabId: null }));

  await setCards(cards);

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
    const tab = c.tabId ? tabsByUrl.get(c.url) : undefined;
    if (tab?.status === "complete" && !tab.discarded) domJobs.push(c);
    else fetchJobs.push(c);
  }

  const applyUpdate = async (updated: CardRecord) => {
    const latest = await getCards();
    const idx = latest.findIndex((c) => c.id === updated.id);
    if (idx === -1) return; // removed by the user mid-sync
    latest[idx] = { ...latest[idx], ...updated };
    await setCards(latest);
  };

  await Promise.all(
    domJobs.map(async (c) => applyUpdate(await extractOne(c, tabsByUrl.get(c.url))))
  );

  // Not awaited: a queue shared with a big label load can be minutes deep, and
  // the UI already updates live off storage — only the spinner would be waiting.
  for (const c of fetchJobs) {
    enqueueFetch(() => extractOne(c, tabsByUrl.get(c.url))).then(applyUpdate);
  }
}

// --- label catalogue --------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: LABEL_MENU_ID,
      title: "View all tracks from this label",
      contexts: ["page", "link"],
      documentUrlPatterns: [BANDCAMP_MATCH],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== LABEL_MENU_ID) return;
  const pageUrl = info.pageUrl ?? tab?.url;
  if (!pageUrl) return;
  const { origin, host } = new URL(pageUrl);

  // Placeholder first, so the page can open immediately and show progress
  // rather than the user staring at the bandcamp tab for a few seconds.
  if (!(await getLabel(host))) {
    await setLabel({ id: host, url: origin, name: host, discographyLoaded: false, error: null, cards: [] });
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/label/index.html?id=${encodeURIComponent(host)}`) });
});

/** Rewrites one card inside a label collection, re-reading first so concurrent
 *  track loads don't clobber each other (same pattern as the grid's applyUpdate). */
async function applyLabelCard(labelId: string, updated: CardRecord) {
  const col = await getLabel(labelId);
  if (!col) return;
  const idx = col.cards.findIndex((c) => c.id === updated.id);
  if (idx === -1) return;
  col.cards[idx] = { ...col.cards[idx], ...updated };
  await setLabel(col);
}

// Labels already being walked, so a page reload doesn't queue every release twice.
const loadingLabels = new Set<string>();

async function loadLabel(id: string) {
  if (loadingLabels.has(id)) return;
  let col = await getLabel(id);
  if (!col) return;
  loadingLabels.add(id);
  try {
    if (!col.discographyLoaded) {
      const disco = await enqueueFetch(() => fetchDiscography(col!.url));
      if (!disco || disco.items.length === 0) {
        await setLabel({ ...col, error: "Couldn't read a discography from that page." });
        return;
      }
      col = {
        ...col,
        name: disco.bandName || col.name,
        discographyLoaded: true,
        error: null,
        cards: disco.items.map((item, i) => ({
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
          refreshedAt: null,
          order: i,
          archived: false,
        })),
      };
      await setLabel(col);
    }

    // Resumable: only ever the releases still without a tracklist.
    const pending = col.cards.filter((c) => c.status === "pending" && !c.permanentFailure);
    for (const c of pending) {
      const updated = await enqueueFetch(() => extractOne(c, undefined));
      await applyLabelCard(id, updated);
    }
  } finally {
    loadingLabels.delete(id);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "sync") {
    sync().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
  if (msg?.type === "loadLabel" && typeof msg.id === "string") {
    // Fire-and-forget: this can run for minutes on a big catalogue, and the
    // page follows along through storage changes.
    loadLabel(msg.id);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
