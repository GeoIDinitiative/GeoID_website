import { registerPage } from "../stages.js?v=20260816-d38eab1";
import * as store from "../project-store.js?v=20260816-d38eab1";
import * as bridge from "../bridge.js?v=20260816-d38eab1";
import { parseTable } from "../table.js?v=20260816-d38eab1";
import {
  el, input, button, row, selectOf, field, statusLine, needProject,
  pageHeader, toolbar, inlineLabel, collapsible, dataTable, console_,
} from "./common.js?v=20260816-d38eab1";

/**
 * Data Repository, laid out as `GeoIDDataRepoPage` does (app_qt.py:5487):
 * a header with the project pill, a toolbar, then the tree, with the
 * secondary work — destination, compare, health, watcher — folded into
 * collapsible sections.
 *
 * The folding is the design, not decoration. The Qt page has eight sections
 * and opens two; unfolded, it is a very long form and nothing is findable.
 */

const DESTINATIONS = ["data/raw", "data/processed", "data/external", "data/pulled"];
const TAGS = ["test", "queued", "main"];

/** Directories worth walking. The rest of the tree is empty scaffolding. */
const TREE_ROOTS = [
  "data", "signals", "meshes", "fem_runs", "post_processing",
  "exports", "figures", "notes", "plans", "analysis", "metadata",
];

function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function mount(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Data Repository"); return; }
  const { node: status, say } = statusLine();
  const active = store.getActive();

  const header = pageHeader(
    "Preprocessing Workspace",
    "Everything this project holds, where it came from, and whether it is fit "
    + "to use downstream.",
    active.name,
  );
  header.pill.classList.add("is-open");

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const tagPick = selectOf(TAGS, "main");
  tagPick.title = "Tag applied to newly imported files";
  const destPick = selectOf(DESTINATIONS, "data/raw");

  const file = document.createElement("input");
  file.type = "file";
  file.multiple = true;
  file.hidden = true;
  file.addEventListener("change", async () => {
    const picked = Array.from(file.files || []);
    if (!picked.length) return;
    let added = 0;
    for (const item of picked) {
      const path = `${destPick.value}/${item.name}`;
      try {
        // Text goes in as text so it is readable by every other page; anything
        // else keeps its bytes.
        const isText = /\.(csv|tsv|txt|dat|json|geojson|md|xyz|asc|obj|ply|msh)$/i
          .test(item.name);
        await store.writeProjectFile(path, isText ? await item.text() : await item.arrayBuffer());
        await store.registerData({
          name: item.name,
          kind: "file",
          path,
          source: "Data Repository",
          extra: { tag: tagPick.value, bytes: item.size },
        });
        added += 1;
      } catch (error) {
        say(`${item.name}: ${error.message}`, true);
      }
    }
    file.value = "";
    if (added) { say(`Imported ${added} file(s) into ${destPick.value}.`); redraw(); }
  });

  const addBtn = button("+ Add Dataset", () => file.click());
  addBtn.classList.add("accent");
  addBtn.title = "Import a file into the project registry";
  const refreshBtn = button("Refresh", () => { redraw(); say("Rescanned."); }, { secondary: true });

  let selected = null;   // { path, name, bytes }

  const promote = button("Promote → main", async () => {
    if (!selected) { say("Select a file in the tree first.", true); return; }
    try {
      const target = `data/processed/${selected.name}`;
      await store.writeProjectFile(target, await store.readProjectFile(selected.path));
      await store.registerData({
        name: selected.name, kind: "file", path: target,
        source: "Data Repository", extra: { tag: "main", promoted_from: selected.path },
      });
      say(`Promoted to ${target} and tagged main.`);
      redraw();
    } catch (error) { say(error.message, true); }
  }, { secondary: true });

  const clone = button("Clone → test", async () => {
    if (!selected) { say("Select a file in the tree first.", true); return; }
    try {
      const stem = selected.name.replace(/(\.[^.]+)$/, "");
      const ext = (selected.name.match(/\.[^.]+$/) || [""])[0];
      const target = `data/raw/${stem}-test${ext}`;
      await store.writeProjectFile(target, await store.readProjectFile(selected.path));
      await store.registerData({
        name: `${stem}-test${ext}`, kind: "file", path: target,
        source: "Data Repository", extra: { tag: "test", cloned_from: selected.path },
      });
      say(`Cloned to ${target}.`);
      redraw();
    } catch (error) { say(error.message, true); }
  }, { secondary: true });

  const showOnGlobe = button("◉ Show on globe", async () => {
    if (!selected) { say("Select a file in the tree first.", true); return; }
    if (!bridge.isGeoFile(selected.path)) {
      say(`${selected.name} is not a spatial file the globe can place.`, true); return;
    }
    try {
      await bridge.sendToGlobe(selected);
      say(`Showing ${selected.name} on the globe.`);
    } catch (error) { say(error.message, true); }
  }, { secondary: true });

  const spacer = el("span", "spacer");
  const bar = toolbar(addBtn, inlineLabel("Tag:"), tagPick, promote, clone, showOnGlobe, spacer, refreshBtn);

  // ── Destination (folded) ──────────────────────────────────────────────────
  const dest = collapsible("File destination");
  dest.body.appendChild(el("p", "research-note",
    "Where + Add Dataset writes. Registered either way, so the choice is about "
    + "what the folder means, not whether the file is found."));
  dest.body.appendChild(field("Destination folder", destPick));

  // ── The tree ──────────────────────────────────────────────────────────────
  const tree = el("div", "repo-tree");
  const preview = console_("", "Select a file in the tree to preview its schema and sample rows.");

  async function showPreview(entry) {
    selected = entry;
    Array.from(tree.querySelectorAll(".repo-file")).forEach((b) =>
      b.classList.toggle("is-selected", b.dataset.path === entry.path));
    try {
      const raw = await store.readProjectFile(entry.path);
      if (typeof raw !== "string") {
        preview.classList.remove("is-placeholder");
        const size = humanSize(entry.bytes);
        preview.textContent = `${entry.path}\n${size ? `${size} — ` : ""}binary, no text preview.`;
        return;
      }
      preview.classList.remove("is-placeholder");
      if (/\.(csv|tsv|txt|dat)$/i.test(entry.name)) {
        const table = parseTable(raw);
        const head = table.rows.slice(0, 8)
          .map((r) => r.map((c) => String(c).slice(0, 14).padEnd(14)).join(""));
        preview.textContent = [
          `${entry.path}`,
          `${table.rows.length} rows × ${table.columns.length} columns`,
          "",
          table.columns.map((c) => String(c).slice(0, 14).padEnd(14)).join(""),
          table.columns.map(() => "─".repeat(13) + " ").join(""),
          ...head,
        ].join("\n");
      } else {
        preview.textContent = `${entry.path}\n\n${raw.slice(0, 1200)}`;
      }
    } catch (error) {
      preview.textContent = `Could not read ${entry.path}: ${error.message}`;
    }
  }

  async function buildTree() {
    tree.textContent = "";
    let any = false;
    for (const rootName of TREE_ROOTS) {
      const node = await buildDir(rootName, rootName);
      if (node) { tree.appendChild(node); any = true; }
    }
    if (!any) {
      tree.appendChild(el("p", "research-note", "This project's folders are all empty."));
    }
  }

  /** One directory, recursively. Returns null when it holds nothing at all, so
   *  the tree shows the project's contents rather than its scaffolding. */
  async function buildDir(path, label) {
    let entries = [];
    try { entries = await store.listProjectDir(path); } catch (error) { return null; }
    const dirs = entries.filter((e) => e.kind === "directory");
    const files = entries.filter((e) => e.kind === "file");
    const children = [];
    for (const dir of dirs) {
      const child = await buildDir(`${path}/${dir.name}`, dir.name);
      if (child) children.push(child);
    }
    if (!children.length && !files.length) return null;

    const box = document.createElement("details");
    box.className = "repo-node repo-dir";
    // Open any branch that leads to a file. Opening only branches with files
    // *directly* in them left data/ shut over data/raw/probes.csv, so the tree
    // looked empty while holding the project's only dataset.
    box.open = files.length > 0 || children.length > 0;
    const head = document.createElement("summary");
    head.append(el("span", null, label),
      el("span", "repo-count", String(files.length + children.length)));
    box.appendChild(head);
    children.forEach((c) => box.appendChild(c));
    files.forEach((entry) => {
      const line = el("button", "repo-file");
      line.type = "button";
      line.dataset.path = `${path}/${entry.name}`;
      line.append(el("span", null, entry.name));
      // The adapters report name and kind only, so a size appears just when a
      // future one supplies it -- never a blank column in the meantime.
      if (Number.isFinite(entry.size)) {
        line.appendChild(el("span", "repo-file-size", humanSize(entry.size)));
      }
      line.addEventListener("click", () => showPreview({
        path: `${path}/${entry.name}`, name: entry.name, bytes: entry.size,
      }));
      box.appendChild(line);
    });
    return box;
  }

  // ── Compare (folded) ──────────────────────────────────────────────────────
  const compare = collapsible("Compare two datasets");
  const aBox = input("", "Dataset A");
  const bBox = input("", "Dataset B");
  const compareOut = console_("", "Pick two tables and compare their shape and columns.");
  const useIn = (target) => button("← Use selected", () => {
    if (!selected) { say("Select a file in the tree first.", true); return; }
    target.value = selected.path;
  }, { secondary: true });
  compare.body.append(
    field("Dataset A", aBox), row(useIn(aBox)),
    field("Dataset B", bBox), row(useIn(bBox)),
    row(button("Compare", async () => {
      try {
        const [a, b] = await Promise.all([
          store.readProjectFile(aBox.value).then(parseTable),
          store.readProjectFile(bBox.value).then(parseTable),
        ]);
        const onlyA = a.columns.filter((c) => !b.columns.includes(c));
        const onlyB = b.columns.filter((c) => !a.columns.includes(c));
        compareOut.classList.remove("is-placeholder");
        compareOut.textContent = [
          `A  ${aBox.value}`,
          `   ${a.rows.length} rows × ${a.columns.length} columns`,
          `B  ${bBox.value}`,
          `   ${b.rows.length} rows × ${b.columns.length} columns`,
          "",
          `rows differ by ${Math.abs(a.rows.length - b.rows.length)}`,
          onlyA.length ? `only in A: ${onlyA.join(", ")}` : "no columns unique to A",
          onlyB.length ? `only in B: ${onlyB.join(", ")}` : "no columns unique to B",
        ].join("\n");
      } catch (error) {
        compareOut.classList.remove("is-placeholder");
        compareOut.textContent = `Could not compare: ${error.message}`;
      }
    })),
    compareOut,
  );

  // ── Health report (folded) ────────────────────────────────────────────────
  const health = collapsible("Health Report");
  const healthOut = console_("", "Run a quality check on the selected dataset.");
  health.body.append(
    row(button("Run Quality Check", async () => {
      if (!selected) { say("Select a file in the tree first.", true); return; }
      try {
        const table = parseTable(await store.readProjectFile(selected.path));
        const report = [`${selected.path}`,
          `${table.rows.length} rows × ${table.columns.length} columns`, ""];
        table.columns.forEach((name, i) => {
          const values = table.rows.map((r) => r[i]);
          const blank = values.filter((v) => v === "" || v == null).length;
          const numeric = values.filter((v) => v !== "" && Number.isFinite(Number(v)));
          const unique = new Set(values).size;
          report.push(
            `${name.slice(0, 18).padEnd(18)} `
            + `${((blank / (values.length || 1)) * 100).toFixed(1).padStart(5)}% null  `
            + `${String(unique).padStart(6)} unique  `
            + `${numeric.length === values.length - blank ? "numeric" : "text"}`);
        });
        const seen = new Set();
        let dupes = 0;
        table.rows.forEach((r) => {
          const key = r.join(" ");
          if (seen.has(key)) dupes += 1; else seen.add(key);
        });
        report.push("", `duplicate rows: ${dupes}`);
        healthOut.classList.remove("is-placeholder");
        healthOut.textContent = report.join("\n");
        await store.writeJson("metadata/qaqc.json", {
          path: selected.path, checked_at: new Date().toISOString(),
          rows: table.rows.length, columns: table.columns.length, duplicates: dupes,
        });
      } catch (error) {
        healthOut.classList.remove("is-placeholder");
        healthOut.textContent = `Could not check: ${error.message}`;
      }
    })),
    healthOut,
  );

  // ── Registered data ───────────────────────────────────────────────────────
  const registered = collapsible("Registered data", { open: true });
  const entries = (await store.listData()) || [];
  if (entries.length) {
    registered.body.appendChild(dataTable(
      ["Name", "Kind", "Path", "Source", "Added"],
      entries.slice().reverse().map((e) => [
        e.name, e.kind, e.path, e.source || "—",
        (e.added_at || "").slice(0, 16).replace("T", " "),
      ]),
    ));
  } else {
    // One empty state, not a header row saying "nothing" above a note saying
    // the same thing differently.
    registered.body.appendChild(el("p", "research-note",
      "Nothing registered yet. Imports on the GIS page land here automatically."));
  }

  const previewSection = collapsible("Dataset preview", { open: true });
  previewSection.body.appendChild(preview);

  function redraw() { host.textContent = ""; void mount(host, ctx); }

  await buildTree();
  host.append(header, bar, file, dest, tree, previewSection, registered,
    health, compare, status);
}

mount.ownHeader = true;   // its Qt title is "Preprocessing Workspace"
registerPage("Data Repository", { mount });
