import { registerPage } from "../stages.js?v=20260830-810aa22";
import * as store from "../project-store.js?v=20260830-810aa22";
import * as bridge from "../bridge.js?v=20260830-810aa22";
import { currentBody, currentBodyId } from "../../bodies.js?v=20260830-810aa22";
import {
  el, card, field, input, textarea, selectOf, button, row, statusLine,
  pageHeader, splitPanes, tabbedPanel, editorCard, editorHero, fieldGrid,
  slider, editTable,
} from "./common.js?v=20260830-810aa22";

/**
 * Projects, laid out as `GeoIDProjectsPage` lays it out (app_qt.py:4570):
 * a page title, then a splitter with **Workspace** on the left (Projects,
 * Command Center, Activity) and **Project Editor** on the right (Profile,
 * Planning, Study Area, Review, Pipeline).
 *
 * Every field is the Qt field, in the Qt tab, with the Qt placeholder — the
 * point of matching the app is that someone who knows one knows the other, and
 * that breaks the moment a field moves.
 *
 * The one addition Qt has no need of: choosing where projects live. The desktop
 * app has a fixed directory; a browser has to be told. It sits at the top of
 * the Workspace tab, small, because it is a once-per-machine act.
 */

const PROJECT_TEMPLATES = [
  "Custom", "Earthquake study", "Volcanic monitoring", "Weather ML",
  "Single Plot", "Data QA", "Full Event Pipeline",
];
const PHASES = [
  "Scoping", "Data Assembly", "Preprocessing", "Modeling",
  "Validation", "Interpretation", "Publication",
];
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const MILESTONE_STATUS = ["Planned", "In progress", "Blocked", "Done"];

const lines = (value) => (Array.isArray(value) ? value.join("\n") : String(value || ""));
const toLines = (text) => String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);

async function mount(host, ctx) {
  const { node: status, say } = statusLine();
  const support = store.folderSupport();
  let meta = store.getActive()?.meta || null;
  // The editor writes into this and "Save Project Details" persists it, which
  // is how the Qt form behaves -- typing is not a write.
  const draft = meta ? JSON.parse(JSON.stringify(meta)) : null;

  const refreshAll = () => { host.textContent = ""; void mount(host, ctx); };

  // ── Left: Workspace ───────────────────────────────────────────────────────

  function workspaceProjects() {
    const wrap = el("div");
    const root = store.getRoot();

    // Where projects live. Compact, and only loud when it is the thing
    // stopping you.
    const where = el("div", "workspace-root");
    where.appendChild(el("span", "research-field-label", "Projects folder"));
    where.appendChild(el("p", "research-note", root
      ? (root.kind === "indexeddb"
        ? "Kept in this browser — the desktop app cannot see these."
        : `Using "${root.name}".`)
      : "Not chosen yet."));
    const whereRow = row();
    const choose = button(root ? "Change…" : "Choose folder…", async () => {
      try { await store.chooseRoot(); refreshAll(); } catch (error) {
        if (error.name !== "AbortError") say(error.message, true);
      }
    }, { secondary: true });
    choose.classList.add("small");
    choose.disabled = !support.ok;
    whereRow.appendChild(choose);
    if (typeof indexedDB !== "undefined" && root?.kind !== "indexeddb") {
      const inBrowser = button("Use this browser", async () => {
        try { await store.useBrowserStorage(); refreshAll(); } catch (error) { say(error.message, true); }
      }, { secondary: true });
      inBrowser.classList.add("small");
      whereRow.appendChild(inBrowser);
    }
    where.appendChild(whereRow);
    if (!support.ok && !root) {
      where.appendChild(el("p", "research-note is-error",
        support.reason === "insecure-origin"
          ? `Served from ${support.origin}, which is not a secure origin — `
            + `open it at ${support.hint}, or use this browser.`
          : "This browser has no folder picker — Chrome and Edge only."));
    }
    wrap.appendChild(where);

    // The list.
    const list = el("div", "workspace-list");
    let selected = store.getActive()?.dir || null;
    const paint = async () => {
      list.textContent = "";
      if (!root) {
        list.appendChild(el("p", "research-note", "Choose where projects live to see them."));
        return;
      }
      const dirs = await store.listProjects(null);
      if (!dirs.length) {
        list.appendChild(el("p", "research-note", "No projects yet."));
      }
      dirs.forEach((dir) => {
        const parts = dir.split("/");
        const line = el("button", "workspace-row");
        line.type = "button";
        line.classList.toggle("is-selected", dir === selected);
        line.appendChild(el("span", "workspace-row-name", parts[parts.length - 1]));
        if (parts.length > 1) line.appendChild(el("span", "research-list-tag", parts[0]));
        if (store.getActive()?.dir === dir) {
          line.appendChild(el("span", "research-list-tag", "open"));
        }
        line.addEventListener("click", async () => {
          selected = dir;
          try {
            await store.openProject(dir);
            // The hub re-mounts the page when a different project opens, so
            // the editor on the right refills by itself.
          } catch (error) { say(error.message, true); }
        });
        list.appendChild(line);
      });
    };
    void paint();
    wrap.appendChild(list);

    // app_qt.py:4609 — + New Project | Delete | Refresh | Open Folder.
    const actions = row();
    const newBtn = button("+ New Project", async () => {
      const name = window.prompt("Project name:");
      if (!name?.trim()) return;
      try {
        await store.createProject(name.trim(), { body: currentBodyId() });
        say(`Created "${name.trim()}".`);
      } catch (error) { say(error.message, true); }
    });
    newBtn.classList.add("accent");
    newBtn.disabled = !root;
    const delBtn = button("Delete", async () => {
      if (!selected) { say("Select a project first.", true); return; }
      if (!window.confirm(`Delete "${selected}" and everything in it?`)) return;
      try {
        await root.remove(selected);
        if (store.getActive()?.dir === selected) store.closeProject();
        selected = null;
        say("Deleted.");
        await paint();
      } catch (error) { say(error.message, true); }
    }, { secondary: true });
    delBtn.disabled = !root;
    const refreshBtn = button("Refresh", () => { void paint(); say("Refreshed."); }, { secondary: true });
    refreshBtn.disabled = !root;
    // Qt opens a file manager. A browser cannot, so this reports the path --
    // which is the part you actually wanted when you clicked it.
    const openBtn = button("Open Folder", () => {
      if (!root) return;
      say(root.kind === "indexeddb"
        ? "Kept in this browser; there is no folder to open."
        : `geoid_projects/${selected || ""} inside "${root.name}".`);
    }, { secondary: true });
    openBtn.disabled = !root;
    actions.append(newBtn, delBtn, refreshBtn, openBtn);
    wrap.appendChild(actions);
    return wrap;
  }

  function workspaceCommandCentre() {
    const wrap = el("div");
    wrap.appendChild(el("p", "research-note",
      "What this project is and what it holds, at a glance."));
    const log = el("pre", "qt-console");
    const active = store.getActive();
    if (!active) {
      log.textContent = "No project open.";
    } else {
      void (async () => {
        const data = await store.listData();
        const counts = data.reduce((acc, e) => {
          acc[e.kind] = (acc[e.kind] || 0) + 1; return acc;
        }, {});
        log.textContent = [
          `project   ${active.name}`,
          `folder    ${active.dir}`,
          `world     ${active.meta.body || "earth"}`,
          `phase     ${active.meta.phase}   priority ${active.meta.priority}`,
          `progress  ${active.meta.progress_pct ?? 0}%`,
          `created   ${(active.meta.created_at || "").slice(0, 19).replace("T", " ")}`,
          `updated   ${(active.meta.updated_at || "").slice(0, 19).replace("T", " ")}`,
          "",
          `registered data (${data.length})`,
          ...Object.entries(counts).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`),
          "",
          `next actions (${(active.meta.next_actions || []).length})`,
          ...(active.meta.next_actions || []).map((a) => `  · ${a}`),
        ].join("\n");
      })();
    }
    wrap.appendChild(log);
    return wrap;
  }

  function workspaceActivity() {
    const wrap = el("div");
    wrap.appendChild(el("p", "research-note",
      "Everything registered against this project, newest first."));
    const list = el("div", "research-list");
    wrap.appendChild(list);
    void (async () => {
      const entries = (await store.listData()) || [];
      if (!entries.length) {
        list.appendChild(el("p", "research-note", "Nothing yet."));
        return;
      }
      entries.slice().reverse().forEach((entry) => {
        const line = el("div", "research-list-row");
        line.append(
          el("span", "research-list-name", `${entry.source || "import"} — ${entry.path || entry.name}`),
          el("span", "research-list-tag",
            (entry.added_at || "").slice(0, 16).replace("T", " ")));
        list.appendChild(line);
      });
    })();
    return wrap;
  }

  const workspace = tabbedPanel("Workspace", {
    Projects: workspaceProjects,
    "Command Center": workspaceCommandCentre,
    Activity: workspaceActivity,
  });

  // ── Right: Project Editor ─────────────────────────────────────────────────

  function noProjectPanel() {
    const box = el("div");
    box.appendChild(el("p", "research-note",
      "No project open. Select one on the left, or create one."));
    return box;
  }

  function profileTab() {
    if (!draft) return noProjectPanel();
    const wrap = el("div");

    // app_qt.py:4717 — EditorHero: the name, the Atlas sync, then phase,
    // priority and progress in one glanceable row.
    const hero = editorHero();
    const name = input(draft.name, "Untitled project");
    name.classList.add("hero-name");
    name.addEventListener("input", () => { draft.name = name.value; });
    const sync = button("◈ Sync with Atlas", () => {
      say("Atlas sync needs the desktop hub; this page has none to reach.", true);
    }, { secondary: true });
    sync.classList.add("atlas-sync");
    sync.title = "Create or switch the matching Atlas project — needs the "
      + "desktop hub, which a static page cannot reach.";
    const heroTop = el("div", "editor-hero-top");
    heroTop.append(name, sync);
    hero.appendChild(heroTop);

    const phase = selectOf(PHASES, draft.phase);
    phase.addEventListener("change", () => { draft.phase = phase.value; });
    const priority = selectOf(PRIORITIES, draft.priority);
    priority.addEventListener("change", () => { draft.priority = priority.value; });
    const progress = slider(draft.progress_pct ?? 5, (v) => { draft.progress_pct = v; });
    hero.appendChild(fieldGrid(3,
      field("Phase", phase), field("Priority", priority), field("Progress", progress)));
    wrap.appendChild(hero);

    const ident = editorCard("Identity");
    const description = textarea(draft.description, 3, "What is this study about?");
    description.addEventListener("input", () => { draft.description = description.value; });
    ident.appendChild(field("Description", description));
    const collaborators = input(lines(draft.collaborators).replace(/\n/g, ", "), "");
    collaborators.addEventListener("input", () => {
      draft.collaborators = collaborators.value.split(",").map((s) => s.trim()).filter(Boolean);
    });
    const tags = input(lines(draft.tags).replace(/\n/g, ", "), "volcano, etna, overpressure…");
    tags.addEventListener("input", () => {
      draft.tags = tags.value.split(",").map((s) => s.trim()).filter(Boolean);
    });
    const focus = input(draft.focus_question, "The one question this project answers");
    focus.addEventListener("input", () => { draft.focus_question = focus.value; });
    const template = selectOf(PROJECT_TEMPLATES, draft.template || "Custom");
    template.addEventListener("change", () => { draft.template = template.value; });
    ident.appendChild(fieldGrid(2,
      field("Collaborators", collaborators), field("Tags", tags),
      field("Focus question", focus), field("Template", template)));
    wrap.appendChild(ident);

    const area = editorCard("Study area — drawn on the compass and framed by the GIS globe");
    const bounds = draft.study_area || {};
    const mk = (key, label) => {
      const box = input(bounds[key] ?? "", "");
      box.addEventListener("input", () => {
        draft.study_area = { ...draft.study_area, [key]: box.value };
      });
      return field(label, box);
    };
    area.appendChild(fieldGrid(4,
      mk("min_lat", "Min latitude"), mk("max_lat", "Max latitude"),
      mk("min_lon", "Min longitude"), mk("max_lon", "Max longitude")));
    area.appendChild(fieldGrid(4, mk("crs", "CRS")));
    wrap.appendChild(area);
    return wrap;
  }

  function planningTab() {
    if (!draft) return noProjectPanel();
    const wrap = el("div");
    const box = editorCard("Research Planner");
    const mk = (key, label, rows) => {
      const area = textarea(lines(draft[key]), rows, "");
      area.addEventListener("input", () => { draft[key] = toLines(area.value); });
      return field(label, area);
    };
    box.append(
      mk("next_actions", "Next actions (one per line)", 3),
      mk("risks", "Risks / caveats (one per line)", 3),
      mk("decisions", "Key decisions / assumptions (one per line)", 3),
    );

    draft.milestones = Array.isArray(draft.milestones) ? draft.milestones : [];
    box.appendChild(el("span", "research-field-label", "Milestones"));
    const table = editTable(["Title", "Due", "Status"], draft.milestones,
      (node, milestone, index, draw) => {
        const title = input(milestone.title || "", "");
        title.addEventListener("input", () => { milestone.title = title.value; });
        const due = input(milestone.due || "", "YYYY-MM-DD");
        due.addEventListener("input", () => { milestone.due = due.value; });
        const state = selectOf(MILESTONE_STATUS, milestone.status || "Planned");
        state.addEventListener("change", () => { milestone.status = state.value; });
        node.append(title, due, state);
      });
    box.appendChild(table.node);
    box.appendChild(row(
      button("Add Milestone", () => {
        draft.milestones.push({ title: "", due: "", status: "Planned" });
        table.draw();
      }, { secondary: true }),
      button("Remove Milestone", () => {
        draft.milestones.pop();
        table.draw();
      }, { secondary: true }),
    ));
    wrap.appendChild(box);
    return wrap;
  }

  function studyAreaTab() {
    if (!draft) return noProjectPanel();
    const wrap = el("div");
    const box = editorCard("Study Area Compass");
    const area = draft.study_area || {};
    // Number("") is 0 and Number.isFinite(0) is true, so an untouched project
    // read as bounds at the origin. Check the field is filled before trusting
    // what it parses to.
    const keys = ["min_lat", "max_lat", "min_lon", "max_lon"];
    const drawn = keys.every((k) => String(area[k] ?? "").trim() !== ""
      && Number.isFinite(Number(area[k])));
    const nums = keys.map((k) => Number(area[k]));

    // Qt paints a compass; here the globe is one click away and can show the
    // real thing, so this is a plain plate-carrée locator rather than a second
    // rendering of the planet.
    const canvas = document.createElement("canvas");
    canvas.width = 480; canvas.height = 240;
    canvas.className = "compass-canvas";
    const g = canvas.getContext("2d");
    const skin = getComputedStyle(document.getElementById("research-hub"));
    g.strokeStyle = skin.getPropertyValue("--atlas-border").trim() || "#555";
    g.lineWidth = 1;
    for (let x = 0; x <= 480; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 240); g.stroke(); }
    for (let y = 0; y <= 240; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(480, y); g.stroke(); }
    g.strokeStyle = skin.getPropertyValue("--atlas-data").trim() || "#0ff";
    g.beginPath(); g.moveTo(0, 120); g.lineTo(480, 120); g.stroke();
    if (drawn) {
      const [minLat, maxLat, minLon, maxLon] = nums;
      const x = (lon) => ((lon + 180) / 360) * 480;
      const y = (lat) => ((90 - lat) / 180) * 240;
      g.strokeStyle = skin.getPropertyValue("--atlas-chrome").trim() || "#f0f";
      g.lineWidth = 2;
      g.strokeRect(x(minLon), y(maxLat), x(maxLon) - x(minLon), y(minLat) - y(maxLat));
    }
    box.appendChild(canvas);
    box.appendChild(el("p", "research-note", drawn
      ? `Bounds summary: ${nums[0]}..${nums[1]} lat, ${nums[2]}..${nums[3]} lon `
        + `(${area.crs || "EPSG:4326"}).`
      : "Bounds summary: -"));
    box.appendChild(row(
      button("Open Study Area Map", () => {
        if (bridge.frameStudyArea()) { bridge.goToPage("gis"); }
        else say("This project has no study area bounds yet.", true);
      }, { secondary: true }),
      button("Capture from the globe", async () => {
        try {
          const b = await bridge.captureStudyArea();
          Object.assign(draft.study_area, b);
          say(`Study area set to ${b.min_lat}..${b.max_lat}, ${b.min_lon}..${b.max_lon}.`);
          refreshAll();
        } catch (error) { say(error.message, true); }
      }, { secondary: true }),
      // The other direction: the area becomes the ground a model is built on,
      // with the globe's own terrain under it.
      button("Send to Meshing Studio", async () => {
        try {
          const result = await bridge.sendToStudio(draft.study_area);
          say(result.terrain
            ? `Studio anchored at ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)} on real terrain.`
            : `Studio anchored at ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}.`);
        } catch (error) { say(error.message, true); }
      }, { secondary: true }),
    ));
    wrap.appendChild(box);

    const timeline = editorCard("Milestone Timeline");
    const rows = (draft.milestones || []).slice()
      .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")));
    if (!rows.length) {
      timeline.appendChild(el("p", "research-note", "No milestones yet — add them under Planning."));
    } else {
      const t = el("div", "qt-table");
      t.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      ["Due", "Milestone", "Status"].forEach((h) => t.appendChild(el("span", "qt-table-head", h)));
      rows.forEach((m) => {
        t.append(el("span", null, m.due || "—"), el("span", null, m.title || "—"),
          el("span", null, m.status || "Planned"));
      });
      timeline.appendChild(t);
    }
    wrap.appendChild(timeline);
    return wrap;
  }

  function reviewTab() {
    if (!draft) return noProjectPanel();
    const wrap = el("div");
    const view = textarea(JSON.stringify(draft, null, 2), 18, "");
    view.readOnly = true;
    view.classList.add("qt-console");
    wrap.appendChild(view);
    wrap.appendChild(row(
      button("Save Project Details", async () => {
        try {
          await store.updateMetadata(draft);
          say("Saved to metadata/project.json.");
        } catch (error) { say(error.message, true); }
      }),
      button("Export Project Brief", async () => {
        const brief = [
          `# ${draft.name}`, "",
          draft.description || "", "",
          `- World: ${draft.body || "earth"}`,
          `- Phase: ${draft.phase} · Priority: ${draft.priority} · ${draft.progress_pct ?? 0}%`,
          `- Focus question: ${draft.focus_question || "—"}`,
          `- Tags: ${lines(draft.tags).replace(/\n/g, ", ") || "—"}`,
          "", "## Next actions",
          ...(draft.next_actions || []).map((a) => `- ${a}`),
          "", "## Risks", ...(draft.risks || []).map((a) => `- ${a}`),
          "", "## Decisions", ...(draft.decisions || []).map((a) => `- ${a}`),
        ].join("\n");
        try {
          await store.writeProjectFile("plans/reports/project-brief.md", brief);
          say("Written to plans/reports/project-brief.md.");
        } catch (error) { say(error.message, true); }
      }, { secondary: true }),
    ));
    return wrap;
  }

  function pipelineTab() {
    if (!draft) return noProjectPanel();
    const wrap = el("div");
    const box = editorCard("Pipeline Builder");
    draft.pipeline_config = draft.pipeline_config && typeof draft.pipeline_config === "object"
      ? draft.pipeline_config : {};
    // The stages are the rail's own, so the builder cannot drift from what the
    // hub actually offers.
    const STAGES_IN_ORDER = [
      "Data Puller", "AI trainer", "Preprocessing", "FEM model",
      "Postprocessing and Signal Analysis", "GIS Explorer", "StoryBoard",
    ];
    const order = Array.isArray(draft.pipeline_config.order)
      ? draft.pipeline_config.order.filter((s) => STAGES_IN_ORDER.includes(s))
      : STAGES_IN_ORDER.slice();
    STAGES_IN_ORDER.forEach((s) => { if (!order.includes(s)) order.push(s); });
    const enabled = draft.pipeline_config.enabled || {};

    let picked = null;
    const table = editTable(["Stage", "Enabled"], order, (node, stage, index, draw) => {
      const label = el("button", "qt-table-cell", stage);
      label.type = "button";
      label.classList.toggle("is-selected", picked === index);
      label.addEventListener("click", () => { picked = index; draw(); });
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = enabled[stage] !== false;
      tick.addEventListener("change", () => { enabled[stage] = tick.checked; });
      node.append(label, tick);
    });
    box.appendChild(table.node);

    const move = (delta) => {
      if (picked == null) { say("Select a stage first.", true); return; }
      const next = picked + delta;
      if (next < 0 || next >= order.length) return;
      [order[picked], order[next]] = [order[next], order[picked]];
      picked = next;
      table.draw();
    };
    box.appendChild(row(
      button("Move Up", () => move(-1), { secondary: true }),
      button("Move Down", () => move(1), { secondary: true }),
      button("Apply Pipeline", async () => {
        draft.pipeline_config = { order, enabled };
        try {
          await store.updateMetadata({ pipeline_config: draft.pipeline_config });
          say("Pipeline saved to metadata/project.json.");
        } catch (error) { say(error.message, true); }
      }),
      button("Export Preset", async () => {
        try {
          await store.writeJson("metadata/pipeline_preset.json", { order, enabled });
          say("Written to metadata/pipeline_preset.json.");
        } catch (error) { say(error.message, true); }
      }, { secondary: true }),
      button("Import Preset", async () => {
        const preset = await store.readJson("metadata/pipeline_preset.json", null);
        if (!preset) { say("No metadata/pipeline_preset.json in this project.", true); return; }
        draft.pipeline_config = preset;
        say("Preset loaded — Apply Pipeline to keep it.");
        refreshAll();
      }, { secondary: true }),
    ));
    wrap.appendChild(box);
    return wrap;
  }

  const editor = tabbedPanel("Project Editor", {
    Profile: profileTab,
    Planning: planningTab,
    "Study Area": studyAreaTab,
    Review: reviewTab,
    Pipeline: pipelineTab,
  });

  // Saving is on Review in Qt, but it applies to every tab, so it is also a
  // footer here -- typing into Planning and losing it to a tab change would be
  // the app's behaviour reproduced as a bug.
  const save = button("Save Project Details", async () => {
    if (!draft) { say("No project open.", true); return; }
    try {
      await store.updateMetadata(draft);
      say("Saved to metadata/project.json.");
    } catch (error) { say(error.message, true); }
  });
  save.disabled = !draft;

  host.append(
    pageHeader("Projects",
      "Every study this workspace holds, and everything the open one records "
      + "about itself.",
      store.getActive()?.name || "No project"),
    splitPanes(workspace, editor),
    row(save),
    status,
  );
}

mount.ownHeader = true;   // draws its own "Projects" title
mount.specComplete = true;
registerPage("Projects", { mount });
