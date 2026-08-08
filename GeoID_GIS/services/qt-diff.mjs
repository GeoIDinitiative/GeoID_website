/**
 * Diff the web Research Hub against the Qt app, page by page.
 *
 * Reads `qt-spec.json` (from qt-extract.py) and a dump of what the hub actually
 * renders, and reports what is missing. The point is to turn "there are too
 * many differences" into a list with a number on the end, so the work is
 * finite and progress is visible.
 *
 *   node GeoID_GIS/services/qt-diff.mjs <rendered.json>
 *   node GeoID_GIS/services/qt-diff.mjs <rendered.json> --page "Statistics"
 *
 * `rendered.json` is written by the browser harness: for each page id, the
 * tabs, section titles, button labels, field labels, placeholders and table
 * headers found in the DOM.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(
  readFileSync(resolve(here, "../viewer/gis/research/qt-spec.json"), "utf8"));

const args = process.argv.slice(2);
const renderedPath = args.find((a) => !a.startsWith("--"));
if (!renderedPath) {
  console.error("usage: node qt-diff.mjs <rendered.json> [--page NAME] [--full]");
  process.exit(2);
}
const rendered = JSON.parse(readFileSync(renderedPath, "utf8"));
const onlyPage = args.includes("--page") ? args[args.indexOf("--page") + 1] : null;
const full = args.includes("--full");

/** Loose match: case and punctuation differ harmlessly between the two. */
const norm = (s) => String(s || "")
  .toLowerCase()
  .replace(/[……]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function missing(want, have) {
  const pool = have.map(norm);
  return want.filter((w) => {
    const n = norm(w);
    if (!n) return false;
    // Present if any rendered string contains it or it contains one of them --
    // "Run PCA" against a button reading "Run PCA on selected" is not a gap.
    return !pool.some((h) => h === n || h.includes(n) || n.includes(h));
  });
}

const rows = [];
let totalWanted = 0;
let totalMissing = 0;

for (const [pageId, want] of Object.entries(spec)) {
  if (onlyPage && pageId !== onlyPage) continue;
  const got = rendered[pageId];
  if (!got) {
    rows.push({ pageId, state: "NOT RENDERED", gaps: {}, score: 0,
                wanted: 1, missed: 1 });
    totalWanted += 1; totalMissing += 1;
    continue;
  }
  const gaps = {
    tabs: missing(want.tabs, got.tabs || []),
    sections: missing(want.sections.map((s) => s.title), got.sections || []),
    groups: missing(want.groups, [...(got.sections || []), ...(got.cardTitles || [])]),
    buttons: missing(want.buttons, got.buttons || []),
    fields: missing(Object.values(want.placeholders),
      [...(got.placeholders || []), ...(got.labels || [])]),
    options: missing(Object.values(want.options).flat(), got.options || []),
    tables: missing(want.tables.flat(), got.headers || []),
  };
  const wanted = want.tabs.length + want.sections.length + want.groups.length
    + want.buttons.length + Object.keys(want.placeholders).length
    + Object.values(want.options).flat().length + want.tables.flat().length;
  const missed = Object.values(gaps).reduce((n, list) => n + list.length, 0);
  totalWanted += wanted || 1;
  totalMissing += missed;
  rows.push({
    pageId, state: missed === 0 ? "match" : `${missed} missing`,
    gaps, wanted: wanted || 1, missed,
    score: wanted ? 1 - missed / wanted : 1,
  });
}

rows.sort((a, b) => a.score - b.score);

const pad = Math.max(...rows.map((r) => r.pageId.length));
console.log(`${"page".padEnd(pad)}  fidelity  gap`);
console.log("-".repeat(pad + 22));
for (const row of rows) {
  const pct = `${Math.round(row.score * 100)}%`.padStart(7);
  console.log(`${row.pageId.padEnd(pad)}  ${pct}   ${row.state}`);
  if (!full && row.missed === 0) continue;
  for (const [kind, list] of Object.entries(row.gaps)) {
    if (!list.length) continue;
    console.log(`${" ".repeat(pad + 4)}${kind}: ${list.slice(0, 8).join(" · ")}`
      + (list.length > 8 ? ` … +${list.length - 8}` : ""));
  }
}

const overall = Math.round((1 - totalMissing / totalWanted) * 100);
console.log("-".repeat(pad + 22));
console.log(`${rows.length} pages · ${totalMissing} missing elements of `
  + `${totalWanted} · ${overall}% structural fidelity`);
