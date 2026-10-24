/**
 * Link cards: a shared URL read once into {provider, title, description,
 * file type}, so a Dropbox or Drive link reads as the file it is rather than
 * as a bare address. This is how big files are shared without R2 holding
 * them: the bytes stay where their owner keeps them.
 *
 * PRIVACY, THE SAME RULE AS embed.js. The Worker reads the page (once, cached a
 * week) -- the reader's browser never does until they press Open. A card
 * carries no third-party image: an og:image hotlinked into a feed would tell
 * the host who read the feed. The provider is drawn as a named badge instead.
 *
 * The parsing is pure (no network) so node tests it: test/reach.test.mjs.
 */
import { fail, now, str, url, requireUser, rateLimit, readJson } from "./lib.js";

const WEEK = 7 * 86400;
const MAX_HTML = 256 * 1024;

/** The file hosts and repositories a card names. Host -> [id, label]. */
const PROVIDERS = [
  [/(^|\.)dropbox(usercontent)?\.com$/, "dropbox", "Dropbox"],
  [/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/, "google-drive", "Google Drive"],
  [/(^|\.)onedrive\.live\.com$|(^|\.)1drv\.ms$|(^|\.)sharepoint\.com$/, "onedrive", "OneDrive"],
  [/(^|\.)box\.com$/, "box", "Box"],
  [/(^|\.)osf\.io$/, "osf", "OSF"],
  [/(^|\.)figshare\.com$/, "figshare", "Figshare"],
  [/(^|\.)zenodo\.org$/, "zenodo", "Zenodo"],
  [/(^|\.)github\.com$|(^|\.)gitlab\.com$/, "git", "Code repository"],
  [/(^|\.)doi\.org$/, "doi", "DOI"],
  [/(^|\.)arxiv\.org$|(^|\.)essopenarchive\.org$|(^|\.)eartharxiv\.org$/, "preprint", "Preprint"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/, "youtube", "YouTube"],
  [/(^|\.)vimeo\.com$/, "vimeo", "Vimeo"],
  [/(^|\.)soundcloud\.com$/, "soundcloud", "SoundCloud"],
];

/** What a file extension says the link is. */
const FILE_KINDS = {
  pdf: "PDF", doc: "Word document", docx: "Word document", odt: "Document", txt: "Text", md: "Text",
  csv: "CSV table", tsv: "Table", xlsx: "Spreadsheet", xls: "Spreadsheet", ods: "Spreadsheet",
  ppt: "Slides", pptx: "Slides", odp: "Slides", mp3: "Audio", m4a: "Audio", wav: "Audio", flac: "Audio",
  mp4: "Video", mov: "Video", webm: "Video", zip: "Archive", tar: "Archive", gz: "Archive", "7z": "Archive",
  nc: "NetCDF data", h5: "HDF5 data", hdf5: "HDF5 data", tif: "GeoTIFF", tiff: "GeoTIFF", shp: "Shapefile",
  geojson: "GeoJSON", kml: "KML", las: "Point cloud", laz: "Point cloud", msh: "Mesh", stl: "3D model", ipynb: "Notebook",
};

/**
 * Classify a URL without fetching it: the provider, the file kind its name
 * implies, and for Dropbox the link that downloads rather than previews.
 */
export function classifyLink(raw) {
  const u = url(raw);
  if (!u) return null;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const found = PROVIDERS.find(([re]) => re.test(host));
  const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
  const ext = (name.toLowerCase().match(/\.([a-z0-9]{1,6})$/) || [])[1] || "";
  const card = {
    url: u,
    host,
    provider: found ? found[1] : "web",
    provider_label: found ? found[2] : host.replace(/^www\./, ""),
    file_name: ext ? name.slice(0, 160) : "",
    file_kind: FILE_KINDS[ext] || "",
  };
  // Dropbox: ?dl=0 opens their previewer; ?dl=1 is the file itself.
  if (card.provider === "dropbox" && /^\/(s|scl)\//.test(parsed.pathname)) {
    const dl = new URL(u);
    dl.searchParams.set("dl", "1");
    card.download_url = dl.toString();
  }
  return card;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decode(text) {
  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32);
    return m;
  }).replace(/\s+/g, " ").trim();
}

/** Title and description from a page's head: og: first, then twitter:, then <title>/<meta name=description>. */
export function parseMeta(html) {
  const head = String(html || "").slice(0, MAX_HTML);
  const meta = {};
  const re = /<meta\s+([^>]+?)\/?>/gi;
  let m;
  while ((m = re.exec(head))) {
    const attrs = m[1];
    const key = (/(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1];
    const val = (/content\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1];
    if (key && val != null && !(key.toLowerCase() in meta)) meta[key.toLowerCase()] = decode(val);
  }
  const title = meta["og:title"] || meta["twitter:title"]
    || decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1]);
  const description = meta["og:description"] || meta["twitter:description"] || meta.description || "";
  return { title: str(title, 200), description: str(description, 400), site: str(meta["og:site_name"], 80) };
}

/** A full card: classify, then read the page (cached a week). Never throws on a dead link. */
export async function unfurl(env, raw, { fetcher = fetch, t = now() } = {}) {
  const card = classifyLink(raw);
  if (!card) return null;
  const cached = await env.DB.prepare("SELECT card_json, fetched_at FROM link_cache WHERE url = ?").bind(card.url).first();
  if (cached && t - cached.fetched_at < WEEK) {
    try { return JSON.parse(cached.card_json); } catch { /* refetch */ }
  }
  let read = { title: "", description: "", site: "" };
  try {
    const res = await fetcher(card.url, {
      redirect: "follow",
      headers: { "user-agent": "GeoIDNetworkBot/1.0 (+https://geoidinitiative.com/social/)", accept: "text/html,*/*;q=0.5" },
      signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
    });
    const type = res.headers.get("content-type") || "";
    if (res.ok && /html/i.test(type)) {
      const text = (await res.text()).slice(0, MAX_HTML);
      read = parseMeta(text);
    } else if (res.ok) {
      // A direct file: its size and type are the card.
      const size = Number(res.headers.get("content-length") || 0);
      if (size) card.bytes = size;
      if (!card.file_kind && /pdf/i.test(type)) card.file_kind = "PDF";
    }
    card.status = res.status;
  } catch (error) {
    card.status = 0;
  }
  // Dropbox and Drive put the file name in the title; strip their suffixes.
  card.title = str(read.title.replace(/\s*[-|–]\s*(Dropbox|Google Drive|OneDrive|Box)\s*$/i, ""), 200) || card.file_name || card.host;
  card.description = read.description;
  card.site = read.site;
  await env.DB.prepare(
    "INSERT INTO link_cache (url, card_json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET card_json = excluded.card_json, fetched_at = excluded.fetched_at",
  ).bind(card.url, JSON.stringify(card), t).run();
  return card;
}

/** POST /v1/unfurl {url} -- the composer asks as a link is pasted. */
async function unfurlRoute(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  const card = await unfurl(ctx.env, body?.url);
  if (!card) fail(400, "That isn't a web address.");
  return card;
}

export const routes = [
  ["POST", "/v1/unfurl", unfurlRoute],
];
