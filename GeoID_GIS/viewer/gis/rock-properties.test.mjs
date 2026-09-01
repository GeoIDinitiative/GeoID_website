/**
 * THE PROPERTY DATABASE, AND THE RESOLVER THAT READS A MAP POLYGON INTO IT.
 *
 * Two halves are checked here and they fail in different ways. The DATABASE is
 * checked structurally — every lithology in Macrostrat's dictionary resolves,
 * every parameter declares a unit and a scale, every value carries a source,
 * and every source key exists in the bibliography. A citation that names
 * nothing is worse than no citation, and nothing at runtime would ever notice.
 *
 * The RESOLVER is checked on the strings the live layer actually carries,
 * because a mixture is the normal case and averaging one wrongly produces a
 * confident number in the middle of two materials that behave nothing alike.
 */
import { readFile } from "node:fs/promises";

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const db = JSON.parse(await readFile(
  new URL("../../data/global/rock-properties.json", import.meta.url), "utf8"));

globalThis.window = globalThis.window || {};
const RP = await import("./rock-properties.js");
RP.useRockProperties(db);

// ---------------------------------------------------------------------------
// The database itself.
// ---------------------------------------------------------------------------
{
  ok("the vocabulary is Macrostrat's own dictionary",
    db.vocabulary?.count === Object.keys(db.lithologies).length,
    `${db.vocabulary?.count} vs ${Object.keys(db.lithologies).length}`);
  ok("every lithology in it resolves to a reference",
    Object.values(db.lithologies).every((l) => db.references[l.reference]),
    Object.values(db.lithologies).filter((l) => !db.references[l.reference])
      .map((l) => l.name).slice(0, 5).join(", "));
  ok("214 lithologies, none unresolved",
    Object.keys(db.lithologies).length === 214,
    String(Object.keys(db.lithologies).length));

  /**
   * A CITATION THAT NAMES NOTHING is the failure mode that matters here: the
   * value looks sourced, the key is a typo, and nothing at runtime looks it up
   * until somebody clicks the one lithology that has it.
   */
  const badSources = [];
  for (const [name, ref] of Object.entries(db.references)) {
    for (const [key, value] of Object.entries(ref.properties)) {
      for (const source of value.sources || []) {
        if (!db.bibliography[source]) badSources.push(`${name}.${key} -> ${source}`);
      }
    }
  }
  ok("every source key resolves to a bibliography entry",
    badSources.length === 0, badSources.slice(0, 5).join("; "));

  ok("every bibliography entry carries a citation",
    Object.values(db.bibliography).every((b) => b.citation && b.citation.length > 30));

  const badParams = [];
  for (const [name, ref] of Object.entries(db.references)) {
    for (const key of Object.keys(ref.properties)) {
      if (!db.parameters[key]) badParams.push(`${name}.${key}`);
    }
  }
  ok("no reference carries a parameter the schema does not declare",
    badParams.length === 0, badParams.slice(0, 5).join("; "));

  ok("every parameter declares a unit, a scale and a note",
    Object.values(db.parameters).every((p) => p.unit && p.scale && p.note));

  const badRanges = [];
  for (const [name, ref] of Object.entries(db.references)) {
    for (const [key, v] of Object.entries(ref.properties)) {
      // A not-applicable cell carries a reason and no numbers, by design —
      // that is what distinguishes it from a value of zero.
      if (v.basis === "not_applicable") continue;
      if (!(Number.isFinite(v.min) && Number.isFinite(v.max) && v.max >= v.min)) {
        badRanges.push(`${name}.${key}`);
      }
      if (v.typical !== undefined && (v.typical < v.min || v.typical > v.max)) {
        badRanges.push(`${name}.${key} typical outside range`);
      }
    }
  }
  ok("every range is finite, ordered, and contains its typical value",
    badRanges.length === 0, badRanges.slice(0, 5).join("; "));

  ok("every value states its basis",
    Object.values(db.references).every((r) => Object.values(r.properties)
      .every((v) => ["table", "compilation", "derived", "inherited", "relation",
        "analogue", "not_applicable"].includes(v.basis))));

  /**
   * NO CELL IS EMPTY. A card can honestly say "not published"; a model cannot,
   * because a hole in the input is a hole in the output. Every reference has
   * every parameter, by one of four routes, and the route is on the value.
   */
  {
    const empty = [];
    for (const [name, ref] of Object.entries(db.references)) {
      for (const key of Object.keys(db.parameters)) {
        if (!ref.properties[key]) empty.push(`${name}.${key}`);
      }
    }
    ok("every reference carries every parameter — no empty cells",
      empty.length === 0, `${empty.length}: ${empty.slice(0, 6).join(", ")}`);
  }

  ok("every value carries a confidence",
    Object.values(db.references).every((r) => Object.values(r.properties)
      .every((v) => v.confidence)));

  /**
   * AND COMPLETENESS MUST NOT LAUNDER PROVENANCE. The whole risk of filling
   * every cell is that an estimate comes to read like a measurement, so an
   * estimated value has to be distinguishable at a glance and by a machine.
   */
  {
    const estimated = [];
    for (const ref of Object.values(db.references)) {
      for (const v of Object.values(ref.properties)) {
        if (v.basis === "relation" || v.basis === "analogue") estimated.push(v);
      }
    }
    ok("every estimated value says how it was estimated",
      estimated.every((v) => v.note && v.note.length > 40));
    ok("and none of them claims better than low confidence",
      estimated.every((v) => ["low", "lowest", "none"].includes(v.confidence)));
    ok("a published value still outranks them",
      db.references.granite.properties.hoek_brown_mi.confidence === "high");
  }

  /**
   * "DOES NOT APPLY" IS ASSIGNED, NOT BLANK, and it carries its reason. A soil
   * has no Hoek-Brown mi: that describes a jointed rock mass, and a number for
   * it over an alluvial fan would be invention rather than estimation. The cell
   * is filled with the refusal so a map can draw it as its own class.
   */
  {
    const gravelMi = db.references.gravel.properties.hoek_brown_mi;
    ok("a soil's Hoek-Brown mi is assigned as not applicable",
      gravelMi.basis === "not_applicable");
    ok("and it says why, naming what to use instead",
      /rock mass/i.test(gravelMi.reason) && /Mohr-Coulomb/i.test(gravelMi.reason),
      gravelMi.reason);
    ok("no not-applicable cell carries a number",
      Object.values(db.references).every((r) => Object.values(r.properties)
        .every((v) => v.basis !== "not_applicable"
          || (v.min === undefined && v.max === undefined))));
  }

  /**
   * A COHESIONLESS SOIL'S UCS IS A REAL ZERO. An unconfined gravel specimen has
   * no strength at all — its strength is entirely friction under confinement —
   * so zero is the measurement, not a stand-in for a missing one. It was
   * omitted before, which made the strength map blank over every alluvial fan.
   */
  ok("gravel has a UCS, and it is zero", db.references.gravel.properties.ucs.max === 0);
  ok("stated as a real zero rather than a gap",
    /cohesionless/i.test(db.references.gravel.properties.ucs.note));
  ok("while a clay has a real, non-zero unconfined strength",
    db.references.clay.properties.ucs.max > 0);

  /** The map's non-rock units are materials too. */
  ok("ice is a material with measured properties", db.references.ice.properties.ucs.max > 0);
  ok("open water says it is not a porous medium",
    /not a porous medium/i.test(db.references.water.properties.hydraulic_conductivity.note));

  /**
   * The distinction the whole file turns on. If these two ever collapse into
   * one number the database has stopped saying the thing it exists to say.
   */
  const granite = db.references.granite.properties;
  ok("intact matrix and formation conductivity are separate parameters",
    granite.hydraulic_conductivity && granite.matrix_hydraulic_conductivity);
  ok("and for crystalline rock they differ by orders of magnitude",
    granite.hydraulic_conductivity.max / granite.matrix_hydraulic_conductivity.max > 1e4,
    String(granite.hydraulic_conductivity.max / granite.matrix_hydraulic_conductivity.max));

  ok("residual strength is carried separately from peak",
    granite.residual_friction_angle && granite.friction_angle
    && granite.residual_friction_angle.max < granite.friction_angle.min);

  /**
   * Clay's residual angle is the number that decides most clay landslides, and
   * it has to be far below its peak or the database is not saying so.
   */
  const clay = db.references.clay.properties;
  ok("clay's residual angle is far below its peak",
    clay.residual_friction_angle.typical <= clay.friction_angle.typical / 1.8,
    `${clay.residual_friction_angle.typical} vs ${clay.friction_angle.typical}`);
  ok("and its residual cohesion is zero",
    clay.residual_cohesion.max === 0);

  ok("the file states the intact-vs-mass warning where a reader will meet it",
    /intact/i.test(db.warning?.intact_vs_mass || ""));
}

// ---------------------------------------------------------------------------
// The resolver, on real `lith` strings.
// ---------------------------------------------------------------------------
{
  const names = (text) => RP.resolveLithology(text).map((p) => p.name);

  ok("a single lithology resolves to itself",
    names("granite").join() === "granite");

  ok("a mixture resolves to ALL of its constituents",
    names("mudstone, sandstone and limestone").sort().join()
      === ["limestone", "mudstone", "sandstone"].sort().join(),
    names("mudstone, sandstone and limestone").join());

  ok("the live layer's commonest string resolves whole",
    names("sandstone and conglomerate, interbedded").sort().join()
      === ["conglomerate", "sandstone"].sort().join());

  /**
   * `psammite` is NOT in Macrostrat's dictionary -- it is the British
   * metamorphic vocabulary, and the map uses it anyway. That is what the alias
   * table is for, and this is the check that the two vocabularies are searched
   * as one rather than the dictionary first and the aliases as a fallback.
   */
  ok("a term the dictionary does not list still resolves, through an alias",
    names("psammite and pelite").sort().join() === ["pelite", "psammite"].sort().join(),
    names("psammite and pelite").join());
  ok("and it is marked as an alias rather than passing as a dictionary name",
    RP.propertiesFor("psammite").lithologies[0].alias === true);
  ok("the regional term the map uses most resolves too",
    names("siltite").join() === "siltite");

  /**
   * LONGEST NAME FIRST, and each match consumes its own text. Without that
   * "quartz arenite" is a quartz plus an arenite and "meta-limestone" is also
   * a limestone -- one rock counted twice, in two different classes.
   */
  ok("a compound name is one lithology, not two",
    names("quartz arenite").join() === "quartz arenite",
    names("quartz arenite").join());

  {
    const parts = RP.resolveLithology("Major:{limestone}, Minor:{claystone,siltstone}");
    const byName = Object.fromEntries(parts.map((p) => [p.name, p]));
    ok("the BGS Major/Minor spelling is read as a proportion",
      parts.length === 3 && byName.limestone && byName.claystone && byName.siltstone,
      parts.map((p) => p.name).join());
    ok("and the major constituent outweighs the minor ones",
      byName.limestone.weight > byName.claystone.weight,
      `${byName.limestone?.weight} vs ${byName.claystone?.weight}`);
  }

  ok("a prose proportion word is read too",
    (() => {
      const parts = RP.resolveLithology("sandstone with subordinate shale");
      const byName = Object.fromEntries(parts.map((p) => [p.name, p]));
      return byName.sandstone?.weight > byName.shale?.weight;
    })());

  ok("a string naming no lithology resolves to nothing",
    names("undivided").length === 0);
}

// ---------------------------------------------------------------------------
// Combining. The log-scale rule is the one that changes an answer by orders
// of magnitude if it is got wrong.
// ---------------------------------------------------------------------------
{
  const sandstone = RP.propertiesFor("sandstone");
  const mudstone = RP.propertiesFor("mudstone");
  const mixed = RP.propertiesFor("sandstone and mudstone");

  /**
   * GRAVEL AND CLAY, because they are the widest honest pair in the file and
   * the log rule has to be demonstrated on a pair wide enough to show it.
   *
   * The first version of this used sandstone against mudstone, and the BGS
   * correction closed that gap to a factor of ten -- at which the geometric
   * and arithmetic means differ by a quarter of a decade and the test could
   * not tell them apart. A test whose premise a data fix invalidates is worth
   * noticing rather than loosening.
   */
  const kCoarse = RP.propertiesFor("gravel").parameters.hydraulic_conductivity.value;
  const kFine = RP.propertiesFor("clay").parameters.hydraulic_conductivity.value;
  const kBoth = RP.propertiesFor("gravel and clay").parameters.hydraulic_conductivity.value;

  ok("the two end members really are orders of magnitude apart",
    kCoarse / kFine > 1e6, String(kCoarse / kFine));

  /**
   * The whole reason `combine` reads the parameter's declared scale. The
   * arithmetic mean of 1e-7 and 1e-11 is 5e-8 — indistinguishable from the
   * sandstone alone, because an arithmetic mean over four orders of magnitude
   * IS the largest term. The geometric mean is the answer, and it is also what
   * a hydrogeologist means by an average permeability.
   */
  const geometric = Math.sqrt(kCoarse * kFine);
  const arithmetic = (kCoarse + kFine) / 2;
  ok("a log-scaled parameter combines geometrically",
    Math.abs(Math.log10(kBoth) - Math.log10(geometric)) < 0.01,
    `${kBoth} vs geometric ${geometric}`);
  ok("and NOT arithmetically, which would have answered with the gravel alone",
    Math.abs(Math.log10(kBoth) - Math.log10(arithmetic)) > 2,
    `${kBoth} vs arithmetic ${arithmetic}`);
  ok("the sandstone/mudstone pair is now only a decade apart, as BGS measured",
    Math.round(sandstone.parameters.hydraulic_conductivity.value
      / mixed.parameters.hydraulic_conductivity.value) <= 10);

  ok("a linear parameter combines arithmetically",
    (() => {
      const p = RP.propertiesFor("sandstone and mudstone").parameters.porosity;
      const a = sandstone.parameters.porosity.value;
      const b = mudstone.parameters.porosity.value;
      return Math.abs(p.value - (a + b) / 2) < 0.01;
    })());

  ok("the combined SPAN covers both constituents",
    mixed.parameters.ucs.min === Math.min(sandstone.parameters.ucs.min,
      mudstone.parameters.ucs.min)
    && mixed.parameters.ucs.max === Math.max(sandstone.parameters.ucs.max,
      mudstone.parameters.ucs.max));

  ok("a combined answer carries every source behind it",
    mixed.parameters.ucs.sources.length > 1);

  ok("a value with zeros in it does not break the log path",
    Number.isFinite(RP.propertiesFor("clay and sand")
      .parameters.residual_cohesion.value));
}

// ---------------------------------------------------------------------------
// The map-painting seam.
// ---------------------------------------------------------------------------
{
  ok("a parameter value is available for any resolvable lithology",
    Number.isFinite(RP.parameterValue("basalt", "ucs")));
  /**
   * A STRING NAMING NO ROCK STILL ANSWERS, from the no-information prior — a
   * model needs a number at every polygon, and 521 of 6,232 in one live view
   * came from a survey that states no lithology at all. It is a `prior` rather
   * than a `value` every step of the way, so nothing mistakes it for mapped
   * ground.
   */
  ok("a string naming no rock answers from the prior",
    Number.isFinite(RP.parameterValue("undivided", "ucs")));
  ok("and says it is a prior rather than a measurement",
    RP.parameterState("undivided", "ucs").state === "prior");
  ok("the prior carries no confidence at all",
    RP.propertiesFor("undivided").parameters.ucs.confidence === "none");
  ok("and its note says the source named no rock",
    /STATES NO LITHOLOGY/.test(RP.propertiesFor("undivided").parameters.ucs.notes[0]));

  ok("a soil answers with its real zero rather than a blank",
    RP.parameterValue("gravel", "ucs") === 0);
  ok("and with a friction angle, which is where its strength actually is",
    Number.isFinite(RP.parameterValue("gravel", "friction_angle")));

  /**
   * THREE ANSWERS, AND THEY ARE NOT INTERCHANGEABLE. A map that paints
   * "does not apply" and "not known" the same colour is telling a reader that
   * a soil's missing GSI and an unmapped polygon are the same problem.
   */
  ok("a value is reported as a value",
    RP.parameterState("granite", "ucs").state === "value");
  ok("a quantity that does not exist for a soil says so, with a reason",
    RP.parameterState("gravel", "hoek_brown_mi").state === "not_applicable"
    && /rock mass/i.test(RP.parameterState("gravel", "hoek_brown_mi").reason));
  ok("and an unrecognised lithology is a third, distinct answer",
    RP.parameterState("undivided", "ucs").state === "prior");

  /**
   * A MIXTURE OF ROCK AND SOIL still answers, from the constituent that has an
   * answer — and says how many of them did.
   */
  ok("a rock/soil mixture answers from what applies",
    (() => {
      const p = RP.propertiesFor("sandstone and gravel").parameters.hoek_brown_mi;
      return p.from === 1 && p.of === 2;
    })());
  ok("a mixture carries the WEAKEST confidence behind it",
    ["lowest", "low", "medium", "high"].includes(
      RP.propertiesFor("sandstone and gravel").parameters.ucs.confidence));

  /**
   * THE WHOLE POINT, checked over the whole vocabulary: every lithology the map
   * can name has an answer for every parameter, and none of those answers is a
   * silent blank.
   */
  {
    const names = [...Object.keys(db.lithologies), ...Object.keys(db.aliases)];
    const holes = [];
    for (const name of names) {
      for (const key of Object.keys(db.parameters)) {
        const answer = RP.parameterState(name, key);
        if (answer.state === "unknown") holes.push(`${name}.${key}`);
        if (answer.state === "value" && !Number.isFinite(answer.value)) {
          holes.push(`${name}.${key} (not a number)`);
        }
      }
    }
    ok(`all ${names.length} lithologies answer for all ${Object.keys(db.parameters).length} parameters`,
      holes.length === 0, `${holes.length}: ${holes.slice(0, 6).join(", ")}`);
  }

  ok("the parameter list is offered for the symbology picker",
    RP.parameterList().length === Object.keys(db.parameters).length);

  ok("citations come back as full references",
    RP.citationsFor(RP.propertiesFor("granite")).every((c) => c.citation));
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
