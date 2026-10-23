// node social/js/declutter.test.mjs
import assert from "node:assert/strict";
import { groupMarkers, fanOut, fanSpread, groupRadius, placeLabels, boxesOverlap, avoidDiscs, FAN_MAX } from "./declutter.js";

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log(`ok  ${name}`); };
const noOverlap = (groups, gap = 0) => {
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const d = Math.hypot(groups[i].x - groups[j].x, groups[i].y - groups[j].y);
      assert.ok(d >= groups[i].r + groups[j].r + gap - 1e-9, `groups ${i} and ${j} overlap (${d} < ${groups[i].r + groups[j].r})`);
    }
  }
};

ok("ten people on one rounded point become one group", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ x: 100, y: 100, id: i }));
  const g = groupMarkers(items);
  assert.equal(g.length, 1);
  assert.equal(g[0].members.length, 10);
});

ok("a fan keeps every marker at least sep apart and off the centre", () => {
  for (let n = 2; n <= FAN_MAX; n += 1) {
    const pts = fanOut(0, 0, n, 14);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 14 - 1e-9, `n=${n}`);
    }
    assert.ok(Math.abs(Math.hypot(pts[0].x, pts[0].y) - fanSpread(n, 14)) < 1e-9);
  }
});

ok("dense random scatter ends with no two groups overlapping", () => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let trial = 0; trial < 20; trial += 1) {
    const items = Array.from({ length: 200 }, () => ({ x: rand() * 600, y: rand() * 300 }));
    const groups = groupMarkers(items, { gap: 3 });
    noOverlap(groups, 3);
    assert.equal(groups.reduce((s, g) => s + g.members.length, 0), 200, "nobody lost");
  }
});

ok("weighted cells keep the heavier cell's position", () => {
  const radiusOf = (g) => 6 + 4 * Math.sqrt(g.weight);
  const groups = groupMarkers([{ x: 0, y: 0, weight: 9 }, { x: 10, y: 0, weight: 1 }], { radiusOf });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].weight, 10);
  assert.ok(groups[0].x < 2, "centre stays near the heavier cell");
});

ok("far-apart markers are left alone", () => {
  const groups = groupMarkers([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 200 }]);
  assert.equal(groups.length, 3);
});

ok("labels never overlap each other or other discs, and drop rather than collide", () => {
  const discs = [{ x: 100, y: 100, r: 10 }, { x: 150, y: 100, r: 10 }, { x: 125, y: 140, r: 10 }];
  const labels = discs.map((d, i) => ({ ...d, w: 60, h: 16, text: `L${i}` }));
  const placed = placeLabels(labels, discs);
  assert.ok(placed.length >= 1);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) assert.ok(!boxesOverlap(placed[i].box, placed[j].box));
    for (const d of discs) {
      if (d.x === placed[i].x && d.y === placed[i].y) continue;
      assert.ok(!boxesOverlap(placed[i].box, { x: d.x - d.r, y: d.y - d.r, w: 2 * d.r, h: 2 * d.r }));
    }
  }
});

ok("a label that fits nowhere inside the bounds is dropped", () => {
  const placed = placeLabels([{ x: 5, y: 5, r: 4, w: 400, h: 20 }], [], { bounds: { x: 0, y: 0, w: 100, h: 100 } });
  assert.equal(placed.length, 0);
});

ok("group radius grows with membership", () => {
  assert.ok(groupRadius(1) < groupRadius(3));
  assert.ok(groupRadius(FAN_MAX + 1) > 9);
});

ok("a second layer is moved off the first, and off itself, never onto anything", () => {
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let trial = 0; trial < 20; trial += 1) {
    const fixed = groupMarkers(Array.from({ length: 60 }, () => ({ x: rand() * 800, y: rand() * 400 })), { gap: 3 });
    const quakes = groupMarkers(Array.from({ length: 80 }, () => ({ x: rand() * 800, y: rand() * 400, weight: 1 })), { gap: 3 });
    const moved = avoidDiscs(quakes, fixed, { gap: 3 });
    assert.equal(moved.length, quakes.length, "every disc is accounted for");
    const drawn = [...fixed, ...moved.filter((m) => m.placed)];
    noOverlap(drawn, 3);
    for (const m of moved.filter((q) => q.placed)) assert.ok(Math.hypot(m.x - m.ax, m.y - m.ay) <= 90 + 1e-9);
  }
});

ok("a disc already clear of everything stays exactly where it is", () => {
  const [m] = avoidDiscs([{ x: 10, y: 10, r: 5 }], [{ x: 200, y: 200, r: 20 }]);
  assert.equal(m.moved, false);
  assert.equal(m.x, 10);
  const [n] = avoidDiscs([{ x: 200, y: 200, r: 5 }], [{ x: 200, y: 200, r: 20 }]);
  assert.equal(n.moved, true);
  assert.equal(n.ax, 200);
  assert.ok(Math.hypot(n.x - 200, n.y - 200) >= 28 - 1e-9);
});

console.log(`\n${passed} passed`);
