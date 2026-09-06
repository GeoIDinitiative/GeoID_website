/**
 * THE LEGEND AND THE EVENTS FEED ARE ONE SLOT.
 *
 * They were side by side, and the feed placed itself by MEASURING the legend —
 * so opening the legend moved the events button and a layer arriving moved it
 * again. Neither is ever read at the same time as the other, so they are a
 * shuffle: one card in front at full size, the other behind it, smaller,
 * turned and greyed, and only the front one may have a panel open.
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

/* A document with just enough in it: the module reads ids, sets `dataset` and
   flips `hidden`, and nothing else. */
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

/* ── which card is in front, and what that means for the other ───────────── */

check("the legend leads, because it describes what is already on the globe", () => {
  stack.apply();
  ok(nodes.get("map-legend").dataset.stack === "front", "legend front");
  ok(nodes.get("events-overlay").dataset.stack === "back", "events back");
});

check("dealing one forward sends the other behind", () => {
  ok(stack.bringToFront("events-overlay"), "it moved");
  ok(stack.frontCard() === "events-overlay", stack.frontCard());
  ok(nodes.get("events-overlay").dataset.stack === "front", "events front");
  ok(nodes.get("map-legend").dataset.stack === "back", "legend back");
});

/**
 * The whole point: two panels open at once is the thing being removed, so the
 * card going behind is shut on the way — whatever state it was left in.
 */
check("a card sent behind is closed, and says so on its toggle", () => {
  nodes.get("map-legend-panel").hidden = false;
  nodes.get("map-legend-toggle").attrs["aria-expanded"] = "true";
  stack.bringToFront("events-overlay");
  stack.apply();
  ok(nodes.get("map-legend-panel").hidden === true, "the panel is shut");
  ok(nodes.get("map-legend-toggle").attrs["aria-expanded"] === "false", "and the toggle agrees");
});

check("dealing the card that is already in front changes nothing", () => {
  ok(stack.bringToFront("events-overlay") === false, "no move reported");
});

check("and a card it has never heard of is refused", () => {
  const before = stack.frontCard();
  ok(stack.bringToFront("not-a-card") === false, "refused");
  ok(stack.frontCard() === before, "and nothing moved");
});

check("the one at the back is offered as a card to bring forward", () => {
  stack.bringToFront("map-legend");
  ok(nodes.get("events-panel-toggle").title === "Bring to the front",
    nodes.get("events-panel-toggle").title);
  ok(nodes.get("map-legend-toggle").title === "", "and the front one has nothing to say");
  ok(nodes.get("map-legend-toggle").attrs["aria-pressed"] === "true", "pressed");
  ok(nodes.get("events-panel-toggle").attrs["aria-pressed"] === "false", "not pressed");
});

/* ── the look, which is the whole instruction ────────────────────────────── */
{
  const src = readFileSync(new URL("./overlay-stack.js", import.meta.url), "utf8");

  check("the back card moves, shrinks, turns and greys", () => {
    const rule = /\[data-stack="back"\] \{[^}]*\}/.exec(src)?.[0] || "";
    ok(/translate\(/.test(rule), "moves");
    ok(/scale\(0\.8/.test(rule), "shrinks");
    ok(/rotate\(-\d/.test(rule), "turns");
    ok(/grayscale\(/.test(rule) && /opacity: 0\.5/.test(rule), "greys");
  });

  /**
   * UP AND LEFT, never down: the front card's panel hangs below its button, so
   * a back card offset downwards hides behind the very thing it should peek
   * out of. And the offset has to beat the width difference — the cards are
   * right-aligned and the transform origin is their shared corner, so scaling
   * alone pulls the back card's left edge INWARDS. Measured on the page: at
   * 0.55rem it cleared the front card by five pixels and read as a shadow; at
   * 1.7rem it peeks 12 px to the left and 9 above.
   */
  check("it is offset up and to the left, far enough to be a corner you can press", () => {
    const move = /transform: translate\((-?[\d.]+)rem, (-?[\d.]+)rem\)/.exec(src);
    ok(move, "an offset is set");
    ok(Number(move[1]) <= -1, `left by ${move[1]}rem`);
    ok(Number(move[2]) < 0, `up by ${move[2]}rem`);
  });

  check("the shuffle is animated, or a card teleports", () => {
    ok(/transition: transform 0\.28s/.test(src), "transform eases");
  });

  check("a card at the back can have nothing open", () => {
    ok(/\[data-stack="back"\] \.map-legend-panel \{ display: none !important; \}/.test(src),
      "its panel is hidden outright");
  });

  /**
   * Each card's own handler flips its panel, which for one at the BACK is
   * wrong twice: it would open a panel the stack keeps hidden, and leave the
   * card behind. So the shuffle goes first, in capture, and stops the click.
   */
  check("pressing the back card shuffles first and stops the click", () => {
    ok(/if \(card\.id === front\) return;/.test(src), "the front card is left alone");
    ok(/event\.stopPropagation\(\);/.test(src), "and the back card's click is taken");
    ok(/\}, true\);/.test(src), "in the capture phase");
  });

  check("wiring twice does not wire twice", () => {
    ok(/toggle\.dataset\.stackWired/.test(src), "the guard is there");
  });
}

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
