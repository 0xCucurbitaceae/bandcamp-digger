import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCollection, setCollection, getUiConfig, setUiConfig, onCollectionChange, onStorageChange } from "../../lib/storage";
import type { CollectionKind } from "../../lib/storage";
import type { CardRecord, LabelCollection, ListColumnId, UiConfig } from "../../lib/types";
import { DEFAULT_UI_CONFIG } from "../../lib/types";
import { usePlayer } from "../../hooks/usePlayer";

const NO_CARDS: CardRecord[] = [];

/**
 * Collection page state: one collection out of storage, plus the shared
 * player. Serves both a label/artist catalogue and a fan's wishlist — same
 * `LabelCollection` shape either way (see storage.ts's `CollectionKind`),
 * so this one hook + page covers both rather than cloning it a second time.
 * The background walks the collection and writes tracklists in as they
 * land, so everything here is driven by storage changes, not local fetching.
 */
export function useLabel() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const id = useMemo(() => params.get("id") ?? "", [params]);
  const kind = useMemo<CollectionKind>(() => (params.get("kind") === "wishlist" ? "wishlist" : "label"), [params]);
  const [collection, setLocalCollection] = useState<LabelCollection | null>(null);
  const [uiConfig, setUiConfigState] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    getCollection(kind, id).then((col) => {
      setLocalCollection(col);
      setLoaded(true);
    });
    getUiConfig().then(setUiConfigState);
    const offCollection = onCollectionChange(kind, id, setLocalCollection);
    const offUi = onStorageChange((changes) => {
      if (changes.uiConfig) setUiConfigState(changes.uiConfig);
    });
    // Kicks the collection read, and resumes it after a reload — the background
    // only ever queues releases that still have no tracklist. Repeating it
    // covers the service worker being torn down partway through a long
    // catalogue/wishlist: a fresh worker just picks up the releases still pending.
    const kick = () => chrome.runtime.sendMessage({ type: "loadCollection", kind, id });
    kick();
    const timer = setInterval(kick, 60_000);
    return () => {
      clearInterval(timer);
      offCollection();
      offUi();
    };
  }, [kind, id]);

  const cards = collection?.cards ?? NO_CARDS;

  /** Re-reads before writing: the background is writing tracklists into this
   *  same collection while the user clicks around in it. */
  const persistCard = useCallback(
    async (updated: CardRecord) => {
      setLocalCollection((prev) =>
        prev ? { ...prev, cards: prev.cards.map((c) => (c.id === updated.id ? updated : c)) } : prev
      );
      const col = await getCollection(kind, id);
      if (!col) return;
      const idx = col.cards.findIndex((c) => c.id === updated.id);
      if (idx === -1) return;
      col.cards[idx] = updated;
      await setCollection(kind, col);
    },
    [kind, id]
  );

  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 1800);
  }, []);

  const player = usePlayer({
    cards,
    ordered: cards,
    persistCard,
    // kind+id routes the refreshed card back into this collection rather than
    // the tab grid's cards key.
    refreshTrack: (cardId) => chrome.runtime.sendMessage({ type: "refreshTrack", cardId, collectionKind: kind, collectionId: id }),
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

  /** Same as the injected page's "Listen to all" button, triggered from a
   *  single release row instead — fetches that artist's whole catalogue in
   *  the background and opens it as a (possibly different) label collection. */
  const listenToArtist = useCallback(
    async (card: CardRecord) => {
      toast("Reading artist's catalogue…");
      const res = await chrome.runtime.sendMessage({ type: "openLabelFromRelease", url: card.url });
      if (!res?.ok) toast("Couldn't read that artist's catalogue");
    },
    [toast]
  );

  const loadedCount = useMemo(() => cards.filter((c) => c.status !== "pending").length, [cards]);

  return {
    ...player,
    kind,
    labelId: id,
    collection,
    /** false only for the first tick, before storage has answered */
    loaded,
    cards,
    loadedCount,
    toast: toastMsg,
    listColumnOrder: uiConfig.listColumnOrder,
    listColumnSizing: uiConfig.listColumnSizing,
    setListColumns,
    openRelease,
    listenToArtist,
  };
}
