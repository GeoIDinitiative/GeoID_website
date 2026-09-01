/**
 * THE IMAGERY ANIMATOR, AND THE ONE PLAYER BEHIND BOTH OF THEM.
 *
 * Two things are checked here and they fail in different ways. The frame
 * arithmetic is pure and its answers are known, so it is checked against
 * dates: a window that is not clipped to the range asked for composites a
 * whole year and calls it a summer, and a cap that TRUNCATES rather than
 * strides silently changes which span the sequence is about — both of which
 * produce a sequence that plays perfectly and means something else.
 *
 * The second is structural: there is ONE player over this globe, and the two
 * drivers must not grow their own. A copied bar or a copied scene cache would
 * not fail anything — it would simply drift, which is the failure this tree
 * has paid for in the polygon-area formula and in an imitated label engine.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};
const here = path.dirname(fileURLToPath(import.meta.url));

const tl = await import("./imagery-timelapse.js");
const player = await import("./timelapse-player.js");

// --- the windows ---
const yearly = tl.framesFor({ from: "2015-01-01", to: "2024-12-31", step: "year" });
ok("a year each", yearly.epochs.length === 10, String(yearly.epochs.length));
ok("and each frame is that whole year",
  yearly.epochs[0].from === "2015-01-01" && yearly.epochs[0].to === "2015-12-31");
// The bar shows the label and GIBS is asked for the DATE, so the date has to
// be a real day inside the window rather than its first instant.
ok("the date is the middle of the window", yearly.epochs[0].date === "2015-07-02",
  yearly.epochs[0].date);
ok("and the label is the year itself", yearly.epochs[0].label === "2015");

/**
 * CLIPPED TO WHAT WAS ASKED FOR. Without this a summer range stepped yearly
 * composites the whole of that year — a picture of twelve months presented as
 * a picture of three.
 */
const summer = tl.framesFor({ from: "2016-06-01", to: "2016-08-31", step: "year" });
ok("a partial year is clipped to the range",
  summer.epochs[0].from === "2016-06-01" && summer.epochs[0].to === "2016-08-31");

const monthly = tl.framesFor({ from: "2020-03-15", to: "2020-06-10", step: "month" });
ok("months are months", monthly.epochs.map((e) => e.label).join(" ")
  === "2020-03 2020-04 2020-05 2020-06");
ok("a 30-day month ends on the 30th", monthly.epochs[1].to === "2020-04-30");
ok("and February is not padded",
  tl.framesFor({ from: "2021-02-01", to: "2021-02-28", step: "month" }).epochs[0].to
  === "2021-02-28");
// A leap February is the one month arithmetic gets wrong from a table.
ok("a leap February has its 29th",
  tl.framesFor({ from: "2020-02-01", to: "2020-03-31", step: "month" }).epochs[0].to
  === "2020-02-29");
ok("December rolls the year over",
  tl.framesFor({ from: "2020-12-01", to: "2020-12-31", step: "month" }).epochs[0].to
  === "2020-12-31");

ok("days are days", tl.framesFor({ from: "2021-01-01", to: "2021-01-05", step: "day" })
  .epochs.map((e) => e.label).join(" ") === "2021-01-01 2021-01-02 2021-01-03 2021-01-04 2021-01-05");

/**
 * THE MELT SEASON follows the hemisphere, and it is the player's own rule —
 * shared with the glacier animator rather than written twice, or a southern
 * frame composites the middle of its winter.
 */
const south = tl.framesFor({ from: "2000-01-01", to: "2003-12-31", step: "year",
  season: "melt", lat: -45 });
ok("a southern melt season crosses the new year",
  south.epochs[1].from === "2000-11-01" && south.epochs[1].to === "2001-04-30",
  `${south.epochs[1].from}..${south.epochs[1].to}`);
// The clip still wins at the ends: a reader who asked for 2000 onward is not
// shown two months of 1999 because the season reaches back over them.
ok("and the first frame is still clipped to the range asked for",
  south.epochs[0].from === "2000-01-01");
const north = tl.framesFor({ from: "2001-01-01", to: "2003-12-31", step: "year",
  season: "melt", lat: 64 });
ok("a northern one is that year's summer",
  north.epochs[0].from === "2001-05-01" && north.epochs[0].to === "2001-10-31");

/**
 * A SLIDER HAS A USEFUL LENGTH, so a long range is STRIDED rather than cut
 * off: a time-lapse is about a span, and truncating it at frame 40 would
 * quietly change which span it is.
 */
const long = tl.framesFor({ from: "1985-01-01", to: "2024-12-31", step: "month" });
ok("a long range is capped", long.epochs.length <= tl.MAX_FRAMES + 1,
  String(long.epochs.length));
ok("and says how coarsely it is stepping", long.stride === 12, String(long.stride));
ok("the range still reaches its far end", long.epochs[long.epochs.length - 1].label === "2024-12");
ok("and starts where it was asked to", long.epochs[0].label === "1985-01");

// --- which collection, and the years it flew ---
const pinned = tl.framesFor({ from: "2000-01-01", to: "2020-12-31", step: "year",
  collection: "s2" });
ok("a pinned collection is used for every frame",
  pinned.epochs.every((e) => e.dataset.id === "COPERNICUS/S2_SR_HARMONIZED"));
// 2000-2014 is before Sentinel-2 flew: those frames will be blank, and saying
// so before thirty requests are spent is the whole point of carrying `since`.
ok("and the frames before it flew are counted", pinned.blind === 15, String(pinned.blind));
const auto = tl.framesFor({ from: "2010-01-01", to: "2020-12-31", step: "year" });
ok("best-available walks the sensors down the years",
  auto.epochs[0].dataset.label === "Landsat 7"
  && auto.epochs[auto.epochs.length - 1].dataset.label === "Sentinel-2");
ok("and nothing before 1984 claims a satellite",
  tl.framesFor({ from: "1975-01-01", to: "1978-12-31", step: "year" })
    .epochs.every((e) => e.dataset === null));

/**
 * AN EXPLICIT COLLECTION REFUSES RATHER THAN SUBSTITUTING. Quietly serving
 * 250 m MODIS where 10 m Sentinel-2 was asked for is the sensor change the
 * choice exists to prevent; only "best available" may fall back.
 */
ok("auto may fall back", tl.sourceFor("auto") === "auto");
ok("a pinned collection may not", tl.sourceFor("s2") === "gee");
ok("and GIBS is asked for by name", tl.sourceFor("gibs") === "gibs");

ok("a backwards range is refused",
  tl.framesFor({ from: "2020-01-01", to: "2019-01-01" }).error);
ok("and so is a missing one", tl.framesFor({ from: "", to: "" }).error);

// --- one player, two drivers ---
{
  const imagery = fs.readFileSync(path.join(here, "imagery-timelapse.js"), "utf8");
  const glacier = fs.readFileSync(path.join(here, "glacier-timelapse.js"), "utf8");
  const playerSrc = fs.readFileSync(path.join(here, "timelapse-player.js"), "utf8");
  for (const [name, src] of [["the imagery driver", imagery], ["the glacier driver", glacier]]) {
    ok(`${name} uses the shared player`, /from "\.\/timelapse-player\.js/.test(src));
    // A second bar, a second scene cache or a second fallback chain would not
    // fail anything — it would drift.
    ok(`${name} builds no bar of its own`, !/document\.createElement\("style"\)/.test(src));
    ok(`${name} fetches no scene of its own`, !/fetchScene\(/.test(src));
    ok(`${name} composites no tiles of its own`, !/drapeMod\.composite/.test(src));
  }
  ok("and the player owns all three", /fetchScene\(/.test(playerSrc)
    && /drapeMod\.composite/.test(playerSrc) && /createElement\("style"\)/.test(playerSrc));

  /**
   * NO POLYGONS — the whole reason this animator is separate. The player takes
   * per-frame nodes and the imagery driver passes none, so a frame is the
   * picture and nothing else; what a reader wants over it is a Workspace
   * layer, which draws above renderOrder 45 by construction.
   */
  const call = (imagery.match(/startPlayer\(\{[^}]*\}\)/) || [""])[0];
  ok("the imagery driver draws no geometry",
    !/renderFeatureCollection/.test(imagery) && !/outlineOnly/.test(imagery));
  ok("and hands the player no per-frame nodes",
    Boolean(call) && !/frames/.test(call), call);
  ok("the player leaves room above the film for Workspace",
    /node\.renderOrder = 45/.test(playerSrc));
}

// --- the shared rules still say what they said ---
ok("the player's own season rule is the one the drivers use",
  JSON.stringify(player.seasonFor("2016-08-28", 64))
  === JSON.stringify({ from: "2016-05-01", to: "2016-10-31" }));
ok("and the sensor-by-year rule is one function",
  player.datasetForYear(2020).id === "COPERNICUS/S2_SR_HARMONIZED");

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
