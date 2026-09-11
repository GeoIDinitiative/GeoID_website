/**
 * THE SEISMIC BANDS — the words for each magnitude class, in a module that
 * imports nothing. The card reads it, and the card is imported by
 * `feature-popup.js`, whose test stubs `window` bare: anything this pulls in
 * at load (the frames driver, the player) would throw there. The record and
 * the driver registration live in `seismic-risk.js`.
 */
import { riskEdges, RISK_LABELS } from "./volcanic-risk.js?v=20260911-289fca0";

export const BANDS = {
  any: { label: "Shaking (≈ MMI VI) from any earthquake M ≥ 5 — per year", kicker: "Seismic risk — any earthquake" },
  m5: { label: "Shaking from M 5–5.9 earthquakes — per year", kicker: "Seismic risk — M 5", lo: 5 },
  m6: { label: "Shaking from M 6–6.9 earthquakes — per year", kicker: "Seismic risk — M 6", lo: 6 },
  m7: { label: "Shaking from M 7–7.9 earthquakes — per year", kicker: "Seismic risk — M 7", lo: 7 },
  m8: { label: "Shaking from M 8+ earthquakes — per year", kicker: "Seismic risk — M 8+", lo: 8 },
};
export const FRAME_BANDS = ["m5", "m6", "m7", "m8"];

/** The catalogue paint for the collective: `p_yr` on the shared scale. Pure, so
 * `global-data.js` can import it without dragging the frames driver in. */
export function colourRange() {
  return { field: "p_yr", edges: riskEdges(), labels: RISK_LABELS, legendLabel: BANDS.any.label, ramp: "risk" };
}
