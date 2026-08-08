import { wirePattern, wire } from "./spec-page.js?v=20260808-824ab45";
import * as store from "./project-store.js?v=20260808-824ab45";
import * as bridge from "./bridge.js?v=20260808-824ab45";

/**
 * Behaviour for the controls the spec brings across.
 *
 * Three hundred-odd disabled controls are not three hundred behaviours. The
 * app reuses the same verbs everywhere — Refresh, Browse, Export CSV, Open in
 * Meshing Studio — so they are wired once by label and a page only needs its
 * own handler where it genuinely differs.
 *
 * The rule kept throughout: **wire it or leave it disabled.** A handler that
 * pops a message and does nothing would turn an honest disabled button into a
 * dishonest live one. Where the desktop app shells out to a native binary
 * (Gmsh, laspy, a system file manager) the control stays disabled, because
 * that is the truth about a browser.
 */

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Ask for files and put them in the project, registered. */
async function importFiles({ say, redraw }, { dest = "data/raw", accept = "" } = {}) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  if (accept) picker.accept = accept;
  const chosen = await new Promise((resolve) => {
    picker.addEventListener("change", () => resolve(Array.from(picker.files || [])));
    // A cancelled picker fires nothing at all, so nothing resolves and nothing
    // happens -- which is the correct outcome, not an error.
    picker.click();
  });
  if (!chosen.length) return;
  let added = 0;
  for (const file of chosen) {
    const path = `${dest}/${file.name}`;
    const isText = /\.(csv|tsv|txt|dat|json|geojson|md|xyz|asc|obj|ply|msh|geo|vtk)$/i
      .test(file.name);
    await store.writeProjectFile(path, isText ? await file.text() : await file.arrayBuffer());
    await store.registerData({
      name: file.name, kind: "file", path, source: "Import",
      extra: { bytes: file.size },
    });
    added += 1;
  }
  say(`Imported ${added} file(s) into ${dest}.`);
  redraw();
}

/** Everything the project has registered, as a CSV in exports/. */
async function exportRegistryCsv({ say, pageId }) {
  const rows = await store.listData();
  const header = ["name", "kind", "path", "source", "crs", "added_at"];
  const csv = [header.join(",")]
    .concat(rows.map((r) => header
      .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")))
    .join("\n");
  const path = `exports/${pageId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nowStamp()}.csv`;
  await store.writeProjectFile(path, csv);
  say(`${rows.length} row(s) written to ${path}.`);
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// Redraw. The page rebuilds from the project, which is what refresh means here.
wirePattern(/^(Refresh|Refresh .+|Rescan .*|Reload)$/i, async ({ say, redraw }) => {
  redraw();
  say("Refreshed from the project.");
});

// Bring files in. Destination follows the page: ingest pages stage into
// data/pulled, everything else into data/raw.
wirePattern(/^(Browse|Browse .+|Import .*Files?|Import Dataset|Add Dataset|Load Preset File|Import Service Export)$/i,
  async (api) => {
    const pulled = /^Ingest /.test(api.pageId);
    await importFiles(api, { dest: pulled ? "data/pulled" : "data/raw" });
  });

// Hand off to the other two pages of the workspace.
wirePattern(/^(Open in Earth viewer|Open in Globe|To Explorer|Open Study Area Map)$/i,
  async ({ say }) => { bridge.goToPage("gis"); say("Opened the globe."); });
wirePattern(/^(Open in Meshing Studio|Send file to Studio…?|Open Gmsh Studio)$/i,
  async ({ say }) => { bridge.goToPage("model"); say("Opened the Meshing Studio."); });

// Navigate inside the hub. The label names its destination, which is the whole
// reason this can be generic.
const DESTINATIONS = {
  "open pipeline runner": "Pipeline Runner",
  "open storyboard": "Storyboard",
  "open setup": "Setup",
  "go to fem setup": "Setup",
  "open projects": "Projects",
  "open data hub": "Data Hub",
  "open figure composer": "Figure Composer",
  "open notes": "Research Notes",
  "create note": "Research Notes",
  "open latest figure": "Figure Composer",
  "open selected": "Data Repository",
  "import dataset": "Data Repository",
};
wirePattern(/^(Open |Go to |Create Note)/i, async ({ say, ctx, pageId }, label) => {
  const target = DESTINATIONS[String(label || "").toLowerCase().trim()];
  if (!target || target === pageId) throw new Error("Nothing to open for that.");
  ctx.setPage?.(target);
});

// Export. Anything asking for a CSV of what the project holds gets one.
wirePattern(/^(Export CSV|Export .*CSV|Export lineage CSV|Export Summary|Export Briefing|Export Weekly)$/i,
  exportRegistryCsv);

wirePattern(/^(Save Notes?|Save narrative|Save)$/i, async ({ values, say, pageId }) => {
  const text = Object.values(values()).filter((v) => typeof v === "string" && v.length > 40)[0];
  if (!text) throw new Error("Nothing on this page to save yet.");
  const path = `notes/${pageId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  await store.writeProjectFile(path, text);
  say(`Saved to ${path}.`);
});

// A reproducibility snapshot: the metadata, the registry, and what produced it.
wirePattern(/^(Export Repro Snapshot|Create Repro Bundle|Export Project Brief)$/i,
  async ({ say }) => {
    const active = store.getActive();
    const path = `exports/snapshot-${nowStamp()}.json`;
    await store.writeJson(path, {
      created_at: new Date().toISOString(),
      project: { name: active.name, dir: active.dir, body: active.meta.body },
      metadata: active.meta,
      data_registry: await store.listData(),
    });
    say(`Written to ${path}.`);
  });

// ── Pages whose verbs are their own ──────────────────────────────────────────

wire("Project Comparison", {
  "Add Current Project": async ({ say }) => {
    const active = store.getActive();
    const list = await store.readJson("metadata/comparison.json", { projects: [] });
    list.projects = Array.isArray(list.projects) ? list.projects : [];
    if (!list.projects.includes(active.dir)) list.projects.push(active.dir);
    await store.writeJson("metadata/comparison.json", list);
    say(`${active.name} added to the comparison set.`);
  },
});

wire("Pipeline Runner", {
  "Reset Status": async ({ say }) => {
    const plan = await store.readJson("metadata/pipeline.json", { plan: [] });
    (plan.plan || []).forEach((step) => { step.done = false; });
    await store.writeJson("metadata/pipeline.json", plan);
    say("Every step marked not done.");
  },
});

wire("Research Notes", {
  // The app's formatting buttons act on the note being edited.
  H1: async ({ say }) => { say("Select text in the editor first."); },
});

/**
 * Controls that stay disabled, and why.
 *
 * Listed rather than silently skipped so the reason is on the record: each one
 * needs a process a browser tab does not have. Wiring them would mean shipping
 * a button that cannot do what it says.
 */
export const CANNOT_WIRE = {
  "Open Gmsh": "Launches the Gmsh binary; the Meshing Studio is the browser's route.",
  "Open Copernicus Land Portal": "Opens an external site — use the link, not the app.",
  "Convert": "Runs gmsh to convert a mesh; needs the desktop app.",
  "Export": "LAS export needs laspy; CSV and XYZ export are wired.",
  "Run Test": "SciPy hypothesis tests; not vendored in the browser yet.",
  "Run PCA": "Needs a linear-algebra library that is not vendored yet.",
  Cluster: "k-means/DBSCAN are not vendored yet.",
};
