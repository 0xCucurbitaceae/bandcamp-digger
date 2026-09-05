import { parseTralbum, fetchExtract } from "./lib/bandcamp";
import type { TralbumData } from "./lib/bandcamp";
import { getCards, setCards } from "./lib/storage";
import type { CardRecord } from "./lib/types";

const BANDCAMP_MATCH = "*://*.bandcamp.com/*";
const FETCH_STAGGER_MS = 2000;

chrome.action.onClicked.addListener(() => openGrid());

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

  for (const c of fetchJobs) {
    await applyUpdate(await extractOne(c, tabsByUrl.get(c.url)));
    await new Promise((r) => setTimeout(r, FETCH_STAGGER_MS));
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "sync") {
    sync().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
  return false;
});
