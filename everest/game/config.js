/**
 * ASCENT — every constant the mountain is made of.
 *
 * Nothing in this file is remembered geography. The route, the camps and the
 * surrounding peaks were all read back out of the DEM before they were written
 * down (see the block comments beside each), because the first draft of this
 * file WAS remembered geography and it put Camp II eight hundred metres up the
 * Nuptse wall. Where a published elevation and the DEM disagree, both numbers
 * are here: the DEM is what you walk on, the published figure is what the
 * journal tells you, and the difference is a real property of a 30 m elevation
 * model over a mountain that comes to a point.
 */

/* ── The world frame ──────────────────────────────────────────────────────
   Local ENU metres about an origin between Base Camp and the summit.
     +x east   +y up   +z south      (so north is -z, which is where a
                                      three.js camera looks by default)
   Horizontal distances are Mercator metres scaled by cos(lat0), which is
   exact at the origin latitude and drifts 0.09% at the edge of the play
   area — nine metres in ten kilometres. */
export const ORIGIN = { lat: 27.9930, lon: 86.8950 };

/** Everest's summit as surveyed (2020, China/Nepal joint), and as the DEM has
 *  it. The DEM is 100 m low because SRTM-lineage data smooths a summit cone —
 *  the game corrects the top 300 m back onto the surveyed height, and says so
 *  in the summit POI rather than quietly fudging it. */
export const SUMMIT = { lat: 27.98806, lon: 86.92528, surveyed: 8848.86, dem: 8749 };

/* ── Tile services ────────────────────────────────────────────────────────
   Both were probed from this machine before being relied on: both answer over
   Everest, both send `Access-Control-Allow-Origin: *`, so an <img> with
   crossOrigin="anonymous" can be read back out of a canvas — which the DEM
   path depends on absolutely, since it decodes elevation from pixels. */

export const IMAGERY = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  // Measured over the summit tile: 200 at every level to 19. 19 is 0.26 m/px
  // nominal; the imagery behind it here is ~0.5 m Maxar, so 18 is the honest
  // floor and 19 is upsampling.
  maxZoom: 19,
  credit: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
  // Same licence position the GIS viewer takes: free of charge on this
  // endpoint, NOT licensed for unrestricted embedding, and explicitly not for
  // offline tile export. Streaming what a player is looking at is viewing.
  licence: "Esri Master License Agreement — viewing only, no tile export.",
};

export const ELEVATION = {
  url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  // Measured: 200 through z15, 404 at z16. z15 is a 4.22 m grid over ~30 m
  // source data, so it is interpolation rather than new information — but it
  // is the interpolation the publisher chose, and it beats ours.
  maxZoom: 15,
  credit: "Elevation: Mapzen Terrain Tiles / AWS Open Data — SRTM, ASTER, and national sources",
  /** height = (R·256 + G + B/256) − 32768, metres above the EGM96 geoid. */
  decode: (r, g, b) => r * 256 + g + b / 256 - 32768,
};

/** A single corrupt scanline sits at exactly 28.0000°N — ~8,150 m below its
 *  neighbours, straight through the Base Camp approach, and present in every
 *  tile along that parallel. Any sample more than this far from the median of
 *  its vertical neighbours is that artifact and is replaced. 300 m is well
 *  above real terrain change across 4 m of ground (a 90° cliff would be 4 m)
 *  and far below the 8,150 m the artifact moves. */
export const DEM_DESPIKE_M = 300;

/* ── Streaming tiers ──────────────────────────────────────────────────────
   Three elevation tiers and four imagery tiers, each a square window in local
   metres. `follow: true` means the window re-centres on the player and its
   tiles are re-fetched; the fixed ones are loaded once at boot.

   The resolutions step 135 → 17 → 8.4 m on the ground for elevation and
   67 → 17 → 4.2 → 0.53 m for imagery, so there is no cliff between what you
   see far away and what you stand on. */
/**
 * The near tier used to be zoom 15, on the assumption that a pyramid which
 * serves you a level has data at that level. It does not. `tools/dem_information.mjs`
 * builds the grid at each level and subtracts a bilinear upsample of its
 * parent; what is left is whatever that level actually knows:
 *
 *     z11  67 m/px   30.07 m RMS   real detail
 *     z12  34 m/px   11.79 m       real detail
 *     z13  17 m/px    7.69 m       real detail
 *     z14  8.4 m/px   1.26 m       marginal
 *     z15  4.2 m/px   0.74 m       interpolation, nothing more
 *
 * The source over High Mountain Asia is 30 m SRTM/ASTER, so the information
 * runs out at z13 and everything past it is the publisher's resampling. Zoom
 * 15 was costing 25 tiles per rebuild to deliver 0.74 m of smooth ramp.
 *
 * So the near tier drops to z14 — still finer than the data, which keeps the
 * height samples smooth under a 4 m clipmap cell — and spends the saved tiles
 * on *extent* instead: the same 25-tile budget now reaches 4.2 km rather than
 * 2.2 km. That pushes the near/mid seam twice as far out, and since z13 and
 * z14 differ by 1.26 m RMS the seam is nearly invisible when you do reach it.
 *
 * The real consequence is worth stating plainly: no shader can put rock detail
 * into geometry that is 17 m coarse. That gap is a data problem, not a
 * rendering one.
 */
export const DEM_TIERS = [
  /* The outermost ring of the world. From the summit the true horizon is
     ~300 km; the shell that draws it needs heights past the far tier's
     104 km. z8 posts are 540 m — coarse, but at 50+ km a post subtends a
     dozen pixels, and nine tiles buy the whole extent. 1.2 MB. */
  { key: "vast", zoom:  8, half: 150000, follow: false }, // 540 m/px, 300 km — the true horizon
  { key: "far",  zoom: 10, half: 52000, follow: false },  // 135 m/px, 104 km — the skyline
  /* The middle tier is for the middle DISTANCE, and that changes the maths.
     It used to be z13/7 km — 17 m posts under the route — but the route's
     fine data actually comes from the near tier that follows the player, so
     what this tier really feeds is every ridge from there to the horizon.
     The first fix extended z13 to 26 km and it worked, at a price measured
     the hard way: a 6154-square float window is 151 MB, the machine went
     into swap, and the compositor stalled for seconds at a time. z12 across
     60 km is 13 MB. Its 34 m posts subtend 3-4 pixels at the distances this
     tier is ever seen at, which is the same picture for a tenth of the
     memory — resolution you cannot see is memory you cannot spare. */
  { key: "mid",  zoom: 12, half: 30000, follow: false },  //  33.7 m/px, 60 km — the horizon band
  { key: "near", zoom: 14, half:  4200, follow: true, rebuildAfter: 900 }, // 8.4 m/px — under your feet
];

/**
 * Imagery is a level finer than the elevation at every tier, because a cliff
 * is mostly a picture problem. The Nuptse wall and the Lhotse Face are one to
 * three kilometres away for most of the game, which is exactly the band the
 * mid tier covers — at 17 m/px they were a smear, and at 8.4 they read as
 * rock and ice. Esri's tiles are 7–13 kB each, so a tier that needs 49 of
 * them costs about half a megabyte; the resolution is nearly free and only
 * the tile count is not.
 *
 *   67.5 → 8.4 → 2.1 → 0.53 metres per pixel
 */
export const IMG_TIERS = [
  /* ── Sized by texels-per-screen-pixel, not by eye ─────────────────────
     The right question for each band is how many texture pixels feed one
     screen pixel. Below 1.0 the texture is being magnified and the view is
     blurry by definition; at or above 1.0 the monitor is the limit and more
     resolution is wasted. At this FOV and 1920 px wide, one screen pixel
     covers distance/1057 metres of ground.

     The ladder that was here measured 0.36 at 800 m and 0.67 at 1500 m —
     the near field, not the distance, was the blurriest part of the view,
     because 0.53 m/px stopped at 540 m and handed straight to 2.11 m/px
     exactly where the screen still resolves under a metre.

         band        ground/screen px     tier        texels/px
         300 m           0.28 m          ultra 0.53      0.54
         800 m           0.76 m          near  1.05      0.72
        1500 m           1.42 m          near  1.05      1.35
        3000 m           2.84 m          mid   2.11      1.35
        5000 m           4.73 m          mid   2.11      2.24
        7300 m           6.91 m          mid   2.11      3.27

     Everything from 1.5 km out is now screen-limited. 300 m cannot be fixed:
     0.53 m/px is Esri's real ceiling (z19 measured as an upsample), so at
     close range the monitor simply out-resolves the best imagery there is. */
  /* z12 at 72 km of width: twice the sharpness of the z11 it replaces while
     still covering the 60 km horizon disc entirely, so no edge-clamp smear.
     The middle distance stops draping in the haziest level of the pyramid. */
  /* The drape for the outermost shell: 270 m/px is the honest resolution
     for ground 40-150 km away (it subtends under a screen pixel there), and
     the whole 300 km square is a ~1300 px canvas from 25 tiles. */
  { key: "vast",  zoom:  9, half: 150000, follow: false },                   // 270 m/px to 300 km wide
  { key: "far",   zoom: 12, half: 36000, follow: false },                    // 33.75 m/px to 72 km wide, skyline
  { key: "mid",   zoom: 16, half:  8000, follow: false },                    //  2.11 m/px to 8.6 km
  { key: "near",  zoom: 17, half:  2100, follow: false },                    //  1.05 m/px to 2.3 km
  /* 1120 m, not 540. A tier at r m/px stops being the limit at d = r * 1057
     (pixels per radian at this FOV and width), so 0.53 m/px is adequate from
     560 m and 1.05 m/px only from 1110 m. Ending ultra at 540 m therefore
     handed over to a tier that was not good enough yet, and 540-1110 m was the
     one starved band left in the whole view — measured 0.72 texels per screen
     pixel at 800 m while everything past 1.5 km sat above 1.0. Carrying ultra
     to 1120 m closes it exactly: every band from 560 m outward becomes
     screen-limited, and below 560 m nothing can help, because 0.53 m/px is
     Esri's real ceiling and the screen resolves finer than that up close. */
  { key: "ultra", zoom: 18, half:  1120, follow: true, rebuildAfter: 240 },  //  0.53 m/px to 1.1 km
];

/** Six in flight is what HTTP/1.1 gives per host, and asking for more just
 *  queues them in the browser where we cannot see or reorder them. */
export const TILE_BUDGET = 6;
export const TILE_CACHE = 512;

/* ── Terrain geometry ─────────────────────────────────────────────────────
   A geometry clipmap: eight nested square levels centred on the player, each
   double the cell size of the last. Level 0 is a filled grid, 1-7 are rings
   with the middle left out because a finer level already covers it. */
/**
 * The base cell was 4 m, chosen to match the z15 DEM exactly. That reasoning
 * expired the moment the DEM was measured: z15 carries no information at all
 * (see DEM_TIERS), so matching it was matching an interpolation. The real
 * elevation data is ~30 m, and no cell size recovers what is not there.
 *
 * What *does* exist below 30 m is the imagery, at 0.53 m per pixel, and
 * photoclino.js turns that into height. But relief cannot be displaced onto a
 * surface too coarse to hold it: a 4 m cell cannot express anything shorter
 * than an 8 m wavelength, which threw away most of what the imagery knows.
 *
 * So the base cell drops to 2 m and a tenth level is added to hold the outer
 * extent. Because every level is the same 96x96 grid, the extra level costs
 * one more ring — about 18k triangles on a scene that draws millions — and the
 * innermost ring now resolves a 4 m wavelength instead of 8 m. That is the
 * band the imagery actually resolves, so it is the first version of this where
 * the recovered relief is not being thrown away by the grid it lands on.
 */
export const CLIPMAP = {
  /* ── One mesh. No rings, no holes, no morph, no seams. ────────────────
     This was ten nested levels centred on the player. Every level had an
     outer edge that morphed onto its parent, a hole cut where its child
     covered, and an index buffer rebuilt whenever either moved — and that
     machinery, not the act of draping imagery on a DEM, produced every
     surface complaint in this project: ring seams, unwritten hole vertices,
     morph targets that disagreed with what the parent actually drew, and
     geometry that rebuilt as you walked.

     The Etna viewer in this repo has none of those problems and none of that
     machinery: one mesh, UVs baked once, fixed extent. The only reason ASCENT
     needed a clipmap is that it is walkable over 100 km — but the massif is
     16 km across, and the elevation model resolves 17 m, so a single fixed
     grid at 8 m posts covers everything anyone can walk to at finer than the
     data itself. 2049² vertices, built once, never rebuilt.

     `levels: 1` makes level 0 both the finest and the only level: no parent
     (so no morph) and no child (so no hole). Every seam is gone by
     construction rather than by patching. */
  levels: 1,
  /* 1024 x 16 m = 16.4 km, the same ground as 2048 x 8 m for a QUARTER of the
     vertices — 1.05M instead of 4.2M. The 8 m grid was finer than the data it
     samples (the elevation model resolves ~17 m), so it bought nothing and
     cost everything: one unbudgeted resample of 4.2M vertices is a multi-
     second CPU stall, measured at 184 ms per frame. 16 m posts are still at
     the data's own resolution. */
  cells: 1024,
  baseCell: 16,
};

/* ── The route ────────────────────────────────────────────────────────────
   Read off the DEM, not recalled. `dem` is what the elevation model says at
   that coordinate; `published` is the accepted height of the place. Camp I
   agrees to 6 m and the South Col to 78 m, which is the check that these
   coordinates land where their names say they do.

   The Western Cwm's line came from taking the lowest cell on each of fourteen
   north-south transects between 86.876 and 86.915 — the valley floor, found
   rather than guessed, which is why it bends south-east instead of running
   along a parallel the way the first draft had it. */
/* Corrected against the published South Col route geometry (and the shape
   every route graphic agrees on): the Cwm runs ESE from Camp I before
   bending south, Camp III sits DOWN the face at 27.974 — the old 27.9806
   was ~770 m north, which drew the C2→C3 leg flat east instead of
   climbing southeast up the Lhotse Face — the traverse to the Col runs
   through the Yellow Band and Geneva Spur at col latitude, and the summit
   is at its surveyed 27.98806 N, 86.92528 E. */
export const ROUTE = [
  /* The lower half is fitted to THIS terrain, not to an atlas: textbook
     camp coordinates landed on the Nuptse-side slopes in our DEM/imagery
     frame, so the Cwm floor was traced in-game (minimum-height,
     minimum-slope scans across the valley at each longitude) and every
     point below the bergschrund now sits on measured flat glacier —
     Camp I at 3\u00b0, the Cwm at 1\u00b0, Camp II at 1\u00b0. */
  { id: "bc",       name: "Base Camp",            lat: 28.00260, lon: 86.85280, dem: 5299, published: 5364, camp: true },
  { id: "icefall",  name: "Khumbu Icefall",       lat: 27.99500, lon: 86.86300, dem: 5450, published: 5700 },
  { id: "icefall2", name: "The Popcorn Field",    lat: 27.99280, lon: 86.86800, dem: 5750, published: 5900 },
  { id: "c1",       name: "Camp I",               lat: 27.99000, lon: 86.87100, dem: 6007, published: 6065, camp: true },
  { id: "cwm1",     name: "Western Cwm",          lat: 27.98700, lon: 86.87700, dem: 6046, published: 6100 },
  { id: "cwm2",     name: "Valley of Silence",    lat: 27.98310, lon: 86.88970, dem: 6274, published: 6300 },
  { id: "c2",       name: "Camp II",              lat: 27.97945, lon: 86.90245, dem: 6481, published: 6400, camp: true },
  { id: "bergs",    name: "Bergschrund",          lat: 27.97700, lon: 86.91000, dem: 6569, published: 6700 },
  { id: "face1",    name: "Lhotse Face",          lat: 27.97500, lon: 86.91600, dem: 7166, published: 7200 },
  { id: "c3",       name: "Camp III",             lat: 27.97370, lon: 86.92070, dem: 7417, published: 7470, camp: true },
  { id: "yellow",   name: "The Yellow Band",      lat: 27.97350, lon: 86.92450, dem: 7600, published: 7700 },
  { id: "geneva",   name: "The Geneva Spur",      lat: 27.97380, lon: 86.92800, dem: 7669, published: 7800 },
  { id: "c4",       name: "Camp IV — South Col",  lat: 27.97350, lon: 86.92970, dem: 7842, published: 7920, camp: true },
  { id: "balcony",  name: "The Balcony",          lat: 27.97930, lon: 86.92960, dem: 8280, published: 8430 },
  { id: "ssummit",  name: "The South Summit",     lat: 27.98680, lon: 86.92620, dem: 8600, published: 8749 },
  { id: "step",     name: "The Hillary Step",     lat: 27.98760, lon: 86.92560, dem: 8690, published: 8790 },
  { id: "summit",   name: "The Summit",           lat: 27.98806, lon: 86.92528, dem: 8749, published: 8848.86, camp: true },
];

/** The five camps, in order, with what each one is for. Progress is measured
 *  in camps reached, and a flare fired at one can only ever lift you to the
 *  next — never to the summit. */
export const CAMPS = ROUTE.filter((p) => p.camp);

/* ── The skyline ──────────────────────────────────────────────────────────
   Found as local maxima of the DEM over a 61-cell window, then named by
   matching position and height against the published peaks. The DEM reads
   every summit 100-220 m low for the same cone-smoothing reason Everest does,
   so both numbers are kept. */
export const PEAKS = [
  { name: "Lhotse",        lat: 27.96170, lon: 86.93260, dem: 8430, published: 8516, note: "Fourth-highest mountain on Earth. Shares the South Col with Everest." },
  { name: "Lhotse Shar",   lat: 27.95900, lon: 86.94370, dem: 8195, published: 8383, note: "The eastern summit of the Lhotse massif." },
  { name: "Nuptse",        lat: 27.96760, lon: 86.88690, dem: 7814, published: 7861, note: "The south wall of the Western Cwm. Its ridge shades Camp II by mid-afternoon." },
  { name: "Changtse",      lat: 28.02570, lon: 86.91090, dem: 7497, published: 7543, note: "Everest's north peak, in Tibet. Visible over the Lho La from Base Camp." },
  { name: "West Shoulder", lat: 27.99660, lon: 86.89170, dem: 7282, published: 7300, note: "The Everest west ridge above the Cwm. Its seracs hang over the Icefall." },
  { name: "Pumori",        lat: 28.01610, lon: 86.82750, dem: 7116, published: 7161, note: "“Unmarried daughter” — named by Mallory. The view of Everest from Kala Patthar is on its south ridge." },
  { name: "Khumbutse",     lat: 28.02800, lon: 86.85460, dem: 6682, published: 6636, note: "At the head of the Khumbu, on the Nepal-Tibet border." },
];

/* ── Points of interest ───────────────────────────────────────────────────
   Everything the player can be told about. Route and peak entries become POIs
   automatically; these are the rest. */
export const POI_EXTRA = [
  { id: "puja", name: "Puja Altar", lat: 28.00300, lon: 86.85180,
    kind: "site",
    text: "No Sherpa on this mountain steps into the Icefall before the puja. A lama blesses the rope, the crampons and the axes; juniper smoke goes up; everyone is marked with tsampa flour. It is not decoration — it is the point at which the season is agreed to have begun." },
  { id: "icedoc", name: "The Icefall Doctors", lat: 28.00050, lon: 86.85900,
    kind: "site",
    text: "A team of eight Sherpas re-rigs the route through the Icefall every season and maintains it daily — eighty ladders, three kilometres of rope. They are in there before dawn, when the ice is coldest and least willing to move. Everything you clip into above Base Camp, someone put there first." },
  { id: "silence", name: "The Valley of Silence", lat: 27.98300, lon: 86.88900,
    kind: "site",
    text: "The Western Cwm is walled by Everest, Nuptse and Lhotse, and no wind reaches the floor of it. On a clear morning it is the hottest place on the mountain — 35°C off the snow, with the air at −20 — and climbers have gone down with heatstroke at 6,400 metres." },
  { id: "deathzone", name: "The Death Zone", lat: 27.97600, lon: 86.92400,
    kind: "warning",
    text: "Above 8,000 metres the air holds a third of the oxygen it does at the sea. Nothing acclimatises to it. From the moment you cross this line your body is consuming itself, and the only treatment for what altitude is doing to you is to lose height." },
  { id: "rainbow", name: "Rainbow Valley", lat: 27.98500, lon: 86.92700,
    kind: "warning",
    text: "The name is gallows humour: the colours are down jackets. The dead stay where they fall up here, because bringing a body down from 8,500 metres costs more lives than it saves. Walk past. Note where they are. Some of them are landmarks now." },
  { id: "lhola", name: "The Lho La", lat: 28.00890, lon: 86.86170,
    kind: "site",
    text: "The pass at the head of the Khumbu, 6,000 m, and the Tibetan border. Mallory looked through it in 1921 and saw the Western Cwm for the first time — and judged it unclimbable from that side." },
];

/* ── Physiology ───────────────────────────────────────────────────────────
   Not a simulation of a person. A set of curves chosen so the mountain feels
   the way the accounts describe it, anchored where real numbers exist. */
export const PHYS = {
  /** Barometric pressure, kPa, by altitude — the standard atmosphere, which
   *  is genuinely what makes 8,000 m what it is. 101.3 at sea level, 33.7 at
   *  the summit: a third. */
  seaLevelKPa: 101.325,
  lapseK: 0.0065,          // K/m
  seaLevelK: 288.15,

  maxEnergy: 100,
  maxWarmth: 100,
  /** Litres of bottled oxygen per bottle, and how fast a regulator drains it
   *  at each flow rate. A 4-litre bottle at 3 L/min is about 5 hours. */
  bottleLitres: 720,
  flowRates: [0, 1, 2, 3, 4],

  /** Energy burn as a percentage of the whole per SIMULATED HOUR, at rest,
   *  walking, and climbing steeply — before altitude, cold and load multiply
   *  it. Per-hour rather than per-second because the clock runs faster than
   *  the player does (see TIME_SCALE) and a rate written per second silently
   *  means something different the moment that changes. Walking flat out on
   *  the flat empties you in about six hours; front-pointing, under two. */
  burnRest: 3,
  /* Raised from 16/55: at TIME_SCALE 8 the old rates cost about two energy
     points a real minute of walking, which on a 100-point bar read as "does
     not deplete at all". A visible cost is the point of carrying the bar. */
  burnWalk: 26,
  burnClimb: 70,

  /** Warmth, same units. Working generates heat; standing still in wind
   *  takes it away several times faster than you can make it. */
  warmthFromWork: 26,
  warmthFromRest: 5,
  warmthLossFull: 78,

  /** Below this SpO2 you start losing coordination; below the second you are
   *  in the territory where people sit down and do not get up. */
  spo2Impaired: 70,
  spo2Critical: 55,

  /** Hours of continuous exposure above 8,000 m before HACE/HAPE become
   *  likely. Real answer is "it varies enormously"; this is a game. */
  deathZoneHours: 16,
};

/* ── Weather ──────────────────────────────────────────────────────────────
   The jet stream sits on Everest for most of the year and lifts off it for a
   few days before and after the monsoon. That is the whole reason there is a
   summit season, so it is the spine of the weather model. */
export const WEATHER = {
  /** Wind at the summit, m/s, when the jet is on the mountain and when it is
   *  not. 80 m/s is 290 km/h and has been measured up there. */
  jetOnSummit: 62,
  jetOffSummit: 11,
  /** Wind falls off below the summit roughly with height above the Cwm. */
  windRefAlt: 6000,
  /** Temperature at Base Camp on a clear day in May, and the lapse rate that
   *  carries it up the hill. */
  baseTempC: -6,
  lapseC: 0.0068,
  /** Wind chill: the 2001 JAG/TI formula, in the module. */
  states: ["clear", "high cloud", "building", "spindrift", "storm", "whiteout"],
};

/* ── Hazards ──────────────────────────────────────────────────────────────
   Rates are per hour of exposure in the terrain each one belongs to. */
export const HAZARD = {
  seracCollapse:  { zone: "icefall",  perHour: 0.55 },
  crevasseBridge: { zone: "glacier",  perHour: 0.90 },
  rockfall:       { zone: "face",     perHour: 0.45 },
  avalanche:      { zone: "slab",     perHour: 0.30 },
  /** Slope angles that hold a slab avalanche. Below 25° it will not slide,
   *  above 60° it sloughs continuously and never builds. The 30-45° band is
   *  where nearly every fatal slab release happens. */
  slabMin: 25, slabPeak: 38, slabMax: 60,
};

/**
 * At or below this bridge strength a crevasse is an OPEN hole: the terrain
 * shader cuts it, you can see it from a hundred metres, and walking into it
 * is a certainty rather than a dice roll. Above it, the crevasse is bridged
 * and looks exactly like the snow either side — which is the one that kills
 * people, and the only one with a probability attached.
 *
 * `glacier.js` uses this to decide what to paint and `player.js` to decide
 * what you fall into, and **they must agree**. A slot that is drawn but not
 * fallen into, or fallen into but not drawn, is the worst bug this game can
 * have, so the number lives here rather than twice.
 */
export const OPEN = 0.55;

/* ── Tuning ───────────────────────────────────────────────────────────────*/
/**
 * How much faster the world's clock runs than the player's. Eight simulated
 * seconds a second: a leg between camps is fifteen to twenty-five minutes of
 * play and two or three hours on the mountain, which is roughly the ratio
 * that keeps both the weather and the walking honest. Everything in the
 * simulation takes simulated seconds; only animation takes real ones.
 */
export const TIME_SCALE = 8;

export const MOVE = {
  /** A game's walking pace, not a person's. A real climber does about
   *  1.3 m/s on the flat at sea level and a great deal less than that here —
   *  but with the clock at 8×, moving at 1.3 would mean covering 16 cm per
   *  simulated second, and the mountain would take a simulated fortnight.
   *  This is the number that makes the two agree. Measured end to end: it
   *  works out at about 1.6 m/s over real ground once slope, snow depth and
   *  a body at 5,300 m have taken their cut, so the 8.14 km route is roughly
   *  ninety minutes of walking and the whole ascent about two hours — which
   *  at eight simulated seconds a second is a little over two simulated
   *  days, which is when the summit window opens. Those three numbers are
   *  tied together; moving one means checking the others. */
  walk: 2.70,
  climbFactor: 0.28, // how much of your speed a 30° slope takes
  maxSlopeWalk: 38,  // degrees; steeper needs front-pointing, which is slower
  maxSlopeClimb: 62, // steeper than this is not going to happen on foot
  eyeHeight: 1.62,
  stepHeight: 0.55,
  gravity: 9.81,
};

export const RENDER = {
  fov: 62,
  near: 0.6,
  /* 230 km, because the outer shell's corner is 212 km out and a far plane
     at 90 km was slicing it. Safe under the logarithmic depth buffer, which
     spends precision by ratio, not range — the near plane is untouched. */
  far: 230000,
  /** Vertical exaggeration. 1.0 — the mountain does not need help. */
  vertExag: 1.0,
};
