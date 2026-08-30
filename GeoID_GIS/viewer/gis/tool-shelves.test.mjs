/**
 * Two shelves, and the rule that decides which one a tool sits on.
 *
 * `Analyse · Prepare` and `Analyse · Tools & Results` had grown by accretion —
 * raster ops beside zonal statistics, a field calculator beside a signal
 * spectrum, four export buttons beside an Export group that already existed —
 * so nothing on screen said which of two panels a tool would be in.
 *
 * The rule is the one already applied to the 47-tool registry: a tool that
 * produces a MAP LAYER is geoprocessing; one that produces a TABLE, A
 * STATISTIC OR A CHART is analysis. These pin the classification itself, since
 * a shelf that quietly drifts is the accretion coming back.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

const { __BLOCKS, __RETIRED, __HEADINGS } = await import("./tool-shelves.js");

const GEO = "gis-group-preprocess";
const ANA = "gis-group-analysis";
const shelfOf = (anchor) => __BLOCKS.find((b) => b.anchor === anchor)?.to;

// Produces a map layer -> geoprocessing.
for (const anchor of ["gis-geo-place", "ras-op-run", "vec-op-run",
  "attr-query-run", "gis-batch-run"]) {
  ok(`${anchor} is geoprocessing — it ends in a layer`, shelfOf(anchor) === GEO);
}
// Produces a table, a statistic or a chart -> analysis.
for (const anchor of ["zonal-run", "raster-sample", "extract-run", "signal-run"]) {
  ok(`${anchor} is analysis — it ends in a table or a chart`, shelfOf(anchor) === ANA);
}

ok("every block names a shelf that exists",
  __BLOCKS.every((b) => b.to === GEO || b.to === ANA));
ok("every block has an id to stamp, so it can be addressed after the move",
  __BLOCKS.every((b) => typeof b.id === "string" && b.id.length > 3));
ok("no anchor is claimed by two blocks",
  new Set(__BLOCKS.map((b) => b.anchor)).size === __BLOCKS.length);
ok("no id is used twice",
  new Set(__BLOCKS.map((b) => b.id)).size === __BLOCKS.length);
ok("both shelves are used", new Set(__BLOCKS.map((b) => b.to)).size === 2);

// EXTRACTION APPEARS ON BOTH SHELVES, on purpose and as two different
// questions: clipping layers to a polygon is geospatial and lands on the
// globe; sampling values at points is data and lands in a table.
ok("point extraction is on the analysis shelf", shelfOf("extract-run") === ANA);
ok("and the geospatial clip is a geoprocessing tool, not a second extractor",
  shelfOf("vec-op-run") === GEO);

// The retired blocks are HIDDEN, never removed: other modules read these ids
// unguarded at boot, and deleting the element throws on the first frame.
ok("three blocks are retired", __RETIRED.length === 3);
ok("each retirement says where the job went",
  __RETIRED.every((r) => typeof r.why === "string" && r.why.length > 3));
ok("a retirement targets a block or a single button",
  __RETIRED.every((r) => Boolean(r.anchor || r.id)));

ok("both shelves are renamed", __HEADINGS[GEO] === "Geoprocessing"
  && __HEADINGS[ANA] === "Analysis");


// ── the resolver, on a page where nothing has been stamped yet ──────────────
/**
 * `id` means two things — on a RETIRED spec it names an element that exists,
 * on a BLOCK it names the id to STAMP — and checking id first found nothing on
 * the first pass, so no block ever moved. The headings and retirements either
 * side of that loop still worked, which made it look as though the module had
 * run correctly. This is that first pass.
 */
{
  const nodes = new Map();
  const mk = (id, parent) => { const n = { id, hidden: false, tagName: "DETAILS",
    children: [], parentElement: parent || null,
    closest: (sel) => (sel === "details" ? n.__wrap : null) };
    nodes.set(id, n); return n; };
  const body = { className: "section-body", children: [],
    appendChild(n) { n.parentElement = this; this.children.push(n); } };
  // an unnamed block holding the anchor control, sitting in a shelf body
  const block = { id: "", tagName: "DETAILS", hidden: false, parentElement: body };
  const anchor = { id: "zonal-run", closest: () => block };
  nodes.set("zonal-run", anchor);

  globalThis.document = { getElementById: (id) => nodes.get(id) || null };
  // the resolver's contract, restated here because the module's copy is private
  const blockFor = (spec) => {
    const known = spec.id ? document.getElementById(spec.id) : null;
    if (known) return known;
    const a = spec.anchor ? document.getElementById(spec.anchor) : null;
    return a ? a.closest("details") : null;
  };
  const spec = { anchor: "zonal-run", id: "an-zonal-stats" };
  ok("a block resolves by its ANCHOR when its id has not been stamped yet",
    blockFor(spec) === block);
  block.id = "an-zonal-stats";
  nodes.set("an-zonal-stats", block);
  ok("and by its stamped id on every pass after", blockFor(spec) === block);
  ok("a spec naming only an id still resolves",
    blockFor({ id: "an-zonal-stats" }) === block);
  ok("a spec whose anchor is absent answers null",
    blockFor({ anchor: "not-here", id: "also-not-here" }) === null);
  delete globalThis.document;
}


/**
 * ONE SPEC PER BLOCK. `attr-query-run`, `calc-run` and `attr-stats-run` all sit
 * inside the same "Attribute Table" section, so listing them separately made
 * each spec move the SAME node and the last one won — the table landed on
 * whichever shelf happened to be named last. Measured on the live page before
 * this: query on the analysis shelf, calculator and field statistics reported
 * missing because their stamped ids never existed.
 */
ok("the attribute table is claimed once, not three times",
  __BLOCKS.filter((b) => ["attr-query-run", "calc-run", "attr-stats-run"]
    .includes(b.anchor)).length === 1);
ok("and it is on the geoprocessing shelf — its acts end in a layer",
  __BLOCKS.find((b) => b.anchor === "attr-query-run").to === "gis-group-preprocess");
ok("a block whose title would repeat its shelf is retitled",
  __BLOCKS.find((b) => b.anchor === "vec-op-run").title === "Vector operations");

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
