/** The model report lays out what it is given, and nothing it is not. */
import { modelReportHtml, reportSections, esc } from "./model-report.js";

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

const full = {
  title: "Etna <chamber> run", generated: "15 Sep 2026", run: "solid/u · t=1", reference: "GEO-1",
  cards: [["251,147", "nodes"], ["85.4 m", "peak |u|"]],
  setup: { physics: "Solid mechanics", study: [["Steps", "1"]], materials: [["10", "Basalt", "2900", "6.000e+10", "0.25"]], conditions: [["2", "Fixed", ""], ["4", "Pressure", "p = 5e7 Pa"]], issues: [{ level: "warning", text: "No gravity" }] },
  mesh: { facts: [["Nodes", "251,147"]], domains: [["0", "1,290,687", "475,483 km³"]] },
  view: { facts: [["Field", "Displacement"]], image: "data:image/png;base64,AAAA", caption: "The model at t=1", bar: "data:image/png;base64,EEEE" },
  profile: { facts: [["Length", "100 km"]], image: "data:image/png;base64,BBBB", caption: "|u| along x" },
  stats: { label: "|u| (m)", heads: ["Flag", "Volume", "Mean"], rows: [["0", "475,483 km³", "21.5 m"]], image: null },
  observations: { facts: [["Best source scale", "× 0.4"]], heads: ["Station", "obs", "model"], rows: [["S0", "1 mm", "1 mm"]], more: "" },
  source: { facts: [["ΔV", "30 × 10⁶ m³"]], image: "data:image/png;base64,CCCC", inversion: [["Source", "(1, 2) m"]], curveImage: "data:image/png;base64,DDDD" },
  methods: ["Barycentric interpolation"], citations: ["Segall, P. (2010) Earthquake and Volcano Deformation."],
};
const html = modelReportHtml(full);
check("report: every section given is present, in order", reportSections(full).map((s) => s.id).join() === "setup,mesh,view,profile,stats,observations,source,methods");
check("report: sections are numbered and the sign-off comes last", /<h2>1\. Model setup<\/h2>/.test(html) && /<h2>9\. Notes and sign-off<\/h2>/.test(html));
check("report: text is escaped, so a name cannot inject markup", html.includes("Etna &lt;chamber&gt; run") && !html.includes("<chamber>") && esc(`"a'<`) === "&quot;a&#39;&lt;");
check("report: figures are embedded, print-ready, with an editable title and sign-off", /<img src="data:image\/png;base64,AAAA"/.test(html) && /@page \{ size: A4/.test(html) && /<h1 contenteditable="true">/.test(html) && /Prepared by/.test(html));
check("report: issues keep their level", /<li class="warning">No gravity<\/li>/.test(html));
check("report: condition flags and volumes are right-aligned numbers", /<td class="n">475,483 km³<\/td>/.test(html));

const bare = { title: "Run", generated: "now", view: { facts: [["Field", "u"]] } };
const small = modelReportHtml(bare);
check("report: an absent analysis is left out, not printed empty", reportSections(bare).length === 1 && !/Plot over line|Statistics by domain|Mogi|Model setup/.test(small) && /<h2>2\. Notes and sign-off<\/h2>/.test(small));
check("report: a view with no image has no broken figure", !/<img/.test(small));
check("report: the view carries its colour scale, since the page's legend is not in the snapshot", /<img class="bar" src="data:image\/png;base64,EEEE"/.test(html));
