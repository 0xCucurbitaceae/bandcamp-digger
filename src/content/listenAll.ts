// Injects a "Listen to all"/"Listen to wishlist" button above a Bandcamp
// release grid or a fan's wishlist. Reading the releases here rather than in
// the background is the whole point: the content script sees the real,
// rendered page (and, for a wishlist, can call Bandcamp's own paginated API
// with the page's own session cookie), so there's no stripped-page trap.

import { readDiscography } from "../lib/discography";
import { readFullWishlist } from "../lib/wishlist";

const GRID_BUTTON_ID = "btm-listen-to-all";
const WISHLIST_BUTTON_ID = "btm-listen-to-wishlist";

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
      });
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
 * A fan page is a Vue SPA — switching from "collection" to "wishlist" doesn't
 * reload the page, and the wishlist tab's own grid only renders once you're
 * actually looking at it, which made waiting for `#wishlist-items` fragile
 * (it depends on catching the right DOM mutation at the right time).
 *
 * Sidesteps that entirely: `#pagedata`'s `wishlist_data` is present at load
 * regardless of which tab is active (verified live — item_count was there
 * even with `active_tab: "collection"`), and `.fan-bio-inner` (the header,
 * name/follow/stats) is present from the first render, tab-independent. So
 * this reads the count from the blob and plants the button in the header
 * once, instead of chasing the wishlist grid's own mount.
 */
function mountWishlist() {
  if (document.getElementById(WISHLIST_BUTTON_ID)) return;

  const header = document.querySelector(".fan-bio-inner");
  if (!header) return;

  const raw = document.getElementById("pagedata")?.getAttribute("data-blob");
  if (!raw) return;
  let itemCount: number | undefined;
  try {
    itemCount = JSON.parse(raw).wishlist_data?.item_count;
  } catch {
    return;
  }
  if (!itemCount) return;

  const btn = document.createElement("button");
  btn.id = WISHLIST_BUTTON_ID;
  btn.type = "button";
  btn.textContent = "▶  Listen to wishlist";
  styleButton(btn);
  btn.style.marginTop = "14px"; // sits after the bio/follow content, not flush against it

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Reading wishlist…";
    const wishlist = await readFullWishlist(document).catch(() => null);
    if (!wishlist || wishlist.items.length === 0) {
      btn.textContent = "Couldn't read the wishlist";
      btn.disabled = false;
      return;
    }
    btn.textContent = "Opening…";
    try {
      await chrome.runtime.sendMessage({
        type: "openWishlist",
        id: location.pathname.split("/")[1] || wishlist.fanName,
        url: location.href,
        name: wishlist.fanName ? `${wishlist.fanName}'s wishlist` : "Wishlist",
        items: wishlist.items,
      });
    } catch {
      btn.textContent = "Couldn't open — reload the page";
      return;
    }
    btn.disabled = false;
    btn.textContent = "▶  Listen to wishlist";
  });

  header.appendChild(btn);
}

function mountAll() {
  mountDiscography();
  mountWishlist();
}

mountAll();

// Debounced: a fan page's tab switches (and the grid's own lazy content)
// mutate the DOM continuously — re-check on quiet, not on every mutation.
let mutationTimer: ReturnType<typeof setTimeout> | undefined;
new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(mountAll, 300);
}).observe(document.body, { childList: true, subtree: true });
