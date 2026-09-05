import { useCallback, useEffect, useMemo, useState } from "react";
import { getLabel, setLabel, getUiConfig, setUiConfig, onLabelChange, onStorageChange } from "../../lib/storage";
import type { CardRecord, LabelCollection, ListColumnId, UiConfig } from "../../lib/types";
import { DEFAULT_UI_CONFIG } from "../../lib/types";
import { usePlayer } from "../../hooks/usePlayer";

const NO_CARDS: CardRecord[] = [];

/** Label page state: one collection out of storage, plus the shared player.
 *  The background walks the catalogue and writes tracklists in as they land,
 *  so everything here is driven by storage changes rather than local fetching. */
export function useLabel() {
  const labelId = useMemo(() => new URLSearchParams(location.search).get("id") ?? "", []);
  const [collection, setCollection] = useState<LabelCollection | null>(null);
  const [uiConfig, setUiConfigState] = useState<UiConfig>(DEFAULT_UI_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!labelId) return;
    getLabel(labelId).then((col) => {
      setCollection(col);
      setLoaded(true);
    });
    getUiConfig().then(setUiConfigState);
    const offLabel = onLabelChange(labelId, setCollection);
    const offUi = onStorageChange((changes) => {
      if (changes.uiConfig) setUiConfigState(changes.uiConfig);
    });
    // Kicks the catalogue read, and resumes it after a reload — the background
    // only ever queues releases that still have no tracklist. Repeating it
    // covers the service worker being torn down partway through a long
    // catalogue: a fresh worker just picks up the releases still pending.
    const kick = () => chrome.runtime.sendMessage({ type: "loadLabel", id: labelId });
    kick();
    const timer = setInterval(kick, 60_000);
    return () => {
      clearInterval(timer);
      offLabel();
      offUi();
    };
  }, [labelId]);

  const cards = collection?.cards ?? NO_CARDS;

  /** Re-reads before writing: the background is writing tracklists into this
   *  same collection while the user clicks around in it. */
  const persistCard = useCallback(
    async (updated: CardRecord) => {
      setCollection((prev) =>
        prev ? { ...prev, cards: prev.cards.map((c) => (c.id === updated.id ? updated : c)) } : prev
      );
      const col = await getLabel(labelId);
      if (!col) return;
      const idx = col.cards.findIndex((c) => c.id === updated.id);
      if (idx === -1) return;
      col.cards[idx] = updated;
      await setLabel(col);
    },
    [labelId]
  );

  const player = usePlayer({ cards, ordered: cards, persistCard });

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

  const loadedCount = useMemo(() => cards.filter((c) => c.status !== "pending").length, [cards]);

  return {
    ...player,
    labelId,
    collection,
    /** false only for the first tick, before storage has answered */
    loaded,
    cards,
    loadedCount,
    listColumnOrder: uiConfig.listColumnOrder,
    listColumnSizing: uiConfig.listColumnSizing,
    setListColumns,
    openRelease,
  };
}
