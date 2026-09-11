/**
 * What a click on water says — a lake, a river, the open sea, a named sea.
 *
 * The sixth card in this tree to write its own lines (after ice, soil, the
 * cyclone cell, the volcanic zone and the earthquake), and for the reason each
 * of those exists: every line the geology card knows how to write was written
 * for a rock. Water through that card is headed "CONTINENTAL" or "OCEANIC" —
 * `crustalSetting` answering from the elevation about something that is not
 * crust — titled "Mapped area", and handed the rock-property database's
 * no-information prior: sixteen rock-mechanics parameters about a lake.
 *
 * Four sources, each recognised by the columns only its bake writes:
 *
 *   HydroLAKES   `volume_mcm` + `lake_type`         bake-hydrology.py
 *   GRWL         `width_median_m`                  bake-hydrology.py
 *   the sea      `class: "ocean"` and nothing else  bake-hydrology.py
 *   named seas   a marine `kind` with a `rank`      bake-hydrology.py marine
 *
 * THE BASIS OF A NUMBER IS PART OF THE NUMBER. HydroLAKES reports a surveyed
 * volume for the largest lakes and reservoirs and MODELS the rest — which is
 * nearly all of its 1.4 million — so a volume on this card always says which
 * it is, and so does the mean depth, which is that volume divided by the area.
 * A modelled volume printed bare reads as a measurement.
 */

/** Natural Earth's `featurecla` values for named marine areas. */
const MARINE_KINDS = new Set([
  "ocean", "sea", "gulf", "bay", "strait", "sound", "channel", "lagoon",
  "fjord", "river", "reef", "inlet", "generic",
]);

/** HydroLAKES `Lake_type`. */
const LAKE_KIND = { 1: "Lake", 2: "Reservoir", 3: "Regulated lake" };

/** HydroLAKES `Vol_src`. */
const VOLUME_BASIS = {
  1: "reported in the literature",
  2: "reported for the reservoir (GRanD)",
  3: "modelled — HydroLAKES' geostatistical estimate",
};

/**
 * GRWL `lakeFlag`, from the dataset's own Zenodo record (doi:10.5281/zenodo.
 * 1297434): 0 river, 1 lake/reservoir, 2 TIDAL river, 3 CANAL. SWORD, which is
 * built on GRWL, numbers the last two the other way round — a search summary
 * quoting SWORD will say 2 is a canal. It is not, here.
 */
const RIVER_KIND = { 0: "River", 1: "River through a lake", 2: "Tidal river", 3: "Canal" };

const finite = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const num = (v) => Number(v);

function fmt(value, digits = 0) {
  return num(value).toLocaleString(undefined, {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

/** Two significant figures past a thousand, more below — a modelled number
 * does not deserve six digits. */
function sig(value) {
  const v = num(value);
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 1000) return fmt(Math.round(v));
  if (a >= 100) return fmt(v, 0);
  if (a >= 10) return fmt(v, 1);
  return fmt(v, 2);
}

/**
 * Which kind of water this is, or null.
 *
 * Each test names columns only one bake writes, so this cannot claim a click
 * it should not: a soil polygon has `code`/`unit`, an ice sheet has
 * `kind: "Ice sheet"` (not a marine kind), a risk cell has `p_yr`.
 */
export function waterKind(props) {
  if (!props) return null;
  if (props.volume_mcm !== undefined && props.lake_type !== undefined) return "lake";
  if (props.width_median_m !== undefined) return "river";
  if (props.class === "ocean" && !props.name) return "sea";
  if (MARINE_KINDS.has(String(props.kind || "").toLowerCase())
    && props.name && finite(props.rank)) return "marine";
  return null;
}

export const isWaterFeature = (props) => Boolean(waterKind(props));

/** Million cubic metres, said the way a reader holds it. */
function volumeText(mcm) {
  const v = num(mcm);
  if (v >= 1000) return `${sig(v / 1000)} km³`;
  return `${sig(v)} million m³`;
}

function residenceText(days) {
  const d = num(days);
  if (d >= 730) return `about ${sig(d / 365.25)} years`;
  if (d >= 60) return `about ${sig(d / 30.44)} months`;
  return `about ${sig(d)} days`;
}

function lakeCard(p) {
  const kind = LAKE_KIND[num(p.lake_type)] || "Lake";
  const title = p.name && String(p.name).trim()
    ? String(p.name).trim()
    : `Unnamed ${kind.toLowerCase()}${p.country ? `, ${p.country}` : ""}`;
  const meta = [];
  if (p.name && p.country) meta.push(p.country);
  if (finite(p.elevation_m)) meta.push(`surface ${fmt(p.elevation_m)} m above sea level`);

  const basis = VOLUME_BASIS[num(p.volume_source)] || null;
  const modelled = num(p.volume_source) === 3;
  const headline = [];
  if (finite(p.area_km2)) headline.push(["Surface area", `${sig(p.area_km2)} km²`]);
  if (finite(p.volume_mcm) && num(p.volume_mcm) > 0) {
    headline.push(["Volume", modelled ? `${volumeText(p.volume_mcm)} (modelled)`
      : volumeText(p.volume_mcm)]);
  }
  if (finite(p.depth_avg_m) && num(p.depth_avg_m) > 0) {
    headline.push(["Mean depth", modelled ? `${sig(p.depth_avg_m)} m (modelled)`
      : `${sig(p.depth_avg_m)} m`]);
  }

  const rows = [];
  if (basis) rows.push(["Volume basis", basis]);
  if (finite(p.shore_km)) rows.push(["Shoreline", `${sig(p.shore_km)} km`]);
  if (finite(p.watershed_km2)) rows.push(["Watershed", `${sig(p.watershed_km2)} km²`]);
  if (finite(p.discharge_m3s) && num(p.discharge_m3s) > 0) {
    rows.push(["Mean outflow", `${sig(p.discharge_m3s)} m³/s (modelled)`]);
  }
  if (finite(p.residence_days) && num(p.residence_days) > 0) {
    rows.push(["Residence time", residenceText(p.residence_days)]);
  }
  if (finite(p.id)) rows.push(["HydroLAKES id", String(p.id)]);

  return {
    kind: "lake",
    kicker: kind,
    title,
    meta: meta.length ? meta.join(" · ") : null,
    headline: headline.length ? headline : null,
    rows,
    source: "HydroLAKES v1.0 (Messager et al. 2016), CC BY 4.0",
    note: modelled
      ? "The volume is HydroLAKES' geostatistical estimate, not a survey, and "
        + "the mean depth is that volume divided by the area. The outflow and "
        + "residence time come from a global hydrological model."
      : "Mean depth is the volume divided by the surface area. The outflow "
        + "and residence time come from a global hydrological model.",
  };
}

function riverCard(p) {
  const kind = RIVER_KIND[num(p.lake_flag)] || "River";
  const width = finite(p.width_median_m) ? num(p.width_median_m) : null;
  // GRWL carries no names: it is a width survey, not a gazetteer. The title is
  // what the survey measured, and the note says where names come from.
  const title = width !== null ? `${kind} channel, ${sig(width)} m wide` : `${kind} channel`;
  const headline = [];
  if (width !== null) headline.push(["Median width", `${sig(width)} m`]);
  if (finite(p.width_min_m) && finite(p.width_max_m)) {
    headline.push(["Width range", `${sig(p.width_min_m)} – ${sig(p.width_max_m)} m`]);
  }
  const rows = [];
  if (finite(p.width_mean_m)) rows.push(["Mean width", `${sig(p.width_mean_m)} m`]);
  if (finite(p.width_sd_m)) rows.push(["Width spread (1 σ)", `${sig(p.width_sd_m)} m`]);
  if (finite(p.measurements) && num(p.measurements) > 0) {
    rows.push(["Width measurements", `${fmt(p.measurements)} along the segment`]);
  }
  if (finite(p.id)) rows.push(["GRWL record", String(p.id)]);
  return {
    kind: "river",
    kicker: kind,
    title,
    meta: "Width at mean discharge, measured from Landsat",
    headline: headline.length ? headline : null,
    rows,
    source: "GRWL — Global River Widths from Landsat v01.01 (Allen & Pavelsky 2018), CC BY 4.0",
    note: "GRWL maps rivers and streams at least 30 m wide and gives them no "
      + "names; the Natural Earth rivers row carries the names of the large "
      + "ones.",
  };
}

function seaCard() {
  return {
    kind: "sea",
    kicker: "Ocean",
    title: "Open sea",
    meta: "Coastline-exact from zoom 4; Natural Earth 1:10m from orbit",
    headline: null,
    rows: [],
    source: "© OpenStreetMap contributors (ODbL 1.0) · Natural Earth, public domain",
    note: "The named-waters row says which sea, gulf or strait this is.",
  };
}

function marineCard(p) {
  const kind = String(p.kind || "").toLowerCase();
  const kicker = kind === "generic" ? "Named water"
    : kind === "river" ? "Estuary"
      : kind.charAt(0).toUpperCase() + kind.slice(1);
  return {
    kind: "marine",
    kicker,
    title: String(p.name),
    meta: "Named marine area, Natural Earth 1:10m",
    headline: null,
    rows: [["Map rank", `${fmt(p.rank)} — lower is shown from further out`]],
    source: "Natural Earth 1:10m marine areas, public domain",
    note: "A named area is a label's extent, not a surveyed boundary: where one "
      + "sea ends and the next begins is a convention.",
  };
}

/** The card's own lines, or null where this is not water. */
export function waterCard(props = {}) {
  switch (waterKind(props)) {
    case "lake": return lakeCard(props);
    case "river": return riverCard(props);
    case "sea": return seaCard(props);
    case "marine": return marineCard(props);
    default: return null;
  }
}

/** The columns the card has already said, so the Attributes fold need not. */
export const WATER_SAID = /^(id|name|country|lake_type|class|colour|area_km2|volume_mcm|depth_avg_m|elevation_m|shore_km|residence_days|watershed_km2|discharge_m3s|volume_source|width_median_m|width_mean_m|width_min_m|width_max_m|width_sd_m|lake_flag|measurements|kind|rank)$/i;

if (typeof window !== "undefined") {
  window.GeoIDWaterCard = { waterKind, isWaterFeature, waterCard };
}
