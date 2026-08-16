/**
 * The Earth Engine request layer, tested without a Google account.
 *
 * Everything that decides WHAT to ask for is pure and is pinned here; the
 * calls themselves need a token and are the only part a test cannot reach.
 * The rule worth pinning hardest: GFS precipitation accumulates through a run,
 * so a step is a DIFFERENCE. Reading the band directly gives a surface that
 * only ever grows — a map that can never dry out.
 */

// A stand-in page. The origin matters now: `token()` refuses before it asks
// Google, and the test has to say where it is pretending to be.
globalThis.window = {
  localStorage: { getItem: () => null },
  location: { protocol: "http:", hostname: "localhost", port: "8125", origin: "http://localhost:8125" },
};
const G = await import("./gee-live.js");

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }

const BOUNDS = { minX: -8, minY: 54, maxX: -5.4, maxY: 55.4 };

check("a date range becomes evenly spaced frames", () => {
  const f = G.frames("2026-08-16T00:00:00Z", { hours: 24, stepHours: 3 });
  eq(f.length, 8, "frames");
  eq(f[0].from, "2026-08-16T00:00:00.000Z", "first start");
  eq(f[0].to, "2026-08-16T03:00:00.000Z", "first end");
  eq(f[7].to, "2026-08-17T00:00:00.000Z", "last end");
});

check("a bad start gives no frames rather than Invalid Date", () => {
  eq(G.frames("not a date").length, 0, "frames");
});

check("the request asks for a DIFFERENCE over the window", () => {
  const body = G.stepImageBody(G.frames("2026-08-16T00:00:00Z", { hours: 3, stepHours: 3 })[0], BOUNDS);
  eq(body.expression.collection, "NOAA/GFS0P25", "collection");
  eq(body.expression.band, "total_precipitation_surface", "band");
  eq(body.expression.reducer, "difference", "cumulative band needs a difference");
  eq(body.expression.window.start, "2026-08-16T00:00:00.000Z", "window start");
});

check("the region is the study area, closed", () => {
  const ring = G.stepImageBody(G.frames("2026-08-16T00:00:00Z")[0], BOUNDS)
    .expression.region.coordinates[0];
  eq(ring.length, 5, "four corners and the close");
  eq(JSON.stringify(ring[0]), JSON.stringify(ring[4]), "closed");
  eq(ring[0][0], BOUNDS.minX, "west");
  eq(ring[2][1], BOUNDS.maxY, "north");
});

check("a map name becomes an XYZ template", () => {
  const url = G.tileTemplate("projects/p/maps/abc123");
  if (!url.endsWith("/tiles/{z}/{x}/{y}")) throw new Error(url);
  if (!url.startsWith("https://earthengine.googleapis.com/v1/")) throw new Error(url);
  eq(G.tileTemplate(null), null, "no name, no url");
});

check("the rain palette runs from nothing to heavy", () => {
  const vis = G.rainVis({ maxMm: 12 });
  eq(vis.max, 12, "max");
  eq(vis.bands[0], "total_precipitation_surface", "band");
  if (vis.palette.length < 5) throw new Error("too few stops to read");
});

check("a returned grid is read at the nearest cell, and refuses outside", () => {
  const grid = { width: 2, height: 2, values: [1, 2, 3, 4] };
  eq(G.sampleGrid(grid, BOUNDS, 55.3, -7.9), 1, "north-west cell");
  eq(G.sampleGrid(grid, BOUNDS, 54.1, -5.5), 4, "south-east cell");
  eq(G.sampleGrid(grid, BOUNDS, 60, 0), null, "outside the box");
  eq(G.sampleGrid(null, BOUNDS, 54.5, -6), null, "no grid");
});

check("localhost is allowed; an IP literal is refused with the reason", () => {
  eq(G.originProblem(), null, "localhost is fine");
  window.location = { protocol: "http:", hostname: "0.0.0.0", port: "8100", origin: "http://0.0.0.0:8100" };
  const problem = G.originProblem();
  if (!/only\s+localhost/.test(problem)) throw new Error(`unhelpful: ${problem}`);
  if (!problem.includes("http://localhost:8100")) throw new Error("no way out offered");
  window.location = { protocol: "https:", hostname: "geoidinitiative.com", origin: "https://geoidinitiative.com" };
  eq(G.originProblem(), null, "https is fine anywhere");
  window.location = { protocol: "http:", hostname: "localhost", port: "8125", origin: "http://localhost:8125" };
});

await (async () => {
  let message = "";
  try { await G.token(); } catch (e) { message = e.message; }
  check("no Client ID is a named refusal, not a silent failure", () => {
    if (!/Client ID/.test(message)) throw new Error(`unhelpful: ${message}`);
  });
})();

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
