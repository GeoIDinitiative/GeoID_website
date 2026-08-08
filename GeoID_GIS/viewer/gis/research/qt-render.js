import { handlerFor } from "./spec-page.js?v=20260808-e9319ca";
import * as store from "./project-store.js?v=20260808-e9319ca";
import { el, statusLine } from "./pages/common.js?v=20260808-e9319ca";
import { install as installRuntime } from "./qt-runtime.js?v=20260808-e9319ca";

/**
 * Render a page from the Qt app's own layout tree.
 *
 * `qt-layout.py` recovers the tree out of `app_qt.py` — layout kinds, nesting,
 * order, stretch factors, tabs, form rows. This walks it. The mapping is almost
 * one to one, which is the whole reason this approach is worth having:
 *
 *   QVBoxLayout      flex column
 *   QHBoxLayout      flex row
 *   QGridLayout      CSS grid, with the row/column each child was placed at
 *   QFormLayout      stacked label-above-field rows
 *   addWidget(w, 2)  flex: 2
 *   addStretch()     a spacer that eats the remaining room
 *   QTabWidget       the hub's own tabbed panel
 *   QGroupBox        a titled card
 *   CollapsibleSection  a details/summary
 *
 * The previous approach extracted an *inventory* — which controls exist — and
 * then invented an arrangement for them. The controls were right and the page
 * looked nothing like the app, because the arrangement is most of what a page
 * is. This renders the arrangement.
 *
 * Behaviour still comes from `wiring.js` via `handlerFor(pageId, label)`, so a
 * button that was wired stays wired wherever the tree puts it.
 */

/**
 * Carry this module's own `?v=` onto a data file it fetches.
 *
 * Every import is stamped, but a plain `fetch` is not -- so the browser kept
 * serving a stale `qt-layout.json` while the modules around it updated, and a
 * regenerated tree appeared to have no effect at all. `import.meta.url` already
 * holds the stamp, so the file cannot fall out of step with the code reading it.
 */
function stamped(path) {
  const v = new URL(import.meta.url).searchParams.get("v");
  return v ? `${path}?v=${v}` : path;
}

const LAYOUT_CLASS = {
  QVBoxLayout: "qt-v",
  QHBoxLayout: "qt-h",
  QGridLayout: "qt-grid",
  QFormLayout: "qt-form",
  QStackedLayout: "qt-v",
};

/** How Qt's stylesheet treats each objectName it sets on a QLabel. */
const LABEL_ROLE = {
  PageTitle: ["h2", "qt-page-title"],
  SectionTitle: ["h3", "qt-section-title"],
  PageSubtitle: ["p", "qt-subtitle"],
  MutedLabel: ["p", "qt-muted"],
  PillLabel: ["span", "qt-pill"],
  FieldLabel: ["span", "qt-form-label"],
  StatLabel: ["span", "qt-form-label"],
};

function applyBox(node, spec) {
  // `flex: N`, not `flex: N 1 auto`, would set the basis to 0 -- and Qt's
  // stretch factor governs only the *extra* space, with the widget still
  // getting its size hint first. Ingest's registry section carries
  // `addWidget(pulled_sec, 1)` and collapsed to 2px under the zero basis.
  if (spec.stretch) node.style.flex = `${spec.stretch} 1 auto`;
  // `addWidget(btn, 0, Qt.AlignLeft)` means the widget keeps its size hint
  // instead of filling the row -- without this every such button stretched the
  // full width of its column, which is the single most obvious way a rebuilt
  // Qt page stops looking like one.
  if (spec.align) {
    node.classList.add(`qt-align-${spec.align}`);
    node.style.flex = "0 0 auto";
  }
  if (Number.isFinite(spec.row)) {
    node.style.gridRow = `${spec.row + 1} / span ${spec.rowspan || 1}`;
    node.style.gridColumn = `${spec.col + 1} / span ${spec.colspan || 1}`;
  }
  return node;
}

/** The value of a control the tree named, e.g. `source_url`. */
function controlValue(api, name) {
  const node = api.controls.get(name);
  if (!node) return "";
  return (node.value || "").trim();
}

function appendLog(api, line) {
  const log = api.controls.get("log");
  if (log) log.value = log.value ? `${log.value}\n${line}` : line;
  api.say(line);
}

async function runProviderAction(api, node, page) {
  const action = node.action || {};
  const provider = node.provider || "Provider";

  if (action.kind === "url") {
    const url = (action.url || "").trim();
    if (!url) return;
    const field = api.controls.get("source_url");
    if (field) field.value = url;
    window.open(url, "_blank", "noopener");
    appendLog(api, `[open] ${provider}: ${url}`);
    return;
  }

  if (action.kind !== "import_files" && action.kind !== "import_dir") return;
  if (!store.getActive()) {
    appendLog(api, "[ingest] select a project first.");
    return;
  }

  const picker = document.createElement("input");
  picker.type = "file";
  if (action.kind === "import_dir") picker.webkitdirectory = true;
  else picker.multiple = true;
  const files = await new Promise((resolve) => {
    picker.addEventListener("change", () => resolve(Array.from(picker.files || [])));
    picker.click();
  });
  if (!files.length) return;

  // Where the Qt page puts them: the Output box if set, else
  // data/ingest/<domain slug>.
  const slug = page.slug || "ingest";
  const outDir = controlValue(api, "output_dir") || `data/ingest/${slug}`;
  const tag = controlValue(api, "pull_tag") || "test";
  const provenance = {
    provider,
    source_url: controlValue(api, "source_url"),
    license: controlValue(api, "source_license"),
    citation: controlValue(api, "source_citation"),
    acquired_on: controlValue(api, "source_acquired"),
    notes: controlValue(api, "source_notes"),
    updated_at: new Date().toISOString().slice(0, 19),
  };

  let written = 0;
  for (const file of files) {
    const rel = `${outDir}/${file.webkitRelativePath || file.name}`;
    try {
      const text = await file.text();
      await store.writeProjectFile(rel, text);
      await store.registerData({
        path: rel, tag,
        source_stage: `${page.title || api.pageId} / ${provider}`,
        note: provenance.citation || "",
        ...provenance,
      });
      written += 1;
    } catch (error) {
      appendLog(api, `[import] ${file.name}: ${error.message}`);
    }
  }
  appendLog(api, `[import] ${provider}: ${written} file(s) -> ${outDir}`);
}

export function renderTree(spec, ctx) {
  const { pageId, api } = ctx;

  function renderLayout(layout) {
    const box = el("div", `qt-layout ${LAYOUT_CLASS[layout.kind] || "qt-v"}`);
    // A row that states where its slack goes -- an addStretch spacer, or a
    // child with a stretch factor -- has already answered the question, so the
    // fields in it must NOT also grow. Qt gives an unweighted QComboBox its
    // size hint and puts the leftover in the spacer; without this the combo ate
    // the row and the spacer got nothing.
    if (layout.children.some((c) => c.node === "stretch" || c.stretch)) {
      box.classList.add("has-stretch");
    }
    if (layout.kind === "QGridLayout") {
      // The widest column index decides the track count; the app never states
      // it, and counting is exact.
      const cols = layout.children.reduce(
        (n, c) => Math.max(n, Number.isFinite(c.col) ? c.col + (c.colspan || 1) : 1), 1);
      box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    }
    layout.children.forEach((child) => {
      const node = renderNode(child);
      if (node) box.appendChild(applyBox(node, child));
    });
    return box;
  }

  function renderNode(node) {
    if (!node) return null;
    switch (node.node) {
      case "layout": return renderLayout(node);
      case "stretch": return el("span", "qt-stretch");
      case "spacing": {
        const gap = el("span", "qt-spacing");
        gap.style.height = `${Math.min(24, node.px || 8)}px`;
        return gap;
      }
      case "row": {
        const row = el("label", "qt-form-row");
        row.appendChild(el("span", "qt-form-label", String(node.label || "").replace(/:$/, "")));
        const child = renderNode(node.child);
        if (child) row.appendChild(child);
        return row;
      }
      // `stacked_field(caption, widget)` — the app's own helper for a caption
      // set above its field, used across the Ingest provenance grids.
      case "stacked": {
        const box = el("label", "qt-stacked");
        box.appendChild(el("span", "qt-form-label", String(node.label || "")));
        const child = renderNode(node.child);
        if (child) box.appendChild(child);
        return box;
      }
      case "tabs": return renderTabs(node);
      case "widget": return renderWidget(node);
      default: return null;
    }
  }

  function renderTabs(node) {
    const box = el("div", "qt-tabwidget");
    const strip = el("div", "qt-tabs");
    const body = el("div", "qt-tab-body");
    const panels = [];
    (node.tabs || []).forEach((tab, index) => {
      const content = el("div", "qt-tab-panel");
      const inner = renderNode(tab.content);
      if (inner) content.appendChild(inner);
      panels.push(content);
      body.appendChild(content);

      const btn = el("button", "qt-tab", tab.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        Array.from(strip.children).forEach((b, i) => {
          b.classList.toggle("is-active", i === index);
          panels[i].hidden = i !== index;
        });
      });
      strip.appendChild(btn);
    });
    // Every panel stays in the DOM; the inactive ones are hidden, so nothing
    // has to click through them to find a control.
    panels.forEach((p, i) => { p.hidden = i !== 0; });
    if (strip.firstChild) strip.firstChild.classList.add("is-active");
    box.append(strip, body);
    return box;
  }

  function decorate(dom, node) {
    if (!dom) return dom;
    if (node.tip) dom.title = node.tip;
    if (node.width) { dom.style.width = `${node.width}px`; dom.style.flex = "0 0 auto"; }
    if (node.minWidth) dom.style.minWidth = `${node.minWidth}px`;
    if (node.minHeight) dom.style.minHeight = `${node.minHeight}px`;
    return dom;
  }

  function renderWidget(node) {
    return decorate(renderWidgetInner(node), node);
  }

  function renderWidgetInner(node) {
    const kind = node.kind;
    const text = node.text || "";

    if (kind === "PageHeader") return null;   // the hub draws the header itself

    if (kind === "QLabel") {
      if (!text) return null;
      const [tag, cls] = LABEL_ROLE[node.objectName] || ["p", "qt-label"];
      const label = el(tag, cls, text);
      if (node.wrap) label.classList.add("is-wrapped");
      return label;
    }

    if (kind === "QPushButton" || kind === "QToolButton") {
      // An Ingest provider action carries what it does, so it runs here rather
      // than sitting disabled. This is `_execute_provider_action` (app_qt.py:3088)
      // and `_copy_into_ingest` (:3112): files land in
      // data/ingest/<slug>/ and are registered with the tag, the provider as
      // the source stage, and the provenance fields off the metadata grid --
      // the same contract, so the desktop app reads what this writes.
      const handler = node.action
        ? (a) => runProviderAction(a, node, spec)
        : handlerFor(pageId, text);
      const btn = el("button", "button secondary qt-button", text);
      btn.type = "button";
      if (handler) {
        btn.addEventListener("click", async () => {
          try { await handler(api, text); }
          catch (error) { api.say(error.message, true); }
        });
      } else {
        btn.disabled = true;
        btn.classList.add("is-unwired");
        btn.title = `"${text}" needs a process this page does not have.`;
      }
      return btn;
    }

    if (kind === "QLineEdit") {
      const input = document.createElement("input");
      input.className = "input qt-input";
      input.type = "text";
      input.placeholder = node.placeholder || "";
      if (node.text) input.value = node.text;
      if (node.var) input.dataset.var = node.var;
      api.controls.set(node.var || input.placeholder || "field", input);
      return input;
    }

    if (kind === "QPlainTextEdit" || kind === "QTextEdit") {
      const area = document.createElement("textarea");
      area.className = "input qt-textarea";
      area.rows = node.maxHeight ? Math.max(2, Math.round(node.maxHeight / 24)) : 4;
      area.placeholder = node.placeholder || "";
      if (node.readOnly) area.readOnly = true;
      if (node.var) area.dataset.var = node.var;
      api.controls.set(node.var || "text", area);
      return area;
    }

    if (kind === "QComboBox") {
      const select = document.createElement("select");
      select.className = "input qt-select";
      (node.items || []).forEach((item) => {
        const option = document.createElement("option");
        option.value = String(item); option.textContent = String(item);
        select.appendChild(option);
      });
      if (!select.options.length) {
        const option = document.createElement("option");
        option.textContent = "—";
        select.appendChild(option);
      }
      if (node.value !== undefined) select.value = String(node.value);
      if (node.var) select.dataset.var = node.var;
      api.controls.set(node.var || "choice", select);
      return select;
    }

    if (kind === "QCheckBox" || kind === "QRadioButton") {
      const wrap = el("label", "qt-check");
      const box = document.createElement("input");
      box.type = kind === "QCheckBox" ? "checkbox" : "radio";
      if (node.checked) box.checked = true;
      if (node.var) box.dataset.var = node.var;
      api.controls.set(node.var || text, box);
      wrap.append(box, el("span", null, text));
      return wrap;
    }

    if (kind === "QSpinBox" || kind === "QDoubleSpinBox") {
      const input = document.createElement("input");
      input.className = "input qt-input qt-number";
      input.type = "number";
      input.step = kind === "QDoubleSpinBox" ? "any" : "1";
      if (Array.isArray(node.range)) {
        input.min = String(node.range[0]);
        input.max = String(node.range[1]);
      }
      if (node.value !== undefined) input.value = String(node.value);
      if (node.var) input.dataset.var = node.var;
      api.controls.set(node.var || "number", input);
      return input;
    }

    if (kind === "QDateEdit" || kind === "QDateTimeEdit") {
      const input = document.createElement("input");
      input.className = "input qt-input";
      input.type = kind === "QDateEdit" ? "date" : "datetime-local";
      if (node.var) input.dataset.var = node.var;
      api.controls.set(node.var || "date", input);
      return input;
    }

    if (kind === "QSlider") {
      const input = document.createElement("input");
      input.className = "input qt-slider";
      input.type = "range";
      if (node.var) input.dataset.var = node.var;
      api.controls.set(node.var || "slider", input);
      return input;
    }

    if (kind === "QProgressBar") {
      const bar = el("div", "research-progress");
      bar.appendChild(el("div", "research-progress-fill"));
      return bar;
    }

    // A list has no columns, so it gets no header row -- a lone "—" heading
    // over an empty list reads as a broken table.
    if (kind === "QListWidget") {
      const list = el("div", "qt-listwidget");
      if (node.var) list.dataset.var = node.var;
      return list;
    }

    if (kind === "QTableWidget" || kind === "QTreeWidget") {
      const headers = node.headers || [];
      const table = el("div", "qt-table is-empty qt-datatable");
      table.style.gridTemplateColumns =
        `repeat(${Math.max(1, headers.length)}, minmax(0, 1fr))`;
      (headers.length ? headers : ["—"]).forEach((h) =>
        table.appendChild(el("span", "qt-table-head", h)));
      if (node.var) table.dataset.var = node.var;
      return table;
    }

    if (kind === "QGroupBox") {
      const card = el("section", "qt-groupbox");
      if (text) card.appendChild(el("h3", "qt-groupbox-title", text));
      const inner = renderNode(node.content);
      if (inner) card.appendChild(inner);
      return card;
    }

    if (kind === "CollapsibleSection") {
      const box = document.createElement("details");
      box.className = "qt-section";
      if (node.collapsed === false) box.open = true;
      const head = document.createElement("summary");
      head.className = "qt-section-head";
      head.textContent = text || "Section";
      box.appendChild(head);
      const body = el("div", "qt-section-body");
      const inner = renderNode(node.content);
      if (inner) body.appendChild(inner);
      box.appendChild(body);
      return box;
    }

    // A bare QFrame set to HLine/VLine is a separator rule, which is how the
    // app breaks a long toolbar into groups.
    if (kind === "QFrame" && node.frame && /line/.test(node.frame)) {
      return el("span", `qt-rule is-${node.frame.startsWith("v") ? "v" : "h"}`);
    }

    if (kind === "QScrollArea") {
      const box = el("div", "qt-scroll");
      const inner = renderNode(node.content);
      if (inner) box.appendChild(inner);
      return box;
    }

    // QWidget / QFrame / QSplitter: a plain container for whatever it holds.
    const inner = renderNode(node.content);
    if (!inner) return null;
    const wrap = el("div", kind === "QSplitter" ? "qt-splitter" : "qt-container");
    wrap.appendChild(inner);
    return wrap;
  }

  return renderLayout(spec.root);
}

let layoutPromise = null;
export function loadLayouts() {
  if (!layoutPromise) {
    layoutPromise = fetch(stamped("/GeoID_GIS/viewer/gis/research/qt-layout.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`qt-layout.json: HTTP ${r.status}`);
        return r.json();
      });
  }
  return layoutPromise;
}

/**
 * A mount that renders the page exactly as the app arranges it.
 *
 * Used for every page that has no hand-built module; the hand-built ones
 * (Projects, Data Repository, QA/QC, Data Hub, Docs & Sheets, Build New,
 * Notebook, Dashboard) keep theirs.
 */
export function qtMount(pageId) {
  async function mount(host, ctx) {
    const layouts = await loadLayouts();
    const spec = layouts[pageId];
    if (!spec) {
      host.appendChild(el("p", "research-note",
        `No layout recovered for "${pageId}" — run services/qt-layout.py.`));
      return;
    }
    const { node: status, say } = statusLine();
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

    const body = el("div", "qt-page");
    body.appendChild(renderTree(spec, { pageId, api }));
    host.append(body, status);
    // The parts the app builds while it runs -- dataset cards, layer rows --
    // are not in a static tree and are filled in here.
    installRuntime(pageId, body, api);
  }
  mount.ownHeader = false;   // the hub supplies title and subtitle
  mount.qtRendered = true;
  return mount;
}
