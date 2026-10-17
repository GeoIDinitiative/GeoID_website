/**
 * Reading a request to Atlas: task, place, size and time.
 *
 *   node GeoID_GIS/viewer/gis/atlas-intent.test.mjs
 */

import {
  readTask, readSize, readTime, readPlace, matchVolcano, volcanoKey, readIntent, readDuration,
} from "./atlas-intent.js";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const PROMPT = "Atlas, model a small ashfall cloud emanating from mount etna if it were to erupt at 4pm today";
// 2026-10-11 09:30 UTC; the reader is in UTC+2.
const NOW = Date.UTC(2026, 9, 11, 9, 30);

ok(readTask(PROMPT) === "ashfall", "the prompt is an ash model");
ok(readTask("what is the weather") === null, "a question with no run verb runs nothing");
ok(readTask("simulate inflation of the magma chamber under Campi Flegrei") === "chamber", "a chamber model");
ok(readTask("show me a 3D model of the air over Sicily") === "atmosphere", "an atmosphere model");
ok(readTask("forecast landslides near Genoa") === "landslide", "a landslide forecast");

ok(readSize(PROMPT) === 2, "small is VEI 2");
ok(readSize("a very large eruption") === 5, "very large is not read as large");
ok(readSize("a VEI 4 eruption") === 4, "an explicit VEI wins");
ok(readSize("model ash from Etna") === null, "no size word, no size");

const t = readTime(PROMPT, NOW, 120);
ok(t.ms === Date.UTC(2026, 9, 11, 14, 0), "4pm today at UTC+2 is 14:00 UTC", new Date(t.ms).toISOString());
ok(/today/.test(t.said) && /4pm/.test(t.said), "the time read is said back", t.said);
ok(readTime("at 16:00 UTC", NOW, 120).ms === Date.UTC(2026, 9, 11, 16, 0), "UTC overrides the zone");
ok(readTime("tomorrow at 9am", NOW, 0).ms === Date.UTC(2026, 9, 12, 9, 0), "tomorrow at 9am");
ok(readTime("in 3 hours", NOW, 0).ms === NOW + 3 * 3600e3, "in 3 hours");
ok(readTime("now", NOW, 0).ms === NOW, "now");
ok(readTime("on 2026-12-01 at noon", NOW, 0).ms === Date.UTC(2026, 11, 1, 12, 0), "an ISO date at noon");
ok(readTime("on 3 March at 6pm", NOW, 0).ms === Date.UTC(2026, 2, 3, 18, 0), "a named date");
ok(readTime("nothing temporal here", NOW, 0).ms === NOW, "no time is now");

ok(readPlace(PROMPT) === "mount etna", "the place follows 'from'", readPlace(PROMPT));
ok(readPlace("model ash from Vesuvius at 4pm") === "Vesuvius", "the place stops before 'at 4pm'");
ok(readPlace("simulate a plume over Eyjafjallajökull, tomorrow") === "Eyjafjallajökull", "accents and a comma");
ok(readPlace("model ash at 4pm") === null, "a time is not a place");

const LIST = [
  { name: "Etna", lat: 37.748, lon: 14.999 },
  { name: "Vesuvius", lat: 40.821, lon: 14.426 },
  { name: "Eyjafjallajökull", lat: 63.633, lon: -19.633 },
  { name: "Fuji", lat: 35.361, lon: 138.728 },
  { name: "Campi Flegrei", lat: 40.827, lon: 14.139 },
  { name: "St. Helens", lat: 46.2, lon: -122.18 },
];
ok(volcanoKey("Mount Etna") === "etna", "Mount is not part of the name");
ok(matchVolcano("mount etna", LIST)?.volcano.name === "Etna", "Mount Etna is Etna");
ok(matchVolcano("Eyjafjallajokull", LIST)?.volcano.name === "Eyjafjallajökull", "accents are optional");
ok(matchVolcano("Mt Fuji", LIST)?.volcano.name === "Fuji", "Mt is not part of the name");
ok(matchVolcano("vesuvio", LIST)?.how === "close", "a near spelling is matched and said to be close");
ok(matchVolcano("campi flegrei caldera", LIST)?.volcano.name === "Campi Flegrei", "a whole-word match");
ok(matchVolcano("Kilimanjaro", LIST) === null, "nothing near is no match, not a guess");

const intent = readIntent(PROMPT, { nowMs: NOW, zoneOffsetMin: 120 });
ok(intent.task === "ashfall" && intent.vei === 2 && intent.place === "mount etna"
  && intent.time.ms === Date.UTC(2026, 9, 11, 14, 0), "the whole prompt, read");
ok(readDuration("follow it for 12 hours") === 12 && readDuration("for 2 days") === 48, "a follow time");
