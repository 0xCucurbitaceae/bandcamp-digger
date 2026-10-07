// Puts our view on Bandcamp's own pages. With `?view=digger` — or with the
// "digger by default" setting on, unless `?view=bandcamp` — the page is
// covered by a full-size frame of src/label (release list + player), fed with
// the releases read off this very page. Otherwise it only plants a button that
// switches to that view, in place.
//
// Reading the releases here rather than in the background is the whole point:
// the content script sees the real, rendered page (and, for a wishlist, can
// call Bandcamp's own paginated API with the page's own session cookie), so
// there's no stripped-page trap. The frame is an extension page rather than
// UI built into Bandcamp's DOM because only an extension page may fetch the
// bcbits streams for waveforms — a bandcamp.com origin gets no CORS header.
//
// Also answers the extension's wishlist requests, for the same session reason.

import { parseFromDom } from "../lib/bandcamp";
import type { TralbumData } from "../lib/bandcamp";
import { readDiscography } from "../lib/discography";
import type { DiscographyItem } from "../lib/discography";
import { viewOf, withView } from "../lib/digger";
import { getSettings } from "../lib/storage";
import type { CollectionKind } from "../lib/storage";
import { readFullWishlist } from "../lib/wishlist";

const GRID_BUTTON_ID = "btm-listen-to-all";
const WISHLIST_BUTTON_ID = "btm-listen-to-wishlist";
const ALBUM_BUTTON_ID = "btm-digger-view";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pageBlob(): Record<string, any> | null {
  const raw = document.getElementById("pagedata")?.getAttribute("data-blob");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Which collection our view would show for this page — no network, so it can
 *  decide whether to cover the page before anything is read. */
function pageKind(): CollectionKind | null {
  // `#pagedata`'s `wishlist_data` is on a fan page whichever tab is active
  // (verified live — item_count was there even with `active_tab: "collection"`).
  if (location.hostname === "bandcamp.com" && pageBlob()?.wishlist_data?.item_count) return "wishlist";
  if (document.querySelector("#music-grid")) return "label";
  if (document.querySelector("[data-tralbum]")) return "album";
  return null;
}

/** The setting only takes over the pages it names — a fan's collection tab
 *  stays Bandcamp's own; their wishlist is one ?view=digger away from there. */
function takenOverByDefault(kind: CollectionKind): boolean {
  return kind !== "wishlist" || /\/wishlist\/?$/.test(location.pathname);
}

interface PageCollection {
  kind: CollectionKind;
  id: string;
  url: string;
  name: string;
  items: DiscographyItem[];
  /** a single album page's own data-tralbum — nothing left to fetch */
  data: TralbumData | null;
}

async function readPage(kind: CollectionKind): Promise<PageCollection | null> {
  if (kind === "wishlist") {
    const wishlist = await readFullWishlist(document);
    if (!wishlist) return null;
    const user = location.pathname.split("/")[1] || wishlist.fanName;
    return {
      kind,
      id: user,
      url: `${location.origin}/${user}/wishlist`,
      name: wishlist.fanName ? `${wishlist.fanName}'s wishlist` : "Wishlist",
      items: wishlist.items,
      data: null,
    };
  }
  if (kind === "label") {
    const disco = readDiscography(document, location.origin);
    if (!disco) return null;
    return { kind, id: location.host, url: location.origin, name: disco.bandName || location.host, items: disco.items, data: null };
  }
  const data = parseFromDom(document);
  if (!data) return null;
  const url = `${location.origin}${location.pathname}`;
  return {
    kind,
    id: url,
    url,
    name: data.artist ? `${data.album} — ${data.artist}` : data.album,
    items: [{ url, title: data.album, artist: data.artist || null, artUrl: data.artUrl }],
    data,
  };
}

/** Covers the page with our view. false (page left as it was) if there turned
 *  out to be nothing to show, or the extension was reloaded under the page. */
async function showDigger(kind: CollectionKind): Promise<boolean> {
  // Up front, so the native page doesn't sit there while a big wishlist pages in.
  const cover = document.createElement("div");
  Object.assign(cover.style, { position: "fixed", inset: "0", zIndex: "2147483647", background: "#131313" });
  document.documentElement.append(cover);
  const root = document.documentElement.style;
  const prevOverflow = root.overflow;
  root.overflow = "hidden";

  try {
    const page = await readPage(kind);
    if (!page || page.items.length === 0) throw new Error("nothing to show");
    await chrome.runtime.sendMessage({ type: "storeCollection", ...page });

    const frame = document.createElement("iframe");
    frame.src = chrome.runtime.getURL(`src/label/index.html?kind=${page.kind}&id=${encodeURIComponent(page.id)}`);
    frame.allow = "autoplay";
    Object.assign(frame.style, { display: "block", width: "100%", height: "100%", border: "0" });
    // Keyboard into our view — Bandcamp binds space on its own document, and
    // would otherwise start its hidden player underneath.
    frame.addEventListener("load", () => frame.focus());
    cover.append(frame);
    return true;
  } catch {
    cover.remove();
    root.overflow = prevOverflow;
    return false;
  }
}

// --- the native page's buttons --------------------------------------------------

function styleButton(btn: HTMLButtonElement) {
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    margin: "0 0 18px",
    padding: "9px 16px",
    font: "inherit",
    fontSize: "13px",
    fontWeight: "500",
    color: "#fff",
    background: "#1da0c3",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
}

function diggerButton(id: string, label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.textContent = label;
  styleButton(btn);
  btn.addEventListener("click", () => location.assign(withView(location.href, "digger")));
  return btn;
}

function mountDiscography() {
  if (document.getElementById(GRID_BUTTON_ID)) return;
  const grid = document.querySelector("#music-grid");
  if (!grid) return;
  const disco = readDiscography(document, location.origin);
  // One release isn't a catalogue — the album page's own button covers that.
  if (!disco || disco.items.length < 2) return;
  grid.parentElement?.insertBefore(diggerButton(GRID_BUTTON_ID, `▶  Listen to all ${disco.items.length} releases`), grid);
}

/**
 * A fan page is a Vue SPA whose wishlist grid only renders once you're on that
 * tab, which made waiting for `#wishlist-items` fragile. `.fan-bio-inner` (the
 * header: name/follow/stats) is there from the first render, tab-independent,
 * so the button goes there once instead of chasing the wishlist grid's mount.
 */
function mountWishlist() {
  if (document.getElementById(WISHLIST_BUTTON_ID)) return;
  const header = document.querySelector(".fan-bio-inner");
  if (!header || pageKind() !== "wishlist") return;
  const btn = diggerButton(WISHLIST_BUTTON_ID, "▶  Listen to wishlist");
  btn.style.marginTop = "14px"; // sits after the bio/follow content, not flush against it
  header.appendChild(btn);
}

function mountAlbum() {
  if (document.getElementById(ALBUM_BUTTON_ID) || document.querySelector("#music-grid")) return;
  const info = document.querySelector("#trackInfoInner");
  if (!info || !document.querySelector("[data-tralbum]")) return;
  info.prepend(diggerButton(ALBUM_BUTTON_ID, "▶  Digger view"));
}

function mountButtons() {
  mountDiscography();
  mountWishlist();
  mountAlbum();
}

// --- wishlist requests from the extension ----------------------------------------

type CollectResult = { ok: true } | { ok: false; error: "logged-out" | "failed" };

/**
 * Bandcamp's own wishlist heart, replayed: its FanControls POST these four
 * fields to /collect_item_cb (/uncollect_item_cb to remove) on whatever host
 * the page is on, plus that endpoint's crumb from #js-crumbs-data. A stale
 * crumb is answered with {error: "invalid_crumb", crumb} to retry with — their
 * Crumb.ajax does exactly this, up to twice.
 */
async function collectItem(req: { add: boolean; itemId: string; itemType: string; bandId: string }): Promise<CollectResult> {
  const fanId = pageBlob()?.identities?.fan?.id;
  if (!fanId) return { ok: false, error: "logged-out" };

  const endpoint = req.add ? "collect_item_cb" : "uncollect_item_cb";
  let crumb: string | undefined;
  try {
    crumb = JSON.parse(document.getElementById("js-crumbs-data")?.dataset.crumbs ?? "{}")[endpoint];
  } catch {
    // no crumbs on the page — the first response hands one over
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const body = new URLSearchParams({ fan_id: String(fanId), item_id: req.itemId, item_type: req.itemType, band_id: req.bandId });
    if (crumb) body.set("crumb", crumb);
    let json: { ok?: boolean; error?: string; crumb?: string } | null;
    try {
      const res = await fetch(`/${endpoint}`, { method: "POST", body, credentials: "same-origin" });
      json = await res.json();
    } catch {
      return { ok: false, error: "failed" };
    }
    if (json?.error === "invalid_crumb" && json.crumb) {
      crumb = json.crumb;
      continue;
    }
    return json?.ok === true ? { ok: true } : { ok: false, error: "failed" };
  }
  return { ok: false, error: "failed" };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "collectItem") return false;
  collectItem(msg).then(sendResponse);
  return true;
});

// --- entry ----------------------------------------------------------------------

async function main() {
  const kind = pageKind();
  const view = viewOf(location.href);
  if (kind && view !== "bandcamp") {
    const want = view === "digger" || (takenOverByDefault(kind) && (await getSettings()).diggerByDefault);
    if (want && (await showDigger(kind))) return;
  }

  mountButtons();
  // Debounced: a fan page's tab switches (and the grid's own lazy content)
  // mutate the DOM continuously — re-check on quiet, not on every mutation.
  let mutationTimer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(mountButtons, 300);
  }).observe(document.body, { childList: true, subtree: true });
}

main();
