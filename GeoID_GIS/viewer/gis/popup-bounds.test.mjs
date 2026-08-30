/**
 * A FEATURE CARD STAYS INSIDE THE MAP.
 *
 * Two faults met in one line. The clamp read
 * `min(max(8, y), innerHeight - height)`, and when the card is taller than the
 * space, that second term is NEGATIVE and `min` takes it — the card was placed
 * off the TOP of the screen. The `max` has to come last so it cannot be beaten.
 *
 * And the window was the wrong frame: in the hub the map sits under a fixed
 * nav bar, so a card at `top: 8` is 8 px from the top of the DOCUMENT with the
 * nav drawn over its head, which is how a popup lost its first rows.
 *
 * The arithmetic is tested here directly, the DOM being a browser's business.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

const MARGIN = 8;
/** The placement the module performs, in one function. */
const place = (x, y, box, area) => ({
  left: Math.max(area.left + MARGIN, Math.min(x + 14, area.right - box.width - MARGIN)),
  top: Math.max(area.top + MARGIN, Math.min(y + 12, area.bottom - box.height - MARGIN)),
});
/** The old one, kept to prove the fault it had. */
const old = (x, y, box, win) => ({
  left: Math.min(Math.max(MARGIN, x + 14), win.width - box.width - MARGIN),
  top: Math.min(Math.max(MARGIN, y + 12), win.height - box.height - MARGIN),
});

// A map area under a 60 px nav bar, as the hub has.
const area = { left: 0, top: 60, right: 1200, bottom: 800, width: 1200, height: 740 };

{
  const p = place(400, 300, { width: 320, height: 400 }, area);
  ok("an ordinary card sits just off the click", p.left === 414 && p.top === 312);
}
{
  // THE REGRESSION: a card taller than the space available.
  const box = { width: 320, height: 900 };
  const p = place(400, 700, box, area);
  ok("a card taller than the map is pinned to the map's top, never above it",
    p.top === area.top + MARGIN);
  ok("and the old arithmetic put it off the top of the screen",
    old(400, 700, box, { width: 1200, height: 800 }).top < 0);
}
{
  const p = place(1190, 300, { width: 320, height: 400 }, area);
  ok("a click at the right edge pulls the card back inside",
    p.left === area.right - 320 - MARGIN);
}
{
  const p = place(400, 780, { width: 320, height: 400 }, area);
  ok("a click near the bottom lifts the card clear of it",
    p.top === area.bottom - 400 - MARGIN);
}
{
  const p = place(5, 5, { width: 320, height: 400 }, area);
  ok("a click above the map never places the card over the nav",
    p.top >= area.top + MARGIN && p.left >= area.left + MARGIN);
}
{
  // The window fallback, when there is no canvas to measure.
  const win = { left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 };
  const p = place(900, 550, { width: 300, height: 300 }, win);
  ok("the fallback frame clamps just the same",
    p.left === 1000 - 300 - MARGIN && p.top === 600 - 300 - MARGIN);
}
{
  // Both dimensions impossible at once: the card is pinned to the top-left of
  // the area and its own max-height does the rest.
  const p = place(500, 500, { width: 5000, height: 5000 }, area);
  ok("an impossible card is pinned inside, not flung outside",
    p.left === area.left + MARGIN && p.top === area.top + MARGIN);
}

/**
 * THE WORLD-GEOLOGY CARD, which is a different element with a different rule.
 *
 * `#geo-popup` is `position: fixed` and drawn ABOVE its anchor by
 * `translate(-50%, -100% - 1.6rem)`, and nothing clamped it at all — the render
 * loop wrote the projected point straight to left/top. A feature near the top
 * of the map therefore put its card off the top of the window.
 *
 * Above by preference; below when there is no room, rather than pinned to an
 * edge pointing at nothing.
 */
{
  const GAP = 1.6 * 16;
  const placeGeo = (sx, sy, w, h, view) => {
    const minX = view.left + w / 2 + MARGIN;
    const maxX = view.right - w / 2 - MARGIN;
    const px = minX > maxX ? (view.left + view.right) / 2
      : Math.min(Math.max(sx, minX), maxX);
    const roomAbove = (sy - GAP - h) >= (view.top + MARGIN);
    const py = roomAbove
      ? Math.min(sy, view.bottom - MARGIN + GAP)
      : Math.max(view.top + MARGIN - GAP, Math.min(sy, view.bottom - MARGIN - GAP - h));
    return { px, py, above: roomAbove };
  };
  const view = { left: 0, top: 60, right: 1200, bottom: 800 };
  const W = 320, H = 210;

  {
    const p = placeGeo(600, 500, W, H, view);
    ok("with room above, the card stays above its anchor", p.above && p.py === 500);
    ok("and sits centred on it", p.px === 600);
  }
  {
    // THE REGRESSION: an anchor near the top of the map.
    const p = placeGeo(600, 100, W, H, view);
    ok("with no room above, the card flips below instead of leaving the screen", !p.above);
    ok("and its top edge stays inside the map",
      p.py + GAP >= view.top + MARGIN - 1);
  }
  {
    const p = placeGeo(20, 500, W, H, view);
    ok("an anchor at the left edge pulls the card fully inside",
      p.px - W / 2 >= view.left + MARGIN - 1);
  }
  {
    const p = placeGeo(1190, 500, W, H, view);
    ok("an anchor at the right edge does too",
      p.px + W / 2 <= view.right - MARGIN + 1);
  }
  {
    // A map narrower than the card: centred rather than flung sideways.
    const narrow = { left: 0, top: 0, right: 200, bottom: 800 };
    const p = placeGeo(10, 500, W, H, narrow);
    ok("a map narrower than the card centres it", p.px === 100);
  }
}

/**
 * THE TAIL POINTS AT THE GROUND, on whichever edge faces it.
 *
 * The card is placed beside the point and then pulled inside the map, so it can
 * end up on any side of the thing it describes; a tail welded to one edge would
 * point at open ground half the time.
 */
{
  const edgeFor = (x, y, box) => {
    if (x < box.left) return "left";
    if (x > box.left + box.w) return "right";
    if (y < box.top) return "top";
    if (y > box.top + box.h) return "bottom";
    return "left";
  };
  const card = { left: 400, top: 300, w: 320, h: 200 };
  ok("a click to the LEFT of the card puts the tail on its left edge",
    edgeFor(380, 400, card) === "left");
  ok("a click to the RIGHT puts it on the right edge",
    edgeFor(760, 400, card) === "right");
  ok("a click ABOVE puts it on the top edge",
    edgeFor(500, 280, card) === "top");
  ok("a click BELOW puts it on the bottom edge",
    edgeFor(500, 560, card) === "bottom");
  ok("a click under the card falls back rather than guessing",
    edgeFor(500, 400, card) === "left");

  // The world-geology card aims its tail by the DIFFERENCE between where the
  // card ended up and where the ground actually is.
  const tailX = (sx, px, w) => (w / 2) + (sx - px);
  ok("an unclamped card aims its tail at its own middle", tailX(600, 600, 320) === 160);
  ok("a card pulled right aims its tail back to the left",
    tailX(500, 600, 320) === 60);
  ok("a card pulled left aims its tail back to the right",
    tailX(700, 600, 320) === 260);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
