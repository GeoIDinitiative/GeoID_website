/**
 * Mesh quality against elements whose answers are known in closed form.
 */
import { METRICS, tetMetrics, triMetrics, analyseMesh, summarise, verdict, elementFaces, elementCentroid, elementsOf } from "./mesh-quality.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// A regular tetrahedron: every metric at its ideal.
const s = 1 / Math.sqrt(2);
const regular = [1, 0, -s, -1, 0, -s, 0, 1, s, 0, -1, s];
{
  const m = tetMetrics(regular, 0, 1, 2, 3);
  check("regular tet: γ = 1, radius ratio = 1, aspect = 1", near(m.gamma, 1) && near(m.radiusRatio, 1) && near(m.aspect, 1), JSON.stringify(m));
  check("regular tet: every dihedral is arccos(1/3) = 70.529°", near(m.minAngle, 70.5288, 1e-3) && near(m.maxAngle, 70.5288, 1e-3));
  check("regular tet: size is the edge length, 2", near(m.size, 2));
}
// The corner tetrahedron of the unit cube: three right dihedrals.
const corner = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
{
  const m = tetMetrics(corner, 0, 1, 2, 3);
  check("corner tet: max dihedral 90°, min arccos(1/√3) = 54.74°", near(m.maxAngle, 90, 1e-6) && near(m.minAngle, 54.7356, 1e-3), `${m.minAngle} ${m.maxAngle}`);
  check("corner tet: aspect √2, volume 1/6", near(m.aspect, Math.SQRT2) && near(Math.abs(m.volume), 1 / 6));
  // inradius 1/(3+√3), circumradius √3/2 → 3r/R = 2√3/(3+√3)·... computed:
  const r = 1 / (3 + Math.sqrt(3)); const R = Math.sqrt(3) / 2;
  check("corner tet: radius ratio 3r/R with r = 1/(3+√3), R = √3/2", near(m.radiusRatio, (3 * r) / R, 1e-9));
}
// A sliver: four nearly coplanar points.
{
  const sliver = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.01];
  const m = tetMetrics(sliver, 0, 1, 2, 3);
  check("sliver: γ and radius ratio collapse, max dihedral near 180°", m.gamma < 0.05 && m.radiusRatio < 0.05 && m.maxAngle > 170, JSON.stringify(m));
}
// Triangles.
{
  const eq = [0, 0, 0, 1, 0, 0, 0.5, Math.sqrt(3) / 2, 0];
  const m = triMetrics(eq, 0, 1, 2);
  check("equilateral triangle: γ = 1, radius ratio 1, all angles 60°", near(m.gamma, 1) && near(m.radiusRatio, 1) && near(m.minAngle, 60, 1e-9) && near(m.maxAngle, 60, 1e-9));
  const right = triMetrics([0, 0, 0, 1, 0, 0, 0, 1, 0], 0, 1, 2);
  check("right isosceles triangle: 45° and 90°, aspect √2", near(right.minAngle, 45, 1e-9) && near(right.maxAngle, 90, 1e-9) && near(right.aspect, Math.SQRT2));
}

// A mesh: the unit cube as six tetrahedra, one of them inverted by hand.
const cube = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const six = [0, 1, 2, 6, 0, 2, 3, 6, 0, 3, 7, 6, 0, 7, 4, 6, 0, 4, 5, 6, 0, 5, 1, 6];
{
  const a = analyseMesh({ nodes: cube, tets: six });
  check("analysis: six elements, none inverted, all volumes 1/6 of the cube", a.count === 6 && a.inverted === 0 && a.degenerate === 0);
  const flipped = six.slice(); [flipped[0], flipped[1]] = [flipped[1], flipped[0]];
  const b = analyseMesh({ nodes: cube, tets: flipped });
  check("analysis: the minority orientation is the inverted one, whichever sign the file uses", b.inverted === 1);
  const sum = summarise(a, "gamma", { threshold: 0.9 });
  check("summary: every element counted past γ 0.9 (a Kuhn tet scores 0.72), worst listed", sum.poor === 6 && sum.worst.length === 6 && near(sum.min, sum.max, 1e-6) && sum.min < 0.9);
  check("summary: the histogram holds every element", sum.histogram.reduce((x, y) => x + y, 0) === 6);
  const high = summarise(a, "aspect", { threshold: 1.5 });
  check("summary: a high-is-worse metric counts above the threshold", high.poor === 6 && summarise(a, "aspect", { threshold: 2 }).poor === 0);
  const v = verdict(b, [sum]);
  check("verdict: an inverted element is an error, a count past a threshold a warning", v[0].level === "error" && /inverted/.test(v[0].text) && v.some((l) => l.level === "warning"));
  check("verdict: a clean mesh says so", verdict(a, [summarise(a, "gamma", { threshold: 0.1 })])[0].level === "ok");
  const faces = elementFaces(a.elements, [0, 3]);
  check("faces: four triangles per tetrahedron, nine numbers each", faces.length === 2 * 4 * 9);
  const c = elementCentroid(a.elements, 0);
  check("centroid: the mean of the element's nodes", near(c[0], 0.75) && near(c[1], 0.5) && near(c[2], 0.25));
}
// A GALES-shaped mesh: mixed cells, only the elements of the mesh's own dimension.
{
  const gales = { coords: Float64Array.from(cube), cells: Uint32Array.from([...six.slice(0, 8), 0, 1, 2]), cellOffsets: Uint32Array.from([0, 4, 8, 11]), dim: 3, nodeCount: 8 };
  const E = elementsOf(gales);
  check("GALES mesh: tetrahedra kept, the boundary triangle left out, source cells recorded", E.per === 4 && E.conn.length === 8 && E.source[1] === 1);
  const two = { coords: Float64Array.from([0, 0, 1, 0, 0, 1]), cells: Uint32Array.from([0, 1, 2]), cellOffsets: Uint32Array.from([0, 3]), dim: 2, nodeCount: 3 };
  const a2 = analyseMesh(two);
  check("2D GALES mesh with xy coordinates: triangles analysed", a2.count === 1 && a2.per === 3 && near(a2.metrics.maxAngle[0], 90, 1e-4));
}
check("every metric names its direction and explains itself", Object.values(METRICS).every((m) => ["low", "high"].includes(m.worse) && m.says.length > 40));

// ── the page half: pinned on the source, since it wants a document ──
{
  const { readFileSync } = await import("node:fs");
  const here = new URL(".", import.meta.url);
  const read = (p) => readFileSync(new URL(p, here), "utf8");
  const panel = read("./mesh-quality-panel.js");
  const index = read("../index.html");
  const shell = read("./shell.html");
  const button = 'data-toggle="quality"';
  check("ribbon: the Quality toggle is in both the Earth page and the planet shell, once each", index.split(button).length === 2 && shell.split(button).length === 2);
  check("loaded: after the results panel on the Earth page and in the planets' module list", /gales-results-panel\.js\?v=[^"]+"><\/script>\n<script type="module" src="gis\/mesh-quality-panel\.js\?v=/.test(index) && /"\.\/gales-results-panel\.js",\n  "\.\/mesh-quality-panel\.js",/.test(read("./boot.js")));
  const style = panel.slice(panel.indexOf("const STYLE = `") + 15, panel.indexOf("`;", panel.indexOf("const STYLE = `")));
  check("style: no backtick or single-backslash escape inside the CSS literal", !style.includes("`") && !/\\[0-9]/.test(style));
  check("seams: the results panel publishes its frame, and the studio announces a new or cleared mesh",
    /frame: \(\) => scene\.frame/.test(read("./gales-results-panel.js")) && read("./model-studio.js").split('dispatchEvent(new Event("geoid-studio:mesh-changed"))').length === 3);
  check("overlay: drawn through the model with the depth test off, and taken down when the card closes", /depthTest: false/.test(panel) && /if \(!Q\.open\) \{ removeOverlay\(\); return; \}/.test(panel));
  check("a large mesh is analysed only when asked", /elementCount\(chosen\.mesh\) > AUTO_LIMIT/.test(panel));
}
// A GALES mesh is analysed in the results reader, and only the answer crosses back.
{
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("reader: the worker answers a quality request, and the results seam asks it", /type === "quality"/.test(worker) && /quality: async \(\) =>/.test(panel));
  const { qualityForTransfer } = await import("./gales-worker.js");
  const gales = { coords: Float64Array.from(cube), cells: Uint32Array.from(six), cellOffsets: Uint32Array.from([0, 4, 8, 12, 16, 20, 24]), dim: 3, nodeCount: 8 };
  const t = qualityForTransfer(analyseMesh(gales), gales);
  check("transfer: the reader's own coordinates are copied, never handed over", t.count === 6 && t.elements.coords !== gales.coords && t.elements.coords.length === 24 && t.elements.conn.length === 24);
}
