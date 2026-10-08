import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCollection, updateCollection, getUiConfig, setUiConfig, onCollectionChange, onStorageChange, parseKind } from "../../lib/storage";
import type { CollectionKind } from "../../lib/storage";
import type { CardRecord, LabelCollection, ListColumnId, UiConfig } from "../../lib/types";
import { DEFAULT_UI_CONFIG } from "../../lib/types";
import { artistDiggerUrl, withView } from "../../lib/digger";
import { usePlayer } from "../../hooks/usePlayer";
import { useWishlist } from "../../hooks/useWishlist";

const NO_CARDS: CardRecord[] = [];

/**
 * Collection page state: one collection out of storage, plus the shared
 * player. Serves a label/artist catalogue, a fan's wishlist and a single
 * album — same `LabelCollection` shape each time (see storage.ts's
 * `CollectionKind`). The background walks the collection and writes
 * tracklists in as they land, so everything here is driven by storage
 * changes, not local fetching.
 *
 * Lives inside the Bandcamp page it was read from (content/listenAll.ts frames
 * it in), so "the current tab" is that Bandcamp tab — navigating it is how
 * this view moves between artists.
 */
export function useLabel() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const id = useMemo(() => params.get("id") ?? "", [params]);
  const kind = useMemo<CollectionKind>(() => parseKind(params.get("kind")), [params]);
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

  /** Re-reads before writing, inside the serialized write chain: the background
   *  is writing tracklists into this same collection while the user clicks
   *  around in it, and a read-then-write pair would drop whatever landed
   *  between the two. */
  const persistCard = useCallback(
    async (updated: CardRecord) => {
      setLocalCollection((prev) =>
        prev ? { ...prev, cards: prev.cards.map((c) => (c.id === updated.id ? updated : c)) } : prev
      );
      await updateCollection(kind, id, (col) => ({
        ...col,
        cards: col.cards.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      }));
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

  const wishlist = useWishlist(toast);

  const openRelease = useCallback((card: CardRecord) => {
    chrome.tabs.create({ url: card.url });
  }, []);

  /** Navigates the tab this view is framed in — so Back returns here. */
  const navigateTab = useCallback(async (url: (current: string) => string) => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id && tab.url) chrome.tabs.update(tab.id, { url: url(tab.url) });
  }, []);

  /** This release's artist/label catalogue, in place of this view. */
  const listenToArtist = useCallback((card: CardRecord) => navigateTab(() => artistDiggerUrl(card.url)), [navigateTab]);

  /** Bandcamp's own page for what's on screen — same URL, ?view=bandcamp, which
   *  also holds when the "digger by default" setting is on. */
  const showNative = useCallback(() => navigateTab((current) => withView(current, "bandcamp")), [navigateTab]);

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
    showNative,
    ...wishlist,
  };
}
