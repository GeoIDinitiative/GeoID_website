/**
 * Files in posts: link cards for files kept elsewhere (Dropbox, Drive, OSF,
 * Zenodo...), and previews of the small files uploaded here -- audio, text,
 * CSV tables, Word documents and PDFs.
 *
 * NOTHING THIRD-PARTY LOADS UNTIL A READER ASKS. A link card is drawn from
 * what the Worker read (unfurl.js) -- the reader's browser touches the host
 * only when they press Open. Previews of our own files are fetched on a
 * press too, through the API (so a team or review file goes with the
 * reader's credentials), and a Word document is converted HERE, by mammoth
 * (vendored, loaded on first use), then sanitised: only plain document
 * markup survives -- no script, no styles, no remote images.
 *
 * The CSV parser and the sanitiser are pure and live in filekit.js.
 */
import * as api from "./api.js?v=20261024-0020891";
import { h, put, clear, extLink } from "./dom.js?v=20261024-0020891";
import { sizeText, parseCsv, sanitizeInto } from "./filekit.js?v=20261024-0020891";

export { sizeText };

/** The badge a link card wears: the provider's name, never its logo. */
const PROVIDER_GLYPH = { dropbox: "◆", "google-drive": "▲", onedrive: "☁", box: "■", osf: "◎", figshare: "◇", zenodo: "Z", git: "⌥", doi: "DOI", preprint: "≡", soundcloud: "♪", web: "↗" };

/** "osf.io/8xq2m", "github.com/geoid/etna-inflation": a link named by where it points. */
function shortUrl(u) {
  try { const x = new URL(u); return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.slice(0, 80); } catch { return String(u || ""); }
}

/** A file kept somewhere else, as a card. */
export function linkCard(l) {
  const glyph = PROVIDER_GLYPH[l.provider] || "↗";
  // A JS-rendered page (Dropbox, OSF) titles itself with the service's own name: name the file instead.
  const label = String(l.label || "").trim();
  const generic = !label || label === l.url || /^https?:\/\//.test(label) || label.toLowerCase() === String(l.provider_label || "").toLowerCase()
    || label.toLowerCase() === String(l.host || "").toLowerCase() || /^(www\.)?[a-z0-9-]+\.[a-z.]+$/i.test(label);
  const title = generic ? (l.file_name || shortUrl(l.url)) : label;
  const kind = [l.file_kind, l.provider_label].filter(Boolean).join(" · ");
  return h("div", { class: `s-linkcard s-linkcard-${l.provider || "web"}` },
    h("span", { class: "s-linkcard-badge", "aria-hidden": "true", text: glyph }),
    h("div", { class: "s-linkcard-main" },
      h("p", { class: "s-linkcard-title", text: title }),
      kind ? h("p", { class: "s-linkcard-kind", text: kind }) : null,
      l.description ? h("p", { class: "s-linkcard-desc", text: l.description }) : null),
    h("div", { class: "s-linkcard-acts" },
      extLink(l.url, "Open"),
      l.download_url ? h("a", { class: "s-linkcard-dl", href: l.download_url, target: "_blank", rel: "noopener noreferrer" }, "Download") : null));
}

// ── Previews ───────────────────────────────────────────────────────────────

async function bytesOf(m) {
  const url = m.url || api.mediaUrl(m.key);
  const root = api.base();
  const res = String(url).startsWith(root) ? await api.request("GET", url.slice(root.length), { raw: true }) : await fetch(url);
  if (!res.ok) throw new Error("That file didn't load. Download it instead.");
  return res.arrayBuffer();
}

let mammothLoad = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  mammothLoad = mammothLoad || new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/social/vendor/mammoth.browser.min.js";
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => reject(new Error("The Word reader didn't load."));
    document.head.appendChild(s);
  });
  return mammothLoad;
}

const KIND = (t) => (String(t).startsWith("audio/") ? "audio" : t === "text/csv" ? "csv" : t === "text/plain" ? "text"
  : /wordprocessingml/.test(t) ? "docx" : t === "application/pdf" ? "pdf" : "file");
const LABEL = { audio: "Audio", csv: "CSV table", text: "Text", docx: "Word document", pdf: "PDF", file: "File" };

/** Files that are not images or videos: true for the ones fileBlock draws. */
export const isDocumentLike = (m) => !String(m?.type || "").startsWith("image/") && !String(m?.type || "").startsWith("video/");

/** One uploaded file, with its preview a press away. */
export function fileBlock(m, { pins = null } = {}) {
  const kind = KIND(m.type);
  const url = m.url || api.mediaUrl(m.key);
  const name = m.name || m.alt || LABEL[kind];
  const body = h("div", { class: "s-filebody" });
  const head = h("div", { class: "s-filehead" },
    h("span", { class: `s-filekind s-filekind-${kind}`, text: LABEL[kind] }),
    h("span", { class: "s-filename", text: name }),
    m.bytes ? h("span", { class: "s-muted", text: sizeText(m.bytes) }) : null,
    h("a", { class: "s-link-btn", href: url, target: "_blank", rel: "noopener noreferrer", download: "" }, "Download"));
  const box = h("figure", { class: `s-file s-file-${kind}` }, head, body);
  if (kind === "audio") {
    put(body, h("audio", { controls: true, preload: "metadata", src: url, class: "s-audio", "aria-label": name }));
    return box;
  }
  if (kind === "file") return box;
  const btn = h("button", { type: "button", class: "s-act" }, kind === "pdf" ? "Read it here" : "Preview");
  put(body, btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
      const buf = await bytesOf(m);
      clear(body);
      if (kind === "text") {
        const text = new TextDecoder().decode(buf.slice(0, 200 * 1024));
        const lines = text.split(/\r?\n/);
        put(body, h("pre", { class: "s-textpreview", text: lines.slice(0, 400).join("\n") }),
          lines.length > 400 ? h("p", { class: "s-hint", text: `The first 400 of ${lines.length} lines. Download it for the rest.` }) : null);
      } else if (kind === "csv") {
        const t = parseCsv(new TextDecoder().decode(buf), { maxRows: 100 });
        put(body, h("div", { class: "s-tablewrap" }, h("table", { class: "s-csv" },
          h("thead", {}, h("tr", {}, t.header.map((c) => h("th", { text: c })))),
          h("tbody", {}, t.rows.map((r) => h("tr", {}, r.map((c) => h("td", { text: c }))))))),
          h("p", { class: "s-hint", text: `${t.more ? "The first 100 rows" : `${t.rows.length} rows`}, ${t.header.length} columns. Opened in a spreadsheet, a cell that starts with = runs as a formula: check before you open it.` }));
      } else if (kind === "docx") {
        const mammoth = await loadMammoth();
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        const parsed = new DOMParser().parseFromString(`<div>${out.value}</div>`, "text/html");
        put(body, sanitizeInto(h("div", { class: "s-prose s-docpreview" }), parsed.body.firstChild));
      } else if (kind === "pdf") {
        const { renderPdf } = await import("./pdfview.js?v=20261024-0020891");
        await renderPdf(body, buf, pins || {});
      }
    } catch (error) {
      clear(body);
      put(body, h("p", { class: "s-error", text: error.message || "That preview didn't load. Download it instead." }));
    }
  });
  return box;
}
