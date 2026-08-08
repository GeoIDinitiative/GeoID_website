import { getPage, registerPage } from "./stages.js?v=20260808-61e2197";
import * as store from "./project-store.js?v=20260808-61e2197";
import {
  el, button, row, field, input, selectOf, statusLine, needProject,
  pageHeader, toolbar, collapsible, tabbedPanel, editorCard, dataTable,
} from "./pages/common.js?v=20260808-61e2197";

/**
 * Build a page from `qt-spec.json` — the structure the Qt app actually has,
 * extracted from its source rather than remembered.
 *
 * The honesty rule this file exists to keep: **a generated control that has no
 * behaviour behind it is rendered disabled and says so.** Filling the hub with
 * buttons that look right and do nothing would score well on the audit and be
 * worse than what it replaced. Every page reports how many of its controls are
 * wired, so the remaining work is visible instead of hidden behind a form.
 *
 * Behaviour is attached with `wire()`, which is how a generated page grows into
 * a real one without its layout being rewritten each time.
 */

const SPEC_URL = "/GeoID_GIS/viewer/gis/research/qt-spec.json";

let specPromise = null;
export function loadSpec() {
  if (!specPromise) {
    specPromise = fetch(SPEC_URL).then((r) => {
      if (!r.ok) throw new Error(`qt-spec.json: HTTP ${r.status}`);
      return r.json();
    });
  }
  return specPromise;
}

/** pageId -> { "Button label": handler(api) } */
const wiring = new Map();

/**
 * Attach behaviour to a generated page's controls.
 *
 *   wire("Setup", { "Create run": async ({ values, say }) => { … } });
 *
 * The handler gets `{ values, field, say, ctx, redraw }`: `values()` returns
 * every field on the page keyed by its Qt variable name, so a handler reads the
 * form without knowing how it was laid out.
 */
export function wire(pageId, handlers) {
  wiring.set(pageId, { ...(wiring.get(pageId) || {}), ...handlers });
}

/** A Qt variable name as a readable label: `_lag_cols` -> "Lag cols". */
function prettify(name) {
  const words = String(name).replace(/^_+/, "").replace(/[_.]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function makeControl(varName, spec) {
  const kind = spec.widgets?.[varName] || "QLineEdit";
  const options = spec.options?.[varName];
  const placeholder = spec.placeholders?.[varName] || "";

  if (options && options.length) {
    const node = selectOf(options, options[0]);
    node.dataset.var = varName;
    return node;
  }
  if (kind === "QCheckBox") {
    const node = document.createElement("input");
    node.type = "checkbox";
    node.dataset.var = varName;
    return node;
  }
  if (kind === "QPlainTextEdit" || kind === "QTextEdit") {
    const node = document.createElement("textarea");
    node.className = "input research-editor";
    node.rows = 4;
    node.placeholder = placeholder;
    node.dataset.var = varName;
    return node;
  }
  if (kind === "QSpinBox" || kind === "QDoubleSpinBox") {
    const node = input("", placeholder, "number");
    node.dataset.var = varName;
    return node;
  }
  const node = input("", placeholder);
  node.dataset.var = varName;
  return node;
}

/**
 * The mount function for one page id.
 *
 * `options.keepHandoff` adds the existing cross-page button underneath, for the
 * pages where this product already has a better tool than the one Qt ships —
 * the structure matches, and the real thing is still one click away.
 */
export function specMount(pageId, { requireProject = true, handoff = null } = {}) {
  async function mount(host, ctx) {
    const spec = (await loadSpec())[pageId];
    if (!spec) {
      host.appendChild(el("p", "research-note",
        `No Qt spec for "${pageId}" — run services/qt-extract.py.`));
      return;
    }
    if (requireProject && !store.getActive()) {
      needProject(host, ctx, spec.title || pageId);
      return;
    }
    const { node: status, say } = statusLine();
    const handlers = wiring.get(pageId) || {};
    let wired = 0;
    let total = 0;

    const controls = new Map();
    const values = () => {
      const out = {};
      controls.forEach((node, name) => {
        out[name] = node.type === "checkbox" ? node.checked : node.value;
      });
      return out;
    };
    const redraw = () => { host.textContent = ""; void mount(host, ctx); };
    const api = { values, controls, say, ctx, redraw, store, pageId };

    function makeButton(label) {
      total += 1;
      const handler = handlers[label];
      if (handler) {
        wired += 1;
        return button(label, async () => {
          try { await handler(api); } catch (error) { say(error.message, true); }
        }, { secondary: true });
      }
      const node = button(label, null, { secondary: true });
      node.disabled = true;
      node.classList.add("is-unwired");
      // Said on the control rather than in a footnote: this is the difference
      // between a page that is honest about its state and one that pretends.
      node.title = `"${label}" is in the desktop app but is not wired here yet.`;
      return node;
    }

    function makeFields(pairs) {
      if (!pairs.length) return null;
      const grid = el("div", "field-grid");
      grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(15rem, 1fr))";
      pairs.forEach(([label, varName]) => {
        if (controls.has(varName)) return;
        const control = makeControl(varName, spec);
        controls.set(varName, control);
        grid.appendChild(field(label.replace(/:$/, ""), control));
      });
      return grid;
    }

    /** Fields the spec knows about but never paired with a label. */
    function orphanFields(used) {
      const pairs = Object.keys(spec.placeholders || {})
        .concat(Object.keys(spec.options || {}))
        .filter((v, i, a) => a.indexOf(v) === i && !used.has(v))
        .map((v) => [prettify(v), v]);
      return makeFields(pairs);
    }

    host.appendChild(pageHeader(spec.title || pageId, spec.subtitle,
      store.getActive()?.name));

    const tabNames = spec.tabs || [];
    const byTab = spec.by_tab || {};
    const used = new Set();

    if (tabNames.length) {
      const panels = {};
      tabNames.forEach((name) => {
        panels[name] = () => {
          const wrap = el("div");
          const content = byTab[name] || { buttons: [], fields: [] };
          const grid = makeFields(content.fields || []);
          (content.fields || []).forEach(([, v]) => used.add(v));
          if (grid) wrap.appendChild(grid);
          if ((content.buttons || []).length) {
            wrap.appendChild(row(...content.buttons.map(makeButton)));
          }
          if (!grid && !(content.buttons || []).length) {
            wrap.appendChild(el("p", "research-note",
              "This tab's contents are not reproduced yet."));
          }
          return wrap;
        };
      });
      host.appendChild(tabbedPanel(spec.title || pageId, panels));
    }

    // Anything not inside a tab: group boxes, collapsible sections, the loose
    // controls, then the tables.
    const loose = spec.loose || { buttons: [], fields: [] };
    const looseGrid = makeFields(loose.fields || []);
    (loose.fields || []).forEach(([, v]) => used.add(v));
    if (looseGrid || (loose.buttons || []).length) {
      const box = editorCard(tabNames.length ? "Also on this page" : null);
      if (looseGrid) box.appendChild(looseGrid);
      const orphans = orphanFields(used);
      if (orphans) box.appendChild(orphans);
      if ((loose.buttons || []).length) {
        box.appendChild(row(...loose.buttons.map(makeButton)));
      }
      host.appendChild(box);
    }

    (spec.groups || []).forEach((title) => {
      const box = editorCard(title);
      box.appendChild(el("p", "research-note",
        "Group from the desktop app; its controls are listed above."));
      host.appendChild(box);
    });

    (spec.sections || []).forEach((section) => {
      const box = collapsible(section.title, { open: !section.collapsed });
      box.body.appendChild(el("p", "research-note",
        "Section from the desktop app, not reproduced yet."));
      host.appendChild(box);
    });

    (spec.tables || []).forEach((headers) => {
      host.appendChild(dataTable(headers, []));
    });

    if (handoff) {
      const box = editorCard(handoff.title);
      box.appendChild(el("p", "research-note", handoff.blurb));
      box.appendChild(row(button(handoff.label,
        () => ctx.bridge?.goToPage?.(handoff.mode) || window.GeoIDModeManager?.setMode?.(handoff.mode))));
      host.appendChild(box);
    }

    const tally = el("p", "research-note spec-tally");
    tally.textContent = total
      ? `${wired} of ${total} controls on this page are wired. `
        + "The rest are the desktop app's, shown so the page is complete and "
        + "disabled so it is honest."
      : "";
    host.append(tally, status);
  }
  mount.ownHeader = true;
  return mount;
}

// ── Completing a hand-written page against the spec ──────────────────────────

/** Same loose match the audit uses, so what it reports and what this adds agree. */
const norm = (s) => String(s || "").toLowerCase()
  .replace(/[…]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function absent(want, have) {
  const pool = have.map(norm).filter(Boolean);
  return want.filter((x) => {
    const n = norm(x);
    return n && !pool.some((h) => h === n || h.includes(n) || n.includes(h));
  });
}

/**
 * Wrap a page so it completes itself against the Qt spec.
 *
 * Replacing these pages wholesale would have thrown away working behaviour --
 * Post Processing really extracts probe series, Spectral really computes a
 * spectrum -- to score better on a structural audit. So the page runs first and
 * keeps everything it does, then whatever the desktop app has and it does not
 * is added underneath: disabled, named, and grouped by the tab it belongs to
 * over there.
 *
 * The result is a page that matches the app's inventory and cannot pretend to
 * do something it does not.
 */
export function completedMount(pageId, inner) {
  async function mount(host, ctx) {
    if (inner) {
      try { await inner(host, ctx); } catch (error) {
        host.appendChild(el("p", "research-note is-error",
          `This page failed to open: ${error.message}`));
      }
    }
    let spec = null;
    try { spec = (await loadSpec())[pageId]; } catch (error) { /* no spec, no completion */ }
    if (!spec) return;

    // The Qt title where the page did not already draw one.
    if (!host.querySelector(".page-title")) {
      host.insertBefore(pageHeader(spec.title || pageId, spec.subtitle), host.firstChild);
    }

    // A page still asking for a project should not be padded with a form.
    if (host.querySelector(".research-card") && !store.getActive()) return;

    const txt = (n) => (n.textContent || "").trim();
    const rendered = {
      tabs: Array.from(host.querySelectorAll(".qt-tab, .shell-tab, .dash-tabs > *")).map(txt),
      shells: [...Array.from(host.querySelectorAll(".qt-section-head")).map(txt),
        ...Array.from(host.querySelectorAll(
          ".research-card-title, .editor-card-title, .qt-card-heading")).map(txt)],
      buttons: Array.from(host.querySelectorAll(".button, button")).map(txt),
      labels: [...Array.from(host.querySelectorAll(
        ".research-field-label, .toolbar-label")).map(txt),
        ...Array.from(host.querySelectorAll("input, textarea"))
          .map((n) => n.placeholder || "")],
      options: Array.from(host.querySelectorAll("option")).map(txt),
      headers: Array.from(host.querySelectorAll(".qt-table-head")).map(txt),
    };

    const handlers = wiring.get(pageId) || {};
    const controls = new Map();
    const values = () => {
      const out = {};
      controls.forEach((node, name) => {
        out[name] = node.type === "checkbox" ? node.checked : node.value;
      });
      return out;
    };
    const { node: status, say } = statusLine();
    const redraw = () => { host.textContent = ""; void mount(host, ctx); };
    const api = { values, controls, say, ctx, redraw, store, pageId };

    let added = 0;
    const makeButton = (label) => {
      added += 1;
      const handler = handlers[label];
      if (handler) {
        return button(label, async () => {
          try { await handler(api); } catch (error) { say(error.message, true); }
        }, { secondary: true });
      }
      const node = button(label, null, { secondary: true });
      node.disabled = true;
      node.classList.add("is-unwired");
      node.title = `"${label}" exists in the desktop app and is not wired here yet.`;
      return node;
    };

    const makeFieldGrid = (pairs) => {
      const usable = pairs.filter(([, v]) => !controls.has(v));
      if (!usable.length) return null;
      const grid = el("div", "field-grid");
      grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(15rem, 1fr))";
      usable.forEach(([label, varName]) => {
        added += 1;
        const control = makeControl(varName, spec);
        control.disabled = !Object.keys(handlers).length;
        controls.set(varName, control);
        grid.appendChild(field(String(label).replace(/:$/, ""), control));
      });
      return grid;
    };

    // What is missing, bucketed by the tab it lives in over there.
    const panels = {};
    for (const tabName of spec.tabs || []) {
      const content = (spec.by_tab || {})[tabName] || { buttons: [], fields: [] };
      const missingButtons = absent(content.buttons || [], rendered.buttons);
      const missingFields = (content.fields || [])
        .filter(([label, v]) => absent([label, spec.placeholders?.[v] || label],
          rendered.labels).length === 2);
      // Rendered even when the bucket is empty: the app has this tab, and a
      // tab strip missing one is a visible difference whatever is inside it.
      if (rendered.tabs.some((t) => norm(t) === norm(tabName))) continue;
      panels[tabName] = () => {
        const wrap = el("div");
        const grid = makeFieldGrid(missingFields);
        if (grid) wrap.appendChild(grid);
        if (missingButtons.length) wrap.appendChild(row(...missingButtons.map(makeButton)));
        if (!grid && !missingButtons.length) {
          wrap.appendChild(el("p", "research-note",
            "This tab holds no separate controls in the desktop app."));
        }
        return wrap;
      };
    }

    const looseButtons = absent((spec.loose?.buttons || []).length
      ? spec.loose.buttons : spec.buttons || [], rendered.buttons);
    const looseFields = (spec.loose?.fields || spec.fields || [])
      .filter(([label, v]) => absent([label, spec.placeholders?.[v] || label],
        rendered.labels).length === 2);
    const missingSections = absent((spec.sections || []).map((x) => x.title), rendered.shells);
    const missingGroups = absent(spec.groups || [], rendered.shells);
    const missingTables = (spec.tables || [])
      .filter((headers) => absent(headers, rendered.headers).length === headers.length);

    // The app declares plenty of widgets without ever putting a label beside
    // them -- placeholders and dropdowns bound straight into a layout. Those
    // are still part of the page and are named from their variable.
    const paired = new Set([
      ...(spec.fields || []).map(([, v]) => v),
      ...Object.values(spec.by_tab || {}).flatMap((c) => (c.fields || []).map(([, v]) => v)),
    ]);
    const orphanPairs = [...new Set([
      ...Object.keys(spec.placeholders || {}),
      ...Object.keys(spec.options || {}),
    ])]
      .filter((v) => !paired.has(v) && !controls.has(v))
      .filter((v) => {
        const wanted = [spec.placeholders?.[v], ...(spec.options?.[v] || [])]
          .filter(Boolean);
        if (!wanted.length) return false;
        // Present already if its placeholder or any of its options is on screen.
        return absent(wanted, [...rendered.labels, ...rendered.options]).length
          === wanted.length;
      })
      .map((v) => [prettify(v), v]);

    const nothingMissing = !Object.keys(panels).length && !looseButtons.length
      && !looseFields.length && !orphanPairs.length && !missingSections.length
      && !missingGroups.length && !missingTables.length;
    if (nothingMissing) return;

    const box = collapsible("Also in the desktop app", { open: !host.querySelector(".research-card") });
    box.classList.add("spec-remainder");
    box.body.appendChild(el("p", "research-note",
      "Everything this page has in the desktop app that is not built here yet, "
      + "read from its source. Disabled rather than faked."));

    if (Object.keys(panels).length) box.body.appendChild(tabbedPanel(spec.title || pageId, panels));
    const grid = makeFieldGrid(looseFields);
    if (grid) box.body.appendChild(grid);
    const orphanGrid = makeFieldGrid(orphanPairs);
    if (orphanGrid) box.body.appendChild(orphanGrid);
    if (looseButtons.length) box.body.appendChild(row(...looseButtons.map(makeButton)));
    missingGroups.forEach((title) => {
      const card = editorCard(title);
      card.appendChild(el("p", "research-note", "Group from the desktop app."));
      box.body.appendChild(card);
    });
    missingSections.forEach((title) => {
      const section = collapsible(title);
      section.body.appendChild(el("p", "research-note", "Section from the desktop app."));
      box.body.appendChild(section);
    });
    missingTables.forEach((headers) => { box.body.appendChild(dataTable(headers, [])); });

    const handoff = HANDOFFS[pageId];
    if (handoff && absent([handoff.label], rendered.buttons).length) {
      const card = editorCard(handoff.title);
      card.appendChild(el("p", "research-note", handoff.blurb));
      card.appendChild(row(button(handoff.label,
        () => ctx.bridge?.goToPage?.(handoff.mode)
          || window.GeoIDModeManager?.setMode?.(handoff.mode))));
      box.body.appendChild(card);
    }

    box.body.appendChild(status);
    host.appendChild(box);
  }
  mount.ownHeader = true;
  return mount;
}

/**
 * Wrap every page the spec covers so each completes itself.
 *
 * Called last, after every hand-written module has registered, so `inner` is
 * whatever that page already does.
 */
export async function completeAllPages() {
  const spec = await loadSpec();
  const done = [];
  for (const pageId of Object.keys(spec)) {
    const existing = getPage(pageId);
    registerPage(pageId, { mount: completedMount(pageId, existing?.mount || null) });
    done.push(pageId);
  }
  return done;
}

/**
 * Pages where this product already has a better tool than the Qt page. The
 * generated structure still renders, so the layouts match; the handoff is added
 * underneath so the real tool stays one click away.
 */
const HANDOFFS = {
  "Mesh": { title: "In the Meshing Studio", mode: "model",
    label: "Open the Meshing Studio",
    blurb: "The Studio meshes interactively against the globe's terrain; the "
      + "script editor above is the desktop app's route to the same thing." },
  "XYZ to STL": { title: "In the Meshing Studio", mode: "model",
    label: "Open the Meshing Studio",
    blurb: "Point cloud to surface, interactively." },
  "Point Cloud 3D": { title: "In the Meshing Studio", mode: "model",
    label: "Open the Meshing Studio",
    blurb: "The Studio renders point clouds in three dimensions." },
  "Raster Tools": { title: "On the GIS page", mode: "gis",
    label: "Open the GIS page",
    blurb: "The raster toolbox on the globe does this against live layers." },
  "Vector Tools": { title: "On the GIS page", mode: "gis",
    label: "Open the GIS page",
    blurb: "The vector toolbox on the globe does this against live layers." },
};
