import { useCallback, useEffect, useState } from "react";
import { releaseKey, trackKey } from "../lib/digger";
import { getWishlisted, onWishlistedChange } from "../lib/storage";
import type { CardRecord, TrackRecord } from "../lib/types";

const ERRORS: Record<string, string> = {
  "logged-out": "Log in to Bandcamp to use your wishlist",
  "no-tab": "Open any Bandcamp page to use your wishlist",
  lookup: "Couldn't find that release on Bandcamp",
};

/**
 * The hearts: what's on the fan's native Bandcamp wishlist (as far as we know —
 * see storage.ts's wishlisted set), and toggling it. The background relays the
 * actual request through a Bandcamp tab and updates the set on success; the
 * heart flips straight away and flips back if that fails.
 */
export function useWishlist(onToast: (msg: string) => void) {
  const [keys, setKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    getWishlisted().then((k) => setKeys(new Set(k)));
    return onWishlistedChange((k) => setKeys(new Set(k)));
  }, []);

  const toggleWishlist = useCallback(
    async (card: CardRecord, track?: TrackRecord) => {
      const key = track ? trackKey(track.trackId) : releaseKey(card.url);
      const add = !keys.has(key);
      const flip = (on: boolean) =>
        setKeys((prev) => {
          const next = new Set(prev);
          on ? next.add(key) : next.delete(key);
          return next;
        });
      flip(add);
      const res = await chrome.runtime
        .sendMessage({
          type: "wishlist",
          add,
          url: card.url,
          trackId: track?.trackId ?? null,
          itemId: card.itemId,
          itemType: card.itemType,
          bandId: card.bandId,
          tabId: card.tabId,
        })
        .catch(() => null);
      if (res?.ok) return;
      flip(!add);
      onToast(ERRORS[res?.error] ?? "Couldn't update your Bandcamp wishlist");
    },
    [keys, onToast]
  );

  return { wishlisted: keys, toggleWishlist };
}
