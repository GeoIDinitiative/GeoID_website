/**
 * THE SEAL IS A RIBBON WITH A WIDTH IN GROUND, not a one-pixel line.
 *
 * Neighbouring units do not share their boundary: each survey, then each tile
 * generalisation, simplifies its polygons independently, so the line two units
 * are meant to share becomes two lines a little apart. Measured on an inland
 * Scotland box at 86 m sampling, the widest gap by level — 4,800 m at zoom 3,
 * 1,714 at 4, 600 at 5, 343 at 7, 86 at 8, and 46 m at zoom 13 over Inishowen.
 * They are not data gaps: Macrostrat returns a unit at those coordinates and
 * we hold the very polygons.
 *
 * A line cannot close them — WebGL draws one device pixel whatever the ground
 * beneath measures — so the seal is a quad per segment, laid in the tangent
 * plane and widened on the GPU from a uniform that follows the camera.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

globalThis.window = { GeoIDViewer: { elevationNormalized: () => 0.5, surfacePoint: null } };
const { renderFeatureCollection, setSealWidthFromAltitude, sealWidth }
  = await import("./vector-render.js");

const square = () => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { name: "unit" },
    geometry: { type: "Polygon",
      coordinates: [[[10, 40], [14, 40], [14, 44], [10, 44], [10, 40]]] } }],
});

const seam = (object3D) => {
  let found = null;
  object3D.traverse((n) => { if (n.userData?.geoidSeam) found = n; });
  return found;
};

const built = renderFeatureCollection(square(), { name: "s", colourFor: () => "#4fd1a5" });
const ribbon = seam(built.object3D);

/* ── the geometry a ribbon needs ───────────────────────────────────────── */
{
  ok("a filled polygon still gets a seal", Boolean(ribbon));
  ok("the seal is triangles, not a line",
    Boolean(ribbon?.isMesh) && !ribbon?.isLineSegments);
  ok("it is indexed — four vertices to a quad, not six",
    Boolean(ribbon?.geometry?.index));

  const attrs = ribbon.geometry.attributes;
  ok("every vertex carries a perpendicular", Boolean(attrs.aPerp));
  ok("and a side", Boolean(attrs.aSide));
  ok("the sides alternate -1 / +1 so the quad straddles the boundary", (() => {
    const s = attrs.aSide;
    for (let i = 0; i < s.count; i += 2) {
      if (s.getX(i) !== -1 || s.getX(i + 1) !== 1) return false;
    }
    return true;
  })());
  ok("there are four vertices and six indices per quad",
    attrs.position.count % 4 === 0
      && ribbon.geometry.index.count === (attrs.position.count / 4) * 6,
    `${attrs.position.count} verts, ${ribbon.geometry.index.count} indices`);
}

/* ── the perpendicular is a TANGENT, or widening lifts the seal ────────── */
{
  const attrs = ribbon.geometry.attributes;
  let worstRadial = 0;
  let worstLength = 0;
  for (let i = 0; i < attrs.position.count; i += 1) {
    const px = attrs.aPerp.getX(i), py = attrs.aPerp.getY(i), pz = attrs.aPerp.getZ(i);
    const len = Math.hypot(px, py, pz);
    worstLength = Math.max(worstLength, Math.abs(len - 1));
    // The vertex's own direction is the outward normal on a sphere.
    const vx = attrs.position.getX(i), vy = attrs.position.getY(i), vz = attrs.position.getZ(i);
    const vl = Math.hypot(vx, vy, vz) || 1;
    worstRadial = Math.max(worstRadial,
      Math.abs((px * vx + py * vy + pz * vz) / vl));
  }
  ok("every perpendicular is a unit vector", worstLength < 1e-5,
    `worst |len-1| = ${worstLength}`);
  ok("and lies in the tangent plane, so width never becomes altitude",
    worstRadial < 1e-3, `worst radial component = ${worstRadial}`);
}

/* ── the width follows the camera, and is clamped ──────────────────────── */
{
  // Three quarters of a pixel of ground at a 45 degree field of view on an
  // 850 px canvas: d * 0.0007, so the ribbon spans about 1.5 px at any height.
  setSealWidthFromAltitude(0.02);                  // about 40 km up
  ok("the width is three quarters of a pixel of ground",
    Math.abs(sealWidth() - 0.02 * 0.0007) < 1e-12, `got ${sealWidth()}`);

  setSealWidthFromAltitude(0.002);                 // ten times closer
  ok("ten times closer is a tenth as wide",
    Math.abs(sealWidth() - 0.002 * 0.0007) < 1e-12, `got ${sealWidth()}`);

  setSealWidthFromAltitude(100);                   // absurdly far
  ok("a planet-wide view is capped rather than smearing the map",
    sealWidth() === 0.004, `got ${sealWidth()}`);

  setSealWidthFromAltitude(1e-9);                  // on the deck
  ok("and on the ground it cannot shrink below a few centimetres",
    sealWidth() === 0.0000002, `got ${sealWidth()}`);

  // A bad reading must leave the last good width standing rather than
  // collapsing the seam to nothing mid-flight.
  setSealWidthFromAltitude(0.02);
  const good = sealWidth();
  setSealWidthFromAltitude(Number.NaN);
  setSealWidthFromAltitude(-5);
  setSealWidthFromAltitude(0);
  ok("a nonsense distance leaves the width alone", sealWidth() === good,
    `got ${sealWidth()} against ${good}`);
}

/* ── degenerate segments are dropped, not turned into NaN ──────────────── */
{
  // A ring with a repeated vertex: `pushSegment` can hand back a zero-length
  // span, and a zero cross product would be NaN and take the draw call with it.
  const repeated = { type: "FeatureCollection", features: [{ type: "Feature",
    properties: { name: "u" }, geometry: { type: "Polygon", coordinates: [[
      [10, 40], [10, 40], [14, 40], [14, 44], [10, 44], [10, 40]]] } }] };
  const r = seam(renderFeatureCollection(repeated,
    { name: "d", colourFor: () => "#fff" }).object3D);
  const a = r.geometry.attributes;
  let finite = true;
  for (let i = 0; i < a.position.count; i += 1) {
    if (!Number.isFinite(a.aPerp.getX(i)) || !Number.isFinite(a.aPerp.getY(i))
      || !Number.isFinite(a.aPerp.getZ(i))) finite = false;
  }
  ok("a repeated vertex produces no NaN perpendicular", finite);
  ok("and the ribbon is still built", a.position.count > 0);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
