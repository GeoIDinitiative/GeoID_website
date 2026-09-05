/**
 * The legend dock's two decisions: what order the sources come in, and when the
 * drop-down opens itself.
 *
 * The second is the one worth pinning. "Open when a layer is triggered" is not
 * the same as "open when there is something to show" -- the second springs the
 * panel open again on every redraw and can never be dismissed, which is a worse
 * bug than not opening at all because it fights the user rather than ignoring
 * them. So the rule is arrivals: open only for a key that was not there before.
 *
 * Run: node GeoID_GIS/viewer/gis/legend-dock.test.mjs
 */

import { mergeSources, entryKey, arrivals, dedupe, signatureOf, SOURCE_ORDER } from "./legend-dock.js";
import { readFileSync } from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

/* ── order ── */

const sample = {
  core: [{ title: "Interior cutaway" }],
  overlays: [{ title: "Solid Geology" }, { title: "Minerals" }],
  layers: [{ title: "site.tif" }],
};

eq("imported layers lead, then overlays, then the cutaway",
  mergeSources(sample).map((e) => e.title),
  ["site.tif", "Solid Geology", "Minerals", "Interior cutaway"]);

eq("each entry is told which source it came from",
  mergeSources(sample).map((e) => e.source),
  ["layers", "overlays", "overlays", "core"]);

eq("a source with nothing in it contributes nothing",
  mergeSources({ layers: [], overlays: [{ title: "A" }] }).map((e) => e.title), ["A"]);

eq("an empty set of sources is an empty legend", mergeSources({}), []);

// A source nobody put in the order still has to appear -- silently dropping
// entries is the one failure a legend must not have.
eq("an undeclared source is appended, not dropped",
  mergeSources({ overlays: [{ title: "A" }], surprise: [{ title: "B" }] }).map((e) => e.title),
  ["A", "B"]);

eq("undeclared sources come in a stable order",
  mergeSources({ zulu: [{ title: "Z" }], alpha: [{ title: "A" }] }).map((e) => e.title),
  ["A", "Z"]);

// The basemap is last on purpose: it is the floor everything else is drawn on,
// so the legend reads down the stack the way the layer list does.
check("the declared order ends with the basemap, under every other source",
  JSON.stringify(SOURCE_ORDER) === JSON.stringify(["layers", "overlays", "core", "basemap"]));

/* ── identity ── */

check("a key is source and title together",
  entryKey({ source: "overlays", title: "Solid Geology" }) === "overlays::Solid Geology");

check("the same title from two sources is two entries",
  entryKey({ source: "layers", title: "Relief" }) !== entryKey({ source: "overlays", title: "Relief" }));

check("an untitled card is keyed by what it says, not by an empty name",
  entryKey({ source: "overlays", title: "", labels: ["Crust", "Mantle"] })
  !== entryKey({ source: "overlays", title: "", labels: ["Ice", "Rock"] }));

/* ── one card per thing described ── */

// The case this exists for: Mars lists the interior shells in its overlay
// legend already, so the cutaway built from Core View's rows is the same card
// arriving twice. Earth does not, so it cannot simply be dropped either way.
const marsOverlay = { source: "overlays", title: "", labels: ["Crust", "Mantle", "Liquid Outer Core", "Inner Core"] };
const builtCore = { source: "core", title: "Interior cutaway", labels: ["Crust", "Mantle", "Liquid Outer Core", "Inner Core"] };

eq("the same shells from two sources collapse to one card",
  dedupe([marsOverlay, builtCore]).length, 1);

eq("and the one kept is the one that names itself",
  dedupe([marsOverlay, builtCore])[0].title, "Interior cutaway");

eq("whichever order they arrive in",
  dedupe([builtCore, marsOverlay])[0].title, "Interior cutaway");

eq("a card with no collision is untouched",
  dedupe([{ source: "overlays", title: "Solid Geology", labels: ["Basalt"] }]).map((e) => e.title),
  ["Solid Geology"]);

eq("different label sets are different cards",
  dedupe([
    { source: "overlays", title: "A", labels: ["x"] },
    { source: "core", title: "B", labels: ["y"] },
  ]).length, 2);

// Deduping must not quietly reorder the legend.
eq("a survivor keeps the position of the card it replaced",
  dedupe([
    { source: "layers", title: "first", labels: ["a"] },
    marsOverlay,
    { source: "core", title: "last", labels: ["z"] },
    builtCore,
  ]).map((e) => e.title),
  ["first", "Interior cutaway", "last"]);

check("label order does not change identity",
  signatureOf({ labels: ["Mantle", "Crust"] }) === signatureOf({ labels: ["Crust", "Mantle"] }));

check("case and padding do not change identity",
  signatureOf({ labels: [" crust "] }) === signatureOf({ labels: ["Crust"] }));

check("with no symbols at all, the title is the identity",
  signatureOf({ title: "Legend", labels: [] }) === "title:legend");

/* ── when it opens ── */

eq("nothing new means nothing to announce", arrivals(["a", "b"], ["a", "b"]), []);
eq("a new key is an arrival", arrivals(["a"], ["a", "b"]), ["b"]);
eq("first paint is all arrivals", arrivals([], ["a", "b"]), ["a", "b"]);
eq("losing a layer is not an arrival", arrivals(["a", "b"], ["a"]), []);
eq("swapping one layer for another announces only the newcomer",
  arrivals(["a", "b"], ["a", "c"]), ["c"]);

// The case the rule exists for: a redraw that changes nothing must not reopen a
// panel the user has just closed.
eq("a redraw with an identical set stays quiet",
  arrivals(["layers::site.tif"], ["layers::site.tif"]), []);

// ...and the case it must still catch: switching a layer off and on again is a
// fresh arrival, so the legend comes back.
eq("a layer switched off and on again re-announces",
  arrivals(arrivals(["overlays::Geology"], []) , ["overlays::Geology"]),
  ["overlays::Geology"]);

/* ── the basemap card is a drop-down, and starts shut ────────────────────── */

/**
 * "ONE ENTRY DOES NOT FOLD" is a rule about a chevron over a line that is
 * already visible, and it was returning before the card's own request was
 * read. The basemap card has one symbol row and a LICENCE under it -- the
 * terms the streamed imagery is free only on condition of -- so it asked to
 * start collapsed from the day it was written and was marked static instead:
 * the paragraph sat open in the key, permanently, pushing the layers a reader
 * actually loaded down the panel.
 */
const dock = readFileSync(new URL("./legend-dock.js", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
check("a card that asks to start collapsed is foldable however few rows it has",
  /entryCount\(card\) <= 1 && card\.dataset\.legendFold !== "collapsed"/.test(dock));
check("and everything else with one entry still gets no chevron",
  /card\.dataset\.foldable = "static";/.test(dock));
check("the request is honoured once, so a redraw cannot shut it while it is read",
  /if \(!seenFold\.has\(key\)\)[\s\S]{0,160}legendFold === "collapsed"/.test(dock));

const hierarchy = readFileSync(new URL("./layer-hierarchy.js", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const cardSrc = hierarchy.slice(hierarchy.indexOf("function basemapCard()"),
  hierarchy.indexOf("function symbolLabel("));
check("the basemap card asks for it", /legendFold = "collapsed"/.test(cardSrc));
check("and never springs the panel open when the basemap changes",
  /legendAutoOpen = "never"/.test(cardSrc));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
