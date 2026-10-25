/**
 * Publish ▸ Study Area Reports — the risk reader's findings, laid out as a
 * document per study area for somebody to finish.
 *
 * The risk reader on the GIS page reads every hazard map over every study
 * area drawn. This page takes one area's readings, measures the ground they
 * are about (`gatherContext`: elevation off the streamed DEM, the climate
 * normal, what every polygon layer on the globe says under the area, the
 * named places in and around it) and writes the report as Markdown
 * (`study-report.js`), with the reader's own sections — setting, limitations,
 * discussion, recommendations — left as prompts.
 *
 * Kept in the project at `reports/<area>.md`, beside the notes, and a rebuild
 * takes fresh numbers while keeping whatever was written in those sections.
 * A report whose readings have changed since it was built says so.
 *
 * Every door is an existing one: the readings are `GeoIDRiskReader.areas()`,
 * the polygons `studyAreas()`, the places the gazetteer's own file, a save
 * goes through the project store, a print through the browser.
 */

import { registerPage } from "../stages.js?v=20261025-158913d";
import * as store from "../project-store.js?v=20261025-158913d";
import { el, card, button, row, textarea, persistentStatus, splitPanes } from "./common.js?v=20261025-158913d";
import {
  buildReport, mergeWriting, latticeInside, summarise, tally, placesFor, areaGeometry, slug, printableHtml,
  markdownToHtml, readingsSignature,
} from "../study-report.js?v=20261025-158913d";

const PAGE = "Study Area Reports";
const DIR = "reports";
const search = new URL(import.meta.url).search;

/** Which area the risk reader's door asked for, consumed on the next mount. */
let wanted = null;

/** The name a feature gives itself, whatever the layer calls the column. */
function unitName(props = {}) {
  for (const key of ["name", "NAME", "unit_name", "unit", "lith", "LITH", "class_name", "class", "soil", "rock_type", "label"]) {
    const v = props[key];
    if (v != null && String(v).trim() && typeof v !== "object") return String(v).trim().slice(0, 80);
  }
  return null;
}

/** Every study area the GIS page holds, with its readings and its polygons. */
async function areasNow() {
  const reader = window.GeoIDRiskReader;
  const read = reader?.areas?.() || [];
  let shapes = [];
  try {
    const mod = await import(`../../risk-reader.js${search}`);
    shapes = mod.studyAreas();
  } catch (error) { shapes = []; }
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const out = [];
  for (const a of read) {
    const shape = byId.get(a.id);
    let polys = shape?.polys || null;
    if (!polys) {
      // An area read without a drawn shape (the view) is reported over the
      // ground its readings were taken on.
      const g = a.readings.find((r) => r.assessment?.mapGroups?.length)?.assessment.mapGroups || [];
      polys = g.flatMap((m) => (m.rings || []).map((ring) => ({ coords: [ring] })));
    }
    if (polys?.length) out.push({ id: a.id, name: a.name, polys, readings: a.readings, layerId: shape?.layerId || null });
    byId.delete(a.id);
  }
  for (const s of byId.values()) out.push({ id: s.id, name: s.name, polys: s.polys, readings: [], layerId: s.layerId });
  return out;
}

/** The ground the readings are about, measured at a lattice inside the area. */
async function gatherContext(area, say = () => {}) {
  const ctx = {};
  const geo = areaGeometry(area.polys);
  if (!geo) return ctx;
  const pts = latticeInside(area.polys, 240);
  const viewer = window.GeoIDViewer;
  if (viewer?.sampleElevationMeters) {
    say("Reading the ground under the area…");
    // The streamed DEM over the area first, so the heights are its own and not
    // whatever the view last loaded.
    try { await window.GeoIDDem?.ensure?.(geo.box); } catch (error) { /* the texture answers */ }
    const z = pts.map((p) => viewer.sampleElevationMeters(p.lat, ((p.lon % 360) + 360) % 360));
    ctx.elevation = summarise(z.map((v) => (Number.isFinite(v) ? v : NaN)));
  }
  try {
    const normals = await import(`../../climate-normals.js${search}`);
    await normals.load?.();
    const zc = viewer?.sampleElevationMeters?.(geo.centroid.lat, ((geo.centroid.lon % 360) + 360) % 360);
    const reading = normals.at(geo.centroid.lat, geo.centroid.lon, zc);
    if (reading) ctx.climate = reading;
  } catch (error) { /* no climate normal: the row is left out */ }
  const featuresAt = window.GeoIDFeaturePopup?.featuresAt;
  if (featuresAt) {
    const perLayer = new Map();
    for (const p of pts) {
      let hits = [];
      try { hits = featuresAt(p.lat, p.lon) || []; } catch (error) { hits = []; }
      for (const h of hits) {
        if (!h?.layer || h.layer.ext === "drawn") continue;
        const name = unitName(h.feature?.properties || h.feature);
        if (!name) continue;
        if (!perLayer.has(h.layer.name)) perLayer.set(h.layer.name, []);
        perLayer.get(h.layer.name).push(name);
      }
    }
    ctx.units = [...perLayer.entries()].slice(0, 6).map(([layer, names]) => ({ layer, tally: tally(names) }));
  }
  try {
    const places = await window.GeoIDEarthPlaces?.places?.();
    if (places?.length) ctx.places = placesFor(places, area.polys, geo.centroid);
  } catch (error) { /* no gazetteer */ }
  return ctx;
}

/** The preview reads as a document at the hub's own scale, not a poster. */
function installStyle() {
  if (document.getElementById("study-report-style")) return;
  const style = document.createElement("style");
  style.id = "study-report-style";
  style.textContent = `
#research-hub .study-report-preview h1 { font-size: 1.25rem; margin: 0 0 0.3rem; }
#research-hub .study-report-preview h2 { font-size: 0.98rem; margin: 1rem 0 0.35rem; }
#research-hub .study-report-preview h3 { font-size: 0.86rem; margin: 0.8rem 0 0.25rem; }
#research-hub .study-report-preview table { border-collapse: collapse; width: 100%; margin: 0.3rem 0 0.6rem; font-size: 0.76rem; }
#research-hub .study-report-preview th, #research-hub .study-report-preview td { border-bottom: 1px solid rgba(255,255,255,0.12); padding: 0.2rem 0.35rem; }
#research-hub .study-report-preview blockquote { margin: 0.5rem 0; padding: 0.35rem 0.7rem; border-left: 3px solid var(--skin-chrome, #ff2bd6); opacity: 0.85; }
#research-hub .study-report-preview ul { margin: 0.3rem 0 0.5rem 1.1rem; padding: 0; }
#research-hub .research-stack { display: grid; gap: 0.8rem; align-content: start; }
`;
  document.head.append(style);
}

async function savedReports() {
  if (!store.getActive()) return [];
  try {
    return (await store.listProjectDir(DIR)).filter((e) => e.kind === "file" && /\.md$/.test(e.name));
  } catch (error) { return []; }
}

/** What a saved draft says it was built from: `{ area, signature }`. */
function headerOf(md) {
  const m = /<!-- geoid-study-report area="([^"]*)" signature="([^"]*)"/.exec(String(md || ""));
  return m ? { area: m[1], signature: m[2] } : null;
}

async function mount(host, ctx) {
  const { node: status, say } = persistentStatus(host, PAGE);
  const project = store.getActive();
  const projectName = project?.metadata?.name || project?.dir || null;

  const areas = await areasNow();
  const saved = await savedReports();
  let current = null;              // { area?, path?, md }

  // ── left: the areas and the drafts
  const areaCard = card("Study areas on the GIS page");
  const areaList = el("div", "research-list");
  areaCard.append(areaList);
  if (!areas.length) {
    areaList.append(el("p", "research-note",
      "No study area yet. Draw one on the GIS page (the Draw tool) and tick the hazard maps you want read over it; "
      + "the risk reader reads each one and its findings land here."));
  }
  const draftCard = card(`Drafts in ${DIR}/`);
  const draftList = el("div", "research-list");
  draftCard.append(draftList);
  if (!project) draftList.append(el("p", "research-note", "Open a project to keep drafts; without one a report can still be built, printed and downloaded."));
  else if (!saved.length) draftList.append(el("p", "research-note", "No drafts yet."));

  // ── right: the document
  const docCard = card("Report");
  const editor = textarea("", 26, "Choose a study area and build its report.");
  editor.disabled = true;
  const preview = el("div", "study-report-preview");
  preview.hidden = true;
  preview.style.cssText = "max-height:62vh;overflow:auto;padding:0.6rem 0.9rem;border:1px solid rgba(255,255,255,0.12);border-radius:0.5rem;font-size:0.82rem;line-height:1.5";
  const stale = el("p", "research-note");
  stale.hidden = true;

  const buildBtn = button("Build from the GIS page", () => void build());
  const previewBtn = button("Preview", () => {
    preview.hidden = !preview.hidden;
    editor.hidden = !preview.hidden;
    previewBtn.textContent = preview.hidden ? "Preview" : "Edit";
    if (!preview.hidden) preview.innerHTML = markdownToHtml(editor.value);
  }, { secondary: true });
  const saveBtn = button("Save to project", () => void save(), { secondary: true });
  const notesBtn = button("Copy to Research Notes", () => void toNotes(), { secondary: true });
  const mdBtn = button("Download .md", () => download("md"), { secondary: true });
  const printBtn = button("Print / PDF", () => print(), { secondary: true });
  const globeBtn = button("Show on the globe", () => showOnGlobe(), { secondary: true });
  const actions = row(buildBtn, previewBtn, saveBtn, notesBtn, mdBtn, printBtn, globeBtn);
  [previewBtn, saveBtn, notesBtn, mdBtn, printBtn].forEach((b) => { b.disabled = true; });
  globeBtn.disabled = true;
  docCard.append(stale, actions, editor, preview);
  editor.addEventListener("input", () => { if (current) current.md = editor.value; });

  function enable(on) {
    editor.disabled = !on;
    [previewBtn, mdBtn, printBtn].forEach((b) => { b.disabled = !on; });
    saveBtn.disabled = !on || !project;
    notesBtn.disabled = !on || !project;
    globeBtn.disabled = !current?.area;
  }

  function show(md) {
    editor.value = md;
    current.md = md;
    if (!preview.hidden) preview.innerHTML = markdownToHtml(md);
    enable(true);
  }

  function selectArea(area) {
    current = { area, path: project ? `${DIR}/${slug(area.name)}.md` : null, md: "" };
    [...areaList.children].forEach((n) => n.classList.toggle("is-active", n.dataset.id === area.id));
    buildBtn.textContent = "Build from the GIS page";
    const done = area.readings.filter((r) => r.assessment).length;
    const running = area.readings.filter((r) => r.busy).length;
    say(`${area.name}: ${done} hazard map${done === 1 ? "" : "s"} read${running ? `, ${running} still reading` : ""}. `
      + `${current.path ? `Its draft is ${current.path}.` : ""}`);
    void (async () => {
      if (!current.path || !(await store.projectFileExists(current.path).catch(() => false))) {
        editor.value = ""; enable(false); globeBtn.disabled = false;
        stale.hidden = true;
        return;
      }
      const text = await store.readProjectFile(current.path);
      show(typeof text === "string" ? text : "");
      buildBtn.textContent = "Rebuild (keeps your writing)";
      const head = headerOf(current.md);
      const now = readingsSignature(area.readings);
      stale.hidden = !head || head.signature === now;
      stale.textContent = "The readings on the GIS page have changed since this draft was built — rebuild to bring the numbers up to date; your writing is kept.";
    })();
  }

  async function build() {
    if (!current?.area) { say("Choose a study area first.", true); return; }
    const area = current.area;
    buildBtn.disabled = true;
    try {
      const context = await gatherContext(area, say);
      say("Writing the report…");
      const fresh = buildReport({ area, context, readings: area.readings, project: projectName });
      const md = current.md ? mergeWriting(current.md, fresh) : fresh;
      show(md);
      stale.hidden = true;
      buildBtn.textContent = "Rebuild (keeps your writing)";
      const done = area.readings.filter((r) => r.assessment).length;
      say(`Built from ${done} reading${done === 1 ? "" : "s"}${context.elevation ? `, ${context.elevation.n} ground points` : ""}`
        + `${context.units?.length ? `, ${context.units.length} mapped layer${context.units.length === 1 ? "" : "s"}` : ""}. `
        + `${project ? "Save it to keep it in the project." : "Open a project to keep it."}`);
    } catch (error) {
      say(`Could not build the report: ${error.message}`, true);
    } finally {
      buildBtn.disabled = false;
    }
  }

  async function save() {
    if (!project || !current) return;
    const path = current.path || `${DIR}/${slug(headerOf(current.md)?.area || "report")}.md`;
    try {
      await store.writeProjectFile(path, editor.value);
      await store.registerData?.({ name: path.split("/").pop(), kind: "report", path, source: "GeoID risk reader" });
      current.path = path;
      say(`Saved ${path}.`);
      redrawDrafts();
    } catch (error) { say(`Could not save: ${error.message}`, true); }
  }

  async function toNotes() {
    if (!project || !current) return;
    const name = `notes/${slug(current.area?.name || headerOf(current.md)?.area || "report")}_report.md`;
    try {
      await store.writeProjectFile(name, editor.value);
      say(`Copied to ${name} — open it under Projects ▸ Notes.`);
    } catch (error) { say(`Could not copy: ${error.message}`, true); }
  }

  function title() {
    return /^# (.+)$/m.exec(editor.value)?.[1] || "Study area report";
  }

  function download(kind) {
    const name = `${slug(title())}.${kind}`;
    const blob = new Blob([editor.value], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function print() {
    const html = printableHtml(editor.value, title());
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(`${url}#print`, "_blank");
    if (!w) say("The browser blocked the print window: allow pop-ups for this site, or download the Markdown.", true);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function showOnGlobe() {
    const area = current?.area;
    if (!area) return;
    window.GeoIDModeManager?.setMode?.("gis");
    const layer = area.layerId ? (window.GeoIDImportManager?.getLayers?.() || []).find((l) => String(l.id) === String(area.layerId)) : null;
    if (layer) setTimeout(() => window.GeoIDImportManager?.frameLayer?.(layer), 300);
  }

  function redrawDrafts() {
    void savedReports().then((files) => {
      draftList.textContent = "";
      if (!files.length) { draftList.append(el("p", "research-note", "No drafts yet.")); return; }
      files.forEach((f) => {
        const b = el("button", "research-list-row");
        b.type = "button";
        b.append(el("span", "research-list-name", f.name));
        b.addEventListener("click", async () => {
          const text = await store.readProjectFile(`${DIR}/${f.name}`);
          const head = headerOf(text);
          const area = areas.find((a) => a.id === head?.area) || null;
          current = { area, path: `${DIR}/${f.name}`, md: typeof text === "string" ? text : "" };
          show(current.md);
          buildBtn.textContent = area ? "Rebuild (keeps your writing)" : "Build from the GIS page";
          buildBtn.disabled = !area;
          stale.hidden = !area || !head || head.signature === readingsSignature(area.readings);
          stale.textContent = "The readings on the GIS page have changed since this draft was built — rebuild to bring the numbers up to date; your writing is kept.";
          say(area ? `Editing ${DIR}/${f.name}.` : `Editing ${DIR}/${f.name}. Its study area is not on the GIS page now, so it cannot be rebuilt.`);
        });
        draftList.append(b);
      });
    });
  }

  areas.forEach((area) => {
    const b = el("button", "research-list-row");
    b.type = "button";
    b.dataset.id = area.id;
    const done = area.readings.filter((r) => r.assessment).length;
    b.append(el("span", "research-list-name", area.name),
      el("span", "research-list-meta", `${done} reading${done === 1 ? "" : "s"}`));
    b.addEventListener("click", () => selectArea(area));
    areaList.append(b);
  });
  if (project && saved.length) redrawDrafts();

  // `el` takes text, not children: the list column is built by hand.
  const left = el("div", "research-stack");
  left.append(areaCard, draftCard);
  host.append(splitPanes(left, docCard, "1fr 2.2fr"));
  installStyle();
  host.append(status);

  const pick = wanted && areas.find((a) => a.id === wanted);
  wanted = null;
  if (pick) {
    selectArea(pick);
    // The door from the risk reader means "write this up": build at once
    // unless a draft already exists, which opens instead.
    setTimeout(() => { if (!current?.md) void build(); }, 400);
  } else if (areas.length === 1) {
    selectArea(areas[0]);
  }
  void ctx;
}

registerPage(PAGE, { mount });

if (typeof window !== "undefined") {
  window.GeoIDStudyReports = {
    /** Open the page on one study area (the risk reader's "Write it up"). */
    open(areaId = null) {
      wanted = areaId;
      window.GeoIDModeManager?.setMode?.("research");
      setTimeout(() => window.GeoIDResearch?.setPage?.(PAGE), 350);
    },
    areas: areasNow,
    build: async (areaId) => {
      const area = (await areasNow()).find((a) => a.id === areaId);
      if (!area) return null;
      const context = await gatherContext(area);
      return buildReport({ area, context, readings: area.readings, project: store.getActive()?.dir || null });
    },
  };
}
