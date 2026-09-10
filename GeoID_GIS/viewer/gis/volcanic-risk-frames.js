/**
 * THE VOLCANIC RISK MAPS, PLAYED BY VEI — registered on the shared frames
 * driver (`risk-frames.js`), which is the cyclone tracks' bar with the size
 * class in place of the date. This file is the volcanic SPEC and nothing else:
 * where the grids live, the words for a VEI frame, and the Quaternary
 * background note for VEI 8. The driver, the paint and the one-key rule are
 * the seismic map's too.
 */

import {
  registerSpec, play as playAny, framePaint as paintAny, epochsFor as epochsAny, reachedIn,
} from "./risk-frames.js?v=20260910-e87104a";
import {
  riskEdges, RISK_LABELS, FRAME_VEIS, BANDS, RECORDS, NONE_COLOUR, NONE_LABEL,
} from "./volcanic-risk.js?v=20260910-e87104a";

export function noteFor(epoch) {
  if (epoch.all) return `${(epoch.count || 0).toLocaleString()} cells reached, every size`;
  if (epoch.count === 0) return `VEI ${epoch.vei} · none in the Holocene record`;
  const n = epoch.count === null ? "…" : epoch.count.toLocaleString();
  return `VEI ${epoch.vei} · ${n} cells${epoch.vei === 8 ? " — Quaternary background" : ""}`;
}

export function noteTitle(epoch) {
  if (epoch.all) return "The collective: eruptions of any size per year depositing at least 1 mm of ash at each point";
  if (epoch.vei === 8) {
    return "No Holocene eruption reached VEI 8 (Toba, about 74,000 years ago, is Pleistocene): "
      + "this is the QUATERNARY BACKGROUND — a global rate of about one per 17,000 years "
      + "(Rougier et al. 2018) spread over the known supereruption vents, on the same scale";
  }
  if (epoch.count === 0) {
    return `No eruption in the Smithsonian Holocene catalogue reached VEI ${epoch.vei}`;
  }
  return `Eruptions of VEI ${epoch.vei} per year depositing at least 1 mm of ash at each point, on the same scale as every other frame`;
}

const scale = { edges: riskEdges(), labels: RISK_LABELS, noneColour: NONE_COLOUR, noneLabel: NONE_LABEL };

export const SPECS = Object.fromEntries(Object.entries(RECORDS).map(([id, record]) => [id, registerSpec(id, {
  path: record.path,
  name: record.name,
  full: record.full,
  home: "volcanic-hazards",
  statusId: "volcanic-status",
  ext: "gvp",
  noun: "a volcanic risk map",
  plotName: `Volcanic risk by VEI — ${record.full ? "full Holocene record" : "windowed record"}`,
  frames: FRAME_VEIS.map((v) => ({ band: `vei${v}`, label: `VEI ${v}`, vei: v })),
  bandLabel: (band) => BANDS[band]?.label || BANDS.any.label,
  scale,
  noteFor,
  noteTitle,
})]));

/** The volcanic paint, on the volcanic scale — kept for the tests and the seam. */
export const framePaint = (features, band) => paintAny(features, SPECS["volcanic-risk"], band);
export const epochsFor = (total) => epochsAny(SPECS["volcanic-risk"], total);
export const play = (id = "volcanic-risk", opts) => playAny(id, opts);
export { reachedIn };

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskFrames = { play, epochsFor, noteFor, noteTitle, framePaint, SPECS };
}
