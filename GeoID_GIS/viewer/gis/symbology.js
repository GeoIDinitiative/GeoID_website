/**
 * Choosing how a layer is coloured — the most-used function in any GIS, and
 * the one this one did not have.
 *
 * Every raster arrived with an automatic ramp and automatic breaks. That is a
 * reasonable default and a bad only-option: the classes a map needs depend on
 * the question, and a legend nobody can change is a legend nobody can fix.
 * Both complaints about symbology in this project reduce to that.
 *
 * Four classification methods, because they answer different questions and
 * picking wrongly is the commonest way a hazard map misleads:
 *
 * - **Equal interval** cuts the RANGE evenly. Right when the units mean
 *   something absolute (millimetres, degrees), wrong for skewed data, where it
 *   puts 95% of the map in class one.
 * - **Quantile** cuts the COUNT evenly, so every class covers the same area.
 *   Right for ranking, and dishonest about magnitude: it always produces a
 *   full spread of classes even from data with no variation worth the name.
 * - **Natural breaks (Jenks)** minimises within-class variance, so the cuts
 *   land where the data is actually sparse. The default, and the one worth the
 *   extra arithmetic.
 * - **Standard deviation** shows departure from the mean, for anomalies.
 *
 * The NI prototype needed quantile over equal-interval to score at all — the
 * acceptance test measured AUC 0.826 → 0.841 on that change alone — which is
 * the whole argument for exposing the choice rather than picking one.
 */

/* ── ramps ──────────────────────────────────────────────────────────────── */

/** Each ramp is a small list of stops, interpolated in RGB. */
export const RAMPS = {
  "risk": [[26, 152, 80], [166, 217, 106], [255, 255, 191], [253, 174, 97], [215, 25, 28]],
  "viridis": [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  "magma": [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  "blues": [[247, 251, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]],
  "terrain": [[0, 97, 71], [160, 190, 120], [232, 220, 150], [180, 140, 90], [255, 255, 255]],
  "greys": [[255, 255, 255], [189, 189, 189], [115, 115, 115], [37, 37, 37], [0, 0, 0]],
  "spectral": [[158, 1, 66], [244, 109, 67], [255, 255, 191], [102, 194, 165], [94, 79, 162]],
};

export const RAMP_NAMES = Object.keys(RAMPS);

/** A colour at 0..1 along a ramp, or its reverse. */
export function rampColour(name, t, { reverse = false } = {}) {
  const stops = RAMPS[name] || RAMPS.viridis;
  let u = Math.max(0, Math.min(1, Number(t)));
  if (!Number.isFinite(u)) u = 0;
  if (reverse) u = 1 - u;
  const at = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  const f = at - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/* ── breaks ─────────────────────────────────────────────────────────────── */

function clean(values) {
  return (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
}

export function equalIntervalBreaks(values, classes = 5) {
  const v = clean(values);
  if (!v.length) return [];
  const min = v[0];
  const max = v[v.length - 1];
  const step = (max - min) / classes;
  // Interior cuts only: the ends are the data's own min and max and are
  // reported separately, so a break list of length n-1 defines n classes.
  return Array.from({ length: classes - 1 }, (_, i) => min + step * (i + 1));
}

export function quantileBreaks(values, classes = 5) {
  const v = clean(values);
  if (!v.length) return [];
  const out = [];
  for (let i = 1; i < classes; i += 1) {
    const pos = (i / classes) * (v.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(v.length - 1, lo + 1);
    out.push(v[lo] + (v[hi] - v[lo]) * (pos - lo));
  }
  return out;
}

export function stdDevBreaks(values, classes = 5) {
  const v = clean(values);
  if (!v.length) return [];
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) || 1;
  const half = Math.floor(classes / 2);
  const out = [];
  for (let i = -half; i <= half; i += 1) {
    if (out.length >= classes - 1) break;
    out.push(mean + i * sd);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Fisher–Jenks natural breaks.
 *
 * The exact algorithm is O(n²·k), which on a million-cell raster is not a
 * user interface. It runs on a SAMPLE of at most `sample` values — evenly
 * spaced through the sorted data, so the sample keeps the distribution's shape
 * — and that is stated rather than hidden, because breaks from a sample can
 * differ slightly from breaks over everything.
 */
export function jenksBreaks(values, classes = 5, { sample = 500 } = {}) {
  const all = clean(values);
  if (!all.length) return [];
  if (classes <= 1) return [];
  const v = all.length <= sample
    ? all
    : Array.from({ length: sample }, (_, i) => all[Math.round((i / (sample - 1)) * (all.length - 1))]);
  const n = v.length;
  const k = Math.min(classes, n);
  if (k <= 1) return [];

  // mat1: index of the first element of each class; mat2: the variance so far.
  const mat1 = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const mat2 = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j += 1) { mat1[1][j] = 1; mat2[1][j] = 0; }
  for (let i = 2; i <= n; i += 1) mat2[i][1] = 0;

  for (let l = 2; l <= n; l += 1) {
    let s1 = 0; let s2 = 0; let w = 0;
    for (let m = 1; m <= l; m += 1) {
      const i3 = l - m + 1;
      const val = v[i3 - 1];
      s2 += val * val;
      s1 += val;
      w += 1;
      const variance = s2 - (s1 * s1) / w;
      if (i3 !== 1) {
        for (let j = 2; j <= k; j += 1) {
          if (mat2[l][j] >= variance + mat2[i3 - 1][j - 1]) {
            mat1[l][j] = i3;
            mat2[l][j] = variance + mat2[i3 - 1][j - 1];
          }
        }
      }
    }
    mat1[l][1] = 1;
    mat2[l][1] = s2 - (s1 * s1) / w;
  }

  const out = [];
  let end = n;
  for (let j = k; j >= 2; j -= 1) {
    const id = mat1[end][j] - 1;
    out.unshift(v[id]);
    end = id;
  }
  return out;
}

export const METHODS = {
  jenks: { label: "Natural breaks (Jenks)", fn: jenksBreaks },
  quantile: { label: "Quantile (equal count)", fn: quantileBreaks },
  equal: { label: "Equal interval", fn: equalIntervalBreaks },
  stddev: { label: "Standard deviation", fn: stdDevBreaks },
};


/** A class bound as a legend should show it: comparable at a glance. */
export function fmtBound(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000 || abs < 0.01) return n.toPrecision(3);
  return String(Number(n.toPrecision(4)));
}

/* ── a full symbology ───────────────────────────────────────────────────── */

/**
 * Breaks, colours and legend rows in one object — everything a renderer and a
 * legend both need, computed once so the two cannot disagree.
 */
/**
 * `edges` overrides the method.
 *
 * Class thresholds are hand-editable in the panel -- the QGIS behaviour, where a
 * natural-breaks pass is a starting point rather than the answer. Given an
 * explicit edge list the method is not consulted at all, so what the legend says
 * and what the renderer does stay the same object; recomputing from the method
 * here would quietly discard the numbers the user typed.
 */
export function buildSymbology(values, {
  method = "jenks", classes = 5, ramp = "risk", reverse = false, continuous = false,
  edges: givenEdges = null,
} = {}) {
  const v = clean(values);
  if (!v.length) return { ok: false, message: "the layer has no values to classify" };
  const min = v[0];
  const max = v[v.length - 1];
  if (continuous) {
    return {
      ok: true, continuous: true, method: "continuous", ramp, reverse, min, max,
      breaks: [],
      palette: Array.from({ length: 24 }, (_, i) => hex(rampColour(ramp, i / 23, { reverse }))),
      rows: [{
        from: min, to: max, colour: hex(rampColour(ramp, 1, { reverse })),
        count: v.length, label: `${fmtBound(min)} – ${fmtBound(max)}`,
      }],
    };
  }
  const chosen = METHODS[method] ? method : "jenks";
  // A supplied edge list is used verbatim, minus anything outside the data --
  // a threshold beyond the range would make an empty class and an honest legend
  // cannot show one.
  let breaks = Array.isArray(givenEdges) && givenEdges.length
    ? givenEdges.map(Number).filter((n) => Number.isFinite(n))
    : METHODS[chosen].fn(v, classes);
  // Duplicate cuts make empty classes, which read as a broken legend. Data
  // with fewer distinct values than classes is the usual cause and is a fact
  // about the layer, so the class count drops rather than the legend lying.
  breaks = [...new Set(breaks.filter((b) => b > min && b < max))].sort((a, b) => a - b);
  const edges = [min, ...breaks, max];
  const rows = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const from = edges[i];
    const to = edges[i + 1];
    const t = edges.length <= 2 ? 1 : i / (edges.length - 2);
    const count = v.filter((x) => (i === edges.length - 2 ? x >= from && x <= to : x >= from && x < to)).length;
    rows.push({
      from, to, colour: hex(rampColour(ramp, t, { reverse })), count,
      // The range, formatted, as the label a legend shows until someone gives
      // the class a name. A class with no label at all forces every legend to
      // invent one, and they then disagree.
      label: `${fmtBound(from)} – ${fmtBound(to)}`,
    });
  }
  return {
    ok: true, continuous: false,
    method: Array.isArray(givenEdges) && givenEdges.length ? "custom" : chosen,
    classes: rows.length, ramp, reverse,
    min, max, breaks,
    palette: rows.map((r) => r.colour),
    rows,
  };
}


/**
 * A QUALITATIVE palette, for categories.
 *
 * Sampling a sequential or diverging ramp across n categories is right for
 * ordered classes and wrong for named ones: thirteen rock units taken along
 * "spectral" gives four consecutive shades of the same red, and the map reads
 * as one colour with a legend that claims otherwise. Categories have no order,
 * so their colours should be as far apart as possible rather than evenly spaced
 * along a line.
 *
 * Twelve hues chosen to stay distinguishable side by side and to survive the
 * common colour-vision deficiencies reasonably well (a ColorBrewer-style
 * qualitative set). Beyond twelve the ramp takes over -- at that point a legend
 * is unreadable whatever the colours, and `maxCategories` already folds the
 * tail into one grey.
 */
export const QUALITATIVE = [
  "#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#b07aa1", "#76b7b2",
  "#edc948", "#9c755f", "#bab0ac", "#86bcb6", "#d37295", "#8cd17d",
];

/* ── categories, for vector layers ──────────────────────────────────────── */

/**
 * Fields worth colouring a geology layer by, best first.
 *
 * A BGS polygon carries fifty-seven columns and only a handful describe the
 * rock; offering the first alphabetically ("age_onegl") or the first in the
 * file ("bgsref") means the user hunts through a list to find the one that
 * makes the map. These are the standard BGS/GSNI names, then generic ones.
 */
export const PREFERRED_CATEGORY_FIELDS = [
  "lex_rcs_d",   // lexicon unit + rock class, the full description
  "rcs_d",       // rock class description — the lithology
  "lex_d",       // the named unit
  "bgstype",
  "rock_type", "ROCK_TYPE", "lithology", "LITHOLOGY",
  "type", "TYPE", "class", "CLASS", "unit", "UNIT", "name", "NAME",
];

/** The field most likely to be what someone means by "the rock type". */
export function suggestCategoryField(features, fields = null) {
  const names = fields && fields.length
    ? fields
    : [...new Set((features || []).flatMap((f) => Object.keys(f?.properties || {})))];
  const has = (name) => names.includes(name)
    && (features || []).some((f) => String(f?.properties?.[name] ?? "").trim());
  const preferred = PREFERRED_CATEGORY_FIELDS.find(has);
  if (preferred) return preferred;
  // Otherwise the field with the most distinct non-empty values that is still
  // a category rather than an identifier — an id has one value per feature and
  // colouring by it produces noise, not a map.
  let best = null;
  names.forEach((name) => {
    const values = new Set();
    (features || []).forEach((f) => {
      const v = f?.properties?.[name];
      if (v != null && String(v).trim()) values.add(String(v));
    });
    const n = values.size;
    if (n < 2 || n > Math.max(3, (features || []).length * 0.5)) return;
    if (!best || n > best.n) best = { name, n };
  });
  return best?.name || null;
}

/**
 * Distinct values → colours. Categories are ordered by how much of the layer
 * they cover, so the ramp's ends land on the units someone will actually see,
 * and everything past `maxCategories` becomes one honest "other" rather than
 * fifty indistinguishable greys.
 */
export function categoricalSymbology(features, field, {
  ramp = "spectral", maxCategories = 12, qualitative = true,
} = {}) {
  const counts = new Map();
  (features || []).forEach((f) => {
    const raw = f?.properties?.[field];
    const key = raw == null || !String(raw).trim() ? null : String(raw);
    if (key == null) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  if (!counts.size) return { ok: false, message: `no feature carries a value for "${field}"` };
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = ordered.slice(0, maxCategories);
  const rest = ordered.slice(maxCategories);
  // Qualitative unless a ramp is asked for by name, and only while the palette
  // has a colour left -- past that the ramp is the honest fallback.
  const useQualitative = qualitative && shown.length <= QUALITATIVE.length;
  const rows = shown.map(([value, count], i) => ({
    value,
    count,
    colour: useQualitative
      ? QUALITATIVE[i]
      : hex(rampColour(ramp, shown.length <= 1 ? 0.5 : i / (shown.length - 1))),
  }));
  if (rest.length) {
    rows.push({
      value: "(other)",
      count: rest.reduce((n, [, c]) => n + c, 0),
      colour: "#8a8a8a",
      other: true,
      hidden: rest.length,
    });
  }
  const lookup = new Map(rows.filter((r) => !r.other).map((r) => [r.value, r.colour]));
  return {
    ok: true, categorical: true, field, ramp, rows,
    qualitative: useQualitative,
    categories: counts.size,
    palette: rows.map((r) => r.colour),
    colourOf: (feature) => {
      const raw = feature?.properties?.[field];
      const key = raw == null ? null : String(raw);
      if (key == null) return null;
      return lookup.get(key) || (rest.length ? "#8a8a8a" : null);
    },
    message: `${counts.size} distinct values in "${field}"`
      + (rest.length ? `; the ${shown.length} largest are coloured and ${rest.length} share one grey.` : "."),
  };
}

/** Which class a value falls in, given the breaks. */
export function classOf(value, breaks) {
  if (!Number.isFinite(value)) return -1;
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i += 1;
  return i;
}

/** The colour a value gets under a symbology — the renderer's one question. */
export function colourOf(value, symbology) {
  if (!symbology?.ok || !Number.isFinite(value)) return null;
  if (symbology.continuous) {
    const t = symbology.max === symbology.min ? 1
      : (value - symbology.min) / (symbology.max - symbology.min);
    return hex(rampColour(symbology.ramp, t, { reverse: symbology.reverse }));
  }
  const row = symbology.rows[Math.min(symbology.rows.length - 1, classOf(value, symbology.breaks))];
  return row ? row.colour : null;
}

/** The legend record the dock already knows how to draw. */
export function legendInfoFrom(symbology, { unit = null, label = "" } = {}) {
  if (!symbology?.ok) return null;
  return {
    palette: symbology.palette.map((c) => c.replace("#", "")),
    min: Number(symbology.min.toFixed(4)),
    max: Number(symbology.max.toFixed(4)),
    unit,
    label,
    breaks: symbology.breaks.map((b) => Number(b.toFixed(4))),
    method: symbology.method,
    // Classed legends are drawn as rows, one per class, with the label that
    // class carries -- so "Low / Moderate / High" survives all the way to the
    // key on the map. A continuous symbology has no classes and says so, and
    // the dock keeps drawing it as a gradient.
    classed: !symbology.continuous,
    labels: symbology.rows.map((r) => r.label
      || `${fmtBound(r.from)} – ${fmtBound(r.to)}`),
    // Rounded the way a legend reads them: the raw break was showing as
    // 3.4000000000000004, which is the same number and unreadable.
    bounds: symbology.rows.map((r) => [fmtBound(r.from), fmtBound(r.to)]),
    counts: symbology.rows.map((r) => r.count),
  };
}

if (typeof window !== "undefined") {
  window.GeoIDSymbology = {
    RAMPS, RAMP_NAMES, METHODS, rampColour, hex, buildSymbology,
    equalIntervalBreaks, quantileBreaks, jenksBreaks, stdDevBreaks,
    classOf, colourOf, legendInfoFrom, fmtBound, QUALITATIVE,
  };
}
