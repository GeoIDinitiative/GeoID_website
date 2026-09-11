/**
 * WHAT A MODELLED LAYER IS, WRITTEN OUT.
 *
 * A slope map is not a measurement. It is Horn's estimator run over a
 * resampled grid at whatever cell size the current view happens to give, and
 * every one of those choices moves the number: the same hillside is 21° on a
 * 30 m grid and 14° on a 90 m one, and neither is wrong. A reader who cannot
 * see the arithmetic cannot tell which they are holding, and a screening model
 * whose method is a secret is not a screening model -- it is a picture with
 * authority it has not earned.
 *
 * So every layer this app COMPUTES states its equations in full on its ⓘ card:
 * the expression, every symbol in it, and the assumptions that make it apply.
 * Layers modelled elsewhere say so instead, name the model and cite it, and
 * state whatever arithmetic our own bake did on top -- which is a different
 * claim and must not read as ours.
 *
 * ONE REGISTRY, and the test executes what it prints. `equations.test.mjs`
 * evaluates these expressions against `raster-analysis.js` on a synthetic
 * surface and fails if the card and the code disagree: a comment can drift
 * from its function silently, and this is the version that cannot.
 */

/** A layer computed in the browser, from the grid the view is looking at. */
const COMPUTED = "computed here";
/** A published model. Ours is the reading, not the modelling. */
const PUBLISHED = "modelled elsewhere";

/**
 * The gradient every surface reading here is built on: Horn's 3x3, the same
 * estimator QGIS and ArcGIS use, so a number from this app is comparable with
 * one from those.
 */
const HORN = {
  lines: [
    { expr: "∂z/∂x = [(z₃ + 2z₆ + z₉) − (z₁ + 2z₄ + z₇)] / (8·Δx)" },
    { expr: "∂z/∂y = [(z₇ + 2z₈ + z₉) − (z₁ + 2z₂ + z₃)] / (8·Δy)" },
  ],
  terms: [
    ["z₁…z₉", "the 3×3 window of heights, read left to right and top to bottom"],
    ["Δx, Δy", "the cell size on the ground, in metres (below)"],
  ],
  note: "A cell whose window touches the grid edge or any no-data cell returns "
    + "no answer rather than a one-sided estimate.",
};

/** Degrees are not metres, and the conversion is latitude's business. */
const CELL = {
  lines: [
    { expr: "Δx = |(lon_max − lon_min)| · 111320 · cos(φ) / width" },
    { expr: "Δy = |(lat_max − lat_min)| · 110574 / height" },
  ],
  terms: [
    ["φ", "the latitude of the middle of the grid"],
    ["111320 m", "one degree of longitude at the equator"],
    ["110574 m", "one degree of latitude"],
  ],
  note: "One cell size for the whole grid, taken at its middle latitude. Over "
    + "a view a few degrees across that is a fraction of a percent; over a "
    + "hemisphere it is not, and a slope read at world zoom is a slope of the "
    + "resampled picture rather than of the ground.",
};

/** Carrying a reanalysis cell's mean to another height. */
const DOWNSCALE_TERMS = [
  ["T_cell, p_cell", "MERRA-2's 2001–2020 annual mean 2 m temperature and surface "
    + "pressure, bilinear on its 0.5° × 0.625° grid"],
  ["z_cell", "the grid cell's own surface height, from the same source"],
  ["z", "the streamed DEM's height here — or 0 where it reports seabed under "
    + "open water (a depression inside high ground keeps its own height)"],
  ["Γ", "6.5 K/km, the standard atmosphere's lapse rate"],
  ["g, R_d", "9.80665 m/s² and 287.05 J/(kg·K), the dry-air gas constant"],
];

const EQUATIONS = {
  "climate-temperature": {
    kind: PUBLISHED,
    intro: "A reanalysis mean, carried to the ground. MERRA-2 is NASA's; the "
      + "carrying is ours, and it is one line.",
    lines: [
      { expr: "T(z) = T_cell − Γ · (z − z_cell)",
        note: "a summit is colder by the height it stands above its cell's mean height" },
    ],
    terms: DOWNSCALE_TERMS,
    note: "The standard lapse rate is an average: inversions in valleys and "
      + "the steeper lapse of dry air are not in it. At sea it adds nothing, "
      + "because the sea is at the height the cell describes.",
  },

  "climate-pressure": {
    kind: PUBLISHED,
    intro: "A reanalysis mean, carried to the ground by the hypsometric equation.",
    lines: [
      { expr: "T(z) = T_cell − Γ · (z − z_cell)" },
      { expr: "T̄ = ½ · (T_cell + T(z)) + 273.15", note: "the layer's mean temperature, in kelvin" },
      { expr: "p(z) = p_cell · exp( −g · (z − z_cell) / (R_d · T̄) )" },
    ],
    terms: DOWNSCALE_TERMS,
    note: "Dry air, hydrostatic, and the layer's temperature taken as its mean: "
      + "over the few hundred metres a grid cell's mean height differs from the "
      + "ground in it, that is a fraction of a percent.",
  },

  "sea-level": {
    kind: COMPUTED,
    intro: "A bathtub model with connectivity, on the streamed heights and the "
      + "real coastline. Nothing moves but the level.",
    lines: [
      { expr: "sea(L) ⊇ O", note: "today's sea is the coastline polygons O, whatever the DEM says under them" },
      { expr: "flooded(L) = { c : h(c) < L, and c is joined to O through cells with h < L }",
        note: "8-neighbour; a lake cell is crossed only if its SURFACE is below L" },
      { expr: "depth(c) = L − h(c)", note: "drawn for flooded land, when L ≥ 0" },
      { expr: "exposed(L) = { c ∈ O : h(c) ≥ L },  height = h(c) − L", note: "drawn when L < 0" },
    ],
    terms: [
      ["L", "the chosen level, in metres against today's"],
      ["h(c)", "the streamed DEM's height at the cell; inside a lake, the lake's "
        + "surveyed surface elevation from HydroLAKES instead"],
      ["O", "the ocean polygons: OpenStreetMap's water polygons from zoom 4, "
        + "Natural Earth below"],
    ],
    note: "Static: no tides, surges or waves, no defences finer than the DEM's "
      + "posts, no land rising or sinking under the change in load. Ground "
      + "below L that the sea cannot reach is reported as cut off, not drawn. "
      + "Away from the world view only ground in view is considered, so the "
      + "sea has to reach a cell through what the view can see.",
  },

  "cyclone-risk": {
    kind: COMPUTED,
    intro: "How often a tropical cyclone passes, counted from IBTrACS and "
      + "converted to an annual chance. The one thing to read before the "
      + "colours: the value is measured AT A POINT within a fixed radius, "
      + "never per cell — which is what lets the cells be different sizes "
      + "without the map becoming a picture of its own resolution.",
    lines: [
      { expr: "λ(p) = N(p) / Y",
        note: "the rate, in storms per year, at the point p" },
      { expr: "P(p) = 1 − exp( −λ(p) )",
        note: "the chance of AT LEAST ONE in a given year — what the map is "
          + "coloured by, and what the classes are cut on" },
      { expr: "N(p) = |{ s ∈ storms : min over fixes f of s of d(p, f) ≤ R }|",
        note: "each storm counted ONCE however many of its fixes fall inside" },
      { expr: "cell value = mean of λ over the lattice points inside it",
        note: "and a cell is only coarsened where that mean is representative "
          + "— see the note below" },
    ],
    terms: [
      ["R", "200 km, the distance over which a cyclone's wind field is felt at "
        + "strength. THE NUMBER IS THE DEFINITION: at 100 km the map is about "
        + "half as red, and neither radius is more correct than the other."],
      ["Y", "46 — the COMPLETE seasons 1980–2025. The season in progress is "
        + "excluded: 46 seasons of storms divided by 47 years would understate "
        + "every cell on the map."],
      ["1980", "where the record becomes globally consistent. Before the "
        + "satellites a storm was recorded where ships and coasts were, so the "
        + "archive's own storm count rises through the twentieth century for "
        + "reasons that are mostly observational."],
      ["d", "great-circle distance, solved on the sphere. In the flat "
        + "approximation a point computed at 199 km is 216 km of real ground, "
        + "so the layer would claim a radius it does not have."],
      ["exp(−λ)", "the Poisson chance of NO arrival in a year at rate λ. It "
        + "assumes storms arrive independently, which is the standard "
        + "assumption and is not exactly true — seasons cluster."],
    ],
    note: "WHY THE CELLS ARE DIFFERENT SIZES. The grid is a sampling lattice "
      + "at a quarter of a degree; blocks of it are merged while the field "
      + "inside them is flat, so a cell's size is display resolution and "
      + "nothing more — 28 km over Florida and the Philippines, 444 km over "
      + "the open ocean. A block that is EMPTY IN PART is never merged, "
      + "whatever its spread: one lattice point can report no less than one "
      + "storm in 46 seasons, so a coarse cell reporting less than that would "
      + "be one point's rate divided by the thousand beside it that no storm "
      + "has ever reached. Cells no storm has ever crossed are not drawn at "
      + "all. AND A SINGLE SEASON IS NOT A PROBABILITY: while the track "
      + "animation is followed the map shows that season's storm COUNTS, and "
      + "the key changes with it.",
    citation: "IBTrACS v04r01, NOAA NCEI. Knapp, K. R., M. C. Kruk, D. H. "
      + "Levinson, H. J. Diamond and C. J. Neumann (2010), The International "
      + "Best Track Archive for Climate Stewardship (IBTrACS), Bull. Amer. "
      + "Meteor. Soc., 91, 363–376.",
  },

  "volcanic-risk": {
    kind: COMPUTED,
    intro: "How often an eruption of EACH VEI drops at least a millimetre of "
      + "ash on a point, per year, counted from the Smithsonian eruption "
      + "catalogue — one map per VEI number, coloured on one return-period "
      + "scale, each eruption's reach the eruption's own size. Each size is counted over "
      + "the years eruptions of that size are actually recorded, which is what "
      + "lets a dormant volcano's one VEI 5 in 1707 count beside a live one's "
      + "fifty small eruptions since 1950.",
    lines: [
      { expr: "λ_n(p) = Σ over eruptions e of VEI n of w(e) · P_e(d(p, vent(e))) / Y(n)",
        note: "the VEI-n map: eruptions of that size per year depositing at "
          + "least 1 mm of ash at the point p — each weighted by the chance its "
          + "ash reaches that far" },
      { expr: "λ_any(p) = Σ_n λ_n(p)",
        note: "the collective" },
      { expr: "P = 1 − exp(−λ)",
        note: "the chance of at least one in a given year — what the classes are cut on" },
      { expr: "VEI_max(p) = max VEI over the same eruptions",
        note: "the largest on record reaching p" },
    ],
    terms: [
      ["Y(n)", "the complete years over which eruptions of that size are "
        + "recorded, measured on the catalogue: VEI ≤ 3 since 1950 (76), VEI 4 "
        + "since 1900 (126), VEI 5–6 since 1550 (476), VEI ≥ 7 the whole "
        + "Holocene (11,700). Confirmed VEI ≤ 3 eruptions per fifty years run "
        + "76, 178, 983, 1,318, 1,821 from the 1500s to the 1950s and flatten "
        + "only after 1950; VEI 5 runs three to five per half-century since "
        + "1550."],
      ["P(d)", "the chance that THIS eruption deposits at least 1 mm of ash "
        + "at distance d: tephra thins exponentially with distance (Pyle 1989, "
        + "T = T₀·exp(−d/b)) with both T₀ and b scaling with the eruption, and "
        + "solved for 1 mm that gives a reach R per VEI — 5 km at VEI 1, 15 at "
        + "2, 50 at 3, 150 at 4, 350 at 5, 800 at 6, 1,800 at 7 (Eyjafjallajökull "
        + "2010 at VEI 4 dropped 1 mm to 100–200 km; Pinatubo 1991 at VEI 6 to "
        + "500–900 km; Tambora 1815 at VEI 7 past 1,300 km). T₀ and b each vary "
        + "by about two between eruptions of one VEI, so the reach is "
        + "log-normal about R with σ = 0.5: P(d) = 1 − Φ(ln(d/R)/σ), stamped "
        + "out to R·e^{1.25} where P is 0.6%. ISOTROPIC: a real plume goes "
        + "downwind, and the honest next step is an ERA5 wind climatology per "
        + "volcano, not a guess at it. This is the reduction the global tephra "
        + "hazard studies make without a wind field (Jenkins et al. 2015)."],
      ["w(e)", "1 for a confirmed eruption, ½ for one GVP files as uncertain "
        + "(1,173 of 11,089). Unknown VEI (2,671) is counted as VEI 2."],
      ["floor prior", "every volcano in the catalogue is in the map. The "
        + "eruption list names 915 of 2,666; the rest take the least a volcano "
        + "that demonstrably erupted can be given — a Holocene volcano with no "
        + "dated eruption, one VEI 2 over the Holocene (11,725 y); a "
        + "Pleistocene one, one VEI 3 over the Pleistocene (2.58 My) — drawn "
        + "fainter, and named on the card where nothing else reaches."],
      ["d", "great-circle distance, solved on the sphere, at every cell of a "
        + "0.25° lattice."],
      ["1 mm", "the threshold: about where ash starts to close airports, foul "
        + "water and load roofs when wet. A different threshold is a different "
        + "reach — 10 mm is roughly a third of the distance."],
      ["the whole globe", "a VEI ≥ 5 eruption is stamped over every cell on "
        + "Earth, so the map ends with an answer everywhere: a VEI 7's chance "
        + "of a millimetre at the antipode is 8×10⁻⁷, which with the rate is one "
        + "in hundreds of millions of years — the bottom class, not a hole. "
        + "Smaller eruptions are stamped to R·e^{1} (2%), because a VEI 3's "
        + "chance at 500 km is 2×10⁻⁶ and thousands of them stamped further buy "
        + "nothing. The largest on record and the vent count key on a chance of "
        + "at least 1%, or a global tail makes every cell 'VEI 8'."],
      ["VEI 8", "no Holocene eruption reached it, so the VEI 8 map is a QUATERNARY "
        + "BACKGROUND: the global return period of a magnitude-8 eruption is "
        + "about 17,000 years (Rougier et al. 2018, 95% range 5,200–48,000), and "
        + "that rate is spread evenly over the known Quaternary supereruption "
        + "vents — Toba, Yellowstone, Taupo, Long Valley, Aso, Atitlán, Cerro "
        + "Galán, Whakamaru (LaMEVE; Mason et al. 2004) — with the VEI 8 reach "
        + "(3,000 km). Labelled as a background wherever it appears; it is not a "
        + "count from the catalogue."],
      ["exp(−λ)", "the Poisson chance of NO arrival in a year at rate λ. "
        + "Eruptions cluster and repose times are not memoryless, so this is "
        + "the standard assumption rather than an exact one."],
    ],
    note: "ONE GRID PER VEI, played through the bar. Each is the cyclone "
      + "map's own quadtree over that band alone: a quarter-degree lattice "
      + "merged into blocks while the band inside them is flat (2% of its "
      + "peak), never while empty in part, never across two largest-VEI "
      + "classes — so a VEI 7 map, flat over almost all its extent, is a few "
      + "thousand cells. VEI 8 is the Quaternary background, not a Holocene "
      + "count. A cell nothing reaches is DRAWN, in the "
      + "'no eruption's ash on record' class that leads every key — an answer, "
      + "not a gap; the app's grey means not measured, and this was. The collective "
      + "carries every band's rate on each cell, so a click on it lists every "
      + "size at the point.",
    citation: "Global Volcanism Program (2024). Volcanoes of the World, "
      + "v. 5.2. Smithsonian Institution. https://doi.org/10.5479/si.GVP.VOTW5-2024.5.2. "
      + "VEI: Newhall & Self (1982), J. Geophys. Res., 87, 1231–1238. Thinning: "
      + "Pyle (1989), Bull. Volcanol., 51, 1–15. Global tephra hazard: Jenkins "
      + "et al. (2015), GAR15 background paper, UNISDR. VEI 8 rate: Rougier, "
      + "Sparks, Cashman & Brown (2018), Earth Planet. Sci. Lett., 482, 621–629; "
      + "vents: Mason, Pyle & Oppenheimer (2004), Bull. Volcanol., 66, 735–748.",
  },

  "volcanic-risk-holocene": {
    kind: COMPUTED,
    intro: "The same maps from THE FULL RECORD: every dated eruption back to "
      + "9700 BCE, active or not. For each volcano and size class the modern "
      + "window is used where it holds eruptions of that size at that volcano; "
      + "where it holds none, every dated eruption of that size over the "
      + "volcano's own record span. The full record can therefore only ADD a "
      + "dormant volcano's ancient eruptions, never dilute an active one's "
      + "modern rate.",
    lines: [
      { expr: "span(v, n) = Y(n) if the volcano has a VEI-n eruption inside Y(n)'s window, else 2025 − first_v + 1",
        note: "the denominator per volcano and size: the completeness window "
          + "where the record supports it, the volcano's own record where it "
          + "is all there is" },
      { expr: "λ_n(p) = Σ over eruptions e of VEI n of w(e) · P_e(d(p, vent(e))) / span(v(e))",
        note: "the VEI-n map: eruptions of that size per year depositing at "
          + "least 1 mm of ash at the point p" },
      { expr: "P = 1 − exp(−λ)",
        note: "the chance of at least one in a given year" },
    ],
    terms: [
      ["span(v, n)", "the first version divided EVERY volcano's eruptions by its "
        + "own record span, and read 1 in 1,733 years for VEI 3 at Etna — a "
        + "volcano that does it every twenty, whose tephra record reaches back "
        + "8,000 years. A denominator is the record that supports it: where the "
        + "modern window holds eruptions of that size at that volcano it is "
        + "complete for them and is used; only a volcano with none in the "
        + "window falls back to its own span."],
      ["P(d)", "the chance that THIS eruption deposits at least 1 mm of ash "
        + "at distance d: tephra thins exponentially with distance (Pyle 1989, "
        + "T = T₀·exp(−d/b)) with both T₀ and b scaling with the eruption, and "
        + "solved for 1 mm that gives a reach R per VEI — 5 km at VEI 1, 15 at "
        + "2, 50 at 3, 150 at 4, 350 at 5, 800 at 6, 1,800 at 7 (Eyjafjallajökull "
        + "2010 at VEI 4 dropped 1 mm to 100–200 km; Pinatubo 1991 at VEI 6 to "
        + "500–900 km; Tambora 1815 at VEI 7 past 1,300 km). T₀ and b each vary "
        + "by about two between eruptions of one VEI, so the reach is "
        + "log-normal about R with σ = 0.5: P(d) = 1 − Φ(ln(d/R)/σ), stamped "
        + "out to R·e^{1.25} where P is 0.6%. ISOTROPIC: a real plume goes "
        + "downwind, and the honest next step is an ERA5 wind climatology per "
        + "volcano, not a guess at it. This is the reduction the global tephra "
        + "hazard studies make without a wind field (Jenkins et al. 2015)."],
      ["w(e)", "1 for a confirmed eruption, ½ for one GVP files as uncertain "
        + "(1,173 of 11,089). Unknown VEI (2,671) is counted as VEI 2."],
      ["floor prior", "every volcano in the catalogue is in the map. The "
        + "eruption list names 915 of 2,666; the rest take the least a volcano "
        + "that demonstrably erupted can be given — a Holocene volcano with no "
        + "dated eruption, one VEI 2 over the Holocene (11,725 y); a "
        + "Pleistocene one, one VEI 3 over the Pleistocene (2.58 My) — drawn "
        + "fainter, and named on the card where nothing else reaches."],
      ["d", "great-circle distance, solved on the sphere, at every cell of a "
        + "0.25° lattice."],
    ],
    note: "The same lattice, kernel, priors and one-grid-per-VEI as the "
      + "windowed record; only the denominator differs. A cell nothing reaches "
      + "is drawn in the 'no eruption's ash on record' class.",
    citation: "Global Volcanism Program (2024). Volcanoes of the World, "
      + "v. 5.2. Smithsonian Institution. https://doi.org/10.5479/si.GVP.VOTW5-2024.5.2.",
  },

  "seismic-risk": {
    kind: COMPUTED,
    intro: "How often an earthquake of EACH magnitude unit shakes a point at "
      + "about MMI VI, per year, counted from a record merged out of three "
      + "catalogues — the volcanic map's method with magnitude in place of "
      + "VEI: one map per magnitude, one return-period scale, each event's "
      + "reach the event's own size.",
    lines: [
      { expr: "λ_m(p) = Σ over events e with magnitude in [m, m+1) of P_e(d(p, e)) / Y(m)",
        note: "the magnitude-m map: earthquakes of that size per year shaking "
          + "the point at about MMI VI, each weighted by the chance its damaging "
          + "radius reaches that far" },
      { expr: "λ_any(p) = Σ_m λ_m(p)", note: "the collective" },
      { expr: "P = 1 − exp(−λ)", note: "the chance of at least one in a given year" },
    ],
    terms: [
      ["R(M)", "the radius of damaging shaking, log₁₀(R km) = 0.5 M − 1.7 in the "
        + "global average — about 20 km at M5, 63 at M6, 200 at M7, 630 at M8. "
        + "Attenuation differs by a factor of two or three between regions "
        + "(stable crust carries motion further than a subduction margin) and "
        + "with depth, so the reach is log-normal about R with σ = 0.4: "
        + "P(d) = 1 − Φ(ln(d/R)/σ), stamped to R·e^{1.0}."],
      ["Y(M)", "the years each size is recorded globally, measured on the "
        + "catalogue: M5 since 1964 (the WWSSN), M6 since 1930, M7 and M8 since "
        + "1900."],
      ["events", "THREE CATALOGUES, because no single one is both complete and "
        + "current. USGS ComCat gives density and currency (every M ≥ 4.5 since "
        + "1900, public domain) and its magnitudes are mixed — about 82% of "
        + "modern events at that threshold are body-wave mb, which saturates "
        + "near 6 and reads low. ISC-GEM v12 gives the homogenised backbone "
        + "(1904–2021, every event Mw, recomputed from the original station "
        + "bulletins), joined on ComCat's own contributing ids so there is no "
        + "fuzzy space-time matching and no double count. GEM's historical "
        + "catalogue (1008–1903, about M ≥ 7) gives the deep record; its last "
        + "event is 1903-12-28 and ISC-GEM's first 1904-01-20, so the seam "
        + "needs no dedup. The rates are computed on ISC-GEM's Mw wherever it "
        + "reaches. Depth is carried on the point and not used in the reach."],
      ["the historical record is NOT in the rates", "GEM's 825 events play in "
        + "the timeline and are held out of the arithmetic above. A rate needs "
        + "a COMPLETE window, and a catalogue of the large events somebody "
        + "knows about across nine centuries is not one: counted, it would "
        + "divide a handful of events by 900 years and understate every rate "
        + "it touched."],
      ["licence", "ComCat is US Government public domain. ISC-GEM and GEM GHEC "
        + "are CC BY-SA 3.0, which is share-alike — so these grids, being "
        + "derived from them, are offered under CC BY-SA 3.0 with the "
        + "citations below."],
      ["what this is not", "a probabilistic seismic hazard assessment. GEM's "
        + "global model and any PSHA use site-specific ground-motion models, "
        + "fault sources with slip rates, and site conditions; this is the "
        + "catalogue's own answer at a point, isotropic and depth-blind, and "
        + "says so."],
    ],
    note: "One grid per magnitude unit, played through the bar; the same "
      + "quarter-degree quadtree as the volcanic maps, a cell nothing reaches "
      + "listed in the key and drawn nowhere.",
    citation: "U.S. Geological Survey (2017), ANSS Comprehensive Earthquake "
      + "Catalog (ComCat), https://doi.org/10.5066/F7MS3QZH · International "
      + "Seismological Centre (2025), ISC-GEM Earthquake Catalogue, "
      + "https://doi.org/10.31905/d808b825 (Storchak et al. 2013, 2015; Di "
      + "Giacomo et al. 2018) · GEM Foundation (2013), GEM Global Historical "
      + "Earthquake Catalogue v1.0, https://doi.org/10.13127/ghea/ghec.1.0. "
      + "Attenuation: a global-average MMI VI radius after Atkinson & Wald "
      + "(2007), Bull. Seismol. Soc. Am., 97, 497–510.",
  },

  "worldpop": {
    kind: PUBLISHED,
    intro: "WorldPop's 2020 global population surface at 1 km, the top-down "
      + "constrained method: each country's census total for 2020 is "
      + "disaggregated onto a 30-arcsecond grid by a Random Forest weighting "
      + "trained on settlement extent, land cover, night lights and roads, so "
      + "that the grid sums to the census. The number here is theirs; what "
      + "is ours is the reading and the classes.",
    lines: [
      { expr: "people(cell) = total_country × w(cell) / Σ w",
        note: "the disaggregation — a cell's share of the census by its "
          + "modelled weight" },
      { expr: "density = people(cell) / area(cell)",
        note: "people per km², the value drawn; the cell's ground is 30″ × 30″ "
          + "at its own latitude" },
    ],
    terms: [
      ["w", "the Random Forest weight from covariates — built settlement "
        + "(GHSL, Microsoft/Google building footprints where used), land cover, "
        + "VIIRS night lights, roads, elevation, slope, water — trained on "
        + "the finest census units available."],
      ["classes", "decades of people per km² (1, 10, 100, 1,000, 10,000): a "
        + "linear ramp of a quantity spanning five orders of magnitude is a "
        + "black map with three bright pixels."],
      ["what it is not", "a count. It is right at the country level by "
        + "construction and puts people where the covariates say within it; a "
        + "single cell's figure is a model estimate."],
    ],
    note: "Read whole from a Cloud-Optimised GeoTIFF: the window this view "
      + "needs at the overview it deserves, and a click at full resolution.",
    citation: "WorldPop (www.worldpop.org — School of Geography and "
      + "Environmental Science, University of Southampton). Global 1 km "
      + "population 2020, top-down constrained. doi:10.5258/SOTON/WP00647. "
      + "Method: Stevens et al. (2015), PLoS ONE 10(2): e0107042.",
  },

  "dem-elevation": {
    kind: COMPUTED,
    intro: "The tiles are PNGs, and the height is packed into the colour. "
      + "Nothing is modelled: this is the decode, and the sheet is the numbers "
      + "it returns.",
    lines: [
      { expr: "h = (R·256 + G + B/256) − 32768",
        note: "metres above the EGM96 geoid, from the Terrarium encoding" },
    ],
    terms: [
      ["R, G, B", "the tile pixel's three channels, 0–255"],
      ["32768", "the offset that lets the encoding carry ocean depths"],
    ],
    note: "A single-pixel spike whose neighbours disagree with it by more than "
      + "300 m in the same direction on both sides is replaced by their mean — "
      + "tile-edge artefacts, not terrain.",
  },

  "dem-slope": {
    kind: COMPUTED,
    intro: "Steepness of the streamed heights, by Horn's 3×3 estimator.",
    lines: [
      ...HORN.lines,
      { expr: "slope = arctan( √( (∂z/∂x)² + (∂z/∂y)² ) )",
        note: "in degrees; as a percentage it is 100·√(…) instead" },
      ...CELL.lines,
    ],
    terms: [
      HORN.terms[0],
      ["∂z/∂x, ∂z/∂y", "the surface's gradient in each direction, in metres "
        + "per metre — so their root sum of squares is the rise of the "
        + "steepest line through the cell"],
      ...CELL.terms,
    ],
    note: `${HORN.note} ${CELL.note}`,
  },

  "dem-hillshade": {
    kind: COMPUTED,
    intro: "Lambertian shading of the same gradient — a picture of the surface, "
      + "not a quantity. Nothing downstream should read values off it.",
    lines: [
      { expr: "zenith = (90° − altitude)" },
      { expr: "azimuth* = (360° − azimuth + 90°)",
        note: "compass bearing to the mathematical convention the shading uses" },
      { expr: "slope = arctan( √( (∂z/∂x)² + (∂z/∂y)² ) )" },
      { expr: "aspect = atan2( ∂z/∂y, −∂z/∂x )", note: "wrapped into 0…2π" },
      { expr: "shade = 255 · [ cos(zenith)·cos(slope) "
        + "+ sin(zenith)·sin(slope)·cos(azimuth* − aspect) ]",
        note: "clamped to 0…255" },
    ],
    terms: [
      ["altitude", "the sun's height above the horizon, from the panel's control (default 45°)"],
      ["azimuth", "the compass bearing it shines from (default 315°, the north-west)"],
      ["∂z/∂x, ∂z/∂y", "Horn's gradient, as for slope"],
    ],
    note: "The lighting is a convention, not a time of day: relief lit from the "
      + "north-west reads as relief, and lit from the south-east reads inside out.",
  },

  "soil-thickness": {
    kind: PUBLISHED,
    intro: "The thickness itself is Pelletier et al.'s model, not ours — a "
      + "mosaic of their upland-hillslope and lowland-valley grids, weighted by "
      + "area and by topographic wetness index, calibrated against measured "
      + "soil thickness in the US and Europe and against depth-to-bedrock from "
      + "US groundwater wells. Read the paper for its equations; ours is only "
      + "what the bake did to the numbers it publishes.",
    lines: [
      { expr: "band = round( thickness in metres )",
        note: "8-bit, so the sheet is metre-resolution by construction" },
      { expr: "−1  →  255 (no data)",
        note: "sea, and everything the model excludes, kept apart from a real 0" },
    ],
    terms: [
      ["0 m", "a modelled reading: bedrock at the surface, not an absence"],
      ["255", "no reading: the model does not apply here"],
    ],
    note: "Clipped at 60°S. Values are a model's, for a whole 1 km cell.",
  },

  /**
   * Not on a catalogue row -- GeoID mode builds it -- but the registry is the
   * place the app's maths lives, and a panel that wants to show its working
   * should read it from here rather than write it out a second time.
   */
  "geoid-fos": {
    kind: COMPUTED,
    intro: "The infinite-slope model: the standard screening equation for "
      + "shallow translational failures, which assumes the failure plane is "
      + "parallel to the ground and long compared with its depth. True of the "
      + "soil-slip case; false for deep rotational failures.",
    lines: [
      { expr: "FoS = [ c′ + (γ − m·γw)·z·cos²β·tanφ′ ] / [ γ·z·sinβ·cosβ ]" },
    ],
    terms: [
      ["c′", "effective cohesion (kPa)"],
      ["φ′", "effective friction angle (°)"],
      ["γ", "unit weight of the soil (kN/m³)"],
      ["γw", "unit weight of water, 9.81 kN/m³"],
      ["z", "depth to the failure plane (m) — the modelled soil thickness at "
        + "this cell, capped at 3 m, because an infinite-slope model describes "
        + "a shallow plane and not the base of a sediment basin; the "
        + "lithology's own default stands where the model has no reading"],
      ["β", "slope angle, from the slope reading above"],
      ["m", "the wet fraction of that depth, 0–1 — the only term the weather moves"],
      ["FoS", "reported to four decimal places, which is far finer than the "
        + "parameters justify — it is a screening number, not a design one"],
    ],
    note: "Every term is a property of the place except m, which is a property "
      + "of a place AND a moment: c′, φ′ and γ from the mapped lithology, β "
      + "from the DEM, z from the thickness model, and m from the weather. "
      + "FoS > 1 is stable and < 1 is failure, with the interesting band "
      + "1.0–1.3. Ground below 5° returns no answer rather than infinity — "
      + "sinβ → 0 makes the driving stress vanish, which is arithmetic rather "
      + "than insight — and m is capped at 1: rain past saturation does not "
      + "keep raising pore pressure in this model. The strength parameters are "
      + "standard engineering-geology ranges by lithology, not site "
      + "investigation values.",
  },
};

/**
 * The maths for a dataset id, or null where there is none to state.
 *
 * Null is the honest answer for an observed dataset — a soil map is a survey,
 * and giving it a "How it is calculated" fold with nothing in it would suggest
 * every layer is a model.
 */
export function mathsFor(id) {
  return EQUATIONS[id] || null;
}

/** Every id that has working to show — for the test, and for anything listing. */
export function modelledIds() {
  return Object.keys(EQUATIONS);
}

export { COMPUTED, PUBLISHED };
