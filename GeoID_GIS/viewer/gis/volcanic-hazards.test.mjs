/**
 * VOLCANIC HAZARD BUFFERS -- the pure halves, and the source of the merge.
 * Run: node GeoID_GIS/viewer/gis/volcanic-hazards.test.mjs
 *
 * IDIOM: `check(name, fn)` RUNS the callback; `ok(cond, msg)` throws.
 */
import { readFileSync } from "node:fs";

let pass = 0; const failures = [];
const check = (name, fn) => {
  try { fn(); pass += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

const vh = await import("./volcanic-hazards.js");
const R = 6371;
const hav = (a, b) => { // km between [lon,lat] pairs
  const d = Math.PI / 180;
  const dLat = (b[1] - a[1]) * d, dLon = (b[0] - a[0]) * d;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * d) * Math.cos(b[1] * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

check("a ring is a circle on the sphere, at every latitude", () => {
  for (const [lat, lon] of [[0, 0], [37.75, 15.0], [64, -17], [-41, 174], [80, 30]]) {
    const ring = vh.circleRing(lat, lon, 50, R, 64);
    ring.forEach((p) => ok(Math.abs(hav([lon, lat], p) - 50) < 0.05, `${lat},${lon}: ${hav([lon, lat], p)}`));
  }
});
check("and is closed", () => {
  const ring = vh.circleRing(10, 20, 5, R, 32);
  ok(ring.length === 33 && ring[0][0] === ring[32][0], "first point repeated");
});
check("a ring across the antimeridian is split into two parts within +-180", () => {
  const ring = vh.circleRing(52, 179.8, 50, R, 64);
  ok(Math.max(...ring.map((p) => p[0])) > 180, "the raw ring crosses the seam");
  const parts = vh.splitAtSeam(ring);
  ok(parts.length === 2, `${parts.length} parts`);
  parts.forEach((r) => r.forEach((p) => ok(p[0] <= 180 && p[0] >= -180, `within: ${p[0]}`)));
});
check("a ring that stays inside is left as one", () => {
  ok(vh.splitAtSeam(vh.circleRing(37, 15, 50, R, 64)).length === 1, "one");
});

const volcano = (name, rank, lon = 15, lat = 37.75) => ({
  type: "Feature", properties: { name, label_rank: rank }, geometry: { type: "Point", coordinates: [lon, lat] },
});
check("which volcanoes get buffers is the catalogue's own rank", () => {
  const fs = [volcano("A", 5), volcano("B", 4), volcano("C", 3), volcano("D", 1), volcano("P", 0)];
  ok(vh.zonesFor(fs, 4).volcanoes === 2, "since 1900: ranks 5 and 4");
  ok(vh.zonesFor(fs, 1).volcanoes === 4, "every Holocene: ranks 1..5");
  ok(vh.zonesFor(fs, 1).features.every((f) => f.properties.volcano !== "P"), "never Pleistocene");
});
check("five zones per volcano, as annuli with a hole and a disc for the first", () => {
  const { features } = vh.zonesFor([volcano("Etna", 5)], 4);
  ok(features.length === vh.ZONES.length, `${features.length}`);
  ok(features[0].geometry.coordinates.length === 1, "zone 0 is a disc");
  ok(features[1].geometry.coordinates.length === 2, "zone 1 has a hole");
  ok(features[4].properties.outer_km === 50 && features[4].properties.inner_km === 35, "the last is 35-50");
});
check("each zone carries its own area, the annulus and not the outer disc", () => {
  const { features } = vh.zonesFor([volcano("Etna", 5)], 4);
  const planar = (r1, r2) => Math.PI * (r2 * r2 - r1 * r1);
  ok(Math.abs(features[2].properties.area_km2 - planar(10, 20)) / planar(10, 20) < 0.001,
    `10-20 km: ${features[2].properties.area_km2} vs ${planar(10, 20).toFixed(1)}`);
  ok(Math.abs(features[0].properties.area_km2 - planar(0, 5)) < 0.1, `0-5 km: ${features[0].properties.area_km2}`);
  const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
  ok(/mapped_area_km2: Number\.isFinite\(Number\(props\.area_km2\)\)/.test(popup), "and the card reads it");
});
check("the zones are Etna Explorer's, verbatim -- bands, colours, labels, hazards and detail", () => {
  const etna = readFileSync(new URL("../../../earth_explorer/etna/viewer/etna-viewer.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../../earth_explorer/etna/viewer/index.html", import.meta.url), "utf8");
  const unescape = (t) => t.replace(/\\'/g, "'");
  vh.ZONES.forEach((z) => {
    ok(etna.includes(`rInner: ${z.inner}, rOuter: ${z.outer}`), `${z.inner}-${z.outer} km is an Etna band`);
    ok(etna.includes(`colorHex: '${z.colour}'`), `${z.colour} is its colour`);
    ok(etna.includes(`label: '${z.label}'`), `${z.label} is its label`);
    z.hazardList.forEach((h) => ok(etna.includes(`'${h.replace(/'/g, "\\'")}'`), `hazard listed: ${h}`));
    ok(unescape(etna).includes(z.detail), `detail verbatim for ${z.label}`);
    ok(page.includes(`${z.inner} – ${z.outer} km · ${z.hazards}`), `legend words: ${z.hazards}`);
  });
});
check("the legend names the hazard beside the distance, as Etna's legend does", () => {
  const legend = vh.legendFor();
  ok(legend.labels.some((l) => /Ash fall, lahars/.test(l)), legend.labels.join(" | "));
  ok(legend.labels.every((l, i) => l.startsWith(vh.ZONES[i].label)), "one row per zone, in order");
});
check("every Holocene volcano is buffered by default", () => {
  const src = readFileSync(new URL("./volcanic-hazards.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  ok(/\|\| 1;/.test(src.slice(src.indexOf("const chosenRank"))), "the module's own default is rank 1");
  ok(/<option value="1" selected>Every Holocene volcano<\/option>/.test(html), "and the select opens there");
});

/* ── the card ─────────────────────────────────────────────────────────────── */
{
  const card = await import("./volcanic-zone-card.js");
  const props = { volcano: "Ilopango", zone: 2, zone_label: "High Risk", inner_km: 10, outer_km: 20,
    hazards: "Ash fall, lahars, airport closures", last_eruption: 1880, label_rank: 3 };
  check("a zone polygon is recognised", () => ok(card.isZoneFeature(props) && !card.isZoneFeature({ p_yr: 0.1 }), "by zone + outer_km + volcano"));
  check("the card writes the band, the volcano and Etna's hazard list", () => {
    const c = card.zoneCard(props);
    ok(/10–20 km from Ilopango/.test(c.kicker), c.kicker);
    ok(c.title === "High Risk", c.title);
    ok(/last known eruption 1880/.test(c.meta), c.meta);
    ok(c.headline.length === vh.ZONES[2].hazardList.length && c.headline[0][0] === "Hazards", "hazards as rows");
    ok(c.detail === vh.ZONES[2].detail, "and the detail paragraph");
    ok(/schematic/i.test(c.note), "saying what it is not");
  });
  check("an undated eruption is said, not invented", () => {
    ok(/last eruption undated/.test(card.zoneCard({ ...props, last_eruption: null }).meta), "undated");
  });
  check("and the click path uses it, before the generic card", () => {
    const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
    ok(/isZoneFeature\(props\) \? zoneCard\(props\) : null/.test(popup), "built from the feature");
    ok(/const feature = zone \? \{/.test(popup), "and mapped ahead of the rock card");
  });
}


/* ── the picker agrees with the painter, and the highlight is the merged shape ── */
check("zones come innermost first, so the first containing polygon is the worst hazard", () => {
  const { features } = vh.zonesFor([volcano("A", 5, 15, 37.75), volcano("B", 5, 15.3, 37.75)], 4);
  const zones = features.map((f) => f.properties.zone);
  ok(zones.every((z, i) => !i || z >= zones[i - 1]), zones.join(","));
});
check("volcanoes whose zones can touch form one group, transitively", () => {
  const cs = [{ name: "Vulcano", lat: 38.40, lon: 14.96 }, { name: "Lipari", lat: 38.48, lon: 14.95 },
    { name: "Stromboli", lat: 38.79, lon: 15.21 }, { name: "Etna", lat: 37.75, lon: 15.00 }, { name: "Hekla", lat: 64.0, lon: -19.7 }];
  const g = vh.mergedGroups(cs);
  ok(g.get("Vulcano").has("Lipari") && g.get("Vulcano").has("Stromboli"), "the Aeolian chain is one group");
  ok(g.get("Etna").has("Vulcano"), "and Etna, 72 km from Vulcano, reaches it through the 50 km bands");
  ok(g.get("Hekla").size === 1, "Hekla alone");
});
check("the layer draws its own highlight, and the popup defers to it", () => {
  const src = readFileSync(new URL("./volcanic-hazards.js", import.meta.url), "utf8");
  const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
  ok(/layer\.highlightFor = \(feature/.test(src), "the seam is set on the layer");
  ok(/stencilRef = 2/.test(src.slice(src.indexOf("highlightFor"))), "painted once through its own stencil ref");
  ok(/typeof layer\?\.highlightFor === "function"/.test(popup) && /return Array\.isArray\(own\)/.test(popup), "and the popup draws nothing of its own then");
});

/* ── the merge, on the source ─────────────────────────────────────────────── */
{
  const src = readFileSync(new URL("./volcanic-hazards.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
  check("overlaps merge by the stencil: one paint per pixel, innermost zone first", () => {
    ok(/stencilWrite = true/.test(code) && /stencilRef = 1/.test(code), "writes 1");
    ok(/stencilFunc = three\.NotEqualStencilFunc/.test(code), "refused where already 1");
    ok(/stencilZPass = three\.ReplaceStencilOp/.test(code), "claims the pixel");
    ok(/renderLift = zoneIndex \* 0\.01/.test(code), "zone order is draw order");
  });
  check("and the renderer has a stencil buffer to do it with", () => {
    ok((viewer.match(/stencil: true/g) || []).length === 3, "on every renderer attempt");
  });
  check("the seal is off, or every disc edge doubles at 50%", () => {
    ok(/geoidSeam\) \{ n\.visible = false;/.test(code), "seams hidden");
  });
  check("half strength, filed under the hazards subtab, and a model by its tag", () => {
    ok(/opacity: 0\.5,/.test(code), "0.5");
    ok(/home: "volcanic-hazards"/.test(code), "home");
    ok(/dataType: "model"/.test(code), "model");
  });
  check("the buffers follow the volcanoes off the globe, through the manager's own seam", () => {
    ok(/if \(current && !volcanoLayer\(\)\) remove\(\);/.test(code), "removed with them");
    // A catalogue removal never dispatches the DOM event; `onChange` is the
    // list every catalogue subscribes to, and it was measured to be the one
    // that fires.
    ok(/im\.onChange\(follow\)/.test(code), "subscribed to onChange");
  });
}

process.on("exit", () => {
  if (failures.length) {
    console.log(`\n${failures.length} failed, ${pass} passed`);
    failures.forEach((f) => console.log(`   ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓  volcanic-hazards.test.mjs  —  ${pass} passed`);
  }
});
