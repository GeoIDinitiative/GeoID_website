// node social/js/files.test.mjs -- the CSV reader and the Word-document sanitiser.
import assert from "node:assert/strict";
import { parseCsv, sanitizeInto, sizeText } from "./filekit.js";

let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log(`ok ${n} ${name}`); };

ok("sizes", () => {
  assert.equal(sizeText(0), "");
  assert.equal(sizeText(900), "900 B");
  assert.equal(sizeText(2048), "2 KB");
  assert.equal(sizeText(2.5 * 1048576), "2.5 MB");
  assert.equal(sizeText(40 * 1048576), "40 MB");
});

ok("csv: quotes, doubled quotes, CRLF, blank lines", () => {
  const t = parseCsv('﻿site,lat,"note"\r\n"Etna, NE crater",37.75,"said ""hot"""\r\n\r\nVesuvius,40.82,\n');
  assert.equal(t.delim, ",");
  assert.deepEqual(t.header, ["site", "lat", "note"]);
  assert.deepEqual(t.rows, [["Etna, NE crater", "37.75", 'said "hot"'], ["Vesuvius", "40.82", ""]]);
  assert.equal(t.more, false);
});

ok("csv: semicolons and tabs guessed", () => {
  assert.equal(parseCsv("a;b;c\n1;2;3").delim, ";");
  assert.deepEqual(parseCsv("a\tb\n1\t2").rows, [["1", "2"]]);
});

ok("csv: row cap", () => {
  const body = ["x"].concat(Array.from({ length: 50 }, (_, i) => String(i))).join("\n");
  const t = parseCsv(body, { maxRows: 10 });
  assert.equal(t.rows.length, 10);
  assert.equal(t.more, true);
});

// A tiny DOM, enough for sanitizeInto.
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.childNodes = []; this.attrs = {}; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.childNodes.push(c); return c; }
  get html() {
    const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
    const t = this.tagName.toLowerCase();
    return `<${t}${a}>${this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.html)).join("")}</${t}>`;
  }
}
const txt = (v) => ({ nodeType: 3, nodeValue: v });
const doc = { createElement: (t) => new El(t), createTextNode: txt };
const el = (tag, attrs = {}, ...kids) => { const e = new El(tag); Object.assign(e.attrs, attrs); kids.forEach((k) => e.appendChild(typeof k === "string" ? txt(k) : k)); return e; };

ok("sanitiser keeps document markup, drops the rest", () => {
  const src = el("div", {},
    el("h1", { style: "color:red", onclick: "x()" }, "Title"),
    el("p", {}, "Read ", el("a", { href: "https://doi.org/10.1/x", onmouseover: "y()" }, "this"), " and ", el("a", { href: "javascript:alert(1)" }, "not this")),
    el("script", {}, "alert(1)"),
    el("style", {}, "p{}"),
    el("span", { class: "x" }, "unwrapped"),
    el("img", { src: "https://tracker.example/p.gif" }),
    el("img", { src: "data:image/png;base64,AAAA", alt: "fig 1", onerror: "z()" }),
    el("iframe", { src: "https://evil.example" }, "frame"));
  const out = sanitizeInto(new El("div"), src, doc).html;
  assert.equal(out,
    '<div><h1>Title</h1><p>Read <a href="https://doi.org/10.1/x" target="_blank" rel="noopener noreferrer">this</a> and <a>not this</a></p>'
    + 'unwrapped<img src="data:image/png;base64,AAAA" alt="fig 1"></img></div>');
});

console.log(`${n} passed`);
