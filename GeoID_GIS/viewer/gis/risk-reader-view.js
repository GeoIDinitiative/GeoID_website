/**
 * How a risk assessment is shown, wherever it is shown: the risk reader window,
 * Hazards ▸ Exposure, and anything else that asks. One view, so a number cannot
 * read one way in one place and another way in the next.
 */

import { formatPeople } from "./exposure.js?v=20260915-e41a68d";
import {
  LEVEL_COLOURS, formatCount, formatShare, formatNumber, returnPeriod, stackedBarSvg, assessmentCsv,
  reportHtml, bandColour,
} from "./risk-assessment.js?v=20260915-e41a68d";
import { may, refusal } from "./membership.js?v=20260915-e41a68d";

const search = new URL(import.meta.url).search;

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v); });
  children.flat().forEach((c) => { if (c !== "" && c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return n;
}

function para(text, quiet = false) {
  return el("p", { class: `risk-view-p${quiet ? " is-quiet" : ""}` }, text);
}

function svgNode(markup) {
  const holder = el("div", { class: "risk-view-svg" });
  holder.innerHTML = markup;
  return holder;
}

const card = (value, label) => el("div", { class: "risk-view-card" }, el("b", {}, value), el("span", {}, label));

function breakdownTable(b) {
  const table = el("table", { class: "risk-view-table" });
  table.append(el("thead", {}, el("tr", {}, el("th", {}, b.scheme.bands ? "Band" : "Level"), el("th", { class: "n" }, "People"), el("th", { class: "n" }, "%"), el("th", { class: "n" }, "km²"))));
  const body = el("tbody");
  b.byClass.forEach((c, k) => {
    const sw = el("span", { class: "risk-view-sw" });
    sw.style.background = c.level ? LEVEL_COLOURS[c.level] : bandColour(k, b.byClass.length);
    const name = el("td", {}, sw, el("span", {}, c.level ? `${c.level} — ${c.label}` : c.label), el("small", {}, c.threshold));
    body.append(el("tr", { class: c.people >= 0.5 ? "" : "is-empty" }, name, el("td", { class: "n" }, formatCount(c.people)), el("td", { class: "n" }, formatShare(c.shareOfArea)), el("td", { class: "n" }, formatNumber(c.areaKm2, 100))));
  });
  body.append(el("tr", { class: "is-quiet" }, el("td", {}, "Not exposed"), el("td", { class: "n" }, formatCount(b.notExposed)), el("td", { class: "n" }, formatShare(b.total ? b.notExposed / b.total : 0)), el("td", {})));
  body.append(el("tr", { class: "is-quiet" }, el("td", {}, "No reading (off the map)"), el("td", { class: "n" }, formatCount(b.noReading)), el("td", { class: "n" }, formatShare(b.total ? b.noReading / b.total : 0)), el("td", { class: "n" }, formatNumber(b.noReadingAreaKm2, 100))));
  table.append(body);
  return table;
}

function statsList(b) {
  const s = b.stats;
  const u = b.scheme.unit && b.scheme.unit !== "per year" ? ` ${b.scheme.unit}` : "";
  const span = Math.abs((s.max ?? 0) - (s.min ?? 0)) || 1;
  const f = (v) => (v === null ? "—" : b.scheme.probability ? returnPeriod(v) : `${formatNumber(v, span)}${u}`);
  const rows = [["People-weighted mean", f(s.mean)], ["Median person", f(s.median)], ["10th – 90th percentile", `${f(s.p10)} – ${f(s.p90)}`], ["Range in the area", `${f(s.min)} – ${f(s.max)}`]];
  if (b.expectedPerYear !== null) rows.push(["Expected people reached a year", formatNumber(b.expectedPerYear, b.expectedPerYear)]);
  rows.push(["Population density", `${formatNumber(b.density, 100)} per km²`], ["People in edge cells (error bar)", formatShare(b.edgeShare)]);
  const dl = el("dl", { class: "risk-view-stats" });
  rows.forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
  return dl;
}

function polygonTable(a) {
  const prob = a.breakdowns[0].expectedPerYear !== null;
  const table = el("table", { class: "risk-view-table" });
  table.append(el("thead", {}, el("tr", {}, el("th", {}, "Polygon"), el("th", { class: "n" }, "People"), el("th", { class: "n" }, "Exposed"), el("th", { class: "n" }, a.breakdowns[0].scheme.bands ? "Top 2" : "V.high+high"), el("th", { class: "n" }, prob ? "Per yr" : "%"))));
  const body = el("tbody");
  [...a.byPolygon].sort((x, y) => y.breakdown.veryHighHigh - x.breakdown.veryHighHigh || y.breakdown.exposed - x.breakdown.exposed).forEach((row) => {
    const b = row.breakdown;
    body.append(el("tr", {}, el("td", {}, row.name), el("td", { class: "n" }, formatCount(b.total)), el("td", { class: "n" }, formatCount(b.exposed)), el("td", { class: "n" }, formatCount(b.veryHighHigh)), el("td", { class: "n" }, prob ? formatNumber(b.expectedPerYear, b.expectedPerYear) : formatShare(b.exposedShare))));
  });
  table.append(body);
  return table;
}

function fold(title, open, ...content) {
  const d = el("details", { class: "risk-view-fold" });
  d.open = open;
  d.append(el("summary", {}, title), ...content);
  return d;
}

function slug(text) { return String(text || "area").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "area"; }

export function exportCsv(a, say = () => {}) {
  void import(`./extraction.js${search}`).then(({ downloadText }) => {
    try { downloadText(`geoid_risk_${slug(a.hazard)}_${slug(a.area)}.csv`, assessmentCsv(a), "text/csv"); } catch (e) { say(e.message); }
  });
}

export function downloadReport(a, say = () => {}) {
  void import(`./extraction.js${search}`).then(({ downloadText }) => {
    try { downloadText(`geoid_risk_report_${slug(a.hazard)}_${slug(a.area)}.html`, reportHtml(a), "text/html"); } catch (e) { say(e.message); }
  });
}

/**
 * The report opens as its own page, print-ready: the browser's own "Save as
 * PDF" is the PDF writer, so nothing is vendored.
 */
export function openReport(a, { print = false } = {}, say = () => {}) {
  if (!may("save")) { say(refusal("save")); return; }
  const html = reportHtml(a);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(`${url}${print ? "#print" : ""}`, "_blank");
  if (!w) say("The browser blocked the report window: allow pop-ups for this site, or use Report (HTML).");
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  try { window.GeoIDResearch?.bridge?.saveExport?.(`geoid_risk_report_${slug(a.hazard)}_${slug(a.area)}.html`, html); } catch (e) { /* no project */ }
}

/** The annotation lines for an assessment, top classes with people in them. */
export function annotationOf(a) {
  const b0 = a.breakdowns[0];
  return {
    kicker: b0.scheme.bands ? "People on the layer" : `People at ${String(a.hazard).toLowerCase()} risk`,
    title: `${formatPeople(b0.exposed)} of ${formatPeople(b0.total)}`,
    lines: b0.byClass.filter((c) => c.people >= 0.5).slice(0, 3).map((c, k) => ({ text: `${formatPeople(c.people)} · ${c.level || c.label}`, colour: c.level ? LEVEL_COLOURS[c.level] : bandColour(k, 5) })),
  };
}

/** Draws an assessment into `host`, replacing what was there. */
export function renderAssessment(host, a, { say = () => {}, compact = false } = {}) {
  injectStyle();
  host.replaceChildren();
  host.classList.add("risk-view");
  const b0 = a.breakdowns[0];
  host.append(
    para(a.summaryText),
    el("div", { class: "risk-view-cards" },
      card(formatCount(b0.total), "people in the area"),
      card(formatCount(b0.exposed), `exposed · ${formatShare(b0.exposedShare)}`),
      card(formatCount(b0.veryHighHigh), b0.scheme.bands ? "in the top two bands" : "very high or high"),
      b0.expectedPerYear !== null ? card(formatNumber(b0.expectedPerYear, b0.expectedPerYear), "reached a year") : card(formatNumber(b0.areaKm2, 100), "km² assessed")),
    svgNode(stackedBarSvg(b0, { width: 300, height: 16 })),
  );
  a.breakdowns.forEach((b, k) => {
    host.append(fold(`${b.scheme.measure}${b.scheme.unit && !b.scheme.probability ? ` (${b.scheme.unit})` : ""}`, k === 0 && !compact,
      para(b.scheme.definition, true),
      k ? svgNode(stackedBarSvg(b, { width: 300, height: 12 })) : "",
      breakdownTable(b),
      statsList(b)));
  });
  if (a.byPolygon?.length > 1) host.append(fold(`By polygon · ${a.byPolygon.length}${a.polygonsTruncated ? ` of ${a.byPolygon.length + a.polygonsTruncated}` : ""}`, false, polygonTable(a)));
  if (a.hazardNote) host.append(para(a.hazardNote, true));
  if (a.ownArea) host.append(para(`Read over ${a.area} because nothing is drawn: draw a study area to read your own.`, true));
  const pdf = el("button", { type: "button", class: "button" }, "Report (PDF)");
  pdf.title = "Opens the report, ready to print or save as PDF";
  pdf.addEventListener("click", () => openReport(a, { print: true }, say));
  const csv = el("button", { type: "button", class: "button secondary" }, "CSV");
  csv.title = "The whole assessment as a sectioned CSV";
  csv.addEventListener("click", () => exportCsv(a, say));
  const html = el("button", { type: "button", class: "button secondary" }, "HTML");
  html.title = "The report as an HTML file";
  html.addEventListener("click", () => downloadReport(a, say));
  host.append(el("div", { class: "gis-btn-row risk-view-actions" }, pdf, csv, html));
}

const STYLE = `
.risk-view .risk-view-p { margin: 0.3rem 0 0; font-size: 0.74rem; line-height: 1.4; }
.risk-view .risk-view-p.is-quiet { opacity: 0.72; }
.risk-view .risk-view-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.35rem; margin: 0.45rem 0; }
.risk-view .risk-view-card { border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.3); border-left: 3px solid var(--nav-accent, #ff2bd6); border-radius: 0.4rem; padding: 0.3rem 0.45rem; display: grid; }
.risk-view .risk-view-card b { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.risk-view .risk-view-card span { font-size: 0.66rem; opacity: 0.75; }
.risk-view .risk-view-svg svg { display: block; width: 100%; border-radius: 0.2rem; margin: 0.2rem 0; }
.risk-view .risk-view-fold { margin: 0.35rem 0 0; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.2); border-radius: 0.45rem; padding: 0.25rem 0.45rem; }
.risk-view .risk-view-fold > summary { cursor: pointer; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; }
.risk-view .risk-view-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; margin: 0.3rem 0 0; }
.risk-view .risk-view-table th { text-align: left; font-weight: 600; opacity: 0.8; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding: 0.1rem 0.2rem; }
.risk-view .risk-view-table td { padding: 0.15rem 0.2rem; border-bottom: 1px solid rgba(255, 255, 255, 0.06); vertical-align: top; }
.risk-view .risk-view-table .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.risk-view .risk-view-table small { display: block; opacity: 0.6; font-size: 0.62rem; }
.risk-view .risk-view-table tr.is-empty td { opacity: 0.5; }
.risk-view .risk-view-table tr.is-quiet td { opacity: 0.7; font-style: italic; }
.risk-view .risk-view-sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 0.35rem; vertical-align: -1px; border: 1px solid rgba(0, 0, 0, 0.4); }
.risk-view .risk-view-stats { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.1rem 0.5rem; font-size: 0.68rem; margin: 0.35rem 0 0.2rem; }
.risk-view .risk-view-stats dt { opacity: 0.7; }
.risk-view .risk-view-stats dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.risk-view .risk-view-actions { margin-top: 0.45rem; }
`;

function injectStyle() {
  if (document.getElementById("risk-view-style")) return;
  const s = document.createElement("style");
  s.id = "risk-view-style";
  s.textContent = STYLE;
  document.head.append(s);
}
