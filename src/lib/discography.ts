// Reads a band's release grid (a label's or an artist's /music page, or any
// page carrying one) into a playable list. Runs in the content script, off the
// live DOM, so it sees exactly what the user sees — no stripped-page trap.
//
// Two shapes exist on the same page and BOTH are needed:
//   - the rendered <li> grid items
//   - a `data-client-items` JSON blob holding everything the grid lazy-loads
// They do not overlap: Ninja Tune renders 16 <li>s and carries a further 595
// in the blob. A small discography has no blob at all — that absence was the
// "couldn't read a discography" failure, not an extraction error.

export interface DiscographyItem {
  /** release page URL, query stripped — doubles as the card dedupe key */
  url: string;
  title: string;
  artist: string | null;
  artUrl: string | null;
}

export interface Discography {
  bandName: string;
  items: DiscographyItem[];
}

/** One grid entry before URLs are resolved and duplicates dropped. */
export interface RawItem {
  pageUrl: string;
  title: string;
  /** absent on an artist's own page — every release is theirs */
  artist?: string | null;
  artUrl?: string | null;
  /** "album" / "track" / "package" (merch) / … */
  kind?: string;
}

const RELEASE_KINDS = new Set(["album", "track"]);

/**
 * Resolves URLs against the page origin (an artist page's grid uses relative
 * hrefs, a label's absolute cross-subdomain ones), drops merch, and dedupes —
 * the two grid shapes are disjoint today but nothing guarantees that.
 */
export function normalizeItems(raw: RawItem[], bandName: string, origin: string): DiscographyItem[] {
  const out: DiscographyItem[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item.pageUrl) continue;
    if (item.kind && !RELEASE_KINDS.has(item.kind)) continue;

    let url: string;
    try {
      const u = new URL(item.pageUrl, origin);
      url = `${u.origin}${u.pathname}`; // drop ?label=…&tab=music — same page, stable key
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    out.push({
      url,
      title: item.title.trim(),
      artist: item.artist?.trim() || bandName || null,
      artUrl: item.artUrl ?? null,
    });
  }

  return out;
}

function artUrlFromId(artId: number | string | undefined): string | null {
  if (artId === undefined || artId === null) return null;
  return `https://f4.bcbits.com/img/a${artId}_10.jpg`;
}

/** The rendered grid items — on a small discography this is the whole catalogue. */
function readGridItems(grid: Element): RawItem[] {
  return Array.from(grid.querySelectorAll("li[data-item-id]")).map((li) => {
    const href = li.querySelector("a")?.getAttribute("href") ?? "";
    const titleEl = li.querySelector("p.title");
    // <p class="title">Album<br><span class="artist-override">Artist</span></p>
    const artist = titleEl?.querySelector(".artist-override")?.textContent ?? null;
    const title = Array.from(titleEl?.childNodes ?? [])
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join(" ");
    const img = li.querySelector("img");
    return {
      pageUrl: href,
      title,
      artist,
      artUrl: img?.getAttribute("data-original") ?? img?.getAttribute("src") ?? null,
      kind: (li.getAttribute("data-item-id") ?? "").split("-")[0],
    };
  });
}

/** Everything the grid would lazy-load on scroll. Absent on short discographies. */
function readClientItems(doc: Document): RawItem[] {
  const raw = doc.querySelector("[data-client-items]")?.getAttribute("data-client-items");
  if (!raw) return [];
  let items: Array<Record<string, unknown>>;
  try {
    items = JSON.parse(raw);
  } catch {
    return [];
  }
  return items.map((i) => ({
    pageUrl: String(i.page_url ?? ""),
    title: String(i.title ?? ""),
    artist: i.artist ? String(i.artist) : null,
    artUrl: artUrlFromId(i.art_id as number | string | undefined),
    kind: i.type ? String(i.type) : undefined,
  }));
}

function readBandName(doc: Document): string {
  const raw = doc.querySelector("[data-band]")?.getAttribute("data-band");
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { name?: string }).name ?? "";
  } catch {
    return "";
  }
}

/** null when the page has no release grid at all (an album page, a fan page…). */
export function readDiscography(doc: Document, origin: string): Discography | null {
  const grid = doc.querySelector("#music-grid");
  if (!grid) return null;
  const bandName = readBandName(doc);
  // Rendered items first: they're the newest releases, and the blob continues
  // from where the rendered grid stops.
  const items = normalizeItems([...readGridItems(grid), ...readClientItems(doc)], bandName, origin);
  return { bandName, items };
}
