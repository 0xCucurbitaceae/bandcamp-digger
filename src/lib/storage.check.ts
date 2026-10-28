// Self-check for the serialized write chain — the non-trivial part of
// storage.ts. chrome.storage offers no atomic read-modify-write, so a sync
// extracting 100 tabs concurrently used to lose all but the last writer's
// update. Everything else here is a get/set one-liner.
//   node --experimental-strip-types src/lib/storage.check.ts
import assert from "node:assert/strict";
import type { CardRecord } from "./types.ts";

// Minimal chrome.storage.local stub. The delay is the whole point: it forces
// the get and the set of one update to sit either side of an await, which is
// exactly the window an unsynchronized read-modify-write loses writes in.
const store: Record<string, unknown> = {};
const tick = () => new Promise((r) => setTimeout(r, 1));
(globalThis as any).chrome = {
  storage: {
    local: {
      async get(key: string) {
        await tick();
        return { [key]: store[key] };
      },
      async set(obj: Record<string, unknown>) {
        await tick();
        Object.assign(store, obj);
      },
    },
  },
};

const { getCards, updateCards, updateCollection } = await import("./storage.ts");

const card = (id: string): CardRecord => ({
  id,
  url: `https://x.bandcamp.com/album/${id}`,
  tabId: null,
  title: null,
  favIconUrl: null,
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
  order: Number(id),
  archived: false,
});

const N = 50;
store.cards = Array.from({ length: N }, (_, i) => card(String(i)));

// The real thing: N extractions finishing at once, each rewriting one card.
await Promise.all(
  Array.from({ length: N }, (_, i) =>
    updateCards((cards) => cards.map((c) => (c.id === String(i) ? { ...c, status: "ready" } : c)))
  )
);
const after = await getCards();
assert.equal(
  after.filter((c) => c.status === "ready").length,
  N,
  "concurrent updateCards lost writes — the chain isn't serializing"
);

// Same guarantee for a collection walk writing tracklists in one at a time.
store["label:x"] = { id: "x", url: "https://x.bandcamp.com", name: "X", cards: [card("a"), card("b")] };
await Promise.all(
  ["a", "b"].map((id) =>
    updateCollection("label", "x", (col) => ({
      ...col,
      cards: col.cards.map((c) => (c.id === id ? { ...c, status: "ready" } : c)),
    }))
  )
);
const col = store["label:x"] as { cards: CardRecord[] };
assert.deepEqual(col.cards.map((c) => c.status), ["ready", "ready"]);

// A collection deleted mid-walk is a no-op, not a resurrection.
assert.equal(await updateCollection("label", "gone", (c) => c), null);
assert.equal(store["label:gone"], undefined);

console.log("storage write chain: ok");
