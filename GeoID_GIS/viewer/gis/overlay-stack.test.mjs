/**
 * ONE PANEL AT A TIME, AND TWO BUTTONS IN A ROW.
 *
 * The legend and the events feed share the top-right corner and their panels
 * are wide enough that two open at once overlap, so at most one may be open.
 * They were a SHUFFLE for a while — one card in front, the other behind it,
 * moved up and left, scaled, turned and greyed — and that was reported: a
 * slanted chip half-hidden behind the active one reads as a rendering fault
 * rather than as a control. The buttons sit side by side now and only the
 * exclusivity is left.
 *
 * Run: node GeoID_GIS/viewer/gis/overlay-stack.test.mjs
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

/* A document with just enough in it: the module reads ids and flips `hidden`. */
function stubDocument() {
  const make = (id) => ({ id, hidden: false, dataset: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, title: "" });
  const nodes = new Map(["map-legend", "map-legend-toggle", "map-legend-panel",
    "events-overlay", "events-panel-toggle", "events-panel"].map((id) => [id, make(id)]));
  globalThis.document = {
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} },
    readyState: "complete",
    addEventListener() {},
  };
  return nodes;
}

const nodes = stubDocument();
const stack = await import("./overlay-stack.js");

const shut = () => {
  nodes.get("map-legend-panel").hidden = true;
  nodes.get("events-panel").hidden = true;
};

/* ── the one rule ────────────────────────────────────────────────────────── */

check("with nothing open, nothing is open", () => {
  shut();
  stack.apply();
  ok(stack.openCard() === null, String(stack.openCard()));
});

check("opening one shuts the other", () => {
  shut();
  nodes.get("map-legend-panel").hidden = false;
  ok(stack.showOnly("events-overlay") === true, "the legend was closed");
  ok(nodes.get("map-legend-panel").hidden === true, "the panel is shut");
  ok(nodes.get("map-legend-toggle").attrs["aria-expanded"] === "false",
    "and the toggle agrees");
});

/**
 * The legend opens ITSELF when a layer arrives, so two can be open without
 * anyone having pressed anything. The one opened last is the one being read.
 */
check("two open at once resolves to the one opened last", () => {
  shut();
  stack.showOnly("events-overlay");
  nodes.get("events-panel").hidden = false;
  nodes.get("map-legend-panel").hidden = false;   // the legend, arriving behind
  stack.apply();
  ok(nodes.get("events-panel").hidden === false, "the feed stays");
  ok(nodes.get("map-legend-panel").hidden === true, "the legend gives way");
  ok(stack.openCard() === "events-overlay", String(stack.openCard()));
});

check("a card it has never heard of is refused", () => {
  shut();
  nodes.get("map-legend-panel").hidden = false;
  ok(stack.showOnly("not-a-card") === false, "refused");
  ok(nodes.get("map-legend-panel").hidden === false, "and nothing was closed");
});

check("closing the only open one leaves the corner empty", () => {
  shut();
  stack.apply();
  ok(stack.openCard() === null, "nothing open");
});

/* ── one drop-down area, measured off the row it hangs from ──────────────── */

const rect = (x, y, w, h) => ({ x, y, width: w, height: h, right: x + w, bottom: y + h });

check("the slot sits under the lowest button and against the rightmost", () => {
  const slot = stack.slotFrom([rect(1107, 16, 101, 29), rect(1215, 16, 102, 29)], 1394, 6);
  ok(slot.top === 51, `top ${slot.top}`);          // 16 + 29 + 6
  ok(slot.right === 77, `right ${slot.right}`);    // 1394 - 1317
});

/**
 * A card that is not on screen has no button to measure, and a zero rect would
 * put the slot in the top-left corner. With only the legend up the slot is the
 * legend's own.
 */
check("a card that is not up does not drag the slot across the screen", () => {
  const slot = stack.slotFrom([rect(0, 0, 0, 0), rect(1215, 16, 102, 29)], 1394, 6);
  ok(slot.right === 77, `right ${slot.right}`);
  ok(slot.top === 51, `top ${slot.top}`);
});

/**
 * Below about 1,000 px the clock cluster drops under the tool rail, into the
 * column the slot hangs down. Measured at 900 px: the drop-down covered the
 * clock's left 27 px. The slot steps left of it; at desktop width, where the
 * clock sits nowhere near, nothing moves.
 */
check("the slot steps left of the clock it would otherwise cover", () => {
  const buttons = [rect(601, 16, 101, 29), rect(708, 16, 104, 29)];
  const clock = rect(774, 89, 119, 47);
  const slot = stack.slotFrom(buttons, 900, 6, [clock], 280);
  ok(slot.right === 900 - (774 - 6), `right ${slot.right}`);
  ok(900 - slot.right <= clock.x - 6, "the panel's right edge clears the clock");
  const wide = stack.slotFrom([rect(1107, 16, 101, 29), rect(1215, 16, 102, 29)], 1394, 6,
    [rect(412, 89, 119, 47)], 280);
  ok(wide.right === 77, `a clock elsewhere moves nothing: ${wide.right}`);
  const above = stack.slotFrom(buttons, 900, 6, [rect(774, 0, 119, 40)], 280);
  ok(above.right === 88, `nor one wholly above the slot: ${above.right}`);
});

check("with no room to step sideways the slot drops below the clock instead", () => {
  // Settings open: both buttons have stepped left to the clock, and the sidebar
  // ends at 400 px. Stepping left of the clock would land the panel on it.
  const buttons = [rect(426, 16, 101, 27), rect(534, 16, 102, 27)];
  const clock = rect(412, 16, 121, 46);
  const slot = stack.slotFrom(buttons, 1091, 8, [clock], 280, 408);
  ok(slot.right === 1091 - 636, `still right-aligned under the buttons: ${slot.right}`);
  ok(slot.top === 62 + 8, `and below the clock: ${slot.top}`);
  const narrow = stack.slotFrom([rect(601, 16, 101, 29), rect(708, 16, 104, 29)], 900, 6,
    [rect(774, 89, 119, 47)], 280, 408);
  ok(narrow.right === 900 - (774 - 6), `where there is room it still steps left: ${narrow.right}`);
});

check("and with neither up there is no slot to place", () => {
  ok(stack.slotFrom([], 1394) === null, "nothing");
  ok(stack.slotFrom([rect(0, 0, 0, 0)], 1394) === null, "nor from an empty rect");
});

/* ── the look, which is the whole instruction ────────────────────────────── */
{
  const src = readFileSync(new URL("./overlay-stack.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  /**
   * "Ensure the legend and events buttons don't slant and hide behind the
   * active one, keep in line and side by side." Every one of these was in the
   * stylesheet this module used to inject, and the module injects none now.
   */
  check("no card is turned, shrunk, greyed or moved behind the other", () => {
    ok(!/rotate\(/.test(code), "nothing is turned");
    ok(!/scale\(0?\./.test(code), "nothing is shrunk");
    ok(!/grayscale\(/.test(code), "nothing is greyed");
    ok(!/translate\(/.test(code), "nothing is offset");
    ok(!/z-index/.test(code), "neither is layered over the other");
  });

  check("and it injects no stylesheet at all", () => {
    ok(!/createElement\("style"\)/.test(code), "no style tag");
    ok(!/data-stack/.test(code), "and no card is marked as front or back");
  });

  /**
   * ONE AREA, so a panel is pinned rather than left to flow under its own
   * button — the two buttons are not in the same place, so two flowing panels
   * are two drop-downs however carefully they take turns.
   */
  check("both panels are pinned into the one slot, at one width", () => {
    ok(/setProperty\("position", "fixed", "important"\)/.test(code), "taken out of flow");
    ok(/setProperty\("top",/.test(code) && /setProperty\("right",/.test(code), "placed");
    ok(/setProperty\("width", SLOT_WIDTH, "important"\)/.test(code), "and one width");
    // Applied to every card, not to whichever happens to be open.
    ok(/CARDS\.forEach\(\(card\) => \{\s*const panel = byId\(card\.panel\);/.test(code),
      "for both of them");
  });

  check("the slot is placed before the panel is shown, not after", () => {
    ok(/if \(!isOpen\(card\)\) showOnly\(card\.id\);\s*applySlot\(\);/.test(code),
      "on the press, ahead of the card's own handler");
  });

  /**
   * Each card's own handler flips its own panel, which is exactly right; all
   * this adds is shutting the other one first. Taking the click would mean
   * reimplementing both toggles.
   */
  check("it runs ahead of each toggle's own handler and lets the click through", () => {
    ok(/\}, true\);/.test(code), "in the capture phase");
    ok(!/stopPropagation/.test(code), "and the click is not taken");
    ok(!/preventDefault/.test(code), "nor prevented");
  });

  check("pressing an open card just closes it", () => {
    ok(/if \(!isOpen\(card\)\) showOnly\(card\.id\);/.test(code),
      "the other is only shut when this press will open one");
  });

  check("wiring twice does not wire twice", () => {
    ok(/toggle\.dataset\.stackWired/.test(code), "the guard is there");
  });
}

/**
 * THE ROW MUST NOT MOVE WHEN A PANEL OPENS, which is what sent these two into
 * a stack in the first place: the feed placed itself off the legend's CARD,
 * and a card is as wide as whatever is open inside it. The toggle is a
 * fixed-width button and the panel hangs below it.
 */
check("the feed is placed off the legend's toggle, never its card", () => {
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const fn = /function placeOverlay\(\)[\s\S]*?\n\}/.exec(src)?.[0] || "";
  ok(fn, "placeOverlay is there");
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  ok(/byId\("map-legend-toggle"\)/.test(code), "it measures the toggle");
  ok(!/byId\("map-legend"\)\.getBoundingClientRect/.test(code), "not the card");
  ok(/getBoundingClientRect\(\)\.width/.test(code), "by width");
  // With no legend on screen the feed takes the legend's own slot rather than
  // sitting one button's width left of nothing.
  ok(/!legend\.hidden/.test(code), "and only when the legend is on screen");
});

/* ── the launch claim ────────────────────────────────────────────────────── */

/**
 * WHICH CARD THE PAGE OPENS ON. The feed is armed on purpose at boot; the
 * legend opens itself when a layer arrives, which at boot is the launch
 * defaults landing a moment later. One slot, so without a claim the card in
 * front was decided by whichever fetch finished first.
 */
check("a claim opens its card and shuts the other", () => {
  shut();
  nodes.get("map-legend-panel").hidden = false;
  ok(stack.claim("events-overlay") === true, "claimed");
  ok(nodes.get("map-legend-panel").hidden === true, "the legend gives way");
  stack.releaseClaim();
});

check("while it stands, the OTHER card may not open itself", () => {
  shut();
  stack.claim("events-overlay");
  ok(stack.mayAutoOpen("map-legend") === false, "the legend defers");
  ok(stack.mayAutoOpen("events-overlay") === true, "the claimant does not");
  stack.releaseClaim();
});

/* A press is a decision; a claim is only a default, so the press wins. */
check("releasing it hands the corner back", () => {
  shut();
  stack.claim("events-overlay");
  stack.releaseClaim();
  ok(stack.mayAutoOpen("map-legend") === true, "the legend may open again");
});

/**
 * Nothing announces that a launch is over, so the claim expires. Without that
 * it would go on suppressing the legend for a layer ticked ten minutes later.
 */
check("it expires, so a later arrival still opens the legend", () => {
  shut();
  const now = Date.now;
  try {
    let t = 1_000_000;
    Date.now = () => t;
    stack.claim("events-overlay");
    ok(stack.mayAutoOpen("map-legend") === false, "it holds at first");
    t += 11_000;
    ok(stack.mayAutoOpen("map-legend") === false, "still inside the window");
    t += 2_000;
    ok(stack.mayAutoOpen("map-legend") === true, "and lapses past it");
  } finally { Date.now = now; stack.releaseClaim(); }
});

/* An id nothing knows cannot take the corner hostage. */
check("an unknown id claims nothing", () => {
  shut();
  ok(stack.claim("no-such-card") === false, "refused");
  ok(stack.mayAutoOpen("map-legend") === true, "and nothing is held");
});

check("the launch opens the feed's own panel and claims the slot", () => {
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  ok(/if \(launch\) window\.GeoIDOverlayStack\?\.claim\?\.\("events-overlay"\);/.test(src),
    "armOnLaunch's setActive claims it");
  ok(!/if \(active && panel && !launch\)/.test(src), "and no longer skips the open");
});

check("an ARRIVAL asks before opening the legend; a press never comes through there", () => {
  const src = readFileSync(new URL("./legend-dock.js", import.meta.url), "utf8");
  ok(/const mayOpen = window\.GeoIDOverlayStack\?\.mayAutoOpen\?\.\("map-legend"\) \?\? true;/.test(src),
    "it asks the arbiter");
  ok(/if \(fresh\.length && mayOpen\) setOpen\(true\);/.test(src), "and only the arrival is gated");
  ok(/toggle\.addEventListener\("click", \(\) => setOpen\(!isOpen\(\)\)\);/.test(src),
    "the reader's own press still goes straight through");
});

check("an open workbench moves the events button with the legend, and the slot follows", () => {
  const src = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function placeOverlay()"), src.indexOf("const pickRay"));
  ok(/getPropertyValue\("--workbench-w"\)/.test(body),
    "the events button reads the workbench offset the legend's stylesheet uses");
  ok(/Math\.max\(rail > 0 \? rail : 5\.5 \* rem, bench\)/.test(body), "and takes the larger");
  ok(/GeoIDOverlayStack\?\.reseat\?\.\(\)/.test(body), "then re-seats the shared drop-down");
  const stack = readFileSync(new URL("./overlay-stack.js", import.meta.url), "utf8");
  ok(/reseat: applySlot/.test(stack), "reseat places the slot and runs no one-open rule");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
