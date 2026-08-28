/**
 * The catalogue path, against REAL records and no Earth Engine.
 *
 * What it proves: any published dataset resolves to a config this service can
 * render, the two id shapes both locate their record (the `projects/<owner>/`
 * ones cannot be derived from the id and go through the index), and the
 * things that genuinely cannot be draped are refused with a reason rather
 * than rendered wrongly.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { __testing } = require("./index.js");
const { configFromStac, stacRecord, configFor } = __testing;

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

// A single-band palette dataset: the legend and its unit are the point.
const chirps = await stacRecord("UCSB-CHG/CHIRPS/DAILY");
const chirpsConfig = configFromStac(chirps);
check("CHIRPS resolves", chirpsConfig.bands?.[0] === "precipitation",
  JSON.stringify(chirpsConfig.bands));
check("CHIRPS carries the published palette", Array.isArray(chirpsConfig.palette));
check("CHIRPS gets a legend with its own range",
  chirpsConfig.legend?.min === 1 && chirpsConfig.legend?.max === 17,
  JSON.stringify(chirpsConfig.legend));
check("CHIRPS states its start date", chirpsConfig.startDate === "1981-01-01",
  chirpsConfig.startDate);

// An RGB composite: three bands, no palette, no legend to claim.
const s2 = configFromStac(await stacRecord("COPERNICUS/S2_SR_HARMONIZED"));
check("Sentinel-2 is a three-band composite", s2.bands?.length === 3);
check("an RGB composite claims no legend", s2.legend === null);

// A single Image, not a collection: it must not be date-filtered.
const dem = configFromStac(await stacRecord("NASA/NASADEM_HGT/001"));
check("NASADEM is a single image", dem.single === true);

// The id shape that cannot be derived — it goes through the index.
const openet = await stacRecord("projects/openet/assets/ensemble/conus/gridmet/monthly/v2_1");
check("a projects/<owner> id still finds its record",
  openet?.id === "projects/openet/assets/ensemble/conus/gridmet/monthly/v2_1",
  String(openet?.id));

// Tables are refused, with a reason.
const table = configFromStac(await stacRecord("TIGER/2018/States"));
check("a table is refused rather than drawn", Boolean(table.unsupported), table.unsupported);

// Land cover: no stretch at all, rendered from its own class table.
const worldcover = configFromStac(await stacRecord("ESA/WorldCover/v200"));
check("land cover renders from its class table", Array.isArray(worldcover.classes),
  worldcover.unsupported || "no classes");
check("classes are remapped onto a dense palette",
  worldcover.min === 0 && worldcover.max === worldcover.classes.length - 1
  && worldcover.palette.length === worldcover.classes.length,
  `${worldcover.min}..${worldcover.max} over ${worldcover.palette?.length} colours`);
check("each class keeps the publisher's own name",
  worldcover.classLegend?.some((c) => /tree/i.test(c.label)),
  JSON.stringify(worldcover.classLegend?.slice(0, 2)));

// A 24,201-class lookup table is not a legend and not a palette.
const landfire = configFromStac(await stacRecord("LANDFIRE/Vegetation/ESP/v1_2_0/CONUS"));
check("an enormous class table is refused, not truncated",
  Boolean(landfire.unsupported), JSON.stringify(landfire).slice(0, 120));

// An id nobody publishes resolves to null, not to a config.
check("an unpublished id is not in the catalogue",
  (await configFor("NOT/A/REAL/DATASET")) === null);

// A curated id still wins over the catalogue.
const curated = await configFor("anomaly/CHIRPS");
check("the curated list is still preferred", curated.anomaly !== undefined);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
