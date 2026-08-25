#!/usr/bin/env node
/**
 * Every shipped layer must still look like degrees.
 *
 * `import-manager` decides where a layer lives by asking `looksLikeGeographic`
 * about its bounds: pass and it is parented to `GeoID-ImportedGeoLayers`, which
 * is turned to the globe's rotation every frame; fail and it goes to the
 * local-models group, which carries no spin at all. **Nothing is logged either
 * way** — the guard exists to catch a shapefile in UTM metres, and for that a
 * silent answer is right.
 *
 * The stress map shipped a commit with `minX = -180.6028`. Six tenths of a
 * degree past the ±180.5 the guard allows for rounding, because a 60 km bar
 * drawn either side of a record near the antimeridian walks off the end of the
 * coordinate system. The whole layer was placed in the unspun frame and sat
 * 38.8° west of the planet — the Iberian records out in the Atlantic, and the
 * shape of Iberia still legible in them, which is how it was spotted.
 *
 * So the rule is checked against the FILES, in the same terms the viewer uses,
 * for every dataset the catalogue ships. A bake that leaves the map fails here
 * rather than in somebody's screenshot.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeGeographic } from "./geo-utils.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "../../..");   // the site root a "/…" path is relative to

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Every position in a geometry, whatever shape it took. */
function coords(geometry) {
  if (!geometry) return [];
  const c = geometry.coordinates;
  switch (geometry.type) {
    case "Point": return [c];
    case "MultiPoint":
    case "LineString": return c;
    case "MultiLineString":
    case "Polygon": return c.flat();
    case "MultiPolygon": return c.flat(2);
    case "GeometryCollection": return (geometry.geometries || []).flatMap(coords);
    default: return [];
  }
}

// Read from the catalogue rather than a list of our own, so a dataset added
// later is covered without anybody remembering to add it here.
const source = readFileSync(join(HERE, "global-data.js"), "utf8");
const paths = [...source.matchAll(/path:\s*"(\/[^"]+\.geojson)"/g)].map((m) => m[1]);

// The two remote datasets (Bird's plate boundaries, the GEM fault database)
// carry a `url:` and are fetched at runtime, so they cannot be checked offline.
check("the catalogue lists shipped geojson", paths.length > 0, `${paths.length} found`);

for (const webPath of paths) {
  const file = join(SITE, webPath.replace(/^\//, ""));
  const label = webPath.split("/").pop();
  if (!existsSync(file)) {
    // A catalogue entry pointing at nothing is its own failure, and a louder
    // one than bad bounds: the layer cannot load at all.
    check(`${label} exists`, false, "no such file");
    continue;
  }
  const fc = JSON.parse(readFileSync(file, "utf8"));
  const all = (fc.features || []).flatMap((f) => coords(f.geometry));
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of all) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bounds = { minX, minY, maxX, maxY };
  const span = `lon ${minX}..${maxX}, lat ${minY}..${maxY}`;
  check(`${label} is georeferenced by the viewer's own rule`,
    looksLikeGeographic(bounds), span);
  // Tighter than the guard: the guard's ±180.5 is slack for rounding, not a
  // licence to ship coordinates off the map.
  check(`${label} stays inside ±180 / ±90`,
    minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90, span);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
