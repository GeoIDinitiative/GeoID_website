/**
 * The Research Hub's shape, as data.
 *
 * Ported from the Qt app's `base_stage_structure` (app_qt.py:3617) so the two
 * front ends agree on what the workspace *is* -- same stages, same page names,
 * same order. Held as data rather than markup so pages can register against it
 * one at a time without the hub needing to change, and so the rail cannot drift
 * from the definition it is supposed to mirror.
 *
 * Each stage: [key, railLabel, [[pageId, tabLabel], ...]]
 * `key` matches the Qt stage key exactly; `pageId` is the Qt page title.
 */
export const STAGES = [
  ["Dashboard", "Dashboard", [
    ["Dashboard", "Dashboard"],
    ["Pipeline Runner", "Pipeline Runner"],
  ]],
  ["Project Manager", "Projects", [
    ["Projects", "Projects"],
    ["Project Board", "Board"],
    ["Research Notes", "Notes"],
    ["Project Comparison", "Compare"],
  ]],
  ["Data Puller", "Fetch Data", [
    ["Ingest Generic Import", "Generic"],
    ["Ingest Land Use", "Land Use"],
    ["Ingest Hydrology", "Hydrology"],
    ["Ingest Coast Marine", "Coast"],
    ["Ingest Geology", "Geology"],
    ["Ingest Seismic Geophysics", "Seismic"],
    ["Ingest Volcano Monitoring", "Volcano"],
    ["Ingest Terrain Elevation", "Terrain"],
    ["Ingest Weather Climate", "Weather"],
    ["Ingest Remote Sensing", "Remote Sensing"],
    ["Ingest Admin Infrastructure", "Admin"],
    ["Metadata & Lineage", "Metadata"],
  ]],
  ["AI trainer", "Train", [
    ["AI Trainer", "AI Trainer"],
    ["Feature Engineering", "Features"],
    ["Workflow Automation", "Automation"],
    ["Notebook", "Notebook"],
  ]],
  ["Preprocessing", "Prepare", [
    ["Data Repository", "Repository"],
    ["QA / QC", "QA / QC"],
    ["Preprocessing Transforms", "Transforms"],
    ["XYZ to STL", "XYZ -> STL"],
    ["Temporal Tools", "Temporal"],
    ["Raster Tools", "Raster"],
    ["Vector Tools", "Vector"],
    ["CSV Plotter", "Plotter"],
    ["Mesh", "Mesh"],
    ["Inputs", "Inputs"],
  ]],
  ["FEM model", "FEM", [
    ["Import / Clone", "Import"],
    ["Build New", "Build New"],
    ["Setup", "Setup"],
    ["Properties", "Properties"],
    ["IC/BC", "IC / BC"],
    ["Run Existing", "Run"],
    ["Simulation", "Simulation"],
    ["DOF Wizard", "DOF Wizard"],
  ]],
  ["Postprocessing and Signal Analysis", "Analysis", [
    ["Post Processing", "Post Process"],
    ["Signal Processing", "Signal"],
    ["Spectral Analysis", "Spectral"],
    ["Multi-Station Viewer", "Stations"],
    ["Model Fitting", "Model Fit"],
    ["Event Detection", "Ev. Detect"],
    ["Equation Workbench", "Equations"],
    ["Statistics", "Statistics"],
    ["EDA Report", "EDA"],
    ["Event Annotation", "Events"],
    ["Point Cloud 3D", "Point Cloud"],
    ["FEM 3D Viewer", "3D Viewer"],
    ["Live Monitor", "Monitor"],
  ]],
  ["GIS Explorer", "GIS", [
    ["GIS Explorer", "Globe"],
    ["Map", "Map"],
  ]],
  ["Pipeline Editor", "Pipeline", [
    ["Pipeline Editor", "Pipeline Editor"],
  ]],
  ["Data Hub", "Data Hub", [
    ["Data Hub", "Data Hub"],
  ]],
  ["StoryBoard", "Publish", [
    ["Docs & Sheets", "Docs"],
    ["Storyboard", "StoryBoard"],
    ["Figure Composer", "Figures"],
  ]],
  ["Settings", "Settings", [
    ["Settings", "Settings"],
    ["Plugin Manager", "Plugins"],
    ["Module Builder", "Build Module"],
    ["Research Notes", "Notes"],
  ]],
];

/** Every page id in rail order, for lookups and for the tests to check against. */
export function allPageIds() {
  return STAGES.flatMap(([, , pages]) => pages.map(([id]) => id));
}

export function stageOf(pageId) {
  const found = STAGES.find(([, , pages]) => pages.some(([id]) => id === pageId));
  return found ? found[0] : null;
}

// ── Page registry ─────────────────────────────────────────────────────────────
// A page is a module that knows how to fill one panel. Registering is the only
// thing a new page has to do; the hub reads the registry when it mounts.
//
// A page that is not registered is not faked. The hub draws a plainly-labelled
// "not built yet" panel instead, so the rail can show the true shape of the
// workspace without implying function that is not there.

const pages = new Map();

/**
 * @param {string} pageId   must match an id in STAGES
 * @param {{ mount: (el: HTMLElement, ctx: object) => void|Promise<void>,
 *           unmount?: (el: HTMLElement) => void,
 *           blurb?: string }} page
 */
export function registerPage(pageId, page) {
  if (!stageOf(pageId)) {
    // A typo here would otherwise show up as a page that silently never mounts.
    console.warn(`[research] registerPage: "${pageId}" is not in STAGES`);
    return;
  }
  pages.set(pageId, page);
}

export function getPage(pageId) {
  return pages.get(pageId) || null;
}

export function registeredCount() {
  return pages.size;
}
