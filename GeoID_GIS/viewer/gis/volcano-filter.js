/**
 * THE VOLCANO YEAR FILTER -- which Smithsonian volcanoes are on the globe at
 * all, and therefore which ones the hazard buffers are drawn around.
 *
 * ONE FILTER, TWO CONSUMERS, IN THAT ORDER. The year filter used to sit
 * beside the buffers as a separate "Around" select while the points stayed
 * drawn whatever it said, so the plot showed volcanoes the buffers ignored
 * and the reader had two time frames to reconcile. Now the filter decides the
 * plotted set first -- a volcano outside the time frame leaves the points,
 * the labels and the click pick -- and the buffers are drawn only around what
 * is left. Nothing downstream may admit a volcano this has removed.
 *
 * The time frame is the catalogue's own `label_rank` (bake-volcanoes.py):
 * 5 = erupted since 2000, 4 = since 1900, 3 = since 1500, 2 = any dated
 * Holocene eruption, 1 = Holocene but undated, 0 = Pleistocene. The filter
 * keeps rank >= minRank, so 0 keeps everything.
 *
 * PURE: no DOM, no layer objects. catalogue-panels.js applies it to the
 * point layer and volcanic-hazards.js re-applies it before building zones.
 */

/** The select's values, oldest-inclusive last, and what each one admits. */
export const YEAR_FILTER = {
  0: "Every volcano (Holocene and Pleistocene)",
  1: "Every Holocene volcano",
  2: "Any dated Holocene eruption",
  3: "Erupted since 1500",
  4: "Erupted since 1900",
  5: "Erupted since 2000",
};

/** Opens showing every volcano, as the layer always has. */
export const DEFAULT_YEAR_RANK = 0;

/** A select value as a rank in 0..5; anything else is the default. */
export function yearRankOf(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_YEAR_RANK;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : DEFAULT_YEAR_RANK;
}

/** Is this volcano inside the time frame? An unranked one counts as rank 0. */
export function inTimeFrame(feature, minRank) {
  const rank = Number(feature?.properties?.label_rank);
  return (Number.isFinite(rank) ? rank : 0) >= minRank;
}

/**
 * The plotted set: inside the time frame AND of a type that is ticked on.
 * `typesOff` is a Set of `type_group` values switched off.
 */
export function filterVolcanoes(features, { minRank = DEFAULT_YEAR_RANK, typesOff = null } = {}) {
  return (features || []).filter((f) => {
    if (!inTimeFrame(f, minRank)) return false;
    if (typesOff && typesOff.size) {
      const type = f?.properties?.type_group;
      if (type !== null && type !== undefined && typesOff.has(String(type))) return false;
    }
    return true;
  });
}

/** The status line's words for the time frame: "erupted since 1900". */
export const yearWords = (rank) => {
  const text = YEAR_FILTER[yearRankOf(rank)] || YEAR_FILTER[DEFAULT_YEAR_RANK];
  return text.charAt(0).toLowerCase() + text.slice(1);
};
