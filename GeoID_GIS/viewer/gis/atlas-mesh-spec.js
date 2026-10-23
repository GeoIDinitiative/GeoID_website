/**
 * "BUILD A STRATOVOLCANO 3 KM HIGH WITH A MAGMA CHAMBER AT 5 KM DEPTH" --
 * a sentence read into a model the Meshing Studio can build and mesh, with
 * the numbers it carries honoured.
 *
 * Before this, Atlas's phrase matcher heard "volcano" and built the studio's
 * template at its own default size, with no mesh: the 3 km and the 5 km were
 * thrown away. This reads the model (a volcano with a chamber, or a layered
 * crust with a dike), every length, depth, dip and count the sentence names,
 * and which mesher it asked for, into studio shapes in METRES (the studio's
 * unit: 1 unit = 1 m, z up, z = 0 the ground). What it did not hear it fills
 * in proportion to what it did, and says which is which, so the reader can
 * see what was built from their words and what was assumed.
 *
 * Pure: no page, no studio. `atlas-runner.js`'s build_mesh adds the shapes and
 * meshes them; a connected model can still call blender_mesh with shapes of
 * its own for anything this does not read.
 */

const UNIT = { km: 1000, kilometre: 1000, kilometres: 1000, kilometer: 1000, kilometers: 1000, m: 1, metre: 1, metres: 1, meter: 1, meters: 1 };
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const LEN = String.raw`${NUM}\s*-?\s*(km|kilomet(?:re|er)s?|m|met(?:re|er)s?)\b`;

/** The words that make a sentence a request to build a model to mesh. */
const BUILD = /\b(build|make|create|construct|generate|add|set up|mesh)\b/;
const NOUN = /\b(volcano|stratovolcano|edifice|magma chamber|chamber|dikes?|dykes?|layers?|layered|crust|halfspace|half-space)\b/;

const num = (s) => Number(String(s).replace(",", "."));
const metres = (n, unit) => num(n) * (UNIT[String(unit).toLowerCase()] ?? 1);
const round = (v) => Math.round(v);

/** The first length a pattern (with LEN in it) finds, in metres, or null. */
function lengthBy(q, ...patterns) {
  for (const p of patterns) {
    const m = q.match(p);
    if (m) {
      const i = m.findIndex((g, k) => k > 0 && g !== undefined && /^\d/.test(g));
      if (i > 0) return metres(m[i], m[i + 1]);
    }
  }
  return null;
}

/** Whether a sentence asks for a model to be built (and so meshed). */
export function isMeshRequest(text) {
  const q = String(text || "").toLowerCase();
  if (/\bblender\b/.test(q) && /\b(mesh|build|make|model)\b/.test(q)) return true;
  if (/\bmesh (it|this|that|the model|my model)\b/.test(q)) return true;
  return BUILD.test(q) && NOUN.test(q);
}

/** The mesher a sentence names, or null for "whatever the model has". */
export function readMesher(text) {
  const q = String(text || "").toLowerCase();
  if (/\bblender\b/.test(q)) return "blender";
  if (/\bgmsh\b/.test(q)) return "gmsh";
  return null;
}

function readVolcano(q, said) {
  const heard = (name, v) => { if (v !== null) said.push(name); return v; };
  const height = heard("height", lengthBy(q,
    new RegExp(`${LEN}\\s*(?:high|tall|in height|of relief)`),
    new RegExp(`(?:height|relief|elevation)\\s*(?:of|is|=)?\\s*${LEN}`)));
  const H = height ?? 2000;
  const depth = heard("chamber depth", lengthBy(q,
    new RegExp(`chamber[^.;]*?\\bat\\s*(?:a\\s*depth\\s*of\\s*)?${LEN}`),
    new RegExp(`${LEN}\\s*(?:deep|depth|below)`),
    new RegExp(`depth\\s*(?:of|is|=)?\\s*${LEN}`)));
  const D = depth ?? Math.max(3000, 2 * H);
  let radius = lengthBy(q,
    new RegExp(`chamber[^.;]*?radius\\s*(?:of|is|=)?\\s*${LEN}`),
    new RegExp(`${LEN}\\s*radius\\s*(?:magma\\s*)?chamber`));
  if (radius === null) {
    const across = lengthBy(q,
      new RegExp(`${LEN}\\s*(?:wide|across|diameter)\\s*(?:magma\\s*)?chamber`),
      new RegExp(`chamber[^.;]*?${LEN}\\s*(?:wide|across|in diameter)`));
    if (across !== null) radius = across / 2;
  }
  heard("chamber radius", radius);
  const r = radius ?? Math.max(D / 5, 200);
  const base = heard("base radius", lengthBy(q,
    new RegExp(`base\\s*radius\\s*(?:of|is|=)?\\s*${LEN}`),
    new RegExp(`${LEN}\\s*(?:wide|across)\\s*(?:at the )?base`)));
  // A stratovolcano's flanks run about 18 degrees: base ~3x the height.
  const B = base ?? 3 * H;
  const crustDepth = Math.max(3 * D, 2 * (D + r));
  const crustWidth = Math.max(4 * B, 6 * D);
  const params = {
    height: round(H), base_radius: round(B), summit_radius: round(Math.max(B * 0.05, 1)),
    chamber_depth: round(D), chamber_radius: round(r), chamber_half_height: round(0.6 * r),
    crust_width: round(crustWidth), crust_depth: round(crustDepth),
  };
  const shapes = [
    { kind: "volcano_edifice", crust_width: params.crust_width, crust_depth: params.crust_depth,
      height: params.height, base_radius: params.base_radius, summit_radius: params.summit_radius },
    { kind: "ellipsoid", op: "difference", x: 0, y: 0, z: -params.chamber_depth,
      rx: params.chamber_radius, ry: params.chamber_radius, rz: params.chamber_half_height },
  ];
  return {
    template: "volcano",
    label: `a ${/strato/.test(q) ? "stratovolcano" : "volcano"} ${km(H)} high with a magma chamber at ${km(D)} depth`,
    params, shapes, extent: Math.max(crustWidth, crustDepth + H),
  };
}

function readLayered(q, said) {
  const heard = (name, v) => { if (v !== null && v !== undefined) said.push(name); return v; };
  // Layers: "three layers", "layers 1, 2 and 3 km thick", "2 km thick layers".
  const listed = q.match(new RegExp(`layers?[^.;]*?((?:\\d+(?:[.,]\\d+)?\\s*(?:,|and|\\s)\\s*)+\\d+(?:[.,]\\d+)?)\\s*(km|m)\\b\\s*thick`));
  let thicknesses = null;
  if (listed) thicknesses = listed[1].split(/\s*(?:,|and)\s*|\s+/).filter(Boolean).map((v) => metres(v, listed[2]));
  const countWord = q.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+layers?\b/);
  const count = countWord ? (WORD_NUMBERS[countWord[1]] ?? Number(countWord[1])) : null;
  const each = lengthBy(q, new RegExp(`${LEN}\\s*thick\\s*layers?`), new RegExp(`layers?\\s*(?:each\\s*)?${LEN}\\s*thick`));
  if (!thicknesses && (count || each)) thicknesses = Array(Math.max(1, Math.min(count || 3, 10))).fill(each ?? 2000);
  heard("layers", thicknesses);
  const th = thicknesses || [2000, 3000, 5000];
  const total = th.reduce((a, b) => a + b, 0);
  const width = heard("block width", lengthBy(q,
    new RegExp(`(?:block|crust)[^.;]*?${LEN}\\s*(?:wide|across|square)`),
    new RegExp(`${LEN}\\s*(?:wide|across|square)\\s*(?:block|crust)`),
    new RegExp(`width\\s*(?:of|is|=)?\\s*${LEN}`)));
  const W = width ?? Math.max(1.2 * total, 6000);
  const dipM = q.match(/\bdip(?:ping|s)?\s*(?:at|of|=)?\s*(\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)?/) || q.match(/(\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)\s*dip/);
  const dip = dipM ? Math.max(1, Math.min(90, num(dipM[1]))) : (/\bdipping\b/.test(q) ? 60 : 80);
  if (dipM) said.push("dip");
  const strikeM = q.match(/\bstrik(?:e|ing)\s*(?:at|of|=)?\s*(\d+(?:\.\d+)?)/);
  if (strikeM) said.push("strike");
  const dikeThick = heard("dike thickness", lengthBy(q,
    new RegExp(`${LEN}\\s*thick\\s*(?:dipping\\s*)?(?:dike|dyke)`),
    new RegExp(`(?:dike|dyke)[^.;]*?${LEN}\\s*thick`)));
  const dikeLength = heard("dike length", lengthBy(q,
    new RegExp(`${LEN}\\s*long`), new RegExp(`(?:dike|dyke)[^.;]*?length\\s*(?:of)?\\s*${LEN}`)));
  const topDepth = heard("dike top depth", lengthBy(q,
    new RegExp(`(?:dike|dyke)[^.;]*?top[^.;]*?${LEN}`), new RegExp(`top\\s*(?:at|depth)[^.;]*?${LEN}`)));
  const params = {
    width: round(W), depth: round(W), thicknesses: th.map(round),
    dike_length: round(dikeLength ?? W / 2), dike_height: round(total / 2),
    dike_thickness: round(dikeThick ?? Math.max(W / 20, 50)), dike_top_depth: round(topDepth ?? total / 10),
    strike: strikeM ? num(strikeM[1]) : 30, dip,
  };
  const shapes = [
    { kind: "layered_halfspace", width: params.width, depth: params.depth, thicknesses: params.thicknesses.join(",") },
    { kind: "dike", op: "difference", x: 0, y: 0, length: params.dike_length, height: params.dike_height,
      thickness: params.dike_thickness, top_depth: params.dike_top_depth, strike: params.strike, dip: params.dip },
  ];
  return {
    template: "layered_dike",
    label: `a ${km(W)} crust block of ${th.length} layers (${th.map(km).join(", ")}) with a dike dipping ${dip}°`,
    params, shapes, extent: Math.max(W, total),
  };
}

function km(m) {
  return m >= 1000 ? `${+(m / 1000).toFixed(2)} km` : `${round(m)} m`;
}

/**
 * The model a sentence asks for, or null when it names none.
 *
 * Returns { template, label, params, shapes, mesher, sizeM, said, assumed }:
 * `shapes` for shapesToSolids (studio-blender.js), `sizeM` the element size
 * to mesh at -- coarse on purpose, about a twelfth of the model, so a request
 * from a sentence is a quick mesh, not a solve-sized one, unless the sentence
 * names a size -- and `said` / `assumed` the parameters taken from the words
 * and those filled in.
 */
export function readMeshRequest(text) {
  const q = String(text || "").toLowerCase().replace(/[–—]/g, "-");
  if (!isMeshRequest(q)) return null;
  const said = [];
  const volcano = /\b(volcano|stratovolcano|edifice|magma chamber|chamber)\b/.test(q);
  const layered = /\b(dikes?|dykes?|layers?|layered|halfspace|half-space)\b/.test(q);
  let spec;
  if (volcano && !(layered && !/\bvolcano/.test(q))) spec = readVolcano(q, said);
  else if (layered || /\bcrust\b/.test(q)) spec = readLayered(q, said);
  else return null;
  const size = lengthBy(q,
    new RegExp(`${LEN}\\s*(?:elements?|cells?|tets?|tetrahedra|mesh size|resolution)`),
    new RegExp(`(?:element|cell|mesh)\\s*size\\s*(?:of|is|=)?\\s*${LEN}`));
  if (size !== null) said.push("element size");
  const all = Object.keys(spec.params);
  return {
    ...spec,
    mesher: readMesher(q),
    sizeM: round(size ?? spec.extent / 12),
    // Curvature refinement keeps a coarse mesh valid round a small chamber:
    // without it, gmsh at a twelfth of a 36 km crust cannot mesh a 1 km
    // ellipsoid (measured: a segfault); with 12 per 2π, ~1.2k nodes.
    curvature: 12,
    said,
    assumed: all.filter((k) => !said.some((s) => k.replace(/_/g, " ").includes(s) || s.includes(k.replace(/_/g, " ")))),
  };
}
