/**
 * THE GEOTECHNICAL PROPERTIES OF WHATEVER IS UNDER THE CURSOR.
 *
 * `data/global/rock-properties.json` holds a cited property range for every
 * one of the 214 lithologies in Macrostrat's published dictionary. This is the
 * half that turns a map polygon into a number: the polygon carries a free-text
 * `lith` string, and this resolves that string to the lithologies in it, in the
 * proportions the string states, and combines their properties.
 *
 * A MIXTURE IS THE NORMAL CASE, not the exception. Measured on the live
 * layer, most `lith` strings name two or more rocks -- "sandstone, siltstone
 * and mudstone", "Major:{limestone}, Minor:{claystone,siltstone}" -- and the
 * three of those have UCS ranges an order of magnitude apart. A resolver that
 * takes the first name it recognises answers with a third of the unit.
 *
 * TWO THINGS THIS DOES NOT DO, both on purpose:
 *
 * It does not average a range away. A combined answer carries the full span of
 * its constituents alongside a representative value, because the span is the
 * honest part -- these are literature ranges for a rock NAME, and a single
 * number from one is a false precision the source does not support.
 *
 * And it does not turn intact properties into rock-mass properties. That needs
 * a GSI, which is a field observation of the outcrop; `hoek_brown_mi` is
 * carried so the conversion can be made deliberately, by someone who has
 * looked.
 */

const DATA_URL = new URL("../../data/global/rock-properties.json", import.meta.url);

let loading = null;
let database = null;

/**
 * The database, fetched once.
 *
 * Module-relative, because a document-relative path resolves against the
 * viewer's index one directory up -- the trap `map-layers.js` and the GEE
 * cache each paid for from opposite directions.
 */
export async function loadRockProperties() {
  if (database) return database;
  if (!loading) {
    loading = fetch(DATA_URL.href)
      .then((response) => {
        if (!response.ok) throw new Error(`rock-properties.json: HTTP ${response.status}`);
        return response.json();
      })
      .then((body) => { database = body; return body; })
      .catch((error) => { loading = null; throw error; });
  }
  return loading;
}

/** The loaded database, or null. For callers that must stay synchronous. */
export function rockPropertiesNow() {
  return database;
}

/** Test seam: hand it a database rather than fetching one. */
export function useRockProperties(data) {
  database = data;
  loading = data ? Promise.resolve(data) : null;
  return database;
}

/**
 * PROPORTION WORDS, because a survey states them and they change the answer.
 *
 * "Major:{limestone}, Minor:{claystone,siltstone}" is the BGS spelling and
 * "sandstone with subordinate shale" is the prose one. Reading either as an
 * even mixture puts a mudrock's strength into a limestone's map at equal
 * weight, and mudrock is the constituent that fails.
 */
const PROPORTION = [
  { pattern: /\bmajor\b/i, weight: 4 },
  { pattern: /\bdominant(ly)?\b/i, weight: 4 },
  { pattern: /\bmainly\b/i, weight: 4 },
  { pattern: /\bpredominant(ly)?\b/i, weight: 4 },
  { pattern: /\bminor\b/i, weight: 1 },
  { pattern: /\bsubordinate\b/i, weight: 1 },
  { pattern: /\boccasional\b/i, weight: 0.5 },
  { pattern: /\brare\b/i, weight: 0.5 },
  { pattern: /\btrace\b/i, weight: 0.25 },
];

const DEFAULT_WEIGHT = 2;

/**
 * Split a lithology string into its clauses, keeping each clause's own
 * proportion word with it.
 *
 * `Major:{a}, Minor:{b,c}` groups by the brace; everything else splits on
 * commas, semicolons, " and " and " with ", which is how these strings are
 * written in every survey seen on the layer.
 */
function clausesOf(text) {
  const source = String(text || "");
  const braced = [...source.matchAll(/([a-z]+)\s*:\s*\{([^}]*)\}/gi)];
  if (braced.length) {
    return braced.map((match) => ({ label: match[1], body: match[2] }));
  }
  return source
    .split(/[;,]|\band\b|\bwith\b/i)
    .map((part) => ({ label: part, body: part }))
    .filter((part) => part.body.trim());
}

function weightOf(label) {
  for (const rule of PROPORTION) {
    if (rule.pattern.test(label)) return rule.weight;
  }
  return DEFAULT_WEIGHT;
}

/**
 * Which named lithologies is this string made of, and in what proportion.
 *
 * Longest name first, and each match consumes its own text, so "quartz
 * arenite" is one lithology and not a quartz plus an arenite, and
 * "meta-limestone" does not also register as a limestone.
 */
export function resolveLithology(text, data = database) {
  if (!data) return [];
  /**
   * THE ALIASES ARE PART OF THE VOCABULARY, not a fallback tried afterwards.
   *
   * Measured against 3,377 distinct `lith` strings from twelve surveys, the
   * dictionary's own 214 names resolve 98.2% of them; the rest are the map
   * naming a composition ("granitic rocks"), a regional term the dictionary
   * does not list (`siltite`, `psammite`) or a rare rock. Searched in one pass
   * with the dictionary, longest first, so "metasandstone" is matched whole
   * rather than as a sandstone with a prefix nobody read.
   */
  const entryFor = (name) => data.lithologies[name] || data.aliases?.[name] || null;
  const names = [...Object.keys(data.lithologies), ...Object.keys(data.aliases || {})]
    .sort((a, b) => b.length - a.length);
  const found = new Map();
  for (const clause of clausesOf(text)) {
    let body = ` ${String(clause.body || "").toLowerCase()} `;
    const weight = weightOf(clause.label);
    for (const name of names) {
      // Word boundaries, and hyphens count as boundaries: the same rule
      // `rock-class.js` uses, and for the same reason -- `tuff` and `tufa` are
      // one letter apart in different classes.
      const pattern = new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?($|[^a-z])`, "g");
      if (!pattern.test(body)) continue;
      body = body.replace(pattern, " ");
      const entry = entryFor(name);
      if (!entry) continue;
      const row = found.get(name) || { name, weight: 0, entry };
      row.weight += weight;
      found.set(name, row);
    }
  }
  const rows = [...found.values()];
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  return rows
    .map((row) => ({ ...row, fraction: total ? row.weight / total : 0 }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * A LOG QUANTITY IS AVERAGED IN THE LOG, and hydraulic conductivity is the
 * reason this rule exists here.
 *
 * A unit that is half sandstone (1e-7 m/s) and half mudstone (1e-11) has an
 * arithmetic mean of 5e-8 -- indistinguishable from the sandstone alone,
 * because the arithmetic mean of quantities spanning four orders of magnitude
 * is just the largest of them. The geometric mean is 1e-9, which is the
 * answer, and it is also what a hydrogeologist means by an average
 * permeability. Every parameter declares its own scale in the database.
 */
function combine(values, weights, scale) {
  const pairs = values.map((v, i) => [v, weights[i]])
    .filter(([v]) => Number.isFinite(v));
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (!total) return null;
  if (scale === "log") {
    // A zero or negative cannot be logged; those are real values (residual
    // cohesion is zero) so they fall back to the arithmetic mean rather than
    // taking the whole answer out.
    if (pairs.every(([v]) => v > 0)) {
      const sum = pairs.reduce((acc, [v, w]) => acc + w * Math.log(v), 0);
      return Math.exp(sum / total);
    }
  }
  return pairs.reduce((acc, [v, w]) => acc + w * v, 0) / total;
}

/**
 * The properties of a lithology string.
 *
 * Returns one row per parameter carrying the combined representative value,
 * the FULL SPAN of the constituents (min of mins to max of maxes, because a
 * mixture can be anywhere between its parts), and every source behind it.
 */
export function propertiesFor(text, data = database) {
  if (!data) return null;
  const parts = resolveLithology(text, data);
  /**
   * A UNIT WHOSE SOURCE NAMES NO ROCK still gets an answer.
   *
   * Measured on the live layer, 521 of 6,232 polygons in view carried a blank
   * `lith` — all from one survey that ships no lithology in any column. A card
   * can say "not stated"; a model cannot, so the database carries a
   * no-information prior (the whole range of ground materials, median typical)
   * and it is used here. It is flagged `prior` every step of the way so the
   * map can keep it in its own class and nothing mistakes it for a unit that
   * was actually mapped.
   */
  if (!parts.length) {
    const fallback = data.references?.unstated;
    if (!fallback) return { lithologies: [], parameters: {}, unresolved: true };
    const parameters = {};
    for (const [key, meta] of Object.entries(data.parameters)) {
      const row = fallback.properties[key];
      if (!row || row.basis === "not_applicable") continue;
      parameters[key] = {
        ...meta, key, min: row.min, max: row.max,
        value: row.typical ?? (row.min + row.max) / 2,
        sources: [], basis: "analogue", confidence: "none",
        notes: [row.note], from: 0, of: 0, prior: true,
      };
    }
    return { lithologies: [], parameters, unresolved: true, prior: true };
  }

  const weights = parts.map((p) => p.weight);
  const refs = parts.map((p) => data.references[p.entry.reference]);
  const parameters = {};

  for (const [key, meta] of Object.entries(data.parameters)) {
    const rows = refs.map((ref) => ref?.properties?.[key] || null);
    if (!rows.some(Boolean)) continue;
    /**
     * "DOES NOT APPLY" IS AN ANSWER, and a different one from "not known".
     *
     * A soil has no Hoek-Brown mi and no GSI — those describe a jointed rock
     * mass, and a number for them over an alluvial fan would be invention. The
     * database assigns those cells rather than leaving them empty, and this is
     * where the two part company: a parameter every constituent refuses is
     * reported as `notApplicable` with its reason, so a map can draw it as its
     * own class instead of as a hole, and a model can skip it knowingly.
     */
    const applicable = rows.filter((row) => row && row.basis !== "not_applicable");
    if (!applicable.length) {
      parameters[key] = {
        ...meta, key, notApplicable: true,
        reason: rows.find((row) => row?.reason)?.reason || null,
        sources: [], basis: "not_applicable", notes: [], from: 0, of: parts.length,
      };
      continue;
    }
    const present = rows.map((row, i) => ({ row, w: weights[i] }))
      .filter((r) => r.row && r.row.basis !== "not_applicable");
    const mins = present.map((r) => r.row.min);
    const maxes = present.map((r) => r.row.max);
    const typicals = present.map((r) => (r.row.typical ?? (r.row.min + r.row.max) / 2));
    const ws = present.map((r) => r.w);
    const sources = [...new Set(present.flatMap((r) => r.row.sources || []))];
    const bases = [...new Set(present.map((r) => r.row.basis))];
    parameters[key] = {
      ...meta,
      key,
      min: Math.min(...mins),
      max: Math.max(...maxes),
      value: combine(typicals, ws, meta.scale),
      sources,
      basis: bases.length === 1 ? bases[0] : "mixed",
      /**
       * The WEAKEST link, because a combined value is only as good as the worst
       * of the values behind it — an average of a measured range and a
       * class-analogue guess is a guess.
       */
      confidence: ["n/a", "lowest", "low", "medium", "high"].find((level) =>
        present.some((r) => (r.row.confidence || "low") === level)) || "low",
      notes: present.map((r) => r.row.note).filter(Boolean),
      // Which constituents actually answered: a parameter present for the
      // sandstone half and absent for the mudstone half is not a property of
      // the unit, and saying so is cheaper than a footnote nobody reads.
      from: present.length,
      of: parts.length,
    };
  }

  return {
    lithologies: parts.map((p) => ({
      name: p.name,
      fraction: p.fraction,
      class: p.entry.class || null,
      type: p.entry.type || null,
      reference: p.entry.reference,
      // An alias is not in the dictionary, and a reader should be able to see
      // that this term was interpreted rather than looked up.
      alias: Boolean(data.aliases?.[p.name]),
      inherited_via: p.entry.inherited_via || null,
      state: p.entry.state,
    })),
    parameters,
    unresolved: false,
  };
}

/**
 * Which of the three answers this ground has for a parameter.
 *
 * `value` — a number. `not_applicable` — the quantity does not exist for this
 * material, and the reason says why. `unknown` — the lithology string named
 * nothing this database recognises, which after the alias table is ice-free
 * ground nobody has mapped rather than a rock nobody has tested.
 */
export function parameterState(text, key, data = database) {
  const resolved = propertiesFor(text, data);
  if (!resolved) return { state: "unknown" };
  const row = resolved.parameters?.[key];
  if (!row) return { state: "unknown" };
  if (row.notApplicable) return { state: "not_applicable", reason: row.reason };
  if (!Number.isFinite(row.value)) return { state: "unknown" };
  // A prior is a VALUE — a model gets a number — and a separate state, so a
  // map can show where the prior is doing the work rather than the ground.
  if (row.prior) return { state: "prior", value: row.value, row };
  return { state: "value", value: row.value, row };
}

/** One parameter's representative value, for painting a map by it. */
export function parameterValue(text, key, data = database) {
  const resolved = propertiesFor(text, data);
  const row = resolved?.parameters?.[key];
  return row && Number.isFinite(row.value) ? row.value : null;
}

/** The parameters a map can be painted by, grouped as the panel shows them. */
export function parameterList(data = database) {
  if (!data) return [];
  return Object.entries(data.parameters).map(([key, meta]) => ({ key, ...meta }));
}

/** Every source behind a resolved answer, as citation strings. */
export function citationsFor(resolved, data = database) {
  if (!data || !resolved) return [];
  const keys = new Set();
  Object.values(resolved.parameters || {}).forEach((p) => {
    (p.sources || []).forEach((s) => keys.add(s));
  });
  return [...keys].map((key) => ({ key, ...(data.bibliography[key] || {}) }))
    .filter((entry) => entry.citation);
}

if (typeof window !== "undefined") {
  window.GeoIDRockProperties = {
    load: loadRockProperties, now: rockPropertiesNow,
    resolve: resolveLithology, propertiesFor, parameterValue, parameterState,
    parameterList,
    citationsFor,
  };
}
