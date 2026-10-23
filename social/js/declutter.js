/**
 * Keeping map markers from sitting on top of each other.
 *
 * Two things make a community map pile up. Locations are ROUNDED before they
 * are stored (0.1 deg, 1 deg), so ten people at Etna are ten markers on one
 * pixel; and at world scale, distinct places a few kilometres apart are a few
 * pixels apart. Both are solved in screen space, after projection, so the
 * answer is right for the zoom the reader is at:
 *
 *   - groupMarkers() gathers markers whose discs would touch into groups,
 *     repeating until no two groups' discs overlap. A group of up to FAN_MAX
 *     is drawn fanned out round its centre (fanOut), each marker on a spoke
 *     back to its true place; a larger group is one counted bubble.
 *   - placeLabels() puts each label beside its marker on whichever side is
 *     free -- right, left, above, below, as the old Earth Explorer hero tile
 *     did -- and drops a label rather than overlap anything.
 *
 * Pure functions over plain numbers, so node tests them (declutter.test.mjs).
 */

export const FAN_MAX = 8;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Radius a group occupies on screen: a fan's spread, or a bubble's size. */
export function groupRadius(n, { marker = 6, sep = 14, bubble = (k) => 9 + Math.min(18, Math.log2(k + 1) * 3) } = {}) {
  if (n <= 1) return marker;
  if (n <= FAN_MAX) return fanSpread(n, sep) + marker;
  return bubble(n);
}

/** Radius of the outermost fanned marker for n markers `sep` apart. */
export function fanSpread(n, sep = 14) {
  if (n <= 1) return 0;
  // Neighbours on a ring of radius r are a CHORD apart, 2r sin(pi/n) -- not
  // the arc -- so r = sep / (2 sin(pi/n)). At least sep, so a pair of
  // markers still sits clear of the centre where the spokes meet.
  return Math.max(sep, sep / (2 * Math.sin(Math.PI / n)));
}

/** Positions for n markers fanned round (cx, cy), at least `sep` apart. */
export function fanOut(cx, cy, n, sep = 14) {
  if (n <= 1) return [{ x: cx, y: cy }];
  const r = fanSpread(n, sep);
  // Start at the top and go clockwise, so the fan reads the same every time.
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

/**
 * Group screen-space markers so no two groups overlap.
 *
 * `items`: [{x, y, weight?, ...}] already projected. `radiusOf(group)` is the
 * disc a group would occupy (defaults to groupRadius by member count).
 * Returns [{x, y, r, members, weight}], heaviest first; x/y is the weighted
 * centre of the members' true positions.
 */
export function groupMarkers(items, { gap = 3, radiusOf } = {}) {
  const rOf = radiusOf || ((g) => groupRadius(g.members.length));
  let groups = items
    .map((it) => ({ x: it.x, y: it.y, weight: it.weight ?? 1, members: [it] }))
    .sort((a, b) => b.weight - a.weight);
  groups.forEach((g) => { g.r = rOf(g); });
  // Merging grows a group, which can make it touch another: repeat until
  // stable. Each pass removes at least one group, so it ends.
  for (let pass = 0; pass < items.length; pass += 1) {
    let merged = false;
    const out = [];
    for (const g of groups) {
      const into = out.find((o) => dist(o, g) < o.r + g.r + gap);
      if (!into) { out.push(g); continue; }
      const w = into.weight + g.weight;
      into.x = (into.x * into.weight + g.x * g.weight) / w;
      into.y = (into.y * into.weight + g.y * g.weight) / w;
      into.weight = w;
      into.members.push(...g.members);
      into.r = rOf(into);
      merged = true;
    }
    groups = out.sort((a, b) => b.weight - a.weight);
    if (!merged) break;
  }
  return groups;
}

/** True when two axis-aligned boxes overlap. */
export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Place labels beside their anchors without overlapping each other or any
 * disc in `obstacles` ([{x, y, r}]). `labels`: [{x, y, r, w, h, ...}] where
 * x/y/r is the anchor disc and w/h the label's size, most important first.
 * Returns the placed labels with box {x, y, w, h} and side; the rest are left
 * out, never drawn on top of something.
 */
export function placeLabels(labels, obstacles = [], { pad = 4, bounds = null } = {}) {
  const placed = [];
  const discBox = (o) => ({ x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 });
  const blockers = obstacles.map(discBox);
  for (const l of labels) {
    const sides = [
      ["right", l.x + l.r + pad, l.y - l.h / 2],
      ["left", l.x - l.r - pad - l.w, l.y - l.h / 2],
      ["up", l.x - l.w / 2, l.y - l.r - pad - l.h],
      ["down", l.x - l.w / 2, l.y + l.r + pad],
    ];
    for (const [side, x, y] of sides) {
      const box = { x, y, w: l.w, h: l.h };
      if (bounds && (x < bounds.x || y < bounds.y || x + l.w > bounds.x + bounds.w || y + l.h > bounds.y + bounds.h)) continue;
      // Its own disc is an obstacle too, but the label sits beside it by
      // construction, so only OTHER discs are tested.
      const others = blockers.filter((b, i) => !(obstacles[i].x === l.x && obstacles[i].y === l.y));
      if (others.some((b) => boxesOverlap(box, b))) continue;
      if (placed.some((p) => boxesOverlap(box, p.box))) continue;
      placed.push({ ...l, box, side });
      break;
    }
  }
  return placed;
}

/**
 * Two layers on one map without either sitting on the other.
 *
 * Community discs (`fixed`) stay where they are: they are the page's own
 * content and their place is the point. A second layer's discs (`movable`,
 * e.g. official hazard markers, already grouped among themselves) are moved
 * off them -- and off each other -- to the nearest free spot on rings round
 * their true position, 12 directions per ring, starting north and going
 * clockwise so the answer is stable from frame to frame. Each keeps its true
 * position as `ax, ay` so a leader line can point home. A disc with no free
 * spot within `maxShift` pixels is returned with `placed: false` and is not
 * drawn; the page lists it instead, so nothing is hidden from the reader.
 */
export function avoidDiscs(movable, fixed = [], { gap = 3, maxShift = 90, step = 6 } = {}) {
  const taken = fixed.map((f) => ({ x: f.x, y: f.y, r: f.r }));
  const clear = (x, y, r) => taken.every((t) => Math.hypot(t.x - x, t.y - y) >= t.r + r + gap);
  const out = [];
  for (const m of [...movable].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))) {
    let spot = clear(m.x, m.y, m.r) ? { x: m.x, y: m.y } : null;
    for (let d = step; !spot && d <= maxShift; d += step) {
      for (let k = 0; k < 12 && !spot; k += 1) {
        const a = -Math.PI / 2 + (k * Math.PI) / 6;
        const x = m.x + d * Math.cos(a); const y = m.y + d * Math.sin(a);
        if (clear(x, y, m.r)) spot = { x, y };
      }
    }
    if (!spot) { out.push({ ...m, ax: m.x, ay: m.y, placed: false, moved: false }); continue; }
    taken.push({ x: spot.x, y: spot.y, r: m.r });
    out.push({ ...m, ax: m.x, ay: m.y, x: spot.x, y: spot.y, placed: true, moved: spot.x !== m.x || spot.y !== m.y });
  }
  return out;
}
