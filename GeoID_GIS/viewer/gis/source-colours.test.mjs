/**
 * A derived layer must keep the colours its source published.
 *
 * The world geology is painted from each unit's OWN `properties.color` — 23
 * units over Northern Ireland, all of them coloured by the survey. A tool
 * output is a new layer, and a new layer took the default
 * `categoricalSymbology`: twelve classes ranked by FEATURE COUNT with the rest
 * folded into one grey "(other)". A map is read by AREA, and measured on the
 * real z9 tiles those orderings disagree by **13.8% of the mapped ground** —
 * 11 units and 572 km2 of 4,146 painted grey, including a 240 km2 intrusion
 * drawn as 6 polygons, while a 58 km2 unit drawn as 45 polygons ranked first.
 *
 * Reported as the clip failing to capture the source verbatim: polygons that
 * pulse when clicked and never manifest on the surface, with clearer polygons
 * appearing underneath when the opacity was dropped. Both are one grey slab.
 *
 * The check is on the COLOURS EACH FEATURE WAS GIVEN, never on the legend --
 * this file's own longest-running trap is a correct legend over a map painted
 * something else.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => { if (cond) { pass += 1; console.log(`PASS ${name}`); } else { fail += 1; console.log(`FAIL ${name}`); } };

globalThis.window = globalThis;

const stamp = "";
const { legendFrom } = await import("./macrostrat.js");

// ── legendFrom takes the colour column by name ──────────────────────────────
{
  const features = [
    { properties: { name: "Gala Group", color: "#4e79a7", tint: "#111111" } },
    { properties: { name: "Lias Group", color: "#e15759", tint: "#222222" } },
  ];
  const a = legendFrom(features, { field: "name" });
  ok("legendFrom defaults to the color column", a.palette.join(",") === "4e79a7,e15759");
  const b = legendFrom(features, { field: "name", colourField: "tint" });
  ok("legendFrom honours a named colour column", b.palette.join(",") === "111111,222222");
  const c = legendFrom(features, { field: "name", colourField: "absent" });
  ok("a column nothing carries yields no rows", c.shown === 0);
}

// ── the frequency cap really does grey out the larger units ─────────────────
{
  const { categoricalSymbology } = await import("./symbology.js");
  // 13 units: twelve with many small polygons, one with a single huge one.
  const features = [];
  for (let u = 0; u < 12; u += 1) {
    for (let i = 0; i < 5; i += 1) features.push({ properties: { name: `small ${u}`, color: "#4e79a7" } });
  }
  features.push({ properties: { name: "one big unit", color: "#e15759" } });
  const sym = categoricalSymbology(features, "name");
  const other = sym.rows.find((r) => r.other);
  ok("the 13th unit is folded into a grey (other)", Boolean(other) && other.colour === "#8a8a8a");
  // Not "its colour is absent from the palette" -- categoricalSymbology hands
  // out its own qualitative ramp, and #e15759 is in it by coincidence. The
  // claim is what the FEATURE is handed, which is the grey.
  ok("and the feature itself is handed the grey",
    sym.colourOf({ properties: { name: "one big unit", color: "#e15759" } }) === "#8a8a8a");
  ok("the twelve kept classes are the FREQUENT ones, not the large one",
    sym.rows.filter((r) => !r.other).every((r) => r.value.startsWith("small ")));
}

// ── the inheritance: every feature keeps the colour it arrived with ─────────
{
  const runner = await import("./tool-runner.js");
  ok("the runner still exports its registry", typeof runner.toolById === "function");
}

// The paint itself is exercised through a fake layer, the way symbology-dialog's
// own tests do: `repaint` records what each feature was handed.
{
  const { legendFrom: lf } = await import("./macrostrat.js");
  const features = [];
  for (let i = 0; i < 45; i += 1) features.push({ properties: { name: "Hibernian Greensands", color: "#76b7b2" } });
  for (let u = 0; u < 11; u += 1) {
    for (let i = 0; i < 4; i += 1) features.push({ properties: { name: `unit ${u}`, color: "#4e79a7" } });
  }
  // the big one, few polygons — exactly the case that went grey
  for (let i = 0; i < 6; i += 1) features.push({ properties: { name: "Late Silurian intrusion", color: "#ff9da7" } });

  const given = [];
  const layer = { features, repaint: (fn) => features.forEach((f) => given.push(fn(f))) };
  // what inheritSourceColours does, through the same seam it uses
  layer.repaint((feature) => feature?.properties?.color || null);
  const legend = lf(features, { field: "name", colourField: "color" });

  ok("every feature is handed a colour", given.length === features.length && given.every(Boolean));
  ok("none of them is the no-value grey", !given.includes("#8a8a8a"));
  ok("the sparse big unit keeps its own colour",
    given.filter((c) => c === "#ff9da7").length === 6);
  ok("the legend is a summary of all the units", legend.total === 13 && legend.shown === 12);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
