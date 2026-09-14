// Reads a fan's wishlist or collection off bandcamp.com/<user>. A fan page is
// a Vue SPA that renders almost nothing into the DOM — everything lives in the
// #pagedata JSON blob, and that blob only carries a usable first batch for
// whichever tab is *active* (verified live: on /wishlist, `collection_data.
// sequence` is empty while `wishlist_data.sequence` has the first 20 — and
// vice versa). Seeding from the blob and paging from its `last_token` therefore
// silently dropped the first batch whenever the other tab was the active one.
//
// So the blob is only used for identity (fan id/name) and counts; every item
// comes from Bandcamp's own fan-collection API, walked from a token in the
// future so the very first page is the newest item. That needs the page's
// first-party bandcamp.com session, which is why this runs in the content
// script and not the background service worker.

import type { DiscographyItem } from "./discography";

export type FanListKind = "wishlist" | "collection";

const ENDPOINT: Record<FanListKind, string> = {
  wishlist: "wishlist_items",
  collection: "collection_items",
};

const PAGE_SIZE = 100;

/** A token newer than any item, so the first page starts at the top of the list. */
const newestToken = () => `${Math.floor(Date.now() / 1000) + 3600}::a::`;

interface ApiItem {
  item_url?: string;
  item_title?: string;
  band_name?: string;
  item_art_url?: string;
  item_art?: { url?: string };
  item_art_id?: number | string;
}

function toItem(raw: ApiItem): DiscographyItem | null {
  if (!raw.item_url) return null;
  return {
    url: raw.item_url,
    title: (raw.item_title ?? "").trim(),
    artist: raw.band_name?.trim() || null,
    artUrl:
      raw.item_art_url ??
      raw.item_art?.url ??
      (raw.item_art_id != null ? `https://f4.bcbits.com/img/a${raw.item_art_id}_10.jpg` : null),
  };
}

export interface FanPageData {
  fanId: number;
  fanName: string;
  /** how many items each list holds — a button is only worth showing for a non-empty one */
  counts: Record<FanListKind, number>;
  /** the blob's own partial caches, used only if the API is unreachable */
  cached: Record<FanListKind, ApiItem[]>;
}

/** Identity + counts off #pagedata. Present regardless of which tab is active. */
export function readFanPageData(doc: Document): FanPageData | null {
  const raw = doc.getElementById("pagedata")?.getAttribute("data-blob");
  if (!raw) return null;

  let blob: {
    fan_data?: { fan_id?: number; name?: string; username?: string };
    wishlist_data?: { item_count?: number };
    collection_data?: { item_count?: number };
    item_cache?: Partial<Record<FanListKind, Record<string, ApiItem>>>;
  };
  try {
    blob = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!blob.fan_data?.fan_id) return null;

  return {
    fanId: blob.fan_data.fan_id,
    fanName: blob.fan_data.name || blob.fan_data.username || "",
    counts: {
      wishlist: blob.wishlist_data?.item_count ?? 0,
      collection: blob.collection_data?.item_count ?? 0,
    },
    cached: {
      wishlist: Object.values(blob.item_cache?.wishlist ?? {}),
      collection: Object.values(blob.item_cache?.collection ?? {}),
    },
  };
}

/** One page of Bandcamp's own fan-collection API — the same endpoint the page calls itself. */
async function fetchPage(
  kind: FanListKind,
  fanId: number,
  olderThanToken: string
): Promise<{ items: DiscographyItem[]; nextToken: string | null }> {
  const res = await fetch(`https://bandcamp.com/api/fancollection/1/${ENDPOINT[kind]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fan_id: fanId, older_than_token: olderThanToken, count: PAGE_SIZE }),
  });
  if (!res.ok) return { items: [], nextToken: null };

  const json = (await res.json()) as { items?: ApiItem[]; more_available?: boolean; last_token?: string };
  const items = (json.items ?? []).map(toItem).filter((x): x is DiscographyItem => !!x);
  const nextToken = json.more_available ? json.last_token ?? null : null;
  return { items, nextToken };
}

/** Walks a fan's whole list, newest first. Deduped by release URL. */
export async function readFanList(
  doc: Document,
  kind: FanListKind
): Promise<{ fanName: string; items: DiscographyItem[] } | null> {
  const page = readFanPageData(doc);
  if (!page) return null;

  const byUrl = new Map<string, DiscographyItem>();
  let token: string | null = newestToken();
  while (token) {
    const batch: { items: DiscographyItem[]; nextToken: string | null } = await fetchPage(kind, page.fanId, token);
    if (batch.items.length === 0) break;
    for (const item of batch.items) byUrl.set(item.url, item);
    token = batch.nextToken;
    // Politeness stagger, not the strict 2s BANDCAMP.md uses for release-page
    // scraping — this is Bandcamp's own paginated collection API, much lighter.
    if (token) await new Promise((r) => setTimeout(r, 400));
  }

  // API unreachable (offline, or a private list) — fall back to whatever the
  // page blob already had rather than showing nothing.
  if (byUrl.size === 0)
    for (const item of page.cached[kind].map(toItem)) if (item) byUrl.set(item.url, item);

  return { fanName: page.fanName, items: [...byUrl.values()] };
}
