import { registerPage } from "../stages.js?v=20260810q";
import * as store from "../project-store.js?v=20260810q";
import { STAGES, getPage } from "../stages.js?v=20260810q";
import {
  el, card, field, input, textarea, selectOf, button, row, statGrid, statusLine,
  guard, crossPage, findTables, saveTable,
} from "./common.js?v=20260810q";

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

const mountDataHub = guard("Data Hub", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const box = card("Everything this project holds");
  const entries = await store.listData();
  const byKind = entries.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1; return acc;
  }, {});
  box.appendChild(statGrid([
    ["Registered items", entries.length],
    ...Object.entries(byKind).map(([k, n]) => [k, n]),
  ]));

  const filter = selectOf(["all", ...Object.keys(byKind)], "all");
  const table = el("div", "research-table");
  box.append(field("Kind", filter), row(button("Export inventory CSV", async () => {
    await saveTable("exports/data-inventory.csv",
      ["name", "kind", "source", "path", "added_at"],
      entries.map((e) => [`"${e.name}"`, e.kind, `"${e.source || ""}"`, e.path, e.added_at]),
      "Data Hub", "export");
    say("Saved exports/data-inventory.csv.");
  })), table);

  function draw() {
    table.textContent = "";
    const head = el("div", "research-table-row is-head");
    ["Name", "Kind", "Source", "Path", "Added"].forEach((h) =>
      head.appendChild(el("span", null, h)));
    table.appendChild(head);
    entries
      .filter((e) => filter.value === "all" || e.kind === filter.value)
      .forEach((e) => {
        const line = el("div", "research-table-row");
        [e.name, e.kind, e.source || "—", e.path || "—", (e.added_at || "").slice(0, 10)]
          .forEach((v) => line.appendChild(el("span", null, String(v))));
        table.appendChild(line);
      });
  }
  filter.addEventListener("change", draw);
  draw();
  if (!entries.length) {
    box.appendChild(el("p", "research-note",
      "Nothing registered yet. Imports on the GIS page, pulls on Fetch Data and "
      + "anything saved from an analysis page all land here."));
  }
  say(`${entries.length} item(s).`);
  host.append(box, status);
});

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
