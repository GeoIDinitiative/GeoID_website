/**
 * The vector-tile decoder.
 *
 * A decoder cannot be checked by looking at it: a wrong zigzag, a missed
 * cursor carry or a flipped winding all produce a tile that decodes without
 * error into geometry that is somewhere else, or inside out. So this file
 * ENCODES tiles — the same wire format, written independently here — and
 * checks that what comes back is what went in, plus the two answers that are
 * arithmetic rather than round-trip: where a tile coordinate lands on the
 * globe, and which tiles cover a box.
 *
 * Run: node GeoID_GIS/viewer/gis/mvt.test.mjs
 */

import { decodeTile, tilesForBounds } from "./mvt.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

/* ── A minimal encoder, written against the spec rather than the decoder ──── */

const varint = (n) => {
  const out = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};
const zigzag = (n) => (n < 0 ? -n * 2 - 1 : n * 2);
const key = (tag, wire) => varint((tag << 3) | wire);
const bytes = (tag, payload) => [...key(tag, 2), ...varint(payload.length), ...payload];
const string = (tag, s) => bytes(tag, [...new TextEncoder().encode(s)]);
const uint = (tag, n) => [...key(tag, 0), ...varint(n)];

/** commands: [["move", x, y], ["line", [x,y], …], ["close"]] */
function geometry(commands) {
  const out = [];
  let cx = 0;
  let cy = 0;
  commands.forEach((cmd) => {
    if (cmd[0] === "move") {
      out.push(...varint((1 << 3) | 1));
      out.push(...varint(zigzag(cmd[1] - cx)), ...varint(zigzag(cmd[2] - cy)));
      cx = cmd[1]; cy = cmd[2];
    } else if (cmd[0] === "line") {
      const points = cmd.slice(1);
      out.push(...varint((points.length << 3) | 2));
      points.forEach(([x, y]) => {
        out.push(...varint(zigzag(x - cx)), ...varint(zigzag(y - cy)));
        cx = x; cy = y;
      });
    } else {
      out.push(...varint((1 << 3) | 7));
    }
  });
  return out;
}

function tile(layers) {
  const out = [];
  layers.forEach((layer) => {
    const body = [
      ...uint(15, 2),
      ...string(1, layer.name),
      ...uint(5, layer.extent || 4096),
    ];
    layer.keys.forEach((k) => body.push(...string(3, k)));
    layer.values.forEach((v) => body.push(...bytes(4,
      typeof v === "string" ? string(1, v) : uint(5, v))));
    layer.features.forEach((f) => {
      const fb = [
        ...uint(1, f.id || 0),
        ...bytes(2, f.tags.flatMap((t) => varint(t))),
        ...uint(3, f.type),
        ...bytes(4, geometry(f.geometry)),
      ];
      body.push(...bytes(2, fb));
    });
    out.push(...bytes(3, body));
  });
  return new Uint8Array(out);
}

/* ── Round trip ──────────────────────────────────────────────────────────── */

// A square covering the middle half of tile (1,1) at zoom 2. At z2 the world
// is four tiles across, so x=1 spans 90°W..0 and y=1 spans 66.5°N..0 — its
// middle half is a box whose corners are arithmetic rather than opinion.
const square = [["move", 1024, 1024], ["line", [3072, 1024], [3072, 3072], [1024, 3072]], ["close"]];
// A hole inside it, wound the other way.
const hole = [["move", 1536, 2560], ["line", [2560, 2560], [2560, 1536], [1536, 1536]], ["close"]];

const buffer = tile([{
  name: "units",
  keys: ["name", "color", "map_id"],
  values: ["Armagh Group", "#678F66", 2036117],
  features: [
    { id: 7, type: 3, tags: [0, 0, 1, 1, 2, 2], geometry: [...square, ...hole] },
  ],
}, {
  name: "lines",
  keys: ["type"],
  values: ["thrust fault"],
  features: [{ id: 9, type: 2, tags: [0, 0], geometry: [["move", 0, 0], ["line", [4096, 4096]]] }],
}]);

const decoded = decodeTile(buffer, { z: 2, x: 1, y: 1 });

check("both layers decode", Object.keys(decoded).sort().join(",") === "lines,units",
  Object.keys(decoded).join(","));
check("only: one layer", Object.keys(decodeTile(buffer, { z: 2, x: 1, y: 1, only: ["units"] }))
  .join(",") === "units");

const unit = decoded.units[0];
check("properties survive", unit.properties.name === "Armagh Group"
  && unit.properties.color === "#678F66" && unit.properties.map_id === 2036117,
  JSON.stringify(unit.properties));
check("feature id survives", unit.id === 7, String(unit.id));
check("polygon with a hole is one Polygon of two rings",
  unit.geometry.type === "Polygon" && unit.geometry.coordinates.length === 2,
  `${unit.geometry.type} / ${unit.geometry.coordinates.length}`);
check("rings are closed",
  unit.geometry.coordinates.every((r) => r[0][0] === r[r.length - 1][0]
    && r[0][1] === r[r.length - 1][1]));

// A quarter in from that tile's left edge is 67.5°W.
const outer = unit.geometry.coordinates[0];
near("west edge longitude", outer[0][0], -67.5, 1e-6);
near("east edge longitude", outer[1][0], -22.5, 1e-6);
// Mercator: the tile's y range 1024..3072 of 4096 maps to these latitudes.
near("north edge latitude", outer[0][1], 55.77657, 1e-4);
near("south edge latitude", outer[2][1], 21.94305, 1e-4);

const line = decoded.lines[0];
check("line type", line.geometry.type === "LineString", line.geometry.type);
check("line spans the tile", line.geometry.coordinates.length === 2
  && Math.abs(line.geometry.coordinates[0][0] + 90) < 1e-6
  && Math.abs(line.geometry.coordinates[1][0] - 0) < 1e-6,
  JSON.stringify(line.geometry.coordinates));

/* ── Winding taken from the data, not assumed ────────────────────────────── */

const flipped = tile([{
  name: "units",
  keys: ["name"],
  values: ["reversed"],
  features: [{
    id: 1,
    type: 3,
    tags: [0, 0],
    // The same square and hole with both windings reversed.
    geometry: [
      ["move", 1024, 1024], ["line", [1024, 3072], [3072, 3072], [3072, 1024]], ["close"],
      ["move", 1536, 1536], ["line", [2560, 1536], [2560, 2560], [1536, 2560]], ["close"],
    ],
  }],
}]);
const rev = decodeTile(flipped, { z: 2, x: 1, y: 1 }).units[0];
check("reversed winding still gives one polygon with a hole",
  rev.geometry.type === "Polygon" && rev.geometry.coordinates.length === 2,
  `${rev.geometry.type} / ${rev.geometry.coordinates.length}`);

/* ── Two separate polygons become a MultiPolygon ─────────────────────────── */

const pair = tile([{
  name: "units",
  keys: ["name"],
  values: ["two"],
  features: [{
    id: 1,
    type: 3,
    tags: [0, 0],
    geometry: [
      ["move", 100, 100], ["line", [500, 100], [500, 500], [100, 500]], ["close"],
      ["move", 1000, 1000], ["line", [1400, 1000], [1400, 1400], [1000, 1400]], ["close"],
    ],
  }],
}]);
check("two same-wound rings are a MultiPolygon",
  decodeTile(pair, { z: 2, x: 1, y: 1 }).units[0].geometry.type === "MultiPolygon");

/* ── A hole goes in the ring that holds it, not the one before it ────────── */

// Two separate squares and then a hole that belongs to the FIRST one. Read in
// arrival order the hole lands in the second square, and ear clipping bridges
// the two — a triangle stretching between them, which is what the rogue
// slivers over the ocean were.
const misordered = tile([{
  name: "units",
  keys: ["name"],
  values: ["stray hole"],
  features: [{
    id: 1,
    type: 3,
    tags: [0, 0],
    geometry: [
      ["move", 200, 200], ["line", [1200, 200], [1200, 1200], [200, 1200]], ["close"],
      ["move", 2600, 2600], ["line", [3600, 2600], [3600, 3600], [2600, 3600]], ["close"],
      ["move", 400, 400], ["line", [400, 800], [800, 800], [800, 400]], ["close"],
    ],
  }],
}]);
const placed = decodeTile(misordered, { z: 2, x: 1, y: 1 }).units[0].geometry;
check("two squares and a hole decode as a MultiPolygon",
  placed.type === "MultiPolygon" && placed.coordinates.length === 2,
  `${placed.type} / ${placed.coordinates.length}`);
const withHole = placed.coordinates.find((poly) => poly.length === 2);
check("the hole went to the square that contains it",
  Boolean(withHole) && Math.abs(withHole[0][0][0] - (-67.5 - 22.5 * (200 / 2048 - 1))) < 90
    && withHole[1].every(([lon, lat]) => lon > withHole[0][0][0] - 90 && lat < 90),
  withHole ? `outer starts ${withHole[0][0]}, hole starts ${withHole[1][0]}` : "no polygon has a hole");
// The decisive form: the hole's first point must be inside its own outer ring.
const inRing = (point, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
check("and it is geometrically inside it",
  Boolean(withHole) && inRing(withHole[1][0], withHole[0]));

// A ring wound as a hole but lying inside nothing is its own polygon, not a
// hole in a shape it does not touch.
const orphan = tile([{
  name: "units",
  keys: ["name"],
  values: ["orphan"],
  features: [{
    id: 1,
    type: 3,
    tags: [0, 0],
    geometry: [
      ["move", 200, 200], ["line", [1200, 200], [1200, 1200], [200, 1200]], ["close"],
      ["move", 3000, 3000], ["line", [3000, 3400], [3400, 3400], [3400, 3000]], ["close"],
    ],
  }],
}]);
const orphaned = decodeTile(orphan, { z: 2, x: 1, y: 1 }).units[0].geometry;
check("a hole inside nothing becomes its own polygon",
  orphaned.type === "MultiPolygon" && orphaned.coordinates.length === 2
    && orphaned.coordinates.every((poly) => poly.length === 1),
  `${orphaned.type} / ${JSON.stringify(orphaned.coordinates.map((p) => p.length))}`);

/* ── Tile cover ──────────────────────────────────────────────────────────── */

check("the world at z0 is one tile", tilesForBounds(
  { west: -180, south: -85, east: 180, north: 85 }, 0).length === 1);
check("the world at z2 is sixteen tiles", tilesForBounds(
  { west: -179.9, south: -85, east: 179.9, north: 85 }, 2).length === 16);
const ni = tilesForBounds({ west: -8.2, south: 54.0, east: -5.4, north: 55.4 }, 8);
check("Northern Ireland at z8 is a handful of tiles",
  ni.length >= 4 && ni.length <= 12, `${ni.length} tiles`);
check("and they are the tiles Macrostrat would be asked for",
  ni.some((t) => t.x === 124 && t.y === 80), JSON.stringify(ni));

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
