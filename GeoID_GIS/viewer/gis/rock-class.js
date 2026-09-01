/**
 * WHAT KIND OF ROCK IS THIS, from the only column that says.
 *
 * Macrostrat's Burwell compilation ships a unit's `name`, its `color` and a
 * free-text `lith` — "sandstone and conglomerate, interbedded", "psammite and
 * pelite", "mafic lava and mafic tuff". There is no rock-class field and no
 * crustal-setting field: the three-fold igneous / metamorphic / sedimentary
 * division that every geologist reads a map by has to be derived from that
 * string, and the map's own card was showing the unit name twice instead.
 *
 * Pure and dependency-free so the test can run it in Node against real `lith`
 * strings pulled off the live tiles.
 *
 * WHAT THIS IS NOT. A lithology string is what the survey wrote down, not a
 * classification it made, so this is an INTERPRETATION of the source and the
 * card says so. Where the string carries no rock term at all the answer is
 * null and the card shows nothing rather than guessing — a wrong rock class on
 * a geological map is worse than an absent one.
 */

/**
 * Terms, longest first within each class so a compound name is not eaten by
 * the shorter term inside it ("meta-limestone" before "limestone").
 *
 * Matched on WORD BOUNDARIES, which is what keeps `tuff` (a volcanic ash) from
 * matching `tufa` (a freshwater limestone) — two rocks one letter apart in
 * different classes, and the pair most likely to be got wrong silently.
 */
const IGNEOUS = [
  "granodiorite", "granophyre", "lamprophyre", "carbonatite",
  "anorthosite", "pyroxenite", "ignimbrite", "peridotite", "komatiite",
  "phonolite", "monzonite", "pegmatite", "porphyry", "trachyte", "tephrite",
  "obsidian", "andesite", "batholith", "kimberlite", "agglomerate",
  "rhyolite", "tonalite", "dolerite", "diabase", "gabbro", "diorite",
  "granite", "syenite", "basalt", "dacite", "latite", "aplite", "scoria",
  "pumice", "dunite", "pluton", "tuff", "lava", "igneous", "volcanic",
  "plutonic", "intrusive", "extrusive", "hypabyssal", "pyroclastic",
  "trap-rock", "greisen",
];

const METAMORPHIC = [
  "metasedimentary", "metavolcanic", "meta-limestone", "metasediment",
  "serpentinite", "amphibolite", "granulite", "migmatite", "charnockite",
  "greenschist", "blueschist", "calcsilicate", "calc-silicate", "granofels",
  "semipelite", "quartzite", "eclogite", "hornfels", "mylonite", "greenstone",
  "phyllite", "psammite", "gneiss", "schist", "marble", "slate", "pelite",
  "skarn", "metamorphic", "meta-igneous",
];

const SEDIMENTARY = [
  "conglomerate", "diamictite", "phosphorite", "calcarenite",
  "dolostone", "sandstone", "siltstone", "mudstone", "claystone", "limestone",
  "ironstone", "travertine", "greywacke", "graywacke", "turbidite", "evaporite",
  "anhydrite", "colluvium", "alluvium", "arenite", "arkose", "breccia",
  "dolomite", "gypsum", "halite", "lignite", "laterite", "bauxite", "molasse",
  "flysch", "loess", "chalk", "chert", "shale", "wacke", "marl", "coal",
  "peat", "till", "tufa", "sand", "silt", "clay", "gravel", "mud",
  "sedimentary", "carbonate",
];

/**
 * Terms that make a unit OCEANIC CRUST wherever it now sits.
 *
 * An ophiolite is a slice of ocean floor, and obduction puts it on a mountain
 * range — so this is affinity, not present position, and it OUTRANKS the
 * elevation test below for exactly that reason.
 */
const OCEANIC_ROCK = [
  "ophiolite", "oceanic crust", "pillow lava", "pillow basalt", "sheeted dike",
  "sheeted dyke", "abyssal", "pelagic", "boninite", "seamount", "oceanic",
];

/**
 * A COMPOSITION IS NOT A ROCK, and weighting it as one inverts the answer.
 *
 * "mafic gneiss" is a gneiss — a metamorphic rock — of mafic composition, and
 * scoring `mafic` and `gneiss` equally made it a tie, which this refuses. It
 * was the single commonest miss on the live layer: **40 polygons**. So an
 * adjective counts, because a string of nothing but adjectives should still
 * answer, and it counts for LESS than the noun it is describing.
 */
const MODIFIERS = {
  Igneous: ["mafic", "felsic", "ultramafic", "andesitic", "basaltic", "granitic",
    "rhyolitic", "doleritic", "volcaniclastic"],
  Metamorphic: ["metamorphosed", "schistose", "gneissose", "migmatitic"],
  Sedimentary: ["calcareous", "argillaceous", "arenaceous", "clastic",
    "siliciclastic", "dolomitic", "sandy", "silty", "clayey", "muddy"],
};
const MODIFIER_WEIGHT = 0.5;

/**
 * `meta-` A ROCK is metamorphic, whatever rock follows it.
 *
 * The list cannot hold every compound a survey writes:
 * "metavolcaniclastic igneous-rock and metavolcaniclastic sedimentary-rock"
 * scored one igneous and one sedimentary and tied, when the prefix on both
 * halves is the whole answer. 11 polygons on the live layer.
 *
 * `meta` plus ANY three letters was the first attempt and is too greedy by
 * far: "metalliferous sandstone" is a sandstone with metal in it, and that
 * rule made it a tie and then nothing. So the prefix has to sit in front of a
 * rock this module already knows — which is also why the compound does not
 * double-count for its own class, since the term inside it has a letter before
 * it and fails its own word boundary.
 */
const META_TERMS = [...IGNEOUS, ...METAMORPHIC, ...SEDIMENTARY,
  ...Object.values(MODIFIERS).flat()];

function metaPrefixHits(text) {
  let count = 0;
  for (const term of META_TERMS) {
    const pattern = new RegExp(`(^|[^a-z])meta-?${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    const found = text.match(pattern);
    if (found) count += found.length;
  }
  return count;
}

const CLASSES = [
  ["Igneous", IGNEOUS],
  ["Metamorphic", METAMORPHIC],
  ["Sedimentary", SEDIMENTARY],
];

function hits(text, terms) {
  let count = 0;
  for (const term of terms) {
    /**
     * Word boundaries on both ends, with hyphens treated as boundaries so
     * "meta-limestone" and "igneous-rock" match the way a reader reads them —
     * and an optional plural, because a survey writes "carbonates,
     * consolidated" as readily as "carbonate" and a boundary after the `e`
     * refuses the first.
     */
    const pattern = new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?($|[^a-z])`, "g");
    const found = text.match(pattern);
    if (found) count += found.length;
  }
  return count;
}

/**
 * The three-fold class, or null.
 *
 * Scored rather than first-match, because a lithology string routinely names
 * rocks of two classes ("marble, meta-limestone" carries a sedimentary term
 * and two metamorphic ones) and the class with more of the string behind it is
 * the one the unit is. A tie is not resolved: an even mix of sandstone and
 * basalt is genuinely both, and "Sedimentary" over it would be a claim the
 * source does not support.
 */
export function rockClass(...sources) {
  const text = sources.map((s) => String(s ?? "").toLowerCase()).join(" ; ");
  if (!text.trim()) return null;
  const scores = CLASSES.map(([label, terms]) => ({
    label,
    score: hits(text, terms)
      + hits(text, MODIFIERS[label] || []) * MODIFIER_WEIGHT
      + (label === "Metamorphic" ? metaPrefixHits(text) : 0),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scores.length) return null;
  if (scores.length > 1 && scores[0].score === scores[1].score) return null;
  return scores[0].label;
}

/**
 * The depth at which this stops calling crust continental.
 *
 * Continental crust does not end at the coast: it carries the shelf and most
 * of the slope, and the continent–ocean boundary is generally somewhere
 * between 2,500 and 4,000 m of water. 2,500 m keeps every shelf sea — the
 * North Sea, the Irish Sea, Sunda, the Grand Banks — on the continent it
 * belongs to, which is where a geological map of them belongs too.
 */
export const OCEANIC_DEPTH_M = -2500;

/**
 * Oceanic or continental, and NEITHER IS PUBLISHED.
 *
 * Macrostrat's carto layer is a compilation of LAND geology; no polygon in it
 * carries a crustal setting, so this is inferred from two things that are
 * real: the rock, where the rock is diagnostic (an ophiolite is ocean floor
 * whatever it now sits on), and otherwise the water depth here. Returns null
 * when neither can answer, so the card can say the class alone rather than
 * inventing the half it does not know.
 */
export function crustalSetting(lith, elevationM) {
  const text = String(lith ?? "").toLowerCase();
  if (text.trim() && hits(text, OCEANIC_ROCK) > 0) return "Oceanic";
  if (!Number.isFinite(elevationM)) return null;
  return elevationM <= OCEANIC_DEPTH_M ? "Oceanic" : "Continental";
}

/**
 * The card's subtitle: "Igneous — Continental", or whichever half is known.
 *
 * An em dash rather than a hyphen because the two halves are separate
 * statements about the unit and not a compound word.
 */
export function rockClassLabel(rockClassName, setting) {
  const parts = [rockClassName, setting].map((p) => String(p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

/** What the classification was read off, for the card's detail row. */
export function classificationBasis(rockClassName, setting, elevationM) {
  if (!rockClassName && !setting) return null;
  const parts = [];
  if (rockClassName) parts.push("rock class from the unit's own lithology");
  if (setting === "Oceanic" || setting === "Continental") {
    parts.push(Number.isFinite(elevationM)
      ? `setting from the elevation here (${Math.round(elevationM).toLocaleString()} m)`
      : "setting from the unit's own lithology");
  }
  return `Interpreted: ${parts.join("; ")}.`;
}
