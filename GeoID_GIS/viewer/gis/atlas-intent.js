/**
 * What a sentence to Atlas ASKS FOR — read into a task, a place, a size and a
 * time, before anything is fetched or run.
 *
 * "Atlas, model a small ashfall cloud emanating from Mount Etna if it were to
 * erupt at 4pm today" is four decisions: the task (an ash dispersal model),
 * the place (Etna — a volcano, found in the Smithsonian catalogue), the size
 * (small → VEI 2) and the time (16:00 today, in the reader's own time zone).
 * Each is read here as a pure function, so every reading is tested and every
 * one can be SHOWN back to the reader before a model is run on it — a model
 * run on a misheard place is worse than none.
 *
 * Nothing here decides how to run a task; the tool registry does
 * (`atlas-tools.js`). This only says what was asked.
 */

import { SIZE_WORDS } from "./ash-plume.js?v=20261024-6e2bde7";
import { isMeshRequest } from "./atlas-mesh-spec.js?v=20261024-6e2bde7";

/**
 * The tasks a sentence can name, most specific first. Each is a test on the
 * lower-cased sentence; the first that matches wins, so "ash" outranks
 * "volcano" (a model OF ash from a volcano is an ash model).
 */
export const TASKS = [
  { id: "ashfall", test: /\b(ash|ashfall|ash ?fall|tephra|plume|ash ?cloud)\b/ },
  // A model to BUILD (and so mesh) — "build a stratovolcano 3 km high with a
  // chamber at 5 km depth", "mesh it in Blender" — before "chamber", which is
  // for a deformation study of one ("simulate inflation of the chamber").
  { id: "build_mesh", test: { test: isMeshRequest } },
  { id: "chamber", test: /\b(magma chamber|chamber|mogi|inflation|deformation|fem|finite element|mesh)\b/ },
  { id: "atmosphere", test: /\b(atmosphere|the air|air column|pressure levels|3d air|wind field)\b/ },
  { id: "landslide", test: /\b(landslides?|slope failure|debris flow|factor of safety)\b/ },
  { id: "flood", test: /\b(flood|flooding|inundation|river rise)\b/ },
  { id: "risk", test: /\b(total risk|risk here|how dangerous|danger)\b/ },
];

/** A sentence is a request to RUN something when it uses one of these. */
const RUN_VERBS = /\b(model|simulate|run|forecast|predict|generate|build|make|create|construct|mesh|show|compute|estimate|what if|if it were to|what would)\b/;

/**
 * A flight's risk is asked as a question, not a command ("how risky is a
 * flight from London to New York today"), so it is read before the run verbs.
 */
const FLIGHT = /\b(flights?|fly|flying|air ?route|airliner)\b/;
const FLIGHT_ASK = /\b(risk\w*|safe\w*|danger\w*|hazard\w*|turbulen\w*|bumpy|storms?|weather|ash)\b/;

export function readTask(text) {
  const q = String(text || "").toLowerCase();
  if (FLIGHT.test(q) && FLIGHT_ASK.test(q) && readRoute(text)) return "flight";
  if (!RUN_VERBS.test(q)) return null;
  return TASKS.find((t) => t.test.test(q))?.id || null;
}

/** A VEI from the size words in a sentence, or an explicit "VEI n". */
export function readSize(text) {
  const q = String(text || "").toLowerCase();
  const explicit = q.match(/\bvei\s*([0-8])\b/);
  if (explicit) return Math.max(1, Math.min(5, Number(explicit[1])));
  // Longest phrase first: "very large" must not read as "large".
  const ordered = [...SIZE_WORDS].sort((a, b) => b[0].source.length - a[0].source.length);
  for (const [re, vei] of ordered) if (re.test(q)) return vei;
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The time a sentence names, as epoch ms, read in `zoneOffsetMin` (minutes
 * EAST of UTC — the opposite sign to Date#getTimezoneOffset) unless the
 * sentence says UTC. Recognised: "now", "today", "tonight", "tomorrow",
 * "in N hours/minutes/days", "at 4pm", "at 16:00", "at noon/midnight",
 * "on 12 October", "on 2026-10-12". With nothing, `now`.
 *
 * Returns { ms, said, utc } — `said` is the words read, so the answer can show
 * what it understood.
 */
export function readTime(text, nowMs = Date.now(), zoneOffsetMin = 0) {
  const q = String(text || "").toLowerCase();
  const utc = /\b(utc|gmt|zulu)\b/.test(q);
  const offset = utc ? 0 : zoneOffsetMin;
  const said = [];

  const rel = q.match(/\bin\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h|days?)\b/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const ms = /^m/.test(unit) ? n * 60e3 : /^d/.test(unit) ? n * 86400e3 : n * 3600e3;
    return { ms: nowMs + ms, said: rel[0], utc };
  }
  if (/\b(right )?now\b|\bimmediately\b/.test(q) && !/\bat\s+\d/.test(q)) {
    return { ms: nowMs, said: "now", utc };
  }

  // The day, in the zone: start from today's local date.
  const local = new Date(nowMs + offset * 60e3);
  let y = local.getUTCFullYear(); let m = local.getUTCMonth(); let d = local.getUTCDate();
  if (/\btomorrow\b/.test(q)) { d += 1; said.push("tomorrow"); }
  else if (/\byesterday\b/.test(q)) { d -= 1; said.push("yesterday"); }
  else if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(q)) said.push("today");
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]) - 1; d = Number(iso[3]); said.push(iso[0]); }
  const named = q.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:\s+(\d{4}))?/);
  if (named && !iso) {
    d = Number(named[1]); m = MONTHS.indexOf(named[2]);
    if (named[3]) y = Number(named[3]);
    said.push(named[0]);
  }

  // The time of day.
  let hh = null; let mm = 0;
  const clock = q.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/)
    || q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/)
    || q.match(/\b(\d{1,2}):(\d{2})\b()/);
  if (clock) {
    hh = Number(clock[1]); mm = Number(clock[2] || 0);
    const ap = (clock[3] || "").replace(/\./g, "");
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    said.push(clock[0].trim());
  } else if (/\bnoon|midday\b/.test(q)) { hh = 12; said.push("noon"); }
  else if (/\bmidnight\b/.test(q)) { hh = 0; said.push("midnight"); }
  else if (/\btonight\b|\bthis evening\b/.test(q)) { hh = 20; }
  else if (/\bthis morning\b/.test(q)) { hh = 9; }
  else if (/\bthis afternoon\b/.test(q)) { hh = 15; }

  if (hh === null && !said.length) return { ms: nowMs, said: "now", utc };
  if (hh === null) hh = new Date(nowMs + offset * 60e3).getUTCHours();
  const ms = Date.UTC(y, m, d, hh, mm) - offset * 60e3;
  return { ms, said: said.join(" ") || "now", utc };
}

/**
 * The place words in a sentence: what follows "from", "at", "of", "over",
 * "near", "under" or "for", up to the next clause.
 */
export function readPlace(text) {
  const raw = String(text || "");
  const re = /\b(?:from|at|of|over|near|under|beneath|below|around|for)\s+((?:mount|mt\.?|volc[aá]n|volcano)?\s*[A-Za-zÀ-ÿ'’\- ]{2,60}?)(?=\s+(?:(?:if|when|today|tomorrow|tonight|erupt\w*|with|for|and|that|which|starting|beginning|at\s+(?:noon|midnight))\b|at\s+\d|in\s+\d|on\s+\d)|[,.;!?]|$)/gi;
  const found = [];
  let m;
  while ((m = re.exec(raw))) {
    const words = m[1].trim();
    // "at 4pm", "of ash", "for 6 hours" are not places.
    if (/^(\d|ash|tephra|the air|a |an |small|large|moderate|very|it\b|this|that|today|tomorrow)/i.test(words)) continue;
    found.push(words);
  }
  return found.length ? found[found.length - 1] : null;
}

/** A name as it compares: no accents, no "Mount", no punctuation. */
export function volcanoKey(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(mount|mt|mont|monte|volcano|volcan|vulkan|gunung|nevado|cerro|the)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The volcano a place phrase names, from a list ({name, lat, lon, ...}):
 * an exact key match, else a whole-word match, else the closest by edit
 * distance within a third of the name's length. Null rather than a guess.
 */
export function matchVolcano(phrase, volcanoes) {
  const key = volcanoKey(phrase);
  if (!key) return null;
  let exact = null; let word = null; let near = null; let nearD = Infinity;
  for (const v of volcanoes) {
    const k = volcanoKey(v.name);
    if (!k) continue;
    if (k === key) { exact = exact || v; continue; }
    if (` ${k} `.includes(` ${key} `) || ` ${key} `.includes(` ${k} `)) {
      if (!word || k.length < volcanoKey(word.name).length) word = v;
      continue;
    }
    const d = editDistance(k, key);
    if (d < nearD) { nearD = d; near = v; }
  }
  if (exact) return { volcano: exact, how: "exact" };
  if (word) return { volcano: word, how: "word" };
  if (near && nearD <= Math.max(1, Math.floor(key.length / 3))) return { volcano: near, how: "close", distance: nearD };
  return null;
}

export function editDistance(a, b) {
  const m = a.length; const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Hours to follow the ash for, if the sentence says ("for 12 hours"). */
export function readDuration(text) {
  const m = String(text || "").toLowerCase().match(/\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|days?)\b/);
  if (!m) return null;
  return /^d/.test(m[2]) ? Number(m[1]) * 24 : Number(m[1]);
}

/**
 * The two ends of a flight: "from X to Y", "X to Y", "between X and Y",
 * each up to the next clause or time word. Null without both.
 */
export function readRoute(text) {
  const raw = String(text || "");
  const stop = String.raw`(?=\s+(?:today|tomorrow|tonight|now|this|at|on|in|departing|leaving|via|right|risk\w*|safe\w*|flights?)\b|[,.;!?]|$)`;
  const end = String.raw`([A-Za-zÀ-ÿ'’\- ]{2,40}?)`;
  const m = raw.match(new RegExp(String.raw`\bfrom\s+${end}\s+to\s+${end}${stop}`, "i"))
    || raw.match(new RegExp(String.raw`\bbetween\s+${end}\s+and\s+${end}${stop}`, "i"))
    || raw.match(new RegExp(String.raw`\b(?:flights?|fly(?:ing)?)\s+(?:a\s+)?${end}\s+to\s+${end}${stop}`, "i"));
  if (!m) return null;
  const clean = (s) => s.trim().replace(/^(the|a|an)\s+/i, "");
  return { from: clean(m[1]), to: clean(m[2]) };
}

/** Everything at once. */
export function readIntent(text, { nowMs = Date.now(), zoneOffsetMin = 0 } = {}) {
  const task = readTask(text);
  if (!task) return null;
  return {
    task,
    place: readPlace(text),
    vei: readSize(text),
    time: readTime(text, nowMs, zoneOffsetMin),
    followHours: readDuration(text),
    route: task === "flight" ? readRoute(text) : null,
    text: String(text),
  };
}
