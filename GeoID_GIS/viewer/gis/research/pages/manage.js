import { registerPage } from "../stages.js?v=20260902-9586225";
import * as store from "../project-store.js?v=20260902-9586225";
import { STAGES, getPage } from "../stages.js?v=20260902-9586225";
import {
  el, card, field, input, textarea, selectOf, button, row, statGrid, statusLine,
  guard, crossPage, findTables, saveTable,
  pageHeader, toolbar, inlineLabel, collapsible, dataTable, console_,
} from "./common.js?v=20260902-9586225";

/**
 * Dashboard, Project Manager, Pipeline and Data Hub.
 *
 * The pages that are about the project rather than about the data in it: what
 * has been done, what is planned, and how far along the pipeline the work has
 * got.
 */

const PIPELINE_PATH = "metadata/pipeline.json";
const BOARD_PATH = "plans/board.json";

/** The workflow's own order, taken from the stage list rather than restated. */
const PIPELINE_STEPS = STAGES
  .filter(([key]) => !["Dashboard", "Settings", "Data Hub", "Pipeline Editor"].includes(key))
  .map(([key, label]) => ({ key, label }));

// ── Pipeline Runner ──────────────────────────────────────────────────────────

const mountPipelineRunner = guard("Pipeline Runner", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const state = await store.readJson(PIPELINE_PATH, { steps: {} });
  state.steps = state.steps && typeof state.steps === "object" ? state.steps : {};

  const box = card("Pipeline");
  box.appendChild(el("p", "research-note",
    "Where this project has got to. Marking a step done records who said so and "
    + "when, which is the difference between a plan and a record."));
  const list = el("div", "research-list");
  box.appendChild(list);

  async function draw() {
    list.textContent = "";
    PIPELINE_STEPS.forEach((step) => {
      const record = state.steps[step.key] || {};
      const line = el("div", "research-list-row");
      const name = el("span", "research-list-name",
        `${step.label}${record.done ? ` — done ${String(record.at).slice(0, 10)}` : ""}`);
      const go = button("Open", () => {
        // Jump to the first built page of that stage.
        const stage = STAGES.find(([key]) => key === step.key);
        const target = stage?.[2].find(([id]) => getPage(id)) || stage?.[2][0];
        if (target) ctx.setPage?.(target[0]);
      }, { secondary: true });
      const toggle = button(record.done ? "Undo" : "Mark done", async () => {
        state.steps[step.key] = record.done
          ? {}
          : { done: true, at: new Date().toISOString() };
        await store.writeJson(PIPELINE_PATH, state);
        await draw();
        say(`${step.label} ${record.done ? "reopened" : "marked done"}.`);
      });
      line.append(name, go, toggle);
      if (record.done) line.classList.add("is-active");
      list.appendChild(line);
    });
    const done = PIPELINE_STEPS.filter((s) => state.steps[s.key]?.done).length;
    const bar = el("div", "research-progress");
    const fill = el("div", "research-progress-fill");
    fill.style.width = `${(100 * done) / PIPELINE_STEPS.length}%`;
    bar.appendChild(fill);
    list.appendChild(bar);
    list.appendChild(el("p", "research-note",
      `${done} of ${PIPELINE_STEPS.length} stages marked done.`));
  }

  host.append(box, status);
  await draw();
});

// ── Project Board ────────────────────────────────────────────────────────────

const COLUMNS = ["To do", "In progress", "Blocked", "Done"];

const mountBoard = guard("Project Board", async (host) => {
  const { node: status, say } = statusLine();
  const board = await store.readJson(BOARD_PATH, { cards: [] });
  board.cards = Array.isArray(board.cards) ? board.cards : [];

  const box = card("Board");
  const title = input("", "New card");
  const where = selectOf(COLUMNS, "To do");
  box.append(row(title, where, button("Add", async () => {
    if (!title.value.trim()) { say("Give the card a title.", true); return; }
    board.cards.push({
      id: `${Date.now()}`, title: title.value.trim(), column: where.value,
      at: new Date().toISOString(),
    });
    title.value = "";
    await store.writeJson(BOARD_PATH, board);
    await draw();
  })));

  const columns = el("div", "research-board");
  box.appendChild(columns);

  async function draw() {
    columns.textContent = "";
    COLUMNS.forEach((name) => {
      const col = el("div", "research-board-col");
      col.appendChild(el("h3", "research-subtitle", `${name} (${
        board.cards.filter((c) => c.column === name).length})`));
      board.cards.filter((c) => c.column === name).forEach((c) => {
        const cardEl = el("div", "research-board-card");
        cardEl.appendChild(el("span", null, c.title));
        const move = selectOf(COLUMNS, c.column);
        move.addEventListener("change", async () => {
          c.column = move.value;
          await store.writeJson(BOARD_PATH, board);
          await draw();
        });
        const drop = button("×", async () => {
          board.cards = board.cards.filter((x) => x.id !== c.id);
          await store.writeJson(BOARD_PATH, board);
          await draw();
        }, { secondary: true });
        cardEl.append(move, drop);
        col.appendChild(cardEl);
      });
      columns.appendChild(col);
    });
    say(`${board.cards.length} card(s).`);
  }

  host.append(box, status);
  await draw();
});

// ── Project Comparison ───────────────────────────────────────────────────────

const mountCompare = guard("Project Comparison", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Compare projects");
  box.appendChild(el("p", "research-note",
    "Every project in the folder side by side: phase, study area and how much "
    + "each one holds."));
  const table = el("div", "research-table is-wide");
  box.appendChild(table);

  // Every world's, not just this one -- comparing projects is the point of
  // the page, and a Mars study next to an Earth one is a fair comparison.
  const names = await store.listProjects(null);
  const head = el("div", "research-table-row is-head");
  ["Project", "World", "Phase", "Priority", "Study area", "Data", "Updated"].forEach((h) =>
    head.appendChild(el("span", null, h)));
  table.appendChild(head);

  const active = store.getActive();
  for (const dir of names) {
    // Read each project's own metadata without disturbing the open one.
    let meta = null;
    try {
      meta = JSON.parse(await store.getRoot().readFile(`${dir}/metadata/project.json`));
    } catch (error) { /* a folder with no metadata is still listed */ }
    let count = 0;
    try {
      const registry = JSON.parse(
        await store.getRoot().readFile(`${dir}/metadata/data_registry.json`));
      count = (registry.entries || []).length;
    } catch (error) { /* none */ }
    const area = meta?.study_area || {};
    const hasArea = ["min_lat", "max_lat", "min_lon", "max_lon"]
      .every((k) => String(area[k] || "").trim() !== "");
    const line = el("div", "research-table-row");
    if (active?.dir === dir) line.classList.add("is-active");
    const parts = dir.split("/");
    [parts[parts.length - 1], meta?.body || parts[0] || "earth",
      meta?.phase || "—", meta?.priority || "—",
      hasArea ? `${area.min_lat}..${area.max_lat}, ${area.min_lon}..${area.max_lon}` : "not set",
      String(count), (meta?.updated_at || "").slice(0, 10) || "—"]
      .forEach((v) => line.appendChild(el("span", null, String(v))));
    table.appendChild(line);
  }
  say(`${names.length} project(s) across all worlds in this folder.`);
  host.append(box, status);
});

// ── Pipeline Editor ──────────────────────────────────────────────────────────

const mountPipelineEditor = guard("Pipeline Editor", async (host) => {
  const { node: status, say } = statusLine();
  const state = await store.readJson(PIPELINE_PATH, { steps: {}, plan: [] });
  state.plan = Array.isArray(state.plan) ? state.plan : [];

  const box = card("Planned steps");
  box.appendChild(el("p", "research-note",
    "An ordered plan of what this project will do, kept in "
    + "metadata/pipeline.json so the desktop app and any runner can read it."));
  const list = el("div", "research-list");
  const stageSelect = selectOf(PIPELINE_STEPS.map((s) => s.key));
  const noteInput = input("", "what this step does here");
  box.append(row(stageSelect, noteInput, button("Add step", async () => {
    state.plan.push({ stage: stageSelect.value, note: noteInput.value.trim() });
    noteInput.value = "";
    await store.writeJson(PIPELINE_PATH, state);
    await draw();
  })), list);

  async function draw() {
    list.textContent = "";
    if (!state.plan.length) {
      list.appendChild(el("p", "research-note", "No steps planned yet."));
    }
    state.plan.forEach((step, index) => {
      const line = el("div", "research-list-row");
      line.append(
        el("span", "research-list-name", `${index + 1}. ${step.stage}${step.note ? ` — ${step.note}` : ""}`),
        button("↑", async () => {
          if (index === 0) return;
          [state.plan[index - 1], state.plan[index]] = [state.plan[index], state.plan[index - 1]];
          await store.writeJson(PIPELINE_PATH, state); await draw();
        }, { secondary: true }),
        button("×", async () => {
          state.plan.splice(index, 1);
          await store.writeJson(PIPELINE_PATH, state); await draw();
        }, { secondary: true }),
      );
      list.appendChild(line);
    });
    say(`${state.plan.length} planned step(s).`);
  }

  host.append(box, status);
  await draw();
});

// ── Data Hub ─────────────────────────────────────────────────────────────────

/**
 * Data Hub, laid out as `DataHubPage` does (app_qt.py:8651): header, a compact
 * toolbar of seven actions, the artefact tree with Artifact/Type/Size, then run
 * comparison, the experiment tracker and publish & release folded underneath.
 *
 * The four groups are the Qt groups -- figures, signals, exports, analysis --
 * and the tracker reads `metadata/experiments.jsonl`, the same append-only file
 * the desktop app writes, so a run recorded in either shows in both.
 */

const HUB_GROUPS = ["figures", "signals", "exports", "analysis"];
const EXPERIMENTS = "metadata/experiments.jsonl";

function sizeOf(text) {
  if (typeof text !== "string") return "";
  return `${(new Blob([text]).size / 1024).toFixed(1)} KB`;
}

const mountDataHub = guard("Data Hub", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const active = store.getActive();
  let selected = null;                       // relative path of the picked file

  const header = pageHeader("Data Hub",
    "Browse all project artefacts — figures, signals, exports and analysis "
    + "outputs.", active.name);
  header.pill.classList.add("is-open");

  const redraw = () => { host.textContent = ""; void mountDataHub(host, ctx); };

  // ── Artefact tree ─────────────────────────────────────────────────────────
  const tree = el("div", "qt-table hub-tree");
  tree.style.gridTemplateColumns = "1fr 6rem 6rem";
  ["Artifact", "Type", "Size"].forEach((h) => tree.appendChild(el("span", "qt-table-head", h)));

  /** Every file under a group, newest first, as the Qt page lists them. */
  async function walk(dir, out = []) {
    let entries = [];
    try { entries = await store.listProjectDir(dir); } catch (error) { return out; }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.kind === "directory") await walk(path, out);
      else out.push(path);
    }
    return out;
  }

  for (const group of HUB_GROUPS) {
    const head = el("button", "qt-table-cell hub-group");
    head.type = "button";
    head.textContent = group;
    head.addEventListener("click", () => { selected = group; paintSelection(); });
    tree.append(head, el("span", null, "dir"), el("span", null, ""));

    const files = await walk(group);
    for (const path of files.slice(0, 300)) {
      const cell = el("button", "qt-table-cell hub-file");
      cell.type = "button";
      cell.dataset.path = path;
      cell.textContent = path;
      cell.addEventListener("click", () => { selected = path; paintSelection(); });
      let text = null;
      try { text = await store.readProjectFile(path); } catch (error) { /* binary or gone */ }
      tree.append(cell,
        el("span", null, (path.split(".").pop() || "file").toLowerCase()),
        el("span", null, sizeOf(text)));
    }
  }
  if (!tree.querySelector(".hub-file")) {
    const empty = el("span", "qt-table-empty",
      "No artefacts yet. Figures, exports and analysis outputs land here as "
      + "they are produced.");
    empty.style.gridColumn = "1 / -1";
    tree.appendChild(empty);
  }

  function paintSelection() {
    Array.from(tree.querySelectorAll(".qt-table-cell")).forEach((b) =>
      b.classList.toggle("is-selected", (b.dataset.path || b.textContent) === selected));
  }

  const needFile = () => {
    if (!selected || !selected.includes("/")) {
      say("Select an artefact in the tree first.", true);
      return null;
    }
    return selected;
  };

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const bar = toolbar(
    button("Refresh", () => { redraw(); }, { secondary: true }),
    // A browser cannot hand a file to the desktop; it can show it, which is
    // what "open" is for here.
    button("Open", async () => {
      const path = needFile(); if (!path) return;
      try {
        const text = await store.readProjectFile(path);
        say(typeof text === "string"
          ? `${path} — ${sizeOf(text)}, ${text.split("\n").length} line(s).`
          : `${path} — binary.`);
      } catch (error) { say(error.message, true); }
    }, { secondary: true }),
    button("Add to StoryBoard", async () => {
      const path = needFile(); if (!path) return;
      const manifest = await store.readJson("exports/storyboard/manifest.json", { panels: [] });
      manifest.panels = Array.isArray(manifest.panels) ? manifest.panels : [];
      manifest.panels.push({ path, added_at: new Date().toISOString(), caption: "" });
      await store.writeJson("exports/storyboard/manifest.json", manifest);
      say(`Added to the storyboard (${manifest.panels.length} panel(s)).`);
    }, { secondary: true }),
    button("Send to Preprocessing", () => {
      const path = needFile(); if (!path) return;
      ctx.setPage?.("Preprocessing Transforms");
    }, { secondary: true }),
    button("Send to AI Trainer", () => {
      const path = needFile(); if (!path) return;
      ctx.setPage?.("AI Trainer");
    }, { secondary: true }),
    button("Create Repro Bundle", async () => {
      // What the desktop bundler records, minus pip freeze -- there is no
      // Python environment here to freeze, and inventing one would be a lie in
      // a file whose whole purpose is to be trusted later.
      const data = await store.listData();
      const bundle = {
        created_at: new Date().toISOString(),
        project: { name: active.name, dir: active.dir, body: active.meta.body },
        metadata: active.meta,
        data_registry: data,
        artefacts: Array.from(tree.querySelectorAll(".hub-file")).map((b) => b.dataset.path),
        environment: {
          note: "Produced in the browser; no interpreter environment to record.",
          user_agent: navigator.userAgent,
        },
      };
      await store.writeJson("exports/repro-bundle.json", bundle);
      say("Written to exports/repro-bundle.json.");
      redraw();
    }, { secondary: true }),
    button("Generate PDF Report", async () => {
      // A single self-contained HTML the browser prints to PDF: no PDF library
      // vendored, and the output is editable before it is printed.
      const data = await store.listData();
      const html = [
        "<!doctype html><meta charset=utf-8>",
        `<title>${active.name}</title>`,
        "<style>body{font:14px/1.6 system-ui;margin:3rem auto;max-width:52rem}"
        + "h1{margin-bottom:0}code{background:#f3f3f3;padding:.1em .3em}"
        + "td,th{border-bottom:1px solid #ddd;padding:.3rem .6rem;text-align:left}</style>",
        `<h1>${active.name}</h1>`,
        `<p>${active.meta.body || "earth"} · ${active.meta.phase} · `
        + `${active.meta.priority} · ${active.meta.progress_pct ?? 0}%</p>`,
        `<p>${active.meta.description || ""}</p>`,
        active.meta.focus_question ? `<p><b>Focus:</b> ${active.meta.focus_question}</p>` : "",
        "<h2>Registered data</h2><table><tr><th>Name<th>Kind<th>Path<th>Source</tr>",
        ...data.map((e) => `<tr><td>${e.name}<td>${e.kind}<td><code>${e.path}</code><td>${e.source || ""}</tr>`),
        "</table>",
        "<h2>Artefacts</h2><ul>",
        ...Array.from(tree.querySelectorAll(".hub-file")).map((b) => `<li><code>${b.dataset.path}</code>`),
        "</ul>",
      ].join("\n");
      await store.writeProjectFile("exports/report.html", html);
      say("Written to exports/report.html — open it and print to PDF.");
      redraw();
    }, { secondary: true }),
  );

  // ── Run comparison (folded) ───────────────────────────────────────────────
  const compare = collapsible("Run comparison");
  const runA = input("", "Run A path or JSON…");
  const runB = input("", "Run B path or JSON…");
  const compareOut = console_("", "Pick two runs and compare their configs and metrics.");
  const useSelected = (target) => button("Use Selected", () => {
    const path = needFile(); if (!path) return;
    target.value = path;
  }, { secondary: true });
  compare.body.append(
    row(inlineLabel("Run A"), runA, useSelected(runA)),
    row(inlineLabel("Run B"), runB, useSelected(runB)),
    row(button("Compare Runs", async () => {
      try {
        const [a, b] = await Promise.all([
          store.readJson(runA.value, null), store.readJson(runB.value, null),
        ]);
        if (!a || !b) { say("Both runs must be readable JSON.", true); return; }
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
        compareOut.classList.remove("is-placeholder");
        compareOut.textContent = keys.map((k) => {
          const av = JSON.stringify(a[k]);
          const bv = JSON.stringify(b[k]);
          return `${av === bv ? "  " : "≠ "}${k.padEnd(22)} ${String(av).slice(0, 24).padEnd(26)} ${String(bv).slice(0, 24)}`;
        }).join("\n");
      } catch (error) {
        compareOut.classList.remove("is-placeholder");
        compareOut.textContent = `Could not compare: ${error.message}`;
      }
    })),
    compareOut,
  );

  // ── Experiment tracker (folded) ───────────────────────────────────────────
  const experiments = collapsible("Experiment tracker");
  let runs = [];
  try {
    const raw = await store.readProjectFile(EXPERIMENTS);
    runs = String(raw).split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (error) { return null; }
    }).filter(Boolean);
  } catch (error) { /* no runs recorded yet */ }
  runs.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  experiments.body.appendChild(el("p", "research-note",
    "Read from metadata/experiments.jsonl — the same append-only file the "
    + "desktop app writes, so a run recorded in either appears in both."));
  experiments.body.appendChild(dataTable(
    ["Run ID", "Timestamp", "Status", "Dataset", "Metrics", "Outputs"],
    runs.map((entry) => {
      const config = entry.config || {};
      const metrics = entry.metrics || {};
      return [
        entry.run_id ?? "-",
        (entry.timestamp || "-").replace("T", " "),
        config.status || config.run_status || entry.status || "-",
        String(config.dataset || "-").split("/").pop(),
        Object.entries(metrics).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ") || "-",
        (entry.outputs || []).slice(0, 2).map((o) => String(o).split("/").pop()).join(", ") || "-",
      ];
    }),
  ));

  // ── Publish & release (folded) ────────────────────────────────────────────
  const publish = collapsible("Publish & release");
  publish.body.appendChild(row(
    button("Create Release Bundle", async () => {
      const manifest = {
        released_at: new Date().toISOString(),
        project: active.name,
        body: active.meta.body,
        artefacts: Array.from(tree.querySelectorAll(".hub-file")).map((b) => b.dataset.path),
        data: (await store.listData()).map((e) => e.path),
      };
      await store.writeJson("exports/release-manifest.json", manifest);
      say(`Release manifest written with ${manifest.artefacts.length} artefact(s).`);
      redraw();
    }, { secondary: true }),
    button("Generate Publish Bundle", async () => {
      const storyboard = await store.readJson("exports/storyboard/manifest.json", { panels: [] });
      await store.writeJson("exports/publish-bundle.json", {
        generated_at: new Date().toISOString(),
        project: active.name,
        focus_question: active.meta.focus_question,
        panels: storyboard.panels || [],
        figures: Array.from(tree.querySelectorAll(".hub-file"))
          .map((b) => b.dataset.path).filter((p) => p.startsWith("figures/")),
      });
      say("Written to exports/publish-bundle.json.");
      redraw();
    }, { secondary: true }),
  ));

  paintSelection();
  host.append(header, bar, tree, compare, experiments, publish, status);
});
mountDataHub.ownHeader = true;

registerPage("Pipeline Runner", { mount: mountPipelineRunner });
registerPage("Project Board", { mount: mountBoard });
registerPage("Project Comparison", { mount: mountCompare });
registerPage("Pipeline Editor", { mount: mountPipelineEditor });
registerPage("Data Hub", { mount: mountDataHub });

registerPage("GIS Explorer", {
  mount: crossPage("GIS Explorer", {
    blurb: "The globe, its basemaps, layers, events and Earth Engine overlays.",
    note: "This is the GIS page. Anything imported or drawn there is recorded "
      + "against the open project, and its Area tool sets the study area.",
    mode: "gis",
  }),
});

registerPage("Map", {
  mount: crossPage("Map", {
    blurb: "The same layers, read as a map: basemaps, polygons and legends.",
    note: "The GIS page carries the map view, the layer box and the legend.",
    mode: "gis",
    section: "basemap-relief-section",
  }),
});
