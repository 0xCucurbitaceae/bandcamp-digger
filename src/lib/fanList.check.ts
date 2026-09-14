import assert from "node:assert/strict";
import { readFanList, readFanPageData } from "./fanList.ts";

/** A fan page whose *collection* tab is active: wishlist_data has a count but its
 *  sequence/cache are empty — the exact shape that used to lose the first batch. */
function fakeDoc(blob: unknown): Document {
  return {
    getElementById: (id: string) =>
      id === "pagedata" ? { getAttribute: () => JSON.stringify(blob) } : null,
  } as unknown as Document;
}

const blob = {
  fan_data: { fan_id: 42, name: "Gaston" },
  wishlist_data: { item_count: 3, last_token: "100:9:a::" },
  collection_data: { item_count: 1 },
  item_cache: { wishlist: {}, collection: { "1": { item_url: "https://a.bandcamp.com/album/one" } } },
};

const page = readFanPageData(fakeDoc(blob))!;
assert.equal(page.fanId, 42);
assert.equal(page.counts.wishlist, 3, "wishlist count read even when its tab isn't active");
assert.equal(page.counts.collection, 1);

const item = (n: number) => ({ item_url: `https://a.bandcamp.com/album/${n}`, item_title: `t${n}`, band_name: "b" });

// Two pages, with the last item of page 1 repeated on page 2 (token boundaries overlap).
const pages = [
  { items: [item(1), item(2)], more_available: true, last_token: "2" },
  { items: [item(2), item(3)], more_available: false },
];
const calls: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (url: string, init: { body: string }) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, json: async () => pages[calls.length - 1] };
}) as unknown as typeof fetch;

const wishlist = (await readFanList(fakeDoc(blob), "wishlist"))!;
assert.deepEqual(
  wishlist.items.map((i) => i.title),
  ["t1", "t2", "t3"],
  "first batch included, pages walked, duplicates dropped"
);
assert.equal(wishlist.fanName, "Gaston");
assert.match(calls[0].url, /wishlist_items$/);
assert.notEqual(calls[0].body.older_than_token, blob.wishlist_data.last_token, "starts above the newest item, not after the blob's first batch");
assert.equal(calls[1].body.older_than_token, "2", "second page uses the API's own cursor");

calls.length = 0;
await readFanList(fakeDoc(blob), "collection");
assert.match(calls[0].url, /collection_items$/, "collection uses its own endpoint");

// API down: whatever the page blob already held beats showing nothing.
globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
const fallback = (await readFanList(fakeDoc(blob), "collection"))!;
assert.deepEqual(fallback.items.map((i) => i.url), ["https://a.bandcamp.com/album/one"]);

console.log("fanList.check ok");
