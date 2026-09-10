/**
 * The 2D model: a cross-section along a line.
 *
 * A 3D model is a block; a 2D one is a FACE. The reader draws a line A–B, the
 * DEM is sampled along it at a spacing, and the profile becomes the top edge
 * of a subsurface face (down to a base) and the bottom edge of an atmosphere
 * face (up to a sky). The faces live in the vertical plane through the line,
 * expressed in (s, z): distance along the line in metres, height in metres.
 * gmsh meshes them as plane surfaces with the profile as a shared curve, so
 * a coupled 2D run has one conforming edge by construction — which the 3D
 * shells could not have, and here costs nothing.
 *
 * Pure: the height reader is passed in, and every function is checked in Node
 * against a plane and against closed forms for area.
 */
import { makeLocalFrame } from "./model-build.js?v=20260910-e8fa215";
import { sizeFieldLines } from "./mesh-size-fields.js?v=20260910-e8fa215";

/** Sample the DEM along A–B: `n` points, evenly spaced along the line. */
export function profileAlong({ a, b, n = 200, heightAt, radiusKm = 6371.0088, frame = null }) {
  const count = Math.max(2, Math.round(n));
  // The frame's own origin where one is given (the study centre, so the
  // section shares the 3D package's CRS); the line's midpoint otherwise.
  const lat0 = frame ? frame.lat0 : (a.lat + b.lat) / 2;
  const lon0 = frame ? frame.lon0 : (a.lon + b.lon) / 2;
  const fr = frame || makeLocalFrame({ lat: lat0, lon: lon0, radiusKm });
  const A = fr.toLocal(a.lat, a.lon);
  const B = fr.toLocal(b.lat, b.lon);
  const lengthM = Math.hypot(B.x - A.x, B.y - A.y);
  if (!(lengthM > 0)) return { ok: false, message: "The section's two ends are the same place." };
  const s = new Float64Array(count);
  const z = new Float64Array(count);
  const lats = new Float64Array(count);
  const lons = new Float64Array(count);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const filled = [];
  let sum = 0; let got = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    xs[i] = A.x + (B.x - A.x) * t;
    ys[i] = A.y + (B.y - A.y) * t;
    s[i] = lengthM * t;
    const ll = fr.fromLocal(xs[i], ys[i]);
    lats[i] = ll.lat; lons[i] = ll.lon;
    const h = heightAt(ll.lat, ll.lon);
    if (Number.isFinite(h)) { z[i] = h; sum += h; got += 1; } else { z[i] = NaN; filled.push(i); }
  }
  if (!got) return { ok: false, message: "No elevation could be read along the line." };
  const mean = sum / got;
  filled.forEach((i) => { z[i] = mean; });
  let zMin = Infinity; let zMax = -Infinity;
  for (let i = 0; i < count; i += 1) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
  return {
    ok: true, kind: "section", n: count, s, z, lats, lons, xs, ys, lengthM, stepM: lengthM / (count - 1),
    a, b, frame: fr, origin: { lat: lat0, lon: lon0 }, zMin, zMax, reliefM: zMax - zMin, filledNodes: filled.length,
    // The line's direction in the local frame, so a 3D reader can place the face.
    dir: { x: (B.x - A.x) / lengthM, y: (B.y - A.y) / lengthM }, start: { x: A.x, y: A.y },
  };
}

/** Height on the profile at a distance along it, linear between samples. */
export function profileHeightAt(profile, sM) {
  if (!(profile?.n > 1)) return null;
  const t = Math.max(0, Math.min(profile.lengthM, sM)) / profile.stepM;
  const i = Math.min(profile.n - 2, Math.floor(t));
  const f = t - i;
  return profile.z[i] * (1 - f) + profile.z[i + 1] * f;
}

/**
 * The two faces as (s, z) rings, counter-clockwise: the rock from the base
 * up to the profile, the air from the profile up to the sky.
 */
export function sectionPolygons(profile, { belowM = 0, aboveM = 0 } = {}) {
  const top = [];
  for (let i = 0; i < profile.n; i += 1) top.push([profile.s[i], profile.z[i]]);
  const out = { baseZ: null, skyZ: null, rock: null, air: null };
  if (Number(belowM) > 0) {
    out.baseZ = profile.zMin - Number(belowM);
    // base left → base right → profile right → … → profile left: CCW in (s, z)
    out.rock = [[0, out.baseZ], [profile.lengthM, out.baseZ], ...top.slice().reverse()];
  }
  if (Number(aboveM) > 0) {
    out.skyZ = profile.zMax + Number(aboveM);
    // profile left → … → profile right → sky right → sky left: CCW
    out.air = [...top, [profile.lengthM, out.skyZ], [0, out.skyZ]];
  }
  return out;
}

/** Shoelace, for the checks: a face's area in m². */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]; const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * The faces as 3D triangles in the study's local frame, standing in the
 * vertical plane through the line, for a viewer that lives in three
 * dimensions (the Meshing Studio) and for an STL anybody can open.
 */
export function sectionPositions(profile, ring, scale = 1) {
  if (!ring) return new Float32Array(0);
  const place = ([sM, zM]) => [
    (profile.start.x + profile.dir.x * sM) * scale,
    (profile.start.y + profile.dir.y * sM) * scale,
    zM * scale,
  ];
  const out = [];
  triangulateRing(ring).forEach(([a, b, c]) => {
    out.push(...place(ring[a]), ...place(ring[b]), ...place(ring[c]));
  });
  return Float32Array.from(out);
}

/**
 * EAR CLIPPING over a simple CCW ring, as index triples. The faces were
 * FANNED from one corner first -- and a fan across a ridge covers the rock
 * under the chord: the air face's triangle from A over the peak to B has
 * the chord for its base and the mountain inside it, so the two domains
 * overlapped and read as one mesh. A ring with relief is not star-shaped
 * from any corner; every triangle here lies inside its own ring, so the
 * rock and the air meet at the profile and nowhere else.
 */
export function triangulateRing(ring) {
  const n = ring.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i += 1) idx.push(i);
  const cross = (o, a, b) => (ring[a][0] - ring[o][0]) * (ring[b][1] - ring[o][1]) - (ring[a][1] - ring[o][1]) * (ring[b][0] - ring[o][0]);
  const inTri = (p, a, b, c) => {
    const [px, py] = ring[p];
    const d1 = (ring[b][0] - ring[a][0]) * (py - ring[a][1]) - (ring[b][1] - ring[a][1]) * (px - ring[a][0]);
    const d2 = (ring[c][0] - ring[b][0]) * (py - ring[b][1]) - (ring[c][1] - ring[b][1]) * (px - ring[b][0]);
    const d3 = (ring[a][0] - ring[c][0]) * (py - ring[c][1]) - (ring[a][1] - ring[c][1]) * (px - ring[c][0]);
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard < n * n) {
    guard += 1;
    let clipped = false;
    for (let k = 0; k < idx.length; k += 1) {
      const a = idx[(k + idx.length - 1) % idx.length];
      const b = idx[k];
      const c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue; // a reflex (or flat) corner is not an ear
      let empty = true;
      for (const p of idx) {
        if (p === a || p === b || p === c) continue;
        if (inTri(p, a, b, c)) { empty = false; break; }
      }
      if (!empty) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // a degenerate ring: fall through to the fan for what is left
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else for (let i = 1; i < idx.length - 1; i += 1) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

const PY = (v) => JSON.stringify(v);
const f = (v) => Number(v).toFixed(4);

/**
 * gmsh, in two dimensions: points along the profile, the profile as a
 * polyline, the base and sky as lines, two plane surfaces sharing the
 * profile, physical groups the deck reads (top / base / sky / ends by flag)
 * and the embedded points at their (s, z).
 */
export function sectionGmshScript({
  name = "geoid_section", profile, belowM = 0, aboveM = 0, meshSizeM = 100, fineM = null,
  flags = {}, embedPoints = [], meshFile = null, sizeFields = [], meshOptions = null,
} = {}) {
  const F = { top: 1, base: 2, sky: 4, sides_below: 5, sides_above: 6, subsurface: 10, atmosphere: 11, points: 20, ...flags };
  const polys = sectionPolygons(profile, { belowM, aboveM });
  const pts = [];
  for (let i = 0; i < profile.n; i += 1) pts.push([f(profile.s[i]), f(profile.z[i])]);
  const fine = Number(fineM) > 0 ? Number(fineM) : Math.min(meshSizeM, profile.stepM * 2);
  const lines = [
    "# GeoID Model Builder — a 2D cross-section along a line.",
    "# Run: python3 this_script.py",
    "import gmsh",
    "",
    "gmsh.initialize()",
    "gmsh.option.setNumber(\"General.Terminal\", 1)",
    `gmsh.model.add(${PY(name)})`,
    `flags = ${PY(F)}`,
    `L = ${f(profile.lengthM)}`,
    "",
    "# The profile: the DEM along the line, as points and one polyline.",
    `profile = ${PY(pts.map(([s, z]) => [Number(s), Number(z)]))}`,
    `h_fine = ${f(fine)}`,
    `h_coarse = ${f(meshSizeM)}`,
    "top_pts = [gmsh.model.geo.addPoint(s, z, 0.0, h_fine) for (s, z) in profile]",
    "top_curves = [gmsh.model.geo.addLine(top_pts[i], top_pts[i + 1]) for i in range(len(top_pts) - 1)]",
    "surfaces = {}",
    "volumes = {}",
  ];
  if (polys.rock) {
    lines.push(
      "",
      "# The rock: base corners under the ends, walls up to the profile.",
      `z_base = ${f(polys.baseZ)}`,
      "b0 = gmsh.model.geo.addPoint(0.0, z_base, 0.0, h_coarse)",
      "b1 = gmsh.model.geo.addPoint(L, z_base, 0.0, h_coarse)",
      "base = gmsh.model.geo.addLine(b0, b1)",
      "wall_r = gmsh.model.geo.addLine(b1, top_pts[-1])",
      "wall_l = gmsh.model.geo.addLine(top_pts[0], b0)",
      "loop_rock = gmsh.model.geo.addCurveLoop([base, wall_r] + [-c for c in reversed(top_curves)] + [wall_l])",
      "surfaces[\"subsurface\"] = gmsh.model.geo.addPlaneSurface([loop_rock])",
    );
  }
  if (polys.air) {
    lines.push(
      "",
      "# The air: sky corners over the ends, walls down to the profile.",
      `z_sky = ${f(polys.skyZ)}`,
      "s0 = gmsh.model.geo.addPoint(0.0, z_sky, 0.0, h_coarse)",
      "s1 = gmsh.model.geo.addPoint(L, z_sky, 0.0, h_coarse)",
      "sky = gmsh.model.geo.addLine(s1, s0)",
      "awall_r = gmsh.model.geo.addLine(top_pts[-1], s1)",
      "awall_l = gmsh.model.geo.addLine(s0, top_pts[0])",
      "loop_air = gmsh.model.geo.addCurveLoop(top_curves + [awall_r, sky, awall_l])",
      "surfaces[\"atmosphere\"] = gmsh.model.geo.addPlaneSurface([loop_air])",
    );
  }
  lines.push(
    "",
    "gmsh.model.geo.synchronize()",
    "",
    "# THE FLAGS, as integers a deck reads: the profile is 'top' on both faces.",
    "gmsh.model.addPhysicalGroup(1, top_curves, flags[\"top\"], name=\"top\")",
    "gmsh.model.addPhysicalGroup(0, top_pts, flags[\"top\"])",
  );
  if (polys.rock) {
    lines.push(
      "gmsh.model.addPhysicalGroup(1, [base], flags[\"base\"], name=\"base\")",
      "gmsh.model.addPhysicalGroup(1, [wall_l, wall_r], flags[\"sides_below\"], name=\"sides_below\")",
      "gmsh.model.addPhysicalGroup(0, [b0, b1], flags[\"base\"])",
      "gmsh.model.addPhysicalGroup(2, [surfaces[\"subsurface\"]], flags[\"subsurface\"], name=\"subsurface\")",
    );
  }
  if (polys.air) {
    lines.push(
      "gmsh.model.addPhysicalGroup(1, [sky], flags[\"sky\"], name=\"sky\")",
      "gmsh.model.addPhysicalGroup(1, [awall_l, awall_r], flags[\"sides_above\"], name=\"sides_above\")",
      "gmsh.model.addPhysicalGroup(0, [s0, s1], flags[\"sky\"])",
      "gmsh.model.addPhysicalGroup(2, [surfaces[\"atmosphere\"]], flags[\"atmosphere\"], name=\"atmosphere\")",
    );
  }
  const embedded = (embedPoints || []).map((p) => [Number(p.s) || 0, Number(p.z) || 0, Number(p.sizeM) > 0 ? Number(p.sizeM) : fine, String(p.name || "point"), Number(p.flag) > 0 ? Math.round(Number(p.flag)) : F.points]);
  lines.push(
    "",
    "# Embedded points at their (s, z): a node exactly there, in whichever face holds them.",
    `embedded = ${PY(embedded)}`,
    "for (ps, pz, psize, pname, pflag) in embedded:",
    "    tag = gmsh.model.geo.addPoint(ps, pz, 0.0, psize)",
    "    gmsh.model.geo.synchronize()",
    "    for key, surf in surfaces.items():",
    "        if gmsh.model.isInside(2, surf, [ps, pz, 0.0]):",
    "            gmsh.model.mesh.embed(0, [tag], 2, surf)",
    "            break",
    "    gmsh.model.addPhysicalGroup(0, [tag], pflag, name=pname)",
    ...(meshOptions || (sizeFields || []).length
      ? sizeFieldLines({ fields: sizeFields, dim: 2, coarseM: meshSizeM, options: { ...(meshOptions || {}) } })
      : ["", `gmsh.option.setNumber("Mesh.MeshSizeMax", ${f(meshSizeM)})`]),
    "",
    "gmsh.model.mesh.generate(2)",
    `gmsh.write(${PY(meshFile || `${name}.msh`)})`,
    "gmsh.finalize()",
  );
  return lines.join("\n");
}

/** The profile as CSV: distance, lat, lon, elevation. */
export function profileCsv(profile) {
  const rows = ["s_m,lat,lon,z_m"];
  for (let i = 0; i < profile.n; i += 1) rows.push(`${profile.s[i].toFixed(2)},${profile.lats[i].toFixed(6)},${profile.lons[i].toFixed(6)},${profile.z[i].toFixed(2)}`);
  return `${rows.join("\n")}\n`;
}
