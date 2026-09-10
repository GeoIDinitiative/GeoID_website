/**
 * THE SEISMIC RISK SCALE AND RECORD — the volcanic map's method with magnitude
 * in place of VEI. A cell's value is EARTHQUAKES OF ONE MAGNITUDE UNIT PER
 * YEAR SHAKING A POINT at about MMI VI, each event counting as the chance its
 * damaging radius reaches that far (a global-average attenuation, log-normal
 * about it), from USGS ComCat's record of every M >= 5 since 1900. Four
 * frames — M5, M6, M7, M8+ — and the collective, on the same return-period
 * scale the volcanic frames use, through the same driver.
 */

import { registerSpec } from "./risk-frames.js?v=20260910-0eaad95";
import { riskEdges, RISK_LABELS } from "./volcanic-risk.js?v=20260910-0eaad95";

export const NONE_COLOUR = "2f3b46";
export const NONE_LABEL = "no earthquake's shaking on record — not drawn";

import { BANDS, FRAME_BANDS, colourRange } from "./seismic-bands.js?v=20260910-0eaad95";
export { BANDS, FRAME_BANDS, colourRange };

export const RECORD = {
  id: "seismic-risk",
  path: "/data/global/seismic-risk",
  name: /seismic risk \(USGS ComCat/i,
};

export function riskLayer(layers = null) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  return held.find((l) => l.name && RECORD.name.test(l.name)) || null;
}

export function noteFor(epoch) {
  if (epoch.all) return `${(epoch.count || 0).toLocaleString()} cells reached, every size`;
  if (epoch.count === 0) return `${epoch.label} · none on record`;
  const n = epoch.count === null ? "…" : epoch.count.toLocaleString();
  return `${epoch.label} · ${n} cells`;
}

export function noteTitle(epoch) {
  if (epoch.all) return "The collective: earthquakes of any size (M ≥ 5) per year shaking each point at about MMI VI";
  return `Earthquakes of ${epoch.label} per year shaking each point at about MMI VI, on the same scale as every other frame`;
}

export const SPEC = registerSpec(RECORD.id, {
  path: RECORD.path,
  name: RECORD.name,
  home: "seismic",
  statusId: "seismic-status",
  ext: "usgs",
  noun: "the seismic risk map",
  plotName: "Seismic risk by magnitude",
  frames: FRAME_BANDS.map((band) => ({ band, label: band === "m8" ? "M 8+" : `M ${band[1]}`, lo: BANDS[band].lo })),
  bandLabel: (band) => BANDS[band]?.label || BANDS.any.label,
  scale: { edges: riskEdges(), labels: RISK_LABELS, noneColour: NONE_COLOUR, noneLabel: NONE_LABEL },
  noteFor,
  noteTitle,
});

if (typeof window !== "undefined") {
  window.GeoIDSeismicRisk = { BANDS, FRAME_BANDS, RECORD, SPEC, colourRange, riskLayer, noteFor, noteTitle };
}
