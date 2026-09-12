/**
 * Explorer Models: the registry, and the one thing that can rot.
 *
 * The subtab is a second list of the site's viewers, and a second list is how
 * a door comes to point at a page that has moved. So every entry that goes
 * through `/transit/` is checked against the registry in `transit/index.html`
 * itself, in both directions, and every direct link is checked to be a path
 * this repository actually serves.
 *
 * Run with `node explorer-models.test.mjs`.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXPLORER_MODELS, hrefFor, mountExplorerModels } from "./explorer-models.js";

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
const transit = readFileSync(new URL("transit/index.html", ROOT), "utf8");
const registry = transit.slice(transit.indexOf("const destinations = {"));
const transitKeys = [...registry.matchAll(/^\s{6}(\w+):\s*\{/gm)].map((m) => m[1]);

check("transit's own registry was found", transitKeys.length >= 10, transitKeys.join(","));

{
  // EVERY TRANSIT DESTINATION IS OFFERED, and none is invented: a key here
  // that transit does not have is a link to nothing.
  const mine = EXPLORER_MODELS.filter((m) => m.transit).map((m) => m.transit);
  const missing = transitKeys.filter((k) => !mine.includes(k));
  const extra = mine.filter((k) => !transitKeys.includes(k));
  check("every destination transit serves is offered here", !missing.length, missing.join(","));
  check("and none is offered that transit does not serve", !extra.length, extra.join(","));
  check("the link goes through transit, which is the site's own door",
    hrefFor(EXPLORER_MODELS.find((m) => m.key === "mars")) === "/transit/?destination=mars");
}

{
  // THE DIRECT LINKS MUST BE PATHS THIS REPOSITORY SERVES. A viewer moved or
  // renamed leaves a row that looks live and opens a 404.
  for (const m of EXPLORER_MODELS.filter((x) => !x.transit)) {
    const rel = `${m.href.replace(/^\//, "").replace(/\/$/, "")}/index.html`;
    check(`${m.key} points at a page that exists`, existsSync(fileURLToPath(new URL(rel, ROOT))), m.href);
  }
  // And every hero shot named is a file that ships.
  for (const m of EXPLORER_MODELS.filter((x) => x.shot)) {
    check(`${m.key}'s hero shot ships`, existsSync(fileURLToPath(new URL(m.shot.replace(/^\//, ""), ROOT))), m.shot);
  }
}

{
  // The wiring: a host in the page, the module loaded, and the link leaving
  // the IFRAME rather than loading a viewer inside this one.
  const html = readFileSync(new URL("GeoID_GIS/viewer/index.html", ROOT), "utf8");
  // Sliced rather than matched across an SVG: the icon alone is 700 characters
  // and any window wide enough to clear it is wide enough to match the wrong
  // section entirely.
  const at = html.indexOf('id="explorer-models-section"');
  const section = at < 0 ? "" : html.slice(at, html.indexOf("</details>", at));
  check("the Explorer tab hosts it",
    at > 0 && /<span>Explorer Models<\/span>/.test(section)
    && /<div id="explorer-models"><\/div>/.test(section));
  // In the Explorer tab, beside Tour Mode and Core View — not adrift in
  // another group. The tabs after it are rendered by panels.js at runtime and
  // are not in this file to compare against, so the neighbours are.
  check("inside the Explorer tab, after its own sections",
    at > html.indexOf('id="geoid-controls-group"')
    && at > html.indexOf('id="tour-mode-section"')
    && at > html.indexOf('id="core-view-section"'));
  check("and the page loads the module", /gis\/explorer-models\.js\?v=/.test(html));
  const src = readFileSync(new URL("./explorer-models.js", import.meta.url), "utf8");
  check("the link replaces the whole page, not the viewer's iframe", /open\.target = "_top";/.test(src));
  check("its stylesheet is built without backticks, which end a template literal",
    !/const STYLE = `/.test(src));
}

{
  // It renders: a select of every model, a card, the stepper, and a live href.
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const el = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], dataset: {}, classList: new Set(),
      style: {}, textContent: "", attrs: {},
      appendChild(c) { this.children.push(c); return c; },
      append(...c) { c.forEach((x) => this.children.push(x)); },
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this[k]; },
      addEventListener() {},
    };
    node.classList = { add() {}, remove() {}, contains: () => false };
    return node;
  };
  const doc = {
    createElement: el,
    head: { appendChild() {} },
    getElementById: () => null,
    defaultView: { localStorage: storage },
  };
  const host = el("div");
  host.ownerDocument = doc;
  const built = mountExplorerModels(host, { storage });
  check("it mounts", Boolean(built) && built.models.length === EXPLORER_MODELS.length);
  const select = host.children.flatMap((c) => c.children || []).find((c) => c.tagName === "SELECT");
  check("with an option per model", select && select.children.length === EXPLORER_MODELS.length);
  const link = host.children.find((c) => c.tagName === "A");
  check("and a link that names where it goes", link && /^Open /.test(link.textContent), link?.textContent);
  check("remembered, so the picker opens where it was left", store.get("geoid-gis:explorer-model"));
}
