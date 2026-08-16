/** Summarising a project's registry — counts and recency, both order-blind. */
globalThis.window = globalThis;
globalThis.document = { readyState: "complete", addEventListener() {}, getElementById: () => null };
const { summarise, recent } = await import("./project-panel.js");

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }

const RECORDS = [
  { name: "dem.tif", kind: "raster", registered_at: "2026-08-10T00:00:00Z" },
  { name: "geology.geojson", kind: "vector", registered_at: "2026-08-12T00:00:00Z" },
  { name: "slope.tif", kind: "processed", registered_at: "2026-08-14T00:00:00Z" },
  { name: "flood.tif", kind: "processed", registered_at: "2026-08-15T00:00:00Z" },
];

check("counts group by kind, commonest first", () => {
  const out = summarise(RECORDS);
  eq(out[0][0], "processed", "kind");
  eq(out[0][1], 2, "count");
  eq(out.length, 3, "kinds");
});

check("an unlabelled record is counted, not dropped", () => {
  eq(summarise([{ name: "x" }])[0][0], "other", "kind");
});

check("recency is read from the stamp, not the file order", () => {
  const out = recent([...RECORDS].reverse(), 2);
  eq(out[0].name, "flood.tif", "newest");
  eq(out[1].name, "slope.tif", "next");
});

check("records with no name or path are not listed", () => {
  eq(recent([{ kind: "raster" }, { name: "a" }]).length, 1, "listed");
});

check("nothing in, nothing out — and no throw", () => {
  eq(summarise(null).length, 0, "counts");
  eq(recent(undefined).length, 0, "recent");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
