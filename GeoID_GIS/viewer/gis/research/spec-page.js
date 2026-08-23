import { getPage, registerPage } from "./stages.js?v=20260823-feb0f36";
import { qtMount, loadLayouts } from "./qt-render.js?v=20260823-feb0f36";
import * as store from "./project-store.js?v=20260823-feb0f36";
import {
  el, button, row, field, input, selectOf, persistentStatus, needProject,
  pageHeader, toolbar, collapsible, tabbedPanel, editorCard, dataTable,
} from "./pages/common.js?v=20260823-feb0f36";

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

// Stamped like every import: an unstamped fetch let the browser serve a stale
// spec against fresh code.
const SPEC_URL = "/GeoID_GIS/viewer/gis/research/qt-spec.json";

let specPromise = null;
export function loadSpec() {
  if (!specPromise) {
    const v = new URL(import.meta.url).searchParams.get("v");
    specPromise = fetch(v ? `${SPEC_URL}?v=${v}` : SPEC_URL).then((r) => {
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

/**
 * Handlers matched by label across every page.
 *
 * Three hundred-odd controls are not three hundred behaviours: "Refresh",
 * "Browse", "Export CSV" and "Open in Meshing Studio" mean the same thing
 * wherever the app puts them. Patterns wire them once. A page-specific handler
 * always wins over a pattern.
 */
const patterns = [];
export function wirePattern(match, handler, { pages = null } = {}) {
  patterns.push({ match, handler, pages });
}

export function handlerFor(pageId, label) {
  const exact = (wiring.get(pageId) || {})[label];
  if (exact) return exact;
  for (const rule of patterns) {
    if (rule.pages && !rule.pages.includes(pageId)) continue;
    if (rule.match instanceof RegExp ? rule.match.test(label) : rule.match === label) {
      return rule.handler;
    }
  }
  return null;
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
    node.rows = 3;
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
    const { node: status, say } = persistentStatus(host, pageId);
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
      const handler = handlerFor(pageId, label);
      if (handler) {
        wired += 1;
        return button(label, async () => {
          try { await handler(api, label); } catch (error) { say(error.message, true); }
        }, { secondary: true });
      }
      const node = button(label, null, { secondary: true });
      node.disabled = true;
      node.classList.add("is-unwired");
      // Said on the control rather than in a footnote: this is the difference
      // between a page that is honest about its state and one that pretends.
      node.title = `"${label}" needs a process this page does not have — see CANNOT_WIRE in wiring.js.`;
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
        "Its controls are above."));
      host.appendChild(box);
    });

    (spec.sections || []).forEach((section) => {
      const box = collapsible(section.title, { open: !section.collapsed });
      box.body.appendChild(el("p", "research-note",
        "Nothing configured here yet."));
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
    // Only worth saying when something on this page cannot work here.
    tally.textContent = total && wired < total
      ? `${total - wired} control(s) on this page need a process a browser tab `
        + "does not have; they are disabled rather than faked."
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
  // A page that implements its spec itself opts out. Some show one step or one
  // tab at a time on purpose -- the Build New wizard is a ten-step stack -- so
  // scanning the DOM for its controls finds only the visible ones and the
  // completion would append a disabled duplicate of every button on the other
  // nine steps. The audit still measures these pages; this only stops the
  // remainder being drawn.
  if (inner?.specComplete) return inner;

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
    const scrape = () => ({
      tabs: Array.from(host.querySelectorAll(".qt-tab, .shell-tab, .dash-tabs > *")).map(txt),
      shells: [...Array.from(host.querySelectorAll(".qt-section-head")).map(txt),
        ...Array.from(host.querySelectorAll(
          ".research-card-title, .editor-card-title, .qt-card-heading, "
          + ".qt-groupbox-title, .qt-section-title")).map(txt)],
      buttons: Array.from(host.querySelectorAll(".button, button")).map(txt),
      labels: [...Array.from(host.querySelectorAll(
        ".research-field-label, .toolbar-label, .qt-form-label, .qt-check")).map(txt),
        ...Array.from(host.querySelectorAll("input, textarea"))
          .map((n) => n.placeholder || "")],
      options: Array.from(host.querySelectorAll("option")).map(txt),
      headers: Array.from(host.querySelectorAll(".qt-table-head")).map(txt),
    });

    // One scrape is enough: tabbedPanel keeps every panel in the DOM and hides
    // the inactive ones, so a hidden control is still findable. This used to
    // click through the tabs instead, which fired the handlers of any tab that
    // did more than switch a view.
    const rendered = scrape();

    const handlers = wiring.get(pageId) || {};
    const controls = new Map();
    const values = () => {
      const out = {};
      controls.forEach((node, name) => {
        out[name] = node.type === "checkbox" ? node.checked : node.value;
      });
      return out;
    };
    const { node: status, say } = persistentStatus(host, pageId);
    const redraw = () => { host.textContent = ""; void mount(host, ctx); };
    const api = { values, controls, say, ctx, redraw, store, pageId };

    let added = 0;
    const makeButton = (label) => {
      added += 1;
      const handler = handlerFor(pageId, label);
      if (handler) {
        return button(label, async () => {
          try { await handler(api, label); } catch (error) { say(error.message, true); }
        }, { secondary: true });
      }
      const node = button(label, null, { secondary: true });
      node.disabled = true;
      node.classList.add("is-unwired");
      node.title = `"${label}" needs a process this page does not have — see CANNOT_WIRE in wiring.js.`;
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
        control.disabled = false;
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
            "Nothing configured here yet."));
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
      // A control the tree already rendered carries its Qt variable as
      // data-var; a <select> has no placeholder attribute, so the text-based
      // check below cannot see it and the completion appended a dead duplicate
      // of AI Trainer's live data-bus combo.
      .filter((v) => !paired.has(v) && !controls.has(v)
        && !host.querySelector(`[data-var="${CSS.escape(v)}"]`))
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

    // Everything below belongs to the page, not to a quarantine.
    //
    // This used to append one collapsible headed "Also in the desktop app",
    // which read as a list of things that were somewhere else. There is no
    // "somewhere else": this hub is the product, so the controls go where a
    // person would look for them -- actions in the toolbar at the top, inputs
    // in a card, tabbed groups in tabs.

    // Actions join the page's toolbar, or start one directly under the header.
    if (looseButtons.length) {
      let bar = host.querySelector(".page-toolbar");
      if (bar) {
        looseButtons.forEach((label) => bar.appendChild(makeButton(label)));
      } else {
        bar = toolbar(...looseButtons.map(makeButton));
        const header = host.querySelector(".page-header");
        if (header) header.after(bar); else host.insertBefore(bar, host.firstChild);
      }
    }

    // Inputs go into the group they belong to, and that group is then not
    // emitted again as an empty card -- doing both put two cards with the same
    // title on the page, one of them empty.
    const inputPairs = [...looseFields, ...orphanPairs];
    const inputGroup = missingGroups.length ? missingGroups[0] : null;
    if (inputPairs.length) {
      const box = editorCard(inputGroup || "Settings for this page");
      box.classList.add("is-wide");   // its field grid wants the full width
      const grid = makeFieldGrid(inputPairs);
      if (grid) box.appendChild(grid);
      host.appendChild(box);
    }

    // Tabbed groups become tabs, as they are in the app.
    if (Object.keys(panels).length) {
      host.appendChild(tabbedPanel(spec.title || pageId, panels));
    }

    // A group with nothing to put in it is not worth a card.
    missingGroups
      .filter((title) => title !== inputGroup)
      .forEach((title) => {
        const card = editorCard(title);
        card.appendChild(el("p", "research-note", "Nothing configured here yet."));
        host.appendChild(card);
      });
    missingSections.forEach((title) => {
      const section = collapsible(title);
      section.body.appendChild(el("p", "research-note",
        "Nothing configured here yet."));
      host.appendChild(section);
    });
    missingTables.forEach((headers) => { host.appendChild(dataTable(headers, [])); });

    const handoff = HANDOFFS[pageId];
    if (handoff && absent([handoff.label], rendered.buttons).length) {
      const card = editorCard(handoff.title);
      card.appendChild(el("p", "research-note", handoff.blurb));
      card.appendChild(row(button(handoff.label,
        () => ctx.bridge?.goToPage?.(handoff.mode)
          || window.GeoIDModeManager?.setMode?.(handoff.mode))));
      host.appendChild(card);
    }

    // One status line, and it lives at the foot of the page. The inner page
    // appends its own before the completion adds its cards, which stranded the
    // line mid-DOM between two sections; appendChild on an existing node is a
    // move, so this is also the de-duplication.
    const existing = host.querySelector(".research-status");
    if (existing) host.appendChild(existing);
    else host.appendChild(status);
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
/**
 * Pages that keep their hand-written module instead of the Qt layout tree.
 *
 * Every one of these is a *tool*, not a form: it holds state, parses files or
 * drives a multi-step flow, and none of that survives being reduced to a tree of
 * widgets with handlers hung off button labels. Measured before choosing them —
 * across all 62 pages, 238 of 310 buttons in the tree already have a handler
 * matched by label, and these seven are where that falls below half (Build New
 * 0/8, Projects 5/18, Data Hub 4/14, Data Repository 1/8, Docs & Sheets 1/6,
 * QA/QC 1/5, Post Processing 0/2). Rendering those from the tree would have
 * traded a page that works for a page that looks right and does nothing.
 *
 * Everything else renders from the tree. Do not add to this list to avoid
 * wiring a page -- wire it, or let its controls render honestly disabled.
 */
const KEEP_HANDBUILT = new Set([
  "Projects", "Data Repository", "Data Hub", "Docs & Sheets",
  "QA / QC", "Build New", "Notebook", "Dashboard", "Post Processing",
]);

export async function completeAllPages() {
  const spec = await loadSpec();
  const layouts = await loadLayouts().catch(() => ({}));
  const done = [];
  for (const pageId of Object.keys(spec)) {
    const existing = getPage(pageId);
    // The Qt app's own layout tree is the page, unless the page is one of the
    // tools above. The old inventory-driven modules said which controls exist
    // and then invented an arrangement for them -- and the arrangement is most
    // of what a page is, which is why they looked nothing like the app.
    const useTree = layouts[pageId] && !KEEP_HANDBUILT.has(pageId);
    const inner = useTree ? qtMount(pageId) : (existing?.mount || null);
    registerPage(pageId, { mount: completedMount(pageId, inner) });
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
      + "script editor above is the scripted route to the same thing." },
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
