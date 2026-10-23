/**
 * Which field a post belongs to, for its card's coloured outline.
 *
 * Read from what the author wrote -- tags count most, then the title, then the
 * body -- against a short word list per field. The colours follow what each
 * field is drawn in on maps: volcanology red-orange, seismology amber, water
 * blue, ice pale cyan. A post that matches nothing gets no colour rather than
 * a guess. The card also names the field in words, so colour is never the only
 * way to tell (colour-blind readers, and anyone who has not learnt the key).
 *
 * Pure, so node tests it: topics.test.mjs.
 */

export const TOPICS = [
  { id: "volcanology", label: "Volcanology", rgb: "255, 92, 56",
    words: ["volcan", "erupt", "lava", "magma", "tephra", "pyroclast", "caldera", "fumarol", "strombol", "etna", "vesuv", "stromboli", "kilauea", "fimmvor", "eyjafjall", "ashfall", "ash plume", "vei"] },
  { id: "seismology", label: "Seismology", rgb: "255, 184, 64",
    words: ["seism", "earthquake", "quake", "aftershock", "rupture", "fault", "tecton", "subduct", "tremor", "moment tensor"] },
  { id: "landslides", label: "Landslides", rgb: "214, 150, 90",
    words: ["landslide", "debris flow", "rockfall", "slope stab", "mass movement", "mudflow", "lahar", "slope failure"] },
  { id: "hydrology", label: "Hydrology", rgb: "70, 150, 255",
    words: ["flood", "river", "hydro", "rainfall", "groundwater", "catchment", "drought", "runoff", "aquifer", "inundation"] },
  { id: "cryosphere", label: "Cryosphere", rgb: "150, 225, 255",
    words: ["glacier", "glacial", "ice sheet", "ice shelf", "sea ice", "permafrost", "cryo", "snowpack", "icecap"] },
  { id: "atmosphere", label: "Atmosphere", rgb: "180, 130, 255",
    words: ["climate", "atmospher", "weather", "cyclone", "hurricane", "typhoon", "storm", "precipitation", "aerosol", "dust storm"] },
  { id: "geodesy", label: "Geodesy & EO", rgb: "90, 220, 160",
    words: ["insar", "gnss", "gps", "geodes", "sentinel", "satellite", "remote sensing", "lidar", "deformation map", "earth observation"] },
];

const byId = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
export const topicById = (id) => byId[id] || null;

function hits(text, words) {
  let n = 0;
  for (const w of words) {
    // Whole-word start for short stems ("vei", "gps"), so "veil" or "gpsx" do not count.
    const re = w.length <= 4 ? new RegExp(`\\b${w}\\b`) : null;
    if (re ? re.test(text) : text.includes(w)) n += 1;
  }
  return n;
}

/** The post's field, or null. */
export function topicOf(p) {
  const tags = (Array.isArray(p?.tags) ? p.tags : []).map((t) => String(t).toLowerCase().replace(/[-_]/g, " ")).join(" ");
  const title = String(p?.title || "").toLowerCase();
  const body = String(p?.body || "").toLowerCase().slice(0, 2000);
  let best = null; let bestScore = 0;
  for (const t of TOPICS) {
    const score = hits(tags, t.words) * 3 + hits(title, t.words) * 2 + hits(body, t.words);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}
