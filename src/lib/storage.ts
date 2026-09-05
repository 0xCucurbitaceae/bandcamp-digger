import type { CardRecord, PlaybackMode, UiConfig } from "./types";
import { DEFAULT_UI_CONFIG } from "./types";

const CARDS_KEY = "cards";
const PLAYBACK_MODE_KEY = "playbackMode";
const UI_CONFIG_KEY = "uiConfig";

/** Backfills fields added after cards may have already been persisted (e.g. `tracks`). */
function normalizeCard(c: CardRecord): CardRecord {
  return {
    ...c,
    tracks: c.tracks ?? [],
    selectedTrackId: c.selectedTrackId ?? null,
    archived: c.archived ?? false,
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

/** Screen state (view mode, archive collapsed/open, list column layout) — so the
 *  grid page looks the same as when the user last left it. */
export async function getUiConfig(): Promise<UiConfig> {
  const { [UI_CONFIG_KEY]: cfg } = await chrome.storage.local.get(UI_CONFIG_KEY);
  return { ...DEFAULT_UI_CONFIG, ...(cfg as Partial<UiConfig> | undefined) };
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
    if (changes[UI_CONFIG_KEY]) out.uiConfig = { ...DEFAULT_UI_CONFIG, ...(changes[UI_CONFIG_KEY].newValue as Partial<UiConfig> | undefined) };
    if (out.cards || out.playbackMode || out.uiConfig) cb(out);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
