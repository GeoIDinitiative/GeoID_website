/**
 * The pure parts of files.js -- sizes, the CSV reader and the allow-list
 * sanitiser for converted Word documents -- kept apart so node can test
 * them without a browser (files.test.mjs).
 */

/** "2.4 MB". */
export function sizeText(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}

// ── CSV ────────────────────────────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF; a delimiter guessed from the first line. */
export function parseCsv(text, { maxRows = 200 } = {}) {
  const src = String(text || "").replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] || "";
  const delim = [",", ";", "\t", "|"].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ",");
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  while (i < src.length && rows.length < maxRows + 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i += 1; continue; }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === "") { quoted = true; i += 1; continue; }
    if (c === delim) { row.push(field); field = ""; i += 1; continue; }
    if (c === "\n" || c === "\r") {
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c; i += 1;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const more = rows.length > maxRows;
  return { delim, header: rows[0] || [], rows: rows.slice(1, maxRows + 1), more };
}

// ── Sanitising converted documents ────────────────────────────────────────

const ALLOWED = new Set(["P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "SUB", "SUP",
  "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "BLOCKQUOTE", "PRE", "CODE", "A", "IMG", "HR"]);

/**
 * Rebuild converted HTML from an allow-list: elements outside it are
 * unwrapped (their text kept), every attribute dropped except a link's
 * http(s) href and an image's data: src (a Word document's own pictures).
 * Works on any DOM-shaped tree, so a node test can drive it.
 */
export function sanitizeInto(target, sourceRoot, doc = document) {
  const walk = (from, to) => {
    for (const node of [...from.childNodes]) {
      if (node.nodeType === 3) { to.appendChild(doc.createTextNode(node.nodeValue)); continue; }
      if (node.nodeType !== 1) continue;
      const tag = String(node.tagName).toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "OBJECT") continue;
      if (!ALLOWED.has(tag)) { walk(node, to); continue; }
      const el = doc.createElement(tag.toLowerCase());
      if (tag === "A") {
        const href = node.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) { el.setAttribute("href", href); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
      }
      if (tag === "IMG") {
        const src = node.getAttribute("src") || "";
        if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) continue;
        el.setAttribute("src", src);
        el.setAttribute("alt", node.getAttribute("alt") || "");
      }
      to.appendChild(el);
      walk(node, el);
    }
  };
  walk(sourceRoot, target);
  return target;
}
