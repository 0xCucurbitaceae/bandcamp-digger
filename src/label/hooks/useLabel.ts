import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCollection, updateCollection, getUiConfig, setUiConfig, onCollectionChange, onStorageChange, parseCollectionKind } from "../../lib/storage";
import type { CollectionKind } from "../../lib/storage";
import type { CardRecord, LabelCollection, ListColumnId, UiConfig } from "../../lib/types";
import { DEFAULT_UI_CONFIG } from "../../lib/types";
import { usePlayer } from "../../hooks/usePlayer";
import { filterCards } from "../../lib/search";

const NO_CARDS: CardRecord[] = [];

/** One collection, addressed the way storage addresses it. */
interface ViewRef {
  kind: CollectionKind;
  id: string;
}

const viewKey = (v: ViewRef) => `${v.kind}:${v.id}`;

const parseKey = (key: string): ViewRef => {
  const sep = key.indexOf(":");
  return { kind: key.slice(0, sep) as CollectionKind, id: key.slice(sep + 1) };
};

const viewFromSearch = (search: string): ViewRef => {
  const params = new URLSearchParams(search);
  return { kind: parseCollectionKind(params.get("kind")), id: params.get("id") ?? "" };
};

/**
 * Collection page state: a *stack* of collections out of storage, plus the
 * shared player. Serves both a label/artist catalogue and a fan's wishlist —
 * same `LabelCollection` shape either way (see storage.ts's `CollectionKind`),
 * so this one hook + page covers both rather than cloning it a second time.
 * The background walks the collection and writes tracklists in as they
 * land, so everything here is driven by storage changes, not local fetching.
 *
 * The stack is what makes "listen to this artist" swap the list in place
 * instead of opening a tab: the page is entirely parameterised by kind+id, so
 * drilling in is a state change. Every collection the stack has visited stays
 * subscribed and stays in the player's card pool, so a track that started in
 * the parent keeps playing after you drill into a child (usePlayer resolves
 * `current` out of `cards`, and would drop the track if it vanished from it) —
 * only prev/next follow the visible list.
 */
export function useLabel() {
  const [stack, setStack] = useState<ViewRef[]>(() => [viewFromSearch(location.search)]);
  const view = stack[stack.length - 1];
  /** Rendered inside a Bandcamp page's overlay frame rather than as its own
   *  tab — the page behind already says which collection this is, so the
   *  header shrinks to what the frame can't do without (see `close`). */
  const embed = useMemo(() => new URLSearchParams(location.search).get("embed") === "1", []);
  const [collections, setCollections] = useState<Record<string, LabelCollection | null>>({});
  const [uiConfig, setUiConfigState] = useState<UiConfig>(DEFAULT_UI_CONFIG);

  // Browser back walks the stack; the whole stack rides in history.state so a
  // back/forward lands on exactly the trail the user built.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const restored = (e.state as { stack?: ViewRef[] } | null)?.stack;
      setStack(restored?.length ? restored : [viewFromSearch(location.search)]);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const stackKey = stack.map(viewKey).join("|");
  // Subscribes every collection on the stack, not just the visible one: the
  // background is still filling in the parent's tracklists while you're
  // looking at a child. Deps are the flattened stack — the array itself is a
  // fresh reference on every render.
  useEffect(() => {
    const offs = stack
      .filter((v) => v.id)
      .map((v) => {
        const key = viewKey(v);
        const put = (col: LabelCollection | null) => setCollections((prev) => ({ ...prev, [key]: col }));
        getCollection(v.kind, v.id).then(put);
        const off = onCollectionChange(v.kind, v.id, put);
        // Kicks the collection read, and resumes it after a reload — the background
        // only ever queues releases that still have no tracklist. Repeating it
        // covers the service worker being torn down partway through a long
        // catalogue/wishlist: a fresh worker just picks up the releases still pending.
        const kick = () => chrome.runtime.sendMessage({ type: "loadCollection", kind: v.kind, id: v.id });
        kick();
        const timer = setInterval(kick, 60_000);
        return () => {
          clearInterval(timer);
          off();
        };
      });
    return () => offs.forEach((f) => f());
  }, [stackKey]);

  useEffect(() => {
    getUiConfig().then(setUiConfigState);
    return onStorageChange((changes) => {
      if (changes.uiConfig) setUiConfigState(changes.uiConfig);
    });
  }, []);

  const collection = collections[viewKey(view)] ?? null;
  const allOfView = collection?.cards ?? NO_CARDS;
  // Filters the visible list and, with it, what prev/next walks. The player's
  // pool stays `allCards`, so a filtered-out track keeps playing.
  const [query, setQuery] = useState("");
  const cards = useMemo(() => filterCards(allOfView, query), [allOfView, query]);
  /** Every card the page has loaded, across the whole stack — the player's lookup pool. */
  const allCards = useMemo(
    () => Object.values(collections).flatMap((c) => c?.cards ?? []),
    [collections]
  );

  /** Every loaded collection holding this card. Usually one — but a release sits
   *  in both a label and the artist you drilled into from it, so `allCards` can
   *  hold two copies of it and both have to be kept in step. Insertion order, so
   *  the first entry is the same copy `allCards` (and therefore the player's
   *  `current`) resolves to. */
  const ownersOf = useCallback(
    (cardId: string): ViewRef[] =>
      Object.entries(collections)
        .filter(([, col]) => col?.cards.some((c) => c.id === cardId))
        .map(([key]) => parseKey(key)),
    [collections]
  );

  /** Re-reads before writing, inside the serialized write chain: the background
   *  is writing tracklists into this same collection while the user clicks
   *  around in it, and a read-then-write pair would drop whatever landed
   *  between the two. Writes every copy, so the visible list and the player
   *  never disagree about the selected track. */
  const persistCard = useCallback(
    async (updated: CardRecord) => {
      for (const owner of ownersOf(updated.id)) {
        const key = viewKey(owner);
        setCollections((prev) => {
          const col = prev[key];
          if (!col) return prev;
          return { ...prev, [key]: { ...col, cards: col.cards.map((c) => (c.id === updated.id ? updated : c)) } };
        });
        await updateCollection(owner.kind, owner.id, (col) => ({
          ...col,
          cards: col.cards.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
        }));
      }
    },
    [ownersOf]
  );

  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 1800);
  }, []);

  const player = usePlayer({
    cards: allCards,
    ordered: cards,
    persistCard,
    // kind+id routes the refreshed card back into the collection that owns it
    // rather than the tab grid's cards key — and that is not necessarily the
    // visible one, since a parent's track can still be playing.
    refreshTrack: (cardId) => {
      // First owner only: that is the copy `current` reads, so that is the one
      // whose fresh streamUrl the audio element will actually pick up. Any
      // other copy refreshes on its own next 410.
      const owner = ownersOf(cardId)[0] ?? view;
      chrome.runtime.sendMessage({ type: "refreshTrack", cardId, collectionKind: owner.kind, collectionId: owner.id });
    },
    onToast: toast,
  });

  const setListColumns = useCallback(
    (order: ListColumnId[], sizing: Partial<Record<ListColumnId, number>>) =>
      setUiConfigState((prev) => {
        const next = { ...prev, listColumnOrder: order, listColumnSizing: sizing };
        setUiConfig(next);
        return next;
      }),
    []
  );

  const openRelease = useCallback((card: CardRecord) => {
    chrome.tabs.create({ url: card.url });
  }, []);

  /** Drills into another collection in place. */
  const open = useCallback(
    (next: ViewRef) => {
      if (viewKey(view) === viewKey(next)) return;
      const nextStack = [...stack, next];
      // embed rides along, so a reload of the frame comes back as a frame.
      const query = `?id=${encodeURIComponent(next.id)}&kind=${next.kind}${embed ? "&embed=1" : ""}`;
      history.pushState({ stack: nextStack }, "", query);
      setStack(nextStack);
    },
    [stack, view, embed]
  );

  const back = useCallback(() => {
    if (stack.length > 1) history.back();
  }, [stack.length]);

  /** Dismisses the overlay frame. Cross-origin, so this can only ask the
   *  Bandcamp page to hide it — which keeps this frame (and its audio) alive. */
  const close = useCallback(() => window.parent.postMessage({ type: "btmClose" }, "*"), []);

  useEffect(() => {
    if (!embed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embed, close]);

  /** Same as the injected page's "Listen to all" button, triggered from a
   *  single release row instead — fetches that artist's whole catalogue in
   *  the background and swaps the list onto it, without losing playback.
   *  (The tab grid sends the same message *without* `inline` and gets a tab —
   *  that standalone page is still the only way in from there.) */
  const listenToArtist = useCallback(
    async (card: CardRecord) => {
      toast("Reading artist's catalogue…");
      const res = await chrome.runtime.sendMessage({ type: "openLabelFromRelease", url: card.url, inline: true });
      if (res?.ok && res.id) open({ kind: "label", id: res.id });
      else toast("Couldn't read that artist's catalogue");
    },
    [toast, open]
  );

  const loadedCount = useMemo(() => cards.filter((c) => c.status !== "pending").length, [cards]);
  const parent = stack.length > 1 ? stack[stack.length - 2] : null;

  return {
    ...player,
    embed,
    close,
    kind: view.kind,
    labelId: view.id,
    collection,
    /** false only for the first tick, before storage has answered for this view */
    loaded: viewKey(view) in collections,
    cards,
    query,
    setQuery,
    loadedCount,
    toast: toastMsg,
    listColumnOrder: uiConfig.listColumnOrder,
    listColumnSizing: uiConfig.listColumnSizing,
    setListColumns,
    openRelease,
    listenToArtist,
    /** name of the collection one level up, or null at the root */
    parentName: parent ? collections[viewKey(parent)]?.name || parent.id : null,
    back,
  };
}
