/**
 * What a click on the soil map says — because every line the geology card
 * knows how to write was written for a rock.
 *
 * This is `ice-card.js`'s lesson met a second time, and the symptom was worse.
 * Clicking a Podzol in the Sahel opened the geology card, which:
 *
 *   * headed it **CONTINENTAL** — `crustalSetting` answering from the
 *     elevation about something that is not crust at all;
 *   * titled it **"Unit"**, the geometry noun, because a soil polygon carries
 *     no `lith` column for `lithologyLabel` to read;
 *   * and then ran the rock-property database, found no lithology, fell
 *     through to its NO-INFORMATION PRIOR, and printed sixteen rock-mechanics
 *     parameters about a soil — uniaxial compressive strength, Hoek-Brown mi,
 *     Geological Strength Index, slake durability. Every number correct for
 *     what it claimed to be and none of it true of the ground clicked.
 *
 * A soil has a bulk density and a texture; it does not have a Brazilian
 * tensile strength. So the three lines are written here instead, and the
 * property fold is refused rather than filled with a prior — the same shape as
 * `not_applicable` in the rock database, which exists precisely because a
 * number for a quantity the material does not have is invention rather than
 * estimation.
 *
 * FAO's own measured values take its place, and they are real: sand, silt and
 * clay percentages, pH, organic carbon and bulk density, per soil unit, from
 * the workbook that ships with the map.
 */

/** Percentages, a pH and a density — what `bake-soil.py` keeps per unit. */
const MEASURED = [
  ["sand_pct", "Sand", "%"],
  ["silt_pct", "Silt", "%"],
  ["clay_pct", "Clay", "%"],
  ["ph", "pH (H₂O)", ""],
  ["organic_carbon_pct", "Organic carbon", "%"],
  ["bulk_density", "Bulk density", "kg/dm³"],
];

/**
 * Is this a polygon from the soil map?
 *
 * Keyed on the columns `bake-soil.py` writes and nothing else carries
 * together: a FAO unit code, a resolved name, and the `unit` string that is
 * the mapping unit's own symbol. A geological polygon has none of them, and a
 * drawn shape has none of them, so this cannot claim a click it should not.
 */
export function isSoilFeature(props) {
  if (!props) return false;
  return Boolean(props.code && props.name && props.unit !== undefined
    && (props.group !== undefined || props.colour !== undefined));
}

/** "PODZOLS" is FAO's own spelling; a card does not need to shout. */
function titleCase(name) {
  return String(name || "").replace(/\b[A-Z]{2,}\b/g,
    (word) => word[0] + word.slice(1).toLowerCase());
}

/**
 * The soil's own three lines, plus what FAO measured about it.
 *
 * The KICKER is the major grouping, which is the thing a reader can hold in
 * mind; the TITLE is the unit's full FAO name, which is the specific answer.
 * "Not a soil" leads instead where the polygon is water, ice, rock debris,
 * salt or dunes — those are mapped by the same sheets and are not soils, and
 * a card that called a lake a soil would be the map's own miscellaneous class
 * quietly disappearing.
 */
export function soilCard(props = {}) {
  const misc = props.group === "Not a soil" || !props.group;
  const kicker = misc ? "Not a soil" : titleCase(props.group);
  const title = props.name || props.code || "Unmapped";

  const meta = [];
  if (props.unit && props.unit !== props.code) meta.push(props.unit);
  if (props.phase) meta.push(props.phase);
  if (props.permafrost) meta.push("permafrost");

  // The headline: the texture triangle in one line, because sand/silt/clay is
  // how anybody actually names a soil, and it is the pair of numbers the
  // screening strength would be derived from.
  const headline = [];
  const { sand_pct: sand, silt_pct: silt, clay_pct: clay } = props;
  if ([sand, silt, clay].every(Number.isFinite)) {
    headline.push(["Texture (topsoil)",
      `${sand.toFixed(0)}% sand · ${silt.toFixed(0)}% silt · ${clay.toFixed(0)}% clay`]);
  }
  if (Number.isFinite(props.ph)) headline.push(["pH (H₂O)", props.ph.toFixed(1)]);
  if (Number.isFinite(props.organic_carbon_pct)) {
    headline.push(["Organic carbon", `${props.organic_carbon_pct.toFixed(1)}%`]);
  }

  const rows = MEASURED
    .filter(([key]) => Number.isFinite(props[key]))
    .map(([key, label, unit]) => [label,
      unit ? `${props[key]} ${unit}` : String(props[key])]);
  // Said once, on the card, rather than left to be discovered: these are the
  // unit's typical values from FAO's own workbook, not a measurement of this
  // polygon. A number on a card reads as a reading unless it says otherwise.
  if (rows.length) {
    rows.push(["Basis",
      "FAO's typical values for this soil unit, not a measurement of this polygon"]);
  }

  return {
    kicker,
    title,
    meta: meta.length ? meta.join(" · ") : null,
    headline: headline.length ? headline : null,
    rows,
    source: "FAO/UNESCO Digital Soil Map of the World, 1:5,000,000",
    /**
     * WHY THERE IS NO ROCK-PROPERTY FOLD, stated on the card rather than left
     * as an absence somebody has to notice. The alternative is what shipped
     * for one commit: the database's no-information prior, printed as sixteen
     * rock-mechanics parameters about a soil.
     */
    note: misc
      ? "Mapped by the soil sheets and not a soil — no soil properties apply."
      : "Rock-mechanics properties do not apply to a soil: the geology layer "
        + "beneath answers for the material under it.",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDSoilCard = { isSoilFeature, soilCard };
}
