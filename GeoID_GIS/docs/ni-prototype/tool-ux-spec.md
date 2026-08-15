# Tool Discoverability & Customisation Layer — Implementation Spec

Verified against the working tree at `/home/owen/GeoID_webpage/GeoID_GIS/viewer/gis/` (branch `gis-viewer-mygeoid`) and Phase 2 of `/home/owen/.claude/plans/dapper-questing-quokka.md`. All file paths below are under `GeoID_GIS/viewer/gis/` unless absolute.

---

## 0. Ground truth this design is built on (read, not assumed)

- **Visual law**: active/open = solid `rgb(var(--nav-accent-rgb))` fill with `var(--skin-chrome-ink, #2b0030)` ink (side-panels.js:72–87, the recorded house rule). Headings = Exo 2, 0.76rem, weight 600, `letter-spacing: 0.1em`, uppercase, `var(--text)` white ink (side-panels.js:136–149). Never restate button colours — viewer-skin.css owns them with `!important`.
- **Injection law**: shared UI ships its own `<style>` tag from the module (side-panels.js:59–361 is the template: `const STYLE = \`…\``, `injectStyle()`, `tag.dataset.gisXxx = ""`). Never put shared rules in `styles.css` (Earth-only) or `gis/shell.css` (planets-only). No backticks inside the CSS template literal — that exact trap killed zoom-bar.js once (project CLAUDE.md).
- **Seams**: `window.GeoIDImportManager` (`getLayers`, `addDerivedLayer`, `onChange`), `window.GeoIDToolboxOps` (`refreshToolboxSelects`, `VECTOR_OPS`, `RASTER_OPS`), `window.GeoIDSidePanels` (`open/close/isOpen`), `window.GeoIDAtlas`.
- **Chaining today (audited, see §4)**: `addDerivedLayer` → `renderLayerList()` (import-manager.js:539) → `notifyLayerChange()` (import-manager.js:204–205) → every subscribed refresher. Derived vector layers carry both `.collection` and `.features` (vector-render.js:151–152), so they pass both select predicates. The loop is intact for the six live selects; the real gaps are elsewhere (§4.2).
- **Search precedent**: atlas-assistant.js:155–198 — STOPWORDS strip, light `stem()`, name hit = 5 × blurb hit, exact-name +20, **score floor of 3 that only a name hit clears**, making "no match" possible. This spec reuses that code, not just the idea.
- **localStorage naming**: `geoid-gis:<name>` (`geoid-gis:view-mode`, `geoid-gis:atlas-endpoint`, `geoid-gis:atlas-alert-cursor`).
- **Keyboard law**: any new document-level `keydown` must exempt `input`/`textarea`/`contenteditable` (the space-bar lesson, project CLAUDE.md).
- **Module loading**: Earth's `index.html` lists script tags (hand-stamp `?v=` once for a new tag); planet pages load via `boot.js` MODULES. A new module must be added to **both**.

---

## 1. The descriptor registry — `gis/tool-runner.js` (new, per Phase 2)

One module holding the tool table and the run pipeline. Everything else in this spec (search, dialog, chaining, prefs) reads this table; adding a tool is a row, never a new UI.

### 1.1 Descriptor shape

Phase 2's `{id, label, category, inputs, params, engines}` plus the UX fields discoverability needs:

```js
export const TOOLS = [
  {
    id: "buffer",
    label: "Buffer",
    category: "Vector geoprocessing",       // palette grouping + toolbox tile it lives in
    blurb: "Grow each feature outward by a distance in metres; overlaps dissolve.",
    keywords: ["distance", "offset", "grow", "ring", "zone"],   // synonyms the label lacks
    inputs: [
      { name: "input", label: "Input", type: "vector" },
      // { name: "overlay", label: "Overlay", type: "vector" }   // clip/difference/intersect/join
    ],
    params: [
      { name: "distance", label: "Distance (m)", kind: "number", default: 1000, step: 100 },
      // kinds: "number" | "select" (options:[…]) | "field" (from selected input layer)
      //        | "text" | "checkbox"
    ],
    outputType: "vector",                    // "vector" | "raster" | "table" | "file"
    outputName: "buffer_{input}",            // template: {input} {tool} {n}
    engines: { native: (inputs, params) => GP.buffer(inputs.input.collection, params.distance) },
  },
  // …
];
export const toolById = (id) => TOOLS.find((t) => t.id === id);
```

- **Migration**: every entry of `VECTOR_OPS` and `RASTER_OPS` (toolbox-ops.js:86–232) becomes a descriptor mechanically — `needsSecond` → a second `inputs` entry, `usesField` → a `kind:"field"` param, `param:{label,value,step}` → a `kind:"number"` param, the existing `` `buffer_${a.name}` `` naming → the `outputName` template. Zonal statistics, the Phase-1 orphans (`rasterCalculator`, `clipRasterByPolygon`, `reproject`, union — task #53), and the currently dead shell controls (§4.2 gap A) all join as descriptors.
- **Typed layer accessor** (single source of truth, closes gap D in §4.2):

```js
export function layersByType(type) {
  const all = window.GeoIDImportManager?.getLayers?.() || [];
  const loaded = all.filter((l) => l.status === "loaded");
  if (type === "vector") return loaded.filter((l) => l.collection);
  if (type === "raster") return loaded.filter((l) => l.raster);
  return loaded;
}
```

Both the dialog and (during migration) `refreshToolboxSelects` call this — the two divergent predicates (toolbox-ops.js:17–23 vs import-manager.js getVectorLayers) stop being able to drift.

### 1.2 `runTool(toolId, inputs, params, { outputName })`

The Phase-2 pipeline, in order: **VALIDATE** (every declared input present and of declared type; params coerced/range-checked) → **PROCESS** (`engines.native`; `engines.sidecar` slot reserved for Phase 3) → **OUTPUT/REGISTER** (publish via the existing `publishVector`/`publishRaster` path → `addDerivedLayer`; Phase 2 item 4 later adds `data/processed/` serialisation here — this spec does not depend on it) → **HISTORY** (§1.3). Returns `{ ok, message, layer, outputType }` — the returned `layer` record (with its `id`) is what makes one-click chaining (§4.3) possible.

Errors keep the current contract: status text `Failed: <message>`, `console.error("[GeoID GIS] …")`.

### 1.3 History

Appended by the runner on every completed run:

```js
{ tool, label, inputs: [{ layerId, name }], params, output: { name, layerId },
  engine: "native", ok, message, t: Date.now() }
```

- Project open → append to `metadata/tool_history.json` via the store (best-effort: **never fail the host action**, the bridge rule).
- No project → `geoid-gis:tool-history` ring buffer, cap 50.
- UI: one new `.gis-tool-section` tile **"History"** appended to `#gis-group-preprocess`'s `.section-body` by tool-dialog.js at init — rows `div.gis-history-row` (label + output name + time, `.gis-metric` typography), each with `button.gis-history-rerun.button.secondary` "Run again" → `openTool(id, { params, prefillInputs })`. This is Phase 2 item 5's "minimal history panel; re-run = one click".

**Test**: `tool-runner.test.mjs` — descriptor completeness (every tool has label/category/blurb/outputType/outputName; every param kind valid), VALIDATE rejections, output-name resolution, history record shape. Zero-dep, beside the module, picked up by `tests/run.mjs`.

---

## 2. Shared search text — `gis/search-text.js` (new)

Extract atlas-assistant.js's proven pieces so the tool search and the page search stay one algorithm:

```js
export const STOPWORDS = /* moved verbatim from atlas-assistant.js:155–162 */;
export function stem(word) { return word.replace(/(ings?|ed|es|s)$/, "") || word; }
export function tokenize(q) {
  return (q.toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .filter((w) => !STOPWORDS.has(w)).map(stem);
}
```

Two deliberate deltas from the original, both needed for tools: token pattern admits digits and length 2 (`idw`, `tin`, `2d`, `dem` must survive), and stemming applies to the *query* side as today. atlas-assistant.js switches to importing these (stamped import, same `?v=` discipline). **Test**: `search-text.test.mjs` pins the meshing/Metadata regression case from the atlas comments plus `"buffering" → buffer`.

---

## 3. Tool search — `gis/tool-search.js` (new)

### 3.1 Where it lives

Two entry points, **one component**:

1. **Persistent search box** — injected by this module as the first child of `#gis-toolbox-panels` (the tab bar). Safe against `orderTabs`: that function `appendChild`s the named tabs (toolbox.js:120–134), so an unlisted node inserted first stays first.

   ```html
   <div id="gis-tool-search-box">
     <input id="gis-tool-search" class="input" type="search"
            placeholder="Search tools…  ( / )" aria-label="Search tools">
   </div>
   ```

   On `focus` it opens the palette and forwards focus there (the VS Code launcher pattern) — one renderer, no second results list.

2. **The palette** — the QGIS Ctrl+Alt+T / ArcGIS geoprocessing-search equivalent, an overlay dialog following the existing `#project-dialog` structural pattern (shell.html:18–26):

   ```html
   <div class="gis-tool-palette-backdrop" id="gis-tool-palette-backdrop" hidden>
     <section class="gis-tool-palette" role="dialog" aria-modal="true"
              aria-label="Tool search">
       <header class="gis-tool-palette-head">
         <input id="gis-tool-palette-input" class="input" type="search"
                placeholder="Search tools…" aria-label="Search tools">
       </header>
       <div id="gis-tool-palette-results" class="gis-tool-palette-results"
            role="listbox"></div>
       <footer class="gis-tool-palette-foot">↑↓ select · Enter open · Esc close</footer>
     </section>
   </div>
   ```

   Result row (one `button.gis-tool-hit`, `role="option"`):

   ```html
   <button class="gis-tool-hit" data-tool="buffer">
     <span class="gis-tool-hit-fav" data-fav>★</span>
     <span class="gis-tool-hit-label">Buffer</span>
     <span class="gis-tool-hit-cat">Vector geoprocessing</span>
     <span class="gis-tool-hit-blurb">Grow each feature outward by a distance in metres.</span>
   </button>
   ```

   `.gis-tool-hit-label` in Exo 2 white per the heading spec; `.gis-tool-hit-cat` as a quiet uppercase chip; keyboard-selected row carries `.is-active` = **solid accent fill, dark ink** (the one active rule, side-panels.js:72). Star: `.gis-tool-hit-fav.is-fav` filled accent, otherwise 0.35 opacity outline; click toggles without opening (stopPropagation).

   Styling ships in this module's injected tag (`tag.dataset.gisToolSearch=""`): backdrop `rgba(0,0,0,0.55)`; the panel borrows the sidebar shell tokens (border `1px solid rgba(var(--nav-accent-rgb), 0.34)`, dark ground, `var(--text)` ink); `z-index: 150` — above `#measurement-result-card` at 140, the top of the audited stack.

### 3.2 Keyboard shortcut

Document-level `keydown`, with the mandatory text-entry exemption (input/textarea/contenteditable bail-out — the space-bar lesson):

- **`/`** opens the palette (primary — reachable, web-conventional, and not eaten by the OS).
- **`Ctrl+Alt+T`** also opens it — QGIS parity, best-effort only: on stock Ubuntu the OS grabs that chord for a terminal before the browser sees it, which is why `/` leads. Registering it costs one condition and serves QGIS hands where the OS allows.
- **Escape** closes (house style: atlas-assistant.js:914, layer-export-dialog.js:229). ArrowUp/ArrowDown move `.is-active`; Enter opens the selected tool via `openTool(id)` (§4.4).

### 3.3 Ranking — the atlas rules, followed

```js
function rankTools(query) {
  const tokens = tokenize(query);
  if (!tokens.length) return null;              // null = show browse state, not "no match"
  return TOOLS.map((t) => {
    const label = t.label.toLowerCase(), cat = t.category.toLowerCase(),
          blurb = t.blurb.toLowerCase(), keys = t.keywords.join(" ").toLowerCase();
    let score = 0;
    tokens.forEach((w) => {
      if (label.includes(w)) score += 5;        // name hit: 5x, the atlas weighting
      else if (keys.includes(w)) score += 3;    // synonym: below name, above blurb
      else if (blurb.includes(w) || cat.includes(w)) score += 1;
    });
    if (label === query.toLowerCase().trim()) score += 20;
    return { tool: t, score };
  })
  .filter((r) => r.score >= 3)                  // THE FLOOR: only a label or keyword hit
                                                // clears it; blurb alone cannot. This is
                                                // what makes "no match" possible at all.
  .sort((a, b) => b.score - a.score
    || favRank(a, b)                            // favourites, then recency — TIEBREAKERS
    || a.tool.label.localeCompare(b.tool.label))// only: prefs never lift a sub-floor hit
  .slice(0, 12);
}
```

- **Empty query** (browse state): Favourites section, then Recents (≤8), then all tools grouped by `category` — this is the ArcGIS Pro geoprocessing pane's resting state.
- **No match**: `"No tool matches "<query>"."` plus one `button.gis-tool-hit` "Browse all tools" that clears the input. Never a guess — the floor is the honesty mechanism, exactly as the atlas comment records.

**Seam**: `window.GeoIDToolSearch = { open(query), openTool(id, prefill) }`. **Test**: `tool-search.test.mjs` on the pure `rankTools` — name-vs-blurb weighting, floor rejection of blurb-only matches, tiebreakers never resurrecting sub-floor tools.

---

## 4. One tool dialog + chaining

### 4.1 The dialog — `gis/tool-dialog.js` (new) + one side-panels.js extension

Every tool renders through one template so every tool looks and behaves identically. It lives as a third **workbench panel** — the established shell for "open, work, close" surfaces — so it inherits placement, the exclusive-open rule, the collapse chevron and the sidebar shell for free.

**side-panels.js edit** (the only edit that file needs): export

```js
export function registerPanel(spec, contentNode) { /* buildPanel + panels.set + rail-free */ }
```

— a variant of the existing `buildPanel` that takes a built content node instead of moving a `<details>` group, registers into the same `panels` map (so `setOpen` keeps "only one workbench at a time") but adds **no rail button** (the palette and search box are the entry points). `window.GeoIDSidePanels.open("tool")` then just works.

**Panel content**, rendered per-descriptor into `#gis-side-panel-tool`:

```html
<div id="gis-tool-dialog" class="gis-tool-body" data-tool="buffer">
  <p id="gis-tool-blurb" class="tool-copy">Grow each feature outward by a distance in metres.</p>

  <!-- one row per descriptor input; select filled by layersByType(input.type) -->
  <div class="row"><label for="gis-tool-in-input">Input</label>
    <select id="gis-tool-in-input" class="mini-select"></select></div>

  <!-- one row per param, renderer keyed on kind -->
  <div class="row"><label for="gis-tool-param-distance">Distance (m)</label>
    <input id="gis-tool-param-distance" class="input" type="number" step="100"></div>

  <div class="row"><label for="gis-tool-output">Output name</label>
    <input id="gis-tool-output" class="input" type="text"></div>

  <div class="gis-btn-row">
    <button id="gis-tool-run" class="tool-button" type="button">Run</button>
    <button id="gis-tool-reset" class="button secondary" type="button">Defaults</button>
  </div>
  <div id="gis-tool-status" class="gis-metric" aria-live="polite"></div>

  <div id="gis-tool-chain" class="measure-actions" hidden>
    <button id="gis-tool-chain-use" class="button secondary" type="button">→ Use result as input</button>
    <button id="gis-tool-chain-next" class="button secondary" type="button">Chain into…</button>
  </div>
</div>
```

Behavioural contract, all inherited from existing patterns:

- **Typed selects**: filled by `fillSelect` (reused from toolbox-ops.js:39 — it already preserves the previous choice) from `layersByType(input.type)`; re-filled on `GeoIDImportManager.onChange` while the panel is open.
- **`kind:"field"` params**: options from the *selected* input layer's `info.fields`, resyncing on input change — the existing `syncVectorOpInputs` pattern (toolbox-ops.js:149–169), generalised.
- **Output name**: prefilled from `resolveOutputName(desc, inputs)` — the descriptor template with `{input}` = first input's basename, collision on an existing layer name appends `_2`. Re-resolves when the input changes *unless the user has typed* (the `dataset.touched` pattern, toolbox-ops.js:422).
- **Run**: `runTool(...)` inside `requestAnimationFrame` with a "Running <label>…" status first — the existing UX (toolbox-ops.js:185–194) so long ops still paint. Success writes the runner's message to `#gis-tool-status`, unhides `#gis-tool-chain`, and records params + output name to prefs (§5). Header carries the favourite star and, via the panel builder, collapse/close.
- **History**: written by the runner (§1.3), not the dialog — legacy tiles and future callers get it for free.

### 4.2 Chaining audit — what works, and the named gaps

**Already achieved** (the question asked): `refreshToolboxSelects` *does* pick up derived layers immediately. Chain verified in code: `addDerivedLayer` → `renderLayerList()` (import-manager.js:539) → `notifyLayerChange()` (204–205) → `refreshToolboxSelects` (subscribed toolbox-ops.js:447) and `refreshVectorLayerSelect`/`refreshProjectSummary` (toolbox.js:470–473). Derived vectors satisfy both live predicates (`collection` *and* `features`, vector-render.js:151–152); `removeLayer` also notifies (import-manager.js:310–321). So `vec-op-a/b`, `ras-op-a`, `zonal-raster`, `zonal-zones`, `attr-layer`, `vector-layer` are all fresh.

**The gaps, named:**

- **Gap A — dead selects.** `#extract-source`, `#export-layer`, `#export-format`, `#export-crs`, `#signal-method/-window/-overlap/-run`, `#builder-language/-source/-run`, and `#map-*` (shell.html, Extraction & Analysis and Export Data groups, ~lines 324–435) have **zero JS references anywhere in `gis/*.js`** — markup-only. Export Layers' layer select never lists anything, derived or otherwise. *Fix*: fold them into the registry as descriptors (`export-layer` with `kind:"select"` format/CRS params, `extract-series`, `compose-map`, `model-builder`); interim, `refreshToolboxSelects` gains `fillSelect(byId("export-layer"), layersByType("any"))` and `fillSelect(byId("extract-source"), …)` so the markup stops lying.
- **Gap B — output never auto-offered.** `fillSelect` restores the *previous* selection, so the layer you just made is listed but never selected; there is no one-click continuation. *Fix*: §4.3.
- **Gap C — result messages are inert text.** `setText("vec-op-status", result.message)` carries no affordance. *Fix*: §4.3's chip, in the dialog now and in the legacy tiles when they migrate onto the runner.
- **Gap D — two definitions of "vector layer"** (toolbox-ops.js:17–19 requires `.collection`; import-manager's `getVectorLayers` requires `.features?.length`). Consistent today, one adapter away from a layer appearing in half the selects. *Fix*: everything routes through `layersByType()`; `tool-runner.test.mjs` pins that a minimal derived-layer record passes both.

### 4.3 "Use result as next input" — one click

The runner returns the created `layer` record. On success the dialog keeps `lastResult = { layerId, outputType }` and shows:

- **`#gis-tool-chain-use`** — sets this tool's first type-compatible input select to `lastResult.layerId` (dispatching `change` so field params resync — the lesson that setting `.value` in code notifies nobody), and re-resolves the output name. Buffer→buffer→buffer is three clicks.
- **`#gis-tool-chain-next`** — opens the palette with results **pre-filtered to tools whose first input type matches `lastResult.outputType`** and a one-line banner "Chaining <output name> into…". Choosing a tool calls `openTool(id, { prefillInputs: { [firstInput.name]: lastResult.layerId } })`. This is the buffer→clip contract from the plan's chaining requirement, as a gesture.

### 4.4 `openTool(id, prefill)`

Exported and hung on `window.GeoIDToolSearch`. Renders the descriptor into the panel, applies **descriptor defaults ← saved per-tool prefs ← `prefill`** (later wins), opens via `GeoIDSidePanels.open("tool")`, focuses the first empty input. The palette, the history "Run again", the chain chip, and Atlas (§6) all enter here — one door.

---

## 5. Customisation — `gis/tool-prefs.js` (new)

Pure persistence module (storage injectable, so it tests without a browser). All keys in the house namespace:

| Key | Shape | Written | Read |
|---|---|---|---|
| `geoid-gis:tool-favourites` | `["buffer","clip"]` | star toggles (palette + dialog header) | palette browse state; ranking tiebreaker |
| `geoid-gis:tool-recents` | `[{id, t}]`, cap 8, newest first | every successful run | palette browse state; ranking tiebreaker |
| `geoid-gis:tool-params:<toolId>` | `{ params: {...}, outputName }` | successful run + explicit output-name edits | `openTool` prefill; "Defaults" button clears it |
| `geoid-gis:tool-history` | run records ring, cap 50 | runner, when no project is open | History tile fallback |

**Where each sits relative to the registry** (the question asked): *defaults* — `outputName` templates, param defaults, keywords — live **in the descriptors** (`tool-runner.js`: shippable, testable data). *User state* — favourites, recents, remembered params, edited naming — lives **only in tool-prefs' localStorage**, keyed by descriptor id, merged at `openTool` time. The registry module stays pure data + pure functions; nothing ever writes into it. Per-tool remembered params mirror QGIS's behaviour; favourites/recents mirror ArcGIS Pro's Favorites/Recents tabs. Every `localStorage` access wrapped in try/catch (house pattern, atlas-assistant.js:55–63).

**Test**: `tool-prefs.test.mjs` — recents dedupe + cap, favourites toggle idempotence, merge order (prefill beats saved beats default), history ring cap.

---

## 6. Atlas integration (one row, big payoff)

atlas-assistant.js's `grounded()` gains one branch before the page search (~line 561): rank `TOOLS` with the same `search-text` scoring and floor; hits return `actions: [["Open Buffer", () => window.GeoIDToolSearch.openTool("buffer")]]`. "Where do I buffer?" now opens the actual dialog instead of naming a Research page. The floor keeps the existing honesty guarantee; the ECOSYSTEM/watch branches, being earlier, keep precedence. (Ship after §3; needs only the import and the branch.)

---

## 7. Build order

Each step ships and verifies independently; `python3 GeoID_GIS/services/stamp.py` + `node GeoID_GIS/tests/run.mjs` **before** commit at every step (per project law), and new script tags hand-stamped once in Earth's `index.html` + added to `boot.js` MODULES.

1. **`search-text.js`** + test; atlas-assistant.js switches to importing it. Behaviour-neutral refactor; smoke-check the atlas page-search regression case in the browser.
2. **`tool-runner.js`**: descriptors for all of VECTOR_OPS + RASTER_OPS + zonal + the four Phase-1 orphans (converges with task #53); `layersByType`; `runTool`; history write. Test per §1.2. toolbox-ops.js's run paths delegate to `runTool` (tiles unchanged visually) so history and prefs cover legacy UI from day one.
3. **`tool-prefs.js`** + test.
4. **side-panels.js `registerPanel`** + **`tool-dialog.js`** (dialog, chain chips, History tile). Headless probe: open buffer → run on a fixture layer → derived layer on globe + history entry + chain chip advances the input select.
5. **`tool-search.js`** (palette + toolbox search box + `/` shortcut + seam). Probe: query "clip" ranks Clip first; "airspeed velocity" yields the no-match state.
6. **Gap A closure**: interim `fillSelect` wiring for `#export-layer`/`#extract-source`, then descriptors for Export Layers / Extract Series / Compose Map as their engines land.
7. **Atlas branch** (§6).
8. **Legacy tile slim-down** (optional, last): Geoprocessing/Surface Analysis tiles become descriptor-rendered via the dialog's row renderer — one rendering path, shell.html markup shrinks. Defer freely; nothing above depends on it.

**Chaining acceptance probe** (the plan's contract, end to end): headless — import polygons fixture → palette `/`, "buffer", Enter → Run → "Use result as input" → switch tool to Clip via "Chain into…" → Run → assert the clip consumed the buffer layer and both derived layers list in every live select. That probe is the regression net for the whole layer.