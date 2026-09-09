/**
 * THE VOLCANIC HAZARD ZONE CARD -- Etna Explorer's zone text, on the zone.
 *
 * A zone polygon opened the ordinary geology card: kicked off "CONTINENTAL"
 * (`crustalSetting` answering from the elevation about a buffer that is not
 * ground), titled "Mapped area", and the only thing on it was the annulus's
 * own area. The fourth card in this tree to write its own three lines
 * (`ice-card`, `soil-card`, `cyclone-risk-card`), for the same reason each of
 * them exists: every line the geology card knows how to write is about a
 * rock, and a hazard zone is not one.
 *
 * What it says is what Etna Explorer says when a zone is clicked there --
 * the band, its hazards and the paragraph explaining them -- carried in
 * `ZONES` and read back out of `etna-viewer.js` by the test. The detail
 * paragraphs name Etna's own towns; that is the schematic's provenance and
 * it is stated as such rather than rewritten as if it were about this
 * volcano.
 */

import { ZONES } from "./volcanic-hazards.js?v=20260909-40d5ccd";

export function isZoneFeature(props = {}) {
  return Number.isFinite(Number(props?.zone)) && Number.isFinite(Number(props?.outer_km))
    && typeof props?.volcano === "string";
}

export function zoneCard(props = {}) {
  const zone = ZONES[Number(props.zone)];
  if (!zone) return null;
  const volcano = props.volcano || "this volcano";
  const last = props.last_eruption != null && String(props.last_eruption).trim() !== ""
    ? `last known eruption ${props.last_eruption}` : "last eruption undated";
  return {
    kicker: `Volcanic hazard zone · ${zone.inner}–${zone.outer} km from ${volcano}`,
    title: zone.label,
    meta: `${volcano} — ${last} · ${zone.hazards}`,
    headline: zone.hazardList.map((h, i) => [i === 0 ? "Hazards" : "", h]),
    detail: zone.detail,
    note: "A schematic buffer, not a hazard map: the real extent depends on "
      + "eruption style, vent location, wind direction and topography. Where "
      + "zones of neighbouring volcanoes meet, the ground is drawn in the "
      + "worse of them.",
    source: "Zone bands and hazard text after INGV's hazard assessments for Etna, "
      + "as drawn in Etna Explorer; volcano position and eruption recency from "
      + "the Smithsonian Global Volcanism Program",
  };
}
