// Injects a "Listen to all"/"Play wishlist"/"Play collection" button above a
// Bandcamp release grid or on a fan's page. Reading the releases here rather
// than in the background is the whole point: the content script sees the real,
// rendered page (and, for a fan list, can call Bandcamp's own paginated API
// with the page's own session cookie), so there's no stripped-page trap.

import { readDiscography } from "../lib/discography";
import { readFanList, readFanPageData, type FanListKind } from "../lib/fanList";
import type { CollectionKind } from "../lib/storage";

const GRID_BUTTON_ID = "btm-listen-to-all";
const fanButtonId = (kind: FanListKind) => `btm-listen-to-${kind}`;

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

const OVERLAY_ID = "btm-overlay";

/** Bandcamp's page body — everything between the site header and footer, on
 *  both band pages and fan pages (verified live). Our frame takes its place. */
const pageBody = () => document.getElementById("pgBd");

function fitOverlay(frame: HTMLIFrameElement) {
  frame.style.height = `${Math.max(400, window.innerHeight - frame.getBoundingClientRect().top - 16)}px`;
}

/**
 * Swaps Bandcamp's page body for our list, in the same tab, leaving the site's
 * own header (and anything below the body) in place. Kept in the DOM (only
 * hidden) once dismissed — a removed frame stops its audio, a display:none one
 * keeps playing, so going back to browsing Bandcamp doesn't cut the music off.
 */
function showOverlay(kind: CollectionKind, id: string) {
  const body = pageBody();
  const src = chrome.runtime.getURL(
    `src/label/index.html?id=${encodeURIComponent(id)}&kind=${kind}&embed=1`
  );

  let frame = document.getElementById(OVERLAY_ID) as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = OVERLAY_ID;
    // No #pgBd (a page shape we haven't seen): fall back to covering the tab
    // rather than doing nothing.
    Object.assign(
      frame.style,
      body
        ? ({ display: "block", width: "100%", border: "none" } satisfies Partial<CSSStyleDeclaration>)
        : ({
            position: "fixed",
            inset: "0",
            width: "100%",
            height: "100%",
            border: "none",
            zIndex: "2147483647",
          } satisfies Partial<CSSStyleDeclaration>)
    );

    // The framed page is a different origin, so it can't hide itself — it asks.
    // Matching on `source` rather than origin: only that exact frame is obeyed.
    const self = frame;
    window.addEventListener("message", (e) => {
      if (e.source === self.contentWindow && (e.data as { type?: string } | null)?.type === "btmClose")
        hideOverlay();
    });
    window.addEventListener("resize", () => {
      if (self.style.position !== "fixed" && self.style.display !== "none") fitOverlay(self);
    });

    if (body) body.parentElement?.insertBefore(frame, body);
    else document.documentElement.appendChild(frame);
  }

  // Switching between a fan's collection and wishlist reuses the same frame.
  if (frame.src !== src) frame.src = src;
  frame.style.display = "block";

  if (body) {
    body.style.display = "none";
    window.scrollTo(0, 0);
    fitOverlay(frame);
  } else {
    document.documentElement.style.overflow = "hidden";
  }
}

function hideOverlay() {
  const frame = document.getElementById(OVERLAY_ID);
  if (frame) (frame as HTMLElement).style.display = "none";
  const body = pageBody();
  if (body) body.style.display = "";
  document.documentElement.style.overflow = "";
}

function mountDiscography() {
  if (document.getElementById(GRID_BUTTON_ID)) return;

  const grid = document.querySelector("#music-grid");
  if (!grid) return;

  const disco = readDiscography(document, location.origin);
  // One release isn't a catalogue — the normal player already covers that.
  if (!disco || disco.items.length < 2) return;

  const btn = document.createElement("button");
  btn.id = GRID_BUTTON_ID;
  btn.type = "button";
  btn.textContent = `▶  Listen to all ${disco.items.length} releases`;
  styleButton(btn);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Opening…";
    try {
      await chrome.runtime.sendMessage({
        type: "openLabel",
        id: location.host,
        url: location.origin,
        name: disco.bandName || location.host,
        items: disco.items,
        inline: true,
      });
      showOverlay("label", location.host);
    } catch {
      // Extension reloaded out from under the page — a refresh re-injects this.
      btn.textContent = "Couldn't open — reload the page";
      return;
    }
    btn.disabled = false;
    btn.textContent = `▶  Listen to all ${disco.items.length} releases`;
  });

  grid.parentElement?.insertBefore(btn, grid);
}

/**
 * A fan page is a Vue SPA — switching between the "collection" and "wishlist"
 * tabs doesn't reload the page, and each tab's grid only renders once you're
 * actually looking at it, which made waiting for `#wishlist-items` fragile
 * (it depends on catching the right DOM mutation at the right time).
 *
 * Sidesteps that entirely: `#pagedata` carries both lists' item counts at load
 * regardless of which tab is active, and `.fan-bio-inner` (the header,
 * name/follow/stats) is present from the first render, tab-independent. So this
 * reads the counts from the blob and plants a button per non-empty list in the
 * header once, instead of chasing either grid's own mount.
 */
function mountFanLists() {
  const header = document.querySelector(".fan-bio-inner");
  if (!header) return;

  const page = readFanPageData(document);
  if (!page) return;

  for (const kind of ["collection", "wishlist"] as const) {
    if (document.getElementById(fanButtonId(kind)) || !page.counts[kind]) continue;

    const label = `▶  Play ${kind} (${page.counts[kind]})`;
    const btn = document.createElement("button");
    btn.id = fanButtonId(kind);
    btn.type = "button";
    btn.textContent = label;
    styleButton(btn);
    btn.style.marginTop = "14px"; // sits after the bio/follow content, not flush against it
    btn.style.marginRight = "8px";

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = `Reading ${kind}…`;
      const list = await readFanList(document, kind).catch(() => null);
      if (!list || list.items.length === 0) {
        btn.textContent = `Couldn't read the ${kind}`;
        btn.disabled = false;
        return;
      }
      btn.textContent = "Opening…";
      const id = location.pathname.split("/")[1] || list.fanName;
      const owner = list.fanName ? `${list.fanName}'s` : "";
      try {
        await chrome.runtime.sendMessage({
          type: "openFanList",
          kind,
          id,
          url: location.href,
          name: `${owner} ${kind}`.trim(),
          items: list.items,
          inline: true,
        });
        showOverlay(kind, id);
      } catch {
        btn.textContent = "Couldn't open — reload the page";
        return;
      }
      btn.disabled = false;
      btn.textContent = label;
    });

    header.appendChild(btn);
  }
}

function mountAll() {
  mountDiscography();
  mountFanLists();
}

mountAll();

// Debounced: a fan page's tab switches (and the grid's own lazy content)
// mutate the DOM continuously — re-check on quiet, not on every mutation.
let mutationTimer: ReturnType<typeof setTimeout> | undefined;
new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(mountAll, 300);
}).observe(document.body, { childList: true, subtree: true });
