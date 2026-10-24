/**
 * Things OSM maps that are not buildings, and must not be drawn as boxes:
 * bridges and lattice structures (the London Eye). Pure, like extrude.js,
 * which calls into here with a small drawing API.
 *
 * ── Bridges ──────────────────────────────────────────────────────────────
 * The satellite photo has every bridge in it, flat on the water. A plane at
 * 100 m flew "through" them, and the photo's own bridge reads as a deck at
 * river level. OpenMapTiles' `transportation` layer has what is needed:
 *   - `class=bridge` POLYGONS: man_made=bridge outlines, the deck's real
 *     shape. These become slabs topped with their own photograph (so the
 *     road markings and buses are on the deck where they belong).
 *   - `brunnel=bridge` LINES with `class` and `layer`: every road, rail line
 *     and footway carried by a bridge. Those not already inside a polygon
 *     become ribbons, sized by class; rail gets a ballast-coloured deck.
 * Height: the highest ground within 150 m along the way (the banks), plus
 * 2 m, plus 2 m per `layer` -- which puts the Thames bridges at about 9 m
 * over the water, close to the real ~8-10 m. Piers every 35 m wherever the
 * span is over the `water` layer's polygons, and under each deck over water
 * a dark water-coloured patch hides the photo's flat copy of the bridge.
 * Buildings whose centroid lies inside a bridge outline are not extruded.
 *
 * ── Lattice structures ───────────────────────────────────────────────────
 * The London Eye is mapped as ~150 building:parts -- rim segments, capsules,
 * the A-frame -- each a few metres tall and floating up to 137 m. Extruded,
 * that is a staircase of boxes. Any CLUSTER of small floating parts (40 or
 * more within 90 m, spanning 40 m or more vertically) is taken out of the
 * extrusion. If its parts lie on a vertical circle it is drawn as a wheel:
 * rim, capsules, spokes and an A-frame. Otherwise it is drawn as nothing,
 * which is better than boxes.
 */

/* ── Geometry helpers ─────────────────────────────────────────────────── */

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1])
        && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function inPolys(p, polys) {
  for (const poly of polys) {
    if (pointInRing(p, poly.outer) && !poly.holes.some((h) => pointInRing(p, h))) return true;
  }
  return false;
}

/** Liang–Barsky against [0, ext]^2; returns the pieces of a polyline inside. */
export function clipLine(line, ext) {
  const out = [];
  let cur = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy], q = [x0, ext - x0, y0, ext - y0];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { ok = false; break; } continue; }
      const r = q[k] / p[k];
      if (p[k] < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
    if (!cur || t0 > 0) { cur = [a]; out.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return out.filter((l) => l.length >= 2);
}

/* Deck widths in metres by OpenMapTiles class. */
const WIDTH = {
  motorway: 24, trunk: 20, primary: 16, secondary: 13, tertiary: 11, minor: 8,
  service: 5, track: 4, path: 3.5, raceway: 10, busway: 8, rail: 10, transit: 7,
};
const RANK = { path: 0, track: 0, service: 1, minor: 2, tertiary: 3, secondary: 4,
  primary: 5, trunk: 6, motorway: 7, busway: 3, raceway: 2, rail: 2, transit: 2 };
const DECK = 1.6;                     // deck thickness
const CONCRETE = [0.58, 0.56, 0.53];
const BALLAST = [0.36, 0.33, 0.30];
const RIVER = [0.10, 0.15, 0.13];

/**
 * Bridge outlines (class=bridge polygons), for excluding buildings and for
 * skipping lines already covered by a deck.
 */
export function bridgeOutlines(transport, polygonsOf) {
  if (!transport) return [];
  const out = [];
  for (const f of transport.features) {
    if (f.type === 3 && f.props.class === "bridge") out.push(...polygonsOf(f));
  }
  return out;
}

/**
 * Draw every bridge in the tile.
 * api: { s, ext, ground(u,v), quad(P[4] metres, n, colour, group, imagery),
 *        polygonsOf(feature), triangulate, roofTri(P[3] metres) }
 */
export function drawBridges(api, transport, water, outlines) {
  if (!transport) return 0;
  const { s, ext, ground } = api;
  const waterPolys = water ? water.features.filter((f) => f.type === 3).flatMap(api.polygonsOf) : [];
  const overWater = (u, v) => inPolys([u, v], waterPolys);
  const M = (u, v) => [u * s, v * s];                     // tile units -> metres (x, z)
  let n = 0;

  /** Highest ground within `reach` metres of a point along a direction. */
  const bankHeight = (u, v, du, dv, reach = 150) => {
    let h = ground(u, v);
    const L = Math.hypot(du, dv) || 1, ux = du / L, uy = dv / L;
    for (let d = -reach; d <= reach; d += 15) {
      const pu = u + ux * d / s, pv = v + uy * d / s;
      if (pu < -ext * 0.5 || pv < -ext * 0.5 || pu > ext * 1.5 || pv > ext * 1.5) continue;
      h = Math.max(h, ground(pu, pv));
    }
    return h;
  };

  /** A box from a centre line segment: top at `top`, given width/thickness. */
  const slabSegment = (a, b, ha, hb, width, topColour, imagery, rankLift) => {
    const [ax, az] = M(a[0], a[1]), [bx, bz] = M(b[0], b[1]);
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.5) return;
    const px = -dz / L * width / 2, pz = dx / L * width / 2;
    const ta = ha + rankLift, tb = hb + rankLift;
    const A1 = [ax + px, ta, az + pz], A2 = [ax - px, ta, az - pz];
    const B1 = [bx + px, tb, bz + pz], B2 = [bx - px, tb, bz - pz];
    const lo = (P) => [P[0], P[1] - DECK, P[2]];
    api.quad([A1, B1, B2, A2], [0, 1, 0], topColour, imagery ? "roof" : "wall");                 // deck
    api.quad([lo(A1), lo(A2), lo(B2), lo(B1)], [0, -1, 0], CONCRETE, "wall");                  // soffit
    api.quad([A1, lo(A1), lo(B1), B1], [px, 0, pz], CONCRETE, "wall");                          // sides
    api.quad([A2, B2, lo(B2), lo(A2)], [-px, 0, -pz], CONCRETE, "wall");
  };

  const pier = (u, v, dirx, dirz, across, top) => {
    // A pier: 3 m along the bridge, `across` wide, from below the water to the soffit.
    const [cx, cz] = M(u, v);
    const L = Math.hypot(dirx, dirz) || 1, ax = dirx / L, az = dirz / L, bx = -az, bz = ax;
    const h0 = Math.min(ground(u, v), 0) - 2, h1 = top - DECK;
    if (h1 - h0 < 1) return;
    const half = 1.5, w = across / 2;
    const c = (sa, sb, y) => [cx + ax * sa * half + bx * sb * w, y, cz + az * sa * half + bz * sb * w];
    for (const [sa, sb, nx, nz] of [[1, 0, ax, az], [-1, 0, -ax, -az], [0, 1, bx, bz], [0, -1, -bx, -bz]]) {
      const p = sa
        ? [c(sa, -1, h1), c(sa, -1, h0), c(sa, 1, h0), c(sa, 1, h1)]
        : [c(-1, sb, h1), c(-1, sb, h0), c(1, sb, h0), c(1, sb, h1)];
      api.quad(p, [nx, 0, nz], CONCRETE, "wall");
    }
  };

  const waterPatch = (P) => api.quad(P.map(([x, z]) => [x, 0.15, z]), [0, 1, 0], RIVER, "wall");

  // 1. Polygon decks.
  for (const poly of outlines) {
    const ring = poly.outer;
    if (ring.length < 3) continue;
    // Principal axis by the farthest pair of vertices (bridges are long).
    let best = 0, ia = 0, ib = 0;
    for (let i = 0; i < ring.length; i++)
      for (let j = i + 1; j < ring.length; j++) {
        const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
        if (d > best) { best = d; ia = i; ib = j; }
      }
    const A = ring[ia], B = ring[ib];
    const du = B[0] - A[0], dv = B[1] - A[1];
    const top = Math.max(bankHeight(A[0], A[1], du, dv), bankHeight(B[0], B[1], du, dv)) + 4;
    // Deck top (imagery) and soffit via earcut; sides along the outline.
    const contour = ring.map(([x, y]) => ({ x, y }));
    const holes = poly.holes.map((h) => h.map(([x, y]) => ({ x, y })));
    const all = contour.concat(...holes);
    for (const t of api.triangulate(contour, holes)) {
      const P = t.map((k) => { const [x, z] = M(all[k].x, all[k].y); return [x, top, z]; });
      api.tri(P, [0, 1, 0], [1, 1, 1], "roof");
      api.tri(P.map((p) => [p[0], top - DECK, p[2]]), [0, -1, 0], CONCRETE, "wall");
      // Water under the deck, triangle by triangle where it is over the river.
      const cu = (all[t[0]].x + all[t[1]].x + all[t[2]].x) / 3, cv = (all[t[0]].y + all[t[1]].y + all[t[2]].y) / 3;
      if (overWater(cu, cv)) api.tri(P.map((p) => [p[0], 0.15, p[2]]), [0, 1, 0], RIVER, "wall");
    }
    for (const r of [ring, ...poly.holes]) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const [ax, az] = M(a[0], a[1]), [bx, bz] = M(b[0], b[1]);
        const nx = bz - az, nz = -(bx - ax);
        api.quad([[ax, top, az], [ax, top - DECK, az], [bx, top - DECK, bz], [bx, top, bz]], [nx, 0, nz], CONCRETE, "wall");
      }
    }
    // Piers along the axis over water, spanning the outline's width there.
    const Lm = best * s, steps = Math.floor(Lm / 35);
    let width = 0;
    for (const q of ring) width = Math.max(width, Math.abs((q[0] - A[0]) * -dv + (q[1] - A[1]) * du) / (best || 1));
    for (let k = 1; k < steps; k++) {
      const t = k / steps, u = A[0] + du * t, v = A[1] + dv * t;
      if (u < 0 || v < 0 || u > ext || v > ext) continue;
      if (overWater(u, v)) pier(u, v, du, dv, Math.max(4, width * s * 0.9), top);
    }
    n++;
  }

  // 2. Line decks not already covered by an outline.
  for (const f of transport.features) {
    if (f.type !== 2 || f.props.brunnel !== "bridge") continue;
    const cls = f.props.class;
    const width = WIDTH[cls];
    if (!width) continue;
    const layer = Math.max(1, +f.props.layer || 1);
    const rail = cls === "rail" || cls === "transit";
    for (const full of api.linesOf(f)) {
      for (const line of clipLine(full, ext)) {
        const mid = line[Math.floor(line.length / 2)];
        const m2 = [(line[0][0] + line[line.length - 1][0]) / 2, (line[0][1] + line[line.length - 1][1]) / 2];
        if (inPolys(mid, outlines) || inPolys(m2, outlines)) continue;
        const hs = line.map((p, i) => {
          const q = line[Math.min(i + 1, line.length - 1)], o = line[Math.max(i - 1, 0)];
          return bankHeight(p[0], p[1], q[0] - o[0], q[1] - o[1]) + 2 + 2 * layer;
        });
        const lift = (RANK[cls] || 0) * 0.08;
        for (let i = 0; i + 1 < line.length; i++) {
          slabSegment(line[i], line[i + 1], hs[i], hs[i + 1], width, rail ? BALLAST : [1, 1, 1], !rail, lift);
          // Piers and the water patch where the segment is over the river.
          const [ax, az] = M(line[i][0], line[i][1]), [bx, bz] = M(line[i + 1][0], line[i + 1][1]);
          const L = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.floor(L / 35));
          for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps, tm = (t0 + t1) / 2;
            const u = line[i][0] + (line[i + 1][0] - line[i][0]) * tm, v = line[i][1] + (line[i + 1][1] - line[i][1]) * tm;
            if (!overWater(u, v)) continue;
            const du = line[i + 1][0] - line[i][0], dv = line[i + 1][1] - line[i][1];
            if (k > 0) pier(line[i][0] + du * t0, line[i][1] + dv * t0, du, dv, width * 0.8, hs[i] + (hs[i + 1] - hs[i]) * t0);
            const px = -(bz - az) / L * width / 2, pz = (bx - ax) / L * width / 2;
            const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
            waterPatch([[x0 + px, z0 + pz], [x1 + px, z1 + pz], [x1 - px, z1 - pz], [x0 - px, z0 - pz]]);
          }
        }
        n++;
      }
    }
  }
  return n;
}

/* ── Lattice structures ───────────────────────────────────────────────── */

/**
 * Find clusters of small floating building parts. `parts` is
 * [{ i, cx, cz (metres), lo, hi (metres above ground), area (m^2) }].
 * Returns { skip: Set of part indices, wheels: [...] }.
 */
export function latticeClusters(parts) {
  const cand = parts.filter((p) => p.lo >= 1 && p.hi - p.lo <= 8 && p.area < 150);
  const skip = new Set(), wheels = [];
  const used = new Set();
  for (const seed of cand) {
    if (used.has(seed.i)) continue;
    // Grow a cluster by 90 m proximity.
    const members = [seed]; used.add(seed.i);
    for (let k = 0; k < members.length; k++) {
      const m = members[k];
      for (const c of cand) {
        if (used.has(c.i)) continue;
        if (Math.hypot(c.cx - m.cx, c.cz - m.cz) < 30) { used.add(c.i); members.push(c); }
      }
    }
    if (members.length < 40) continue;
    const top = Math.max(...members.map((m) => m.hi)), bot = Math.min(...members.map((m) => m.lo));
    if (top - bot < 40) continue;
    // Also take any small part (even grounded) within 20 m of the cluster's
    // members: the bases and the A-frame feet of the same structure.
    for (const p of parts) {
      if (skip.has(p.i)) continue;
      if (p.area < 150 && members.some((m) => Math.hypot(p.cx - m.cx, p.cz - m.cz) < 20) && p.hi - p.lo <= 8) skip.add(p.i);
    }
    for (const m of members) skip.add(m.i);
    // Is it a wheel? Fit the plane: principal horizontal direction of the
    // members' centroids, then a circle in (along, height).
    const wheel = fitWheel(members);
    if (wheel) wheels.push(wheel);
  }
  return { skip, wheels };
}

export function fitWheel(members) {
  const n = members.length;
  const mx = members.reduce((a, m) => a + m.cx, 0) / n, mz = members.reduce((a, m) => a + m.cz, 0) / n;
  let sxx = 0, szz = 0, sxz = 0;
  for (const m of members) { const x = m.cx - mx, z = m.cz - mz; sxx += x * x; szz += z * z; sxz += x * z; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const dx = Math.cos(ang), dz = Math.sin(ang);
  // Rim parts only: drop the lowest band (A-frame feet, bases).
  const pts = members.map((m) => ({ a: (m.cx - mx) * dx + (m.cz - mz) * dz, p: -(m.cx - mx) * dz + (m.cz - mz) * dx, h: (m.lo + m.hi) / 2 }));
  const top = Math.max(...pts.map((q) => q.h)), bot = Math.min(...pts.map((q) => q.h));
  const cy = (top + bot) / 2, r = (top - bot) / 2;
  const ca = pts.reduce((s, q) => s + q.a, 0) / n;
  // Circle test on the parts IN the plane (the A-frame legs stand 10-30 m
  // off it and would drag a mean): the median radial error must be small.
  // A real rim is a truss (the Eye's inner and outer rims and capsules sit
  // 48-76 m from a 66 m centre line), hence 20 %; what keeps a straight
  // lattice from passing is the second test: parts in all four quadrants.
  const errs = [], quad = [0, 0, 0, 0];
  for (const q of pts) {
    if (Math.abs(q.p) > 12) continue;
    const d = Math.hypot(q.a - ca, q.h - cy);
    if (d < r * 0.4) continue;                        // hub, spokes
    errs.push(Math.abs(d - r));
    quad[(q.a > ca ? 1 : 0) + (q.h > cy ? 2 : 0)]++;
  }
  errs.sort((x, y) => x - y);
  if (errs.length < 20 || errs[errs.length >> 1] > r * 0.2 || Math.min(...quad) < 4) return null;
  return { cx: mx + dx * ca, cz: mz + dz * ca, cy, r, dx, dz };
}

/** Rim, capsules, spokes and A-frame, in metres, via the box/quad API. */
export function drawWheel(api, w) {
  const WHITE = [0.93, 0.93, 0.92], GLASS = [0.55, 0.68, 0.78];
  const { cx, cz, cy, r, dx, dz } = w;
  const pt = (a, h, p = 0) => [cx + dx * a - dz * p, h, cz + dz * a + dx * p];
  // Rim: a tube of 8 sides round a 72-segment ring.
  const S = 72, T = 6, tube = Math.max(0.9, r * 0.012);
  for (let i = 0; i < S; i++) {
    const t0 = i / S * Math.PI * 2, t1 = (i + 1) / S * Math.PI * 2;
    for (let j = 0; j < T; j++) {
      const p0 = j / T * Math.PI * 2, p1 = (j + 1) / T * Math.PI * 2;
      const v = (t, p) => {
        const rr = r + tube * Math.cos(p);
        return pt(Math.cos(t) * rr, cy + Math.sin(t) * rr, tube * Math.sin(p));
      };
      const nrm = (t, p) => {
        const c = [Math.cos(t) * Math.cos(p), Math.sin(t) * Math.cos(p), Math.sin(p)];
        return [dx * c[0] - dz * c[2], c[1], dz * c[0] + dx * c[2]];
      };
      const mid = nrm((t0 + t1) / 2, (p0 + p1) / 2);
      api.quad([v(t0, p0), v(t1, p0), v(t1, p1), v(t0, p1)], mid, WHITE, "wall");
    }
  }
  // Spokes and capsules.
  const box = (c, ax, ay, az, col) => api.box(c, ax, ay, az, col);
  for (let i = 0; i < 32; i++) {
    const t = i / 32 * Math.PI * 2;
    const ca = Math.cos(t), sa = Math.sin(t);
    const rim = pt(ca * (r + 2.2), cy + sa * (r + 2.2));
    box(rim, [dx * 2.0, 0, dz * 2.0], [0, 1.6, 0], [-dz * 1.6, 0, dx * 1.6], GLASS);
    if (i % 2 === 0) {
      const mid = pt(ca * r / 2, cy + sa * r / 2);
      box(mid, [dx * ca * r / 2, sa * r / 2, dz * ca * r / 2], [0, 0.12, 0], [-dz * 0.12, 0, dx * 0.12], WHITE);
    }
  }
  box(pt(0, cy), [dx * 1.5, 0, dz * 1.5], [0, 1.5, 0], [-dz * 3, 0, dx * 3], WHITE);   // hub
  // A-frame: two legs from the hub down to feet behind the wheel's plane.
  for (const side of [-1, 1]) {
    const foot = pt(side * r * 0.35, 0, r * 0.55), hub = pt(0, cy, 0);
    const c = [(foot[0] + hub[0]) / 2, (foot[1] + hub[1]) / 2, (foot[2] + hub[2]) / 2];
    const ax = [(hub[0] - foot[0]) / 2, (hub[1] - foot[1]) / 2, (hub[2] - foot[2]) / 2];
    box(c, ax, [0.9 * dx, 0, 0.9 * dz], [-dz * 0.9, 0.0, dx * 0.9], WHITE);
  }
}
