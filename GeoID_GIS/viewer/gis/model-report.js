/**
 * THE MODEL REPORT: a run and everything asked of it, as one printable page.
 *
 * The model page answers questions a card at a time -- a profile, domain
 * statistics, a fit to GNSS, a Mogi benchmark -- and a card is gone the moment
 * the run changes. A report is what leaves the page with a study: the setup
 * that produced the numbers, the mesh they were computed on, the view, and
 * each analysis with its figure and its numbers, under a methods section that
 * says how each was computed and a sign-off a reader fills in.
 *
 * Pure layout: everything arrives already formatted by the page (the same
 * formatting its cards use, so the report and the card cannot disagree), and
 * a section whose data is absent is left out rather than printed empty. One
 * self-contained HTML document, A4, print-ready: the browser's own Save as PDF
 * is the PDF writer, as for the risk assessment report.
 */

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const facts = (rows) => (rows?.length ? `<table class="facts"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>` : "");

const table = (heads, rows, { numeric = [] } = {}) => (rows?.length ? `<table>
  <thead><tr>${heads.map((h, k) => `<th${numeric.includes(k) ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${numeric.includes(k) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
</table>` : "");

const figure = (image, caption) => (image ? `<figure><img src="${esc(image)}" alt="${esc(caption)}"><figcaption>${esc(caption)}</figcaption></figure>` : "");

/** The sections present, in order, each { id, title, html }. Exposed so a test can count them. */
export function reportSections(r) {
  const out = [];
  if (r.setup) {
    const s = r.setup;
    out.push({
      id: "setup", title: "Model setup",
      html: `${facts([["Physics", s.physics], ...(s.study || [])])}
        ${s.materials?.length ? `<h3>Materials</h3>${table(["Volume flag", "Material", "ρ (kg/m³)", "E (Pa)", "ν"], s.materials, { numeric: [0, 2, 3, 4] })}` : ""}
        ${s.pointwise ? `<p class="note">${esc(s.pointwise)}</p>` : ""}
        ${s.conditions?.length ? `<h3>Boundary conditions</h3>${table(["Face flag", "Condition", "Values"], s.conditions, { numeric: [0] })}` : ""}
        ${s.issues?.length ? `<h3>Checks</h3><ul>${s.issues.map((i) => `<li class="${esc(i.level)}">${esc(i.text)}</li>`).join("")}</ul>` : ""}`,
    });
  }
  if (r.mesh) {
    out.push({
      id: "mesh", title: "Mesh",
      html: `${facts(r.mesh.facts)}${r.mesh.domains?.length ? table(["Volume flag", "Elements", "Volume"], r.mesh.domains, { numeric: [0, 1, 2] }) : ""}`,
    });
  }
  if (r.view) {
    out.push({ id: "view", title: "Results", html: `${facts(r.view.facts)}${figure(r.view.image, r.view.caption)}${r.view.bar ? `<img class="bar" src="${esc(r.view.bar)}" alt="Colour scale">` : ""}` });
  }
  if (r.profile) {
    out.push({ id: "profile", title: "Plot over line", html: `${facts(r.profile.facts)}${figure(r.profile.image, r.profile.caption)}` });
  }
  if (r.stats) {
    out.push({
      id: "stats", title: "Statistics by domain",
      html: `<p class="note">${esc(r.stats.label)}</p>${table(r.stats.heads, r.stats.rows, { numeric: r.stats.heads.map((_, k) => k) })}${figure(r.stats.image, "Share of each domain's volume in each bin, square-root axis")}`,
    });
  }
  if (r.observations) {
    const o = r.observations;
    out.push({
      id: "observations", title: "Comparison with observations",
      html: `${facts(o.facts)}${table(o.heads, o.rows, { numeric: o.heads.map((_, k) => k).slice(1) })}${o.more ? `<p class="note">${esc(o.more)}</p>` : ""}`,
    });
  }
  if (r.sweep) {
    out.push({
      id: "sweep", title: "Parameter sweep",
      html: `${facts(r.sweep.facts)}${figure(r.sweep.image, "Response against the varied parameter")}${table(r.sweep.heads, r.sweep.rows, { numeric: [1, 2] })}`,
    });
  }
  if (r.source) {
    const s = r.source;
    out.push({
      id: "source", title: "Analytical source (Mogi)",
      html: `${facts(s.facts)}${figure(s.image, "The model's surface (dots) against the Mogi source (lines) by distance from the source")}
        ${s.inversion ? `<h3>Inversion</h3>${facts(s.inversion)}${figure(s.curveImage, "Misfit along depth at the best position")}` : ""}`,
    });
  }
  if (r.methods?.length) {
    out.push({ id: "methods", title: "Methods", html: `<ul>${r.methods.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>${r.citations?.length ? `<h3>References</h3><ul class="refs">${r.citations.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}` });
  }
  return out;
}

export function modelReportHtml(r) {
  const sections = reportSections(r);
  const cards = (r.cards || []).map(([v, l]) => `<div class="card"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("");
  const body = sections.map((s, k) => `<section id="${s.id}"${k && ["view", "observations", "sweep", "source", "methods"].includes(s.id) ? ' class="page"' : ""}><h2>${k + 1}. ${esc(s.title)}</h2>${s.html}</section>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(r.title || "Model report")}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif; color: #1b1b1f; margin: 0; background: #e9e9ee; font-size: 10.5pt; line-height: 1.45; }
  .sheet { background: #fff; max-width: 190mm; margin: 12px auto; padding: 14mm 12mm; box-shadow: 0 1px 6px rgba(0,0,0,0.15); }
  header.top { border-bottom: 3px solid #b0127e; padding-bottom: 6px; margin-bottom: 10px; }
  .brand { font-weight: 700; letter-spacing: 0.08em; color: #b0127e; font-size: 9pt; text-transform: uppercase; }
  h1 { font-size: 19pt; margin: 2px 0 0; }
  h2 { font-size: 13pt; margin: 18px 0 6px; color: #3a0f45; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  h3 { font-size: 10.5pt; margin: 12px 0 4px; }
  .meta, .note { color: #555; font-size: 9pt; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .card { border: 1px solid #ddd; border-left: 4px solid #b0127e; padding: 6px 8px; border-radius: 3px; }
  .card .v { font-size: 14pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .card .l { font-size: 8.5pt; color: #555; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9pt; }
  th, td { border-bottom: 1px solid #e3e3e3; padding: 3px 5px; text-align: left; vertical-align: top; }
  thead th { background: #f3eef5; font-weight: 600; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.facts th { width: 32%; background: #fafafa; font-weight: 600; }
  figure { margin: 8px 0; }
  figure img { width: 100%; border: 1px solid #ccc; display: block; background: #0d0a1c; }
  img.bar { width: 100%; display: block; margin: 2px 0 8px; }
  figcaption { font-size: 8.5pt; color: #555; margin-top: 3px; }
  li.error { color: #a4161a; } li.warning { color: #8a5a00; }
  ul { margin: 4px 0; padding-left: 18px; }
  ul.refs li { font-size: 9pt; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin-top: 6px; }
  .field { border-bottom: 1px solid #999; min-height: 22px; padding: 2px 4px; }
  .field label { display: block; font-size: 8pt; color: #666; }
  [contenteditable] { outline: none; }
  [contenteditable]:hover, [contenteditable]:focus { background: #fff8d6; }
  .toolbar { position: sticky; top: 0; background: #3a0f45; color: #fff; padding: 6px 12px; display: flex; gap: 8px; align-items: center; font-size: 10pt; z-index: 2; }
  .toolbar button { background: #b0127e; color: #fff; border: 0; padding: 5px 12px; border-radius: 3px; cursor: pointer; font: inherit; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .toolbar { display: none; }
    section.page { break-before: page; }
    table, .card, figure { break-inside: avoid; }
    [contenteditable]:hover { background: none; }
  }
</style></head>
<body>
<script>if (location.hash === "#print") addEventListener("load", () => setTimeout(() => print(), 400));</script>
<div class="toolbar"><button type="button" onclick="window.print()">Print / Save as PDF</button><span>Fields shaded on hover can be edited before printing.</span></div>
<div class="sheet">
  <header class="top">
    <div class="brand">GeoID Initiative · Model report</div>
    <h1 contenteditable="true">${esc(r.title || "Model report")}</h1>
    <div class="meta">Generated ${esc(r.generated)} · ${esc(r.run || "")} · Reference <span contenteditable="true">${esc(r.reference || "—")}</span></div>
  </header>
  ${cards ? `<div class="cards">${cards}</div>` : ""}
  <p contenteditable="true" class="note">${esc(r.summary || "Summary: add what this run was for and what it shows.")}</p>
  ${body}
  <section class="page"><h2>${sections.length + 1}. Notes and sign-off</h2>
    <p contenteditable="true">Notes.</p>
    <div class="fields">
      <div class="field"><label>Prepared by</label><span contenteditable="true"></span></div>
      <div class="field"><label>Date</label><span contenteditable="true"></span></div>
      <div class="field"><label>Checked by</label><span contenteditable="true"></span></div>
      <div class="field"><label>Date</label><span contenteditable="true"></span></div>
    </div>
  </section>
</div>
</body></html>
`;
}
