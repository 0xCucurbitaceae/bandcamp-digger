// Reads a fan's full wishlist off bandcamp.com/<user>/wishlist. Unlike a
// label's release grid (mostly rendered server-side), the wishlist page is a
// Vue SPA that renders almost nothing into the DOM — everything lives in the
// #pagedata JSON blob, and only the first `batch_size` items (usually 20) are
// included there. The rest is paged in through Bandcamp's own fan-collection
// API, using the same session the page is already logged into — which is why
// this has to run in the content script, not the background service worker
// (no first-party bandcamp.com cookie there).

import type { DiscographyItem } from "./discography";

interface PageDataItem {
  item_url?: string;
  item_title?: string;
  band_name?: string;
  item_art_url?: string;
  item_art?: { url?: string };
  item_art_id?: number | string;
}

function artUrlFromId(artId: number | string | undefined): string | null {
  if (artId === undefined || artId === null) return null;
  return `https://f4.bcbits.com/img/a${artId}_10.jpg`;
}

function toItem(raw: PageDataItem): DiscographyItem | null {
  if (!raw.item_url) return null;
  return {
    url: raw.item_url,
    title: (raw.item_title ?? "").trim(),
    artist: raw.band_name?.trim() || null,
    artUrl: raw.item_art_url ?? raw.item_art?.url ?? artUrlFromId(raw.item_art_id),
  };
}

interface FirstPage {
  fanName: string;
  fanId: number;
  items: DiscographyItem[];
  /** pagination cursor for whatever's left beyond this first batch — null if there's nothing more */
  nextToken: string | null;
}

/** Reads whatever the page already rendered into #pagedata — the first batch, for free, no network. */
function readWishlistPage(doc: Document): FirstPage | null {
  const raw = doc.getElementById("pagedata")?.getAttribute("data-blob");
  if (!raw) return null;

  let blob: {
    fan_data?: { fan_id?: number; name?: string; username?: string };
    wishlist_data?: { sequence?: string[]; item_count?: number; last_token?: string };
    item_cache?: { wishlist?: Record<string, PageDataItem> };
  };
  try {
    blob = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!blob.wishlist_data || !blob.fan_data?.fan_id) return null;

  const cache = blob.item_cache?.wishlist ?? {};
  const sequence = blob.wishlist_data.sequence ?? [];
  const items = sequence
    .map((key) => cache[key])
    .filter((x): x is PageDataItem => !!x)
    .map(toItem)
    .filter((x): x is DiscographyItem => !!x);

  const itemCount = blob.wishlist_data.item_count ?? items.length;
  const nextToken = items.length < itemCount ? blob.wishlist_data.last_token ?? null : null;

  return {
    fanName: blob.fan_data.name || blob.fan_data.username || "",
    fanId: blob.fan_data.fan_id,
    items,
    nextToken,
  };
}

/** One more batch via Bandcamp's own fan-collection API — the same endpoint the
 *  wishlist page itself calls when you scroll for more. */
async function fetchWishlistBatch(
  fanId: number,
  olderThanToken: string
): Promise<{ items: DiscographyItem[]; nextToken: string | null }> {
  const res = await fetch("https://bandcamp.com/api/fancollection/1/wishlist_items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fan_id: fanId, older_than_token: olderThanToken, count: 20 }),
  });
  if (!res.ok) return { items: [], nextToken: null };

  const json = (await res.json()) as { items?: PageDataItem[]; more_available?: boolean; last_token?: string };
  const items = (json.items ?? []).map(toItem).filter((x): x is DiscographyItem => !!x);
  const nextToken = json.more_available ? json.last_token ?? null : null;
  return { items, nextToken };
}

/** Reads the first (already-rendered) batch, then walks the rest of the pagination. */
export async function readFullWishlist(doc: Document): Promise<{ fanName: string; items: DiscographyItem[] } | null> {
  const first = readWishlistPage(doc);
  if (!first) return null;

  const items = first.items.slice();
  let token = first.nextToken;
  // Politeness stagger, not the strict 2s BANDCAMP.md uses for release-page
  // scraping — this is Bandcamp's own paginated collection API, much lighter.
  while (token) {
    await new Promise((r) => setTimeout(r, 400));
    const batch = await fetchWishlistBatch(first.fanId, token);
    if (batch.items.length === 0) break;
    items.push(...batch.items);
    token = batch.nextToken;
  }

  return { fanName: first.fanName, items };
}
