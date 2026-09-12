/**
 * Explorer Models: Tour Mode's shape, over the places that have a viewer.
 *
 * The stop list is the SAME list the scene card reads to decide whether to
 * draw a link — a stop with no viewer behind it is a jump to nothing — and the
 * jump is the viewer's own `presentTourFeature`, which opens the card before
 * it flies. Both are pinned here, against `earth-viewer.js` itself.
 *
 * Run with `node explorer-models.test.mjs`.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mountExplorerModels } from "./explorer-models.js";

let pass = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) pass += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`explorer-models: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const ROOT = new URL("../../../", import.meta.url);
const viewer = readFileSync(new URL("GeoID_GIS/viewer/earth-viewer.js", ROOT), "utf8");
const html = readFileSync(new URL("GeoID_GIS/viewer/index.html", ROOT), "utf8");
const src = readFileSync(new URL("./explorer-models.js", import.meta.url), "utf8");

/**
 * PROSE IS NOT CODE. Both files explain the fault they fixed by quoting it —
 * "a hard-coded `feature.name === \"Mount Etna\"` block", "flies the camera
 * 700 ms later" — and a scanner that reads the comments finds the very thing
 * it is checking is gone. Same reason tool-runner's param scanner strips them.
 */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const jumpBody = (() => {
  const seam = viewer.slice(viewer.indexOf("tourToFeature: (name"));
  return seam.slice(0, seam.indexOf("},"));
})();

/* ── the stops ───────────────────────────────────────────────────────────── */

const block = viewer.slice(viewer.indexOf("const EXPLORER_SITES = ["));
const sites = [...block.slice(0, block.indexOf("];")).matchAll(
  /\{ name: "([^"]+)", href: "([^"]+)", label: "([^"]+)" \}/g)].map((m) => ({ name: m[1], href: m[2] }));

check("the registry was found", sites.length >= 2, JSON.stringify(sites));
check("Etna and Everest are both stops", sites.map((s) => s.name).sort().join("|")
  === "Mount Etna|Mount Everest", sites.map((s) => s.name).join(","));

{
  // EVERY STOP IS A CURATED LABEL, or the jump has nowhere to fly: the viewer
  // looks a stop up in `labelData` by name.
  const labels = viewer.slice(viewer.indexOf("const labelData = ["));
  const names = new Set([...labels.slice(0, labels.indexOf("];")).matchAll(/"name":"([^"]+)"/g)].map((m) => m[1]));
  for (const s of sites) check(`${s.name} is a place on the globe`, names.has(s.name));
  // AND EVERY STOP HAS A VIEWER BEHIND IT, or the card's link is a 404.
  for (const s of sites) {
    const rel = `${s.href.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
    check(`${s.name} points at a viewer that exists`, existsSync(fileURLToPath(new URL(rel, ROOT))), s.href);
  }
}

/* ── the card carries the link, for every stop ───────────────────────────── */

check("the card's link is driven by the registry, not by one place's name",
  /const explorerSite = EXPLORER_SITES\.find\(\(site\) => site\.name === feature\.name\);/.test(viewer)
  && !/feature\.name === "Mount Etna"/.test(code(viewer)));
check("and it leaves the whole page, not this viewer's iframe",
  /siteLink\.target = "_top";/.test(viewer));

/* ── the jump is the tour's own, and the card opens first ────────────────── */

check("the seam hands the module the viewer's own tour stop",
  /tourToFeature: \(name, \{ statusPrefix/.test(viewer)
  && /scheduleFeatureFlight\(feature, camera, controls, statusPrefix\)/.test(viewer));
/**
 * AND ARMS NOTHING. Borrowing `presentTourFeature` whole armed Tour Mode's own
 * panel as well: two sections reading Exit at once, with Tour Mode's picker
 * claiming the stop. The mechanism is shared; the arming belongs to the mode
 * that was entered.
 */
check("the jump does not arm Tour Mode's panel",
  !/syncTourModeControls|activeTourModeFeature =/.test(jumpBody));
check("and this mode stands Tour Mode down when it is entered",
  /getElementById\("tour-mode-toggle"\)/.test(src) && /tour\.checked = false/.test(src));
/**
 * THE CARD OPENS BEFORE THE FLIGHT, in both modes, because that ordering is
 * the whole reason the link is on screen while the camera is still moving.
 * The delay is what carries it: reverse them and the card arrives after the
 * jump has finished, which is a different thing to look at.
 */
check("the card opens BEFORE the flight is scheduled, in both modes",
  /openFeature\(feature, false\);\s*syncTourModeControls\(feature\);\s*scheduleFeatureFlight\(/.test(viewer)
  && /openFeature\(feature, false\);\s*scheduleFeatureFlight\(/.test(jumpBody));
check("and the flight is the one that waits",
  /function scheduleFeatureFlight[\s\S]{0,420}moveCameraToFeature\(feature, camera, controls, \{ animate: true, tourHop: true \}\);\s*\}, 700\);/.test(viewer));
check("the module asks for the jump rather than moving a camera itself",
  /tourToFeature\?\.\(stop\.name/.test(src) && !/camera|controls\./.test(code(src)));

/* ── armed the way every other mode is armed ─────────────────────────────── */

const enter = readFileSync(new URL("scripts/tour-enter.js", ROOT), "utf8");
check("the Enter button comes from the shared implementation",
  /section: "explorer-models-section", toggle: "explorer-models-toggle", button: "explorer-models-enter"/.test(enter));
check("the page carries that pair", /id="explorer-models-enter"/.test(html)
  && /id="explorer-models-toggle"/.test(html));
check("and the module drives nothing but the hidden checkbox's change",
  /toggle\.addEventListener\("change", sync\)/.test(src) && !/explorer-models-enter/.test(src));

{
  const at = html.indexOf('id="explorer-models-section"');
  const section = at < 0 ? "" : html.slice(at, html.indexOf("</details>", at));
  check("the Explorer tab hosts it", at > 0 && /<span>Explorer Models<\/span>/.test(section)
    && /<div id="explorer-models"><\/div>/.test(section));
  check("inside the Explorer tab, after its own sections",
    at > html.indexOf('id="geoid-controls-group"') && at > html.indexOf('id="tour-mode-section"'));
  check("and the page loads the module", /gis\/explorer-models\.js\?v=/.test(html));
}

/* ── it builds, arms and steps ───────────────────────────────────────────── */

{
  const listeners = new Map();
  const node = (tag) => {
    const n = {
      tagName: tag.toUpperCase(), children: [], style: {}, textContent: "", innerHTML: "",
      value: "", disabled: false, checked: false, id: "", className: "",
      appendChild(c) { this.children.push(c); c.ownerDocument = this.ownerDocument; return c; },
      append(...c) { c.forEach((x) => this.appendChild(x)); },
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(`${this.id || this.tagName}:${type}`, fn); },
    };
    return n;
  };
  // Tour Mode's own checkbox, so the one-mode-at-a-time rule can be measured
  // rather than read.
  const tourToggle = { id: "tour-mode-toggle", checked: true, dispatched: 0,
    dispatchEvent() { this.dispatched += 1; return true; } };
  const doc = {
    createElement: (t) => { const n = node(t); n.ownerDocument = doc; return n; },
    getElementById: (id) => (id === "tour-mode-toggle" ? tourToggle : null),
  };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  const host = doc.createElement("div");
  const toggle = doc.createElement("input"); toggle.id = "explorer-models-toggle";
  toggle.ownerDocument = doc;
  const jumps = [];
  globalThis.window = {
    GeoIDViewer: {
      explorerSites: () => sites.map((s) => ({ ...s })),
      tourToFeature: (name, opts) => { jumps.push([name, opts?.statusPrefix]); return true; },
    },
  };
  const built = mountExplorerModels(host, toggle);
  check("it mounts", Boolean(built));
  check("and stays out of the way until the mode is entered", host.children[0].style.display === "none");

  toggle.checked = true;
  listeners.get("explorer-models-toggle:change")();
  check("entering jumps to the first stop", jumps.length === 1 && jumps[0][0] === sites[0].name,
    JSON.stringify(jumps));
  check("and stands Tour Mode down, so only one picker claims the stop",
    tourToggle.checked === false && tourToggle.dispatched === 1);
  check("and says which mode is doing the jumping", jumps[0][1] === "Explorer model");
  check("the controls appear with it", host.children[0].style.display === "");

  listeners.get("explorer-models-next:click")();
  check("Next steps to the stop after it", jumps[1][0] === sites[1].name, JSON.stringify(jumps));
  listeners.get("explorer-models-next:click")();
  check("and wraps rather than stopping", jumps[2][0] === sites[0].name);
  listeners.get("explorer-models-prev:click")();
  check("Previous wraps the other way", jumps[3][0] === sites[sites.length - 1].name);

  toggle.checked = false;
  listeners.get("explorer-models-toggle:change")();
  check("leaving puts the controls away and jumps nowhere",
    host.children[0].style.display === "none" && jumps.length === 4);
}
