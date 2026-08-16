/**
 * The 16-day risk panel: a susceptibility map, plus the weather that acts on
 * it, read at a point you choose.
 *
 * The point comes from wherever you already are — the view centre, the study
 * area, or a coordinate typed in — and the susceptibility from whichever
 * loaded raster you pick, so this is not specific to the NI prototype: any
 * susceptibility, hazard or index raster on the globe can be run against the
 * forecast. The prototype is simply the one that ships with the site.
 */

import {
  forecastRiskAt, SOURCE, DEFAULTS, bandOf,
} from "./forecast.js";

const HOST_ID = "gis-forecast-host";

const BAND_COLOUR = {
  high: "#d7191c",
  moderate: "#fdae61",
  low: "#ffffbf",
  minimal: "#3d8f4e",
};

const STYLE = `
#${HOST_ID} .gis-forecast-row { display: flex; gap: 0.4rem; align-items: center; margin-bottom: 0.4rem; }
#${HOST_ID} .gis-forecast-row select { flex: 1 1 auto; min-width: 0; }
#${HOST_ID} .gis-forecast-chart { width: 100%; height: 74px; display: block; margin: 0.3rem 0 0.2rem; }
#${HOST_ID} .gis-forecast-scale { display: flex; justify-content: space-between; font-size: 0.6rem; opacity: 0.7; }
#${HOST_ID} .gis-forecast-table { width: 100%; border-collapse: collapse; font-size: 0.64rem; margin-top: 0.4rem; }
#${HOST_ID} .gis-forecast-table th { text-align: left; font-weight: 500; opacity: 0.7; padding: 0.1rem 0.2rem; }
#${HOST_ID} .gis-forecast-table td { padding: 0.1rem 0.2rem; white-space: nowrap; }
#${HOST_ID} .gis-forecast-band { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 0.1rem; margin-right: 0.3rem; }
#${HOST_ID} .gis-forecast-note { font-size: 0.6rem; opacity: 0.68; margin-top: 0.45rem; line-height: 1.35; }
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function susceptibilityLayers() {
  return (window.GeoIDImportManager?.getSampleableLayers?.() || [])
    .filter((layer) => layer.sampler);
}

/** A sparkline of rain bars with the risk line over them. */
function chart(days) {
  const w = 260;
  const h = 74;
  const pad = { l: 2, r: 2, t: 6, b: 12 };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "gis-forecast-chart");
  svg.setAttribute("preserveAspectRatio", "none");
  const maxRain = Math.max(1, ...days.map((d) => d.precipMm || 0));
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const step = innerW / days.length;

  days.forEach((day, i) => {
    const barH = (day.precipMm / maxRain) * innerH;
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", String(pad.l + i * step + step * 0.15));
    rect.setAttribute("y", String(pad.t + innerH - barH));
    rect.setAttribute("width", String(step * 0.7));
    rect.setAttribute("height", String(Math.max(0, barH)));
    rect.setAttribute("fill", "rgba(89, 242, 255, 0.45)");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${day.date}: ${day.precipMm} mm`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });

  if (days.some((d) => Number.isFinite(d.risk))) {
    const points = days.map((day, i) => {
      const x = pad.l + i * step + step / 2;
      const y = pad.t + innerH - (day.risk || 0) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute("points", points);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#ff3cac");
    line.setAttribute("stroke-width", "1.6");
    svg.appendChild(line);
    days.forEach((day, i) => {
      const dot = document.createElementNS(svg.namespaceURI, "circle");
      dot.setAttribute("cx", String(pad.l + i * step + step / 2));
      dot.setAttribute("cy", String(pad.t + innerH - (day.risk || 0) * innerH));
      dot.setAttribute("r", "1.8");
      dot.setAttribute("fill", BAND_COLOUR[day.band] || "#ff3cac");
      svg.appendChild(dot);
    });
  }
  return svg;
}

function table(days) {
  const t = el("table", "gis-forecast-table");
  const head = el("tr");
  ["Day", "Rain", "3-day", "Risk"].forEach((h) => head.appendChild(el("th", null, h)));
  t.appendChild(head);
  days.forEach((day) => {
    const row = el("tr");
    row.appendChild(el("td", null, day.date.slice(5)));
    row.appendChild(el("td", null, `${day.precipMm} mm`));
    row.appendChild(el("td", null, `${day.burstMm} mm`));
    const risk = el("td");
    if (Number.isFinite(day.risk)) {
      const chip = el("span", "gis-forecast-band");
      chip.style.background = BAND_COLOUR[day.band] || "#888";
      risk.append(chip, document.createTextNode(`${day.risk.toFixed(2)} ${day.band}`));
    } else {
      risk.textContent = "—";
    }
    row.appendChild(risk);
    t.appendChild(row);
  });
  return t;
}

function build(host) {
  host.innerHTML = "";
  if (!document.getElementById("gis-forecast-style")) {
    const style = el("style");
    style.id = "gis-forecast-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const pick = el("div", "gis-forecast-row");
  const select = document.createElement("select");
  select.className = "input";
  select.id = "gis-forecast-layer";
  const refresh = () => {
    const held = select.value;
    select.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Rain only (no susceptibility)";
    select.appendChild(none);
    susceptibilityLayers().forEach((layer) => {
      const option = document.createElement("option");
      option.value = layer.id != null ? String(layer.id) : layer.name;
      option.textContent = layer.name;
      select.appendChild(option);
    });
    if (held) select.value = held;
  };
  refresh();
  window.GeoIDImportManager?.onChange?.(refresh);
  pick.appendChild(select);

  const run = el("button", "button primary", "16-day risk here");
  run.type = "button";
  run.id = "gis-forecast-run";

  const status = el("div", "gis-metric", "");
  const output = el("div");

  run.addEventListener("click", async () => {
    const centre = window.GeoIDViewer?.getViewCentreLatLon?.();
    if (!centre || !Number.isFinite(centre.lat)) {
      status.textContent = "The view centre is not on the globe — turn it to face the area first.";
      return;
    }
    let lon = ((centre.lon % 360) + 360) % 360;
    if (lon > 180) lon -= 360;
    const chosen = susceptibilityLayers()
      .find((l) => String(l.id ?? l.name) === select.value) || null;
    run.disabled = true;
    status.textContent = `Asking ${SOURCE.name} for ${DEFAULTS.days} days at `
      + `${centre.lat.toFixed(3)}, ${lon.toFixed(3)}…`;
    output.innerHTML = "";
    try {
      const result = await forecastRiskAt({ lat: centre.lat, lon, layer: chosen });
      const peak = result.days.reduce((best, d) =>
        (Number.isFinite(d.risk) && (!best || d.risk > best.risk)) ? d : best, null);
      status.textContent = result.susceptibility == null
        ? `Rain at ${result.at.lat.toFixed(2)}, ${result.at.lon.toFixed(2)} — `
          + "pick a susceptibility layer to turn it into risk."
        : `Susceptibility ${result.susceptibility.toFixed(2)} here; `
          + `peak risk ${peak.risk.toFixed(2)} (${peak.band}) on ${peak.date}.`;
      output.appendChild(chart(result.days));
      const scale = el("div", "gis-forecast-scale");
      scale.append(el("span", null, result.days[0].date),
        el("span", null, result.days[result.days.length - 1].date));
      output.appendChild(scale);
      output.appendChild(table(result.days));
      const note = el("div", "gis-forecast-note",
        `${SOURCE.attribution}. Risk = susceptibility × a rainfall trigger `
        + `(${DEFAULTS.burstDays}-day and ${DEFAULTS.antecedentDays}-day windows against `
        + `${DEFAULTS.burstMm} mm and ${DEFAULTS.antecedentMm} mm). The thresholds are `
        + "published regional values, not calibrated against an inventory: this ranks the "
        + "next sixteen days against each other, it does not forecast failures.");
      output.appendChild(note);
    } catch (error) {
      status.textContent = `Forecast failed: ${error.message}`;
    } finally {
      run.disabled = false;
    }
  });

  host.append(pick, run, status, output);
}

function boot() {
  const host = document.getElementById(HOST_ID);
  if (host) build(host);
}

if (typeof window !== "undefined") {
  window.GeoIDForecastPanel = { build, bandOf };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
