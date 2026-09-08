import type { CardRecord, LabelCollection, PlaybackMode, UiConfig } from "./types";
import { DEFAULT_UI_CONFIG } from "./types";

const CARDS_KEY = "cards";
const PLAYBACK_MODE_KEY = "playbackMode";
const UI_CONFIG_KEY = "uiConfig";

/** Backfills fields added after cards may have already been persisted (e.g. `tracks`). */
function normalizeCard(c: CardRecord): CardRecord {
  return {
    ...c,
    tracks: (c.tracks ?? []).map((t) => ({ ...t, duration: t.duration ?? null })),
    selectedTrackId: c.selectedTrackId ?? null,
    archived: c.archived ?? false,
    attempts: c.attempts ?? 0,
  };
}

export async function getCards(): Promise<CardRecord[]> {
  const { [CARDS_KEY]: cards } = await chrome.storage.local.get(CARDS_KEY);
  return ((cards as CardRecord[] | undefined) ?? []).map(normalizeCard);
}

export async function setCards(cards: CardRecord[]): Promise<void> {
  await chrome.storage.local.set({ [CARDS_KEY]: cards });
}

export async function getPlaybackMode(): Promise<PlaybackMode> {
  const { [PLAYBACK_MODE_KEY]: mode } = await chrome.storage.local.get(PLAYBACK_MODE_KEY);
  return mode === "album" ? "album" : "single";
}

export async function setPlaybackMode(mode: PlaybackMode): Promise<void> {
  await chrome.storage.local.set({ [PLAYBACK_MODE_KEY]: mode });
}

/** Backfills a column added after a UiConfig may already be persisted (e.g. `bpm`) —
 *  a plain object spread won't add a missing entry to an already-persisted array. */
function normalizeUiConfig(cfg: Partial<UiConfig> | undefined): UiConfig {
  const merged = { ...DEFAULT_UI_CONFIG, ...cfg };
  const missingCols = DEFAULT_UI_CONFIG.listColumnOrder.filter((id) => !merged.listColumnOrder.includes(id));
  if (missingCols.length) merged.listColumnOrder = [...merged.listColumnOrder, ...missingCols];
  merged.listColumnSizing = { ...DEFAULT_UI_CONFIG.listColumnSizing, ...merged.listColumnSizing };
  return merged;
}

/** Screen state (view mode, archive collapsed/open, list column layout) — so the
 *  grid page looks the same as when the user last left it. */
export async function getUiConfig(): Promise<UiConfig> {
  const { [UI_CONFIG_KEY]: cfg } = await chrome.storage.local.get(UI_CONFIG_KEY);
  return normalizeUiConfig(cfg as Partial<UiConfig> | undefined);
}

export async function setUiConfig(cfg: UiConfig): Promise<void> {
  await chrome.storage.local.set({ [UI_CONFIG_KEY]: cfg });
}

/** Fires cb whenever cards, playback mode, or ui config change, from any surface. */
export function onStorageChange(
  cb: (changes: { cards?: CardRecord[]; playbackMode?: PlaybackMode; uiConfig?: UiConfig }) => void
) {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local") return;
    const out: { cards?: CardRecord[]; playbackMode?: PlaybackMode; uiConfig?: UiConfig } = {};
    if (changes[CARDS_KEY]) out.cards = ((changes[CARDS_KEY].newValue as CardRecord[] | undefined) ?? []).map(normalizeCard);
    if (changes[PLAYBACK_MODE_KEY]) out.playbackMode = changes[PLAYBACK_MODE_KEY].newValue as PlaybackMode;
    if (changes[UI_CONFIG_KEY]) out.uiConfig = normalizeUiConfig(changes[UI_CONFIG_KEY].newValue as Partial<UiConfig> | undefined);
    if (out.cards || out.playbackMode || out.uiConfig) cb(out);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// --- collections (label discographies, wishlists) ---------------------------
// One storage key per collection so a 600-release catalogue (or a big wishlist)
// never rewrites (or wakes listeners for) the tab-grid's `cards` key. Label and
// wishlist collections are the exact same shape — just a different key prefix.

export type CollectionKind = "label" | "wishlist";

const collectionKey = (kind: CollectionKind, id: string) => `${kind}:${id}`;

export async function getCollection(kind: CollectionKind, id: string): Promise<LabelCollection | null> {
  const key = collectionKey(kind, id);
  const { [key]: col } = await chrome.storage.local.get(key);
  const c = col as LabelCollection | undefined;
  return c ? { ...c, cards: (c.cards ?? []).map(normalizeCard) } : null;
}

export async function setCollection(kind: CollectionKind, col: LabelCollection): Promise<void> {
  await chrome.storage.local.set({ [collectionKey(kind, col.id)]: col });
}

export function onCollectionChange(kind: CollectionKind, id: string, cb: (col: LabelCollection) => void) {
  const key = collectionKey(kind, id);
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !changes[key]) return;
    const c = changes[key].newValue as LabelCollection | undefined;
    if (c) cb({ ...c, cards: (c.cards ?? []).map(normalizeCard) });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export const getLabel = (id: string) => getCollection("label", id);
export const setLabel = (col: LabelCollection) => setCollection("label", col);
export const onLabelChange = (id: string, cb: (col: LabelCollection) => void) => onCollectionChange("label", id, cb);

export const getWishlist = (id: string) => getCollection("wishlist", id);
export const setWishlist = (col: LabelCollection) => setCollection("wishlist", col);
export const onWishlistChange = (id: string, cb: (col: LabelCollection) => void) => onCollectionChange("wishlist", id, cb);

export interface CollectionSummary {
  kind: CollectionKind;
  id: string;
  name: string;
  count: number;
}

/** Every label/wishlist collection stored, for a directory page — none of the
 *  per-collection functions above can enumerate them, they only ever address
 *  one collection by its known id. */
export async function listCollections(): Promise<CollectionSummary[]> {
  const all = await chrome.storage.local.get(null);
  const out: CollectionSummary[] = [];
  for (const [key, value] of Object.entries(all)) {
    const sep = key.indexOf(":");
    if (sep === -1) continue;
    const kind = key.slice(0, sep);
    if (kind !== "label" && kind !== "wishlist") continue;
    const col = value as LabelCollection;
    out.push({ kind, id: key.slice(sep + 1), name: col.name || col.id, count: col.cards?.length ?? 0 });
  }
  return out;
}

export async function removeCollection(kind: CollectionKind, id: string): Promise<void> {
  await chrome.storage.local.remove(collectionKey(kind, id));
}

/** Fires whenever any label/wishlist collection is added, changed, or removed —
 *  for a directory page that lists all of them rather than one known collection. */
export function onCollectionsListChange(cb: () => void) {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local") return;
    const touched = Object.keys(changes).some((k) => k.startsWith("label:") || k.startsWith("wishlist:"));
    if (touched) cb();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
