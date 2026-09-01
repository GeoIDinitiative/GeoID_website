/**
 * THE LITHOLOGY HEADING, checked against real `lith` strings.
 *
 * Every string below was read off the live Macrostrat tiles — 299 distinct
 * values over one view, 203 of them in the brace form — not invented.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const { lithologyLabel } = await import("./lithology-label.js");

const is = (raw, want) => ok(`"${raw}" → "${want}"`,
  lithologyLabel(raw) === want, `got "${lithologyLabel(raw)}"`);

// The reported case, verbatim from the card.
is("Major:{claystone}, Minor{siltstone,sandstone,gypsum}",
  "Claystone — minor siltstone, sandstone, gypsum");
is("Major:{limestone}, Minor{claystone,sandstone}",
  "Limestone — minor claystone, sandstone");
is("Major:{granite}, Minor{monzonite,meta-granite,meta-monzonite}",
  "Granite — minor monzonite, meta-granite, meta-monzonite");

// A term that carries its OWN comma survives, because splitting and rejoining
// on ", " is identity for it.
is("Major:{sandstone}, Minor{claystone,carbonates, consolidated,gypsum, anhydrite}",
  "Sandstone — minor claystone, carbonates, consolidated, gypsum, anhydrite");

// A rock is named once, at its strongest mention. Both are live strings.
is("Major:{claystone}, Minor{limestone,siltstone,limestone}",
  "Claystone — minor limestone, siltstone");
is("Major:{sandstone}, Minor{sandstone,siltstone}",
  "Sandstone — minor siltstone");

// Plain prose is passed through with its first letter raised.
is("claystone", "Claystone");
is("volcanic: mafic rocks", "Volcanic: mafic rocks");
is("shale, chert, iron-formation, greywacke", "Shale, chert, iron-formation, greywacke");

// No proportion word, and no brace may reach the card either way.
is("{sandstone}", "Sandstone");
ok("nothing braced survives the label",
  !/[{}]/.test(lithologyLabel("Major:{a}, Minor{b}") + lithologyLabel("{c}")));

// Majors alone, and minors alone.
is("Major:{sandstone,siltstone}", "Sandstone, siltstone");
is("Minor{shale}", "Minor shale");

// A colon after Minor is the other spelling in the wild.
is("Major:{limestone}, Minor:{claystone,siltstone}",
  "Limestone — minor claystone, siltstone");

// An empty or absent value is empty, never "undefined".
is("", "");
ok("null is empty", lithologyLabel(null) === "");
ok("undefined is empty", lithologyLabel(undefined) === "");

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
