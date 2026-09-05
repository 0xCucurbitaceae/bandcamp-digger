// Injects a "Listen to all" button above a Bandcamp release grid. Reading the
// catalogue here rather than in the background is the whole point: the content
// script sees the real, rendered page, so there's no stripped-page trap and no
// second request.

import { readDiscography } from "../lib/discography";

const BUTTON_ID = "btm-listen-to-all";

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

function mount() {
  if (document.getElementById(BUTTON_ID)) return;

  const grid = document.querySelector("#music-grid");
  if (!grid) return;

  const disco = readDiscography(document, location.origin);
  // One release isn't a catalogue — the normal player already covers that.
  if (!disco || disco.items.length < 2) return;

  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
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

mount();
