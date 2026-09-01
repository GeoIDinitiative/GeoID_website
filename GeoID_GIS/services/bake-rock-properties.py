#!/usr/bin/env python3
"""
A GEOTECHNICAL PROPERTY DATABASE FOR EVERY LITHOLOGY THE WORLD MAP USES.

The world geology layer paints Macrostrat's Burwell compilation, and every
polygon in it carries a free-text `lith` string -- "mafic lava and mafic tuff",
"sandstone and conglomerate, interbedded". Those strings are not free-form
prose: they are built from Macrostrat's own published lithology dictionary,
which is 214 named lithologies each carrying a class, a type and a group.

That is what makes this database's coverage STRUCTURAL RATHER THAN SAMPLED.
Cover the 214 and you cover everything the vocabulary can express, at every
zoom, in every survey the compilation composites -- rather than covering
whatever happened to be under the places somebody looked.

WHAT THIS IS FOR. A hydrogeological model and a landslide model. So the
parameters are the ones those need: porosity and hydraulic conductivity for
flow, and density, UCS, modulus, Poisson's ratio, friction, cohesion and the
residual strength after failure for stability.

=============================================================================
READ THIS BEFORE USING A NUMBER FROM THIS FILE IN A DESIGN
=============================================================================

**These are published RANGES for a rock NAME, not measurements of your site.**
A rock name is not a material specification: "sandstone" spans a friable
Cenozoic sand and a quartzitic Palaeozoic orthoquartzite, and the UCS range
below spans that. Every entry is a literature range and every one of them is
wide on purpose. For anything load-bearing, they are a PRIOR to be replaced by
site investigation, not a substitute for it.

**INTACT ROCK IS NOT ROCK MASS.** This is the single most consequential
distinction in the file and the commonest way a number here would be misused.
The UCS, modulus and friction values are for INTACT specimens -- a core in a
press. A slope fails through the rock MASS: joints, bedding, faults and
weathering, whose strength is one to two orders of magnitude lower. Getting
from one to the other is what GSI and the Hoek-Brown criterion are for, and it
needs a field observation this database cannot make for you. Each lithology
therefore carries `hoek_brown_mi` and a typical GSI range so the conversion can
be made explicitly rather than skipped silently.

**MATRIX PERMEABILITY IS NOT AQUIFER PERMEABILITY.** For the same reason: a
granite's intact hydraulic conductivity is around 1e-12 m/s and a fractured
granite aquifer's is around 1e-5 m/s. Seven orders of magnitude, and the
difference is fractures. Both are carried; `hydraulic_conductivity` is the
mass value a hydrogeologist means, `matrix_hydraulic_conductivity` is the core
plug.

**EVERY VALUE CARRIES ITS BASIS**, and the basis is the honest part:

  table       transcribed from a specific published table, read directly while
              building this file. The strongest class, and the citation names
              the table.
  compilation a range that is standard across the engineering-geology
              literature, attributed to the compilations that carry it. To be
              checked against the cited work before it is designed against.
  derived     computed from other fields by a stated relation (Young's modulus
              from UCS x modulus ratio; intrinsic permeability from hydraulic
              conductivity).
  inherited   this lithology has no distinct geotechnical literature of its
              own and takes a parent's values. The parent and the reason are
              both recorded, so the inheritance can be argued with.

Run:  python3 GeoID_GIS/services/bake-rock-properties.py
Out:  GeoID_GIS/data/global/rock-properties.json
"""

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "GeoID_GIS", "data", "global", "rock-properties.json")
DICT_URL = "https://macrostrat.org/api/v2/defs/lithologies?all"
DICT_CACHE = os.path.join(HERE, ".macrostrat-lithologies.json")

# ---------------------------------------------------------------------------
# The bibliography. Every source here was chosen because it is a standard
# reference an engineering geologist would already own, not because it was
# reachable -- a database whose citations nobody can check is a database of
# assertions.
# ---------------------------------------------------------------------------
BIBLIOGRAPHY = {
    "hoek-practical": {
        "citation": "Hoek, E. Practical Rock Engineering, Chapter 11: Rock mass "
                    "properties. Rocscience (2007 edition).",
        "url": "https://www.rocscience.com/assets/resources/learning/hoek/"
               "Practical-Rock-Engineering-Chapter-11-Rock-Mass-Properties.pdf",
        "holds": "Hoek-Brown mi by rock group (Table 3); field estimates of "
                 "uniaxial compressive strength, grades R0-R6 (Table 2); "
                 "modulus ratio MR (Table 8).",
    },
    "hoek-brown-1997": {
        "citation": "Hoek, E. & Brown, E.T. (1997). Practical estimates of rock "
                    "mass strength. International Journal of Rock Mechanics and "
                    "Mining Sciences, 34(8), 1165-1186.",
        "url": "https://doi.org/10.1016/S1365-1609(97)80069-X",
        "holds": "The mi table and the GSI-based rock mass strength estimate.",
    },
    "hoek-brown-2019": {
        "citation": "Hoek, E. & Brown, E.T. (2019). The Hoek-Brown failure "
                    "criterion and GSI - 2018 edition. Journal of Rock Mechanics "
                    "and Geotechnical Engineering, 11(3), 445-463.",
        "url": "https://doi.org/10.1016/j.jrmge.2018.08.001",
        "holds": "Current statement of the criterion, GSI and the disturbance "
                 "factor D.",
    },
    "deere-1968": {
        "citation": "Deere, D.U. (1968). Geological considerations. In: Stagg, "
                    "K.G. & Zienkiewicz, O.C. (eds), Rock Mechanics in "
                    "Engineering Practice. Wiley, London, 1-20.",
        "holds": "Modulus ratio E/UCS by rock type, as tabulated by Hoek "
                 "Practical Rock Engineering Table 8.",
    },
    "palmstrom-singh-2001": {
        "citation": "Palmstrom, A. & Singh, R. (2001). The deformation modulus "
                    "of rock masses: comparisons between in situ tests and "
                    "indirect estimates. Tunnelling and Underground Space "
                    "Technology, 16(2), 115-131.",
        "url": "https://doi.org/10.1016/S0886-7798(01)00038-4",
        "holds": "Modulus ratio values, with Deere (1968), behind Table 8.",
    },
    "freeze-cherry-1979": {
        "citation": "Freeze, R.A. & Cherry, J.A. (1979). Groundwater. "
                    "Prentice-Hall, Englewood Cliffs, NJ. 604 pp.",
        "url": "https://fc79.gw-project.org/english/",
        "holds": "Table 2.2, hydraulic conductivity and intrinsic permeability "
                 "of unconsolidated deposits, sedimentary rocks and crystalline "
                 "rocks; Table 2.4, porosity. Now free to download from the "
                 "Groundwater Project.",
    },
    "domenico-schwartz-1990": {
        "citation": "Domenico, P.A. & Schwartz, F.W. (1990). Physical and "
                    "Chemical Hydrogeology. Wiley, New York. Table 3.2.",
        "holds": "The widest published compilation of hydraulic conductivity by "
                 "material, and porosity ranges alongside it.",
    },
    "heath-1983": {
        "citation": "Heath, R.C. (1983). Basic Ground-Water Hydrology. U.S. "
                    "Geological Survey Water-Supply Paper 2220. 86 pp.",
        "url": "https://pubs.usgs.gov/wsp/2220/report.pdf",
        "holds": "Selected values of porosity, and porosity / specific yield / "
                 "specific retention by material.",
    },
    "goodman-1989": {
        "citation": "Goodman, R.E. (1989). Introduction to Rock Mechanics, 2nd "
                    "edition. Wiley, New York. 562 pp.",
        "holds": "Tables of unconfined compressive strength, modulus, Poisson's "
                 "ratio, porosity and density for named rocks, with the "
                 "specimen provenance given for each.",
    },
    "barton-choubey-1977": {
        "citation": "Barton, N. & Choubey, V. (1977). The shear strength of rock "
                    "joints in theory and practice. Rock Mechanics, 10, 1-54.",
        "url": "https://doi.org/10.1007/BF01261801",
        "holds": "JRC, JCS and the basic/residual friction angle of rock joints "
                 "-- the strength that governs a rock slope.",
    },
    "wyllie-mah-2004": {
        "citation": "Wyllie, D.C. & Mah, C.W. (2004). Rock Slope Engineering: "
                    "Civil and Mining, 4th edition (based on Hoek & Bray). Spon "
                    "Press, London. 431 pp.",
        "holds": "Friction angles of rock-forming materials and of "
                 "discontinuities; rock slope stability practice.",
    },
    "bell-2007": {
        "citation": "Bell, F.G. (2007). Engineering Geology, 2nd edition. "
                    "Butterworth-Heinemann, Oxford. 581 pp.",
        "holds": "Engineering properties of the major rock and soil types, "
                 "including weathering grades and durability.",
    },
    "schon-2015": {
        "citation": "Schon, J.H. (2015). Physical Properties of Rocks: "
                    "Fundamentals and Principles of Petrophysics, 2nd edition. "
                    "Elsevier. 512 pp.",
        "holds": "Density, porosity, elastic properties and permeability across "
                 "rock types, with the measurement populations behind them.",
    },
    "zhang-2016": {
        "citation": "Zhang, L. (2016). Engineering Properties of Rocks, 2nd "
                    "edition. Butterworth-Heinemann. 378 pp.",
        "holds": "Compiled intact and rock-mass property ranges, and the "
                 "empirical relations between them.",
    },
    "lama-vutukuri-1978": {
        "citation": "Lama, R.D. & Vutukuri, V.S. (1978). Handbook on Mechanical "
                    "Properties of Rocks, Vols II-IV. Trans Tech Publications.",
        "holds": "The largest single compilation of measured mechanical "
                 "properties of named rocks.",
    },
    "terzaghi-peck-mesri-1996": {
        "citation": "Terzaghi, K., Peck, R.B. & Mesri, G. (1996). Soil Mechanics "
                    "in Engineering Practice, 3rd edition. Wiley, New York.",
        "holds": "Strength and permeability of soils -- which is what the "
                 "unconsolidated lithologies here are.",
    },
    "bgs-ngpd": {
        "citation": "British Geological Survey. National Geotechnical "
                    "Properties Database (NGPD). 7,370 projects, 178,436 holes, "
                    "5,180,330 laboratory test records from UK commercial site "
                    "investigations.",
        "url": "https://www.bgs.ac.uk/geological-research/science-facilities/"
               "engineering-geotechnical-capability/"
               "national-geotechnical-properties-database/",
        "holds": "Measured UK site-investigation data behind the BGS "
                 "engineering-geology formation reports below. The database "
                 "itself is accessed by arrangement with BGS; the formation "
                 "reports drawn from it are free to download and are what is "
                 "cited here.",
    },
    "hobbs-mercia-2002": {
        "citation": "Hobbs, P.R.N., Hallam, J.R., Forster, A., Entwisle, D.C., "
                    "Jones, L.D., Cripps, A.C., Northmore, K.J., Self, S.J. & "
                    "Meakin, J.L. (2002). Engineering geology of British rocks "
                    "and soils: Mudstones of the Mercia Mudstone Group. British "
                    "Geological Survey Research Report RR/01/02. 106 pp.",
        "url": "https://nora.nerc.ac.uk/id/eprint/3664/1/RR01002.pdf",
        "holds": "Measured index, strength, deformability and permeability data "
                 "for the Mercia Mudstone Group BY WEATHERING ZONE, from the "
                 "National Geotechnical Properties Database and the UK "
                 "literature. The clearest published demonstration that a "
                 "mudrock's engineering properties are a function of weathering "
                 "grade rather than of its name.",
    },
    "chandler-1969": {
        "citation": "Chandler, R.J. (1969). The effect of weathering on the "
                    "shear strength properties of Keuper Marl. Geotechnique, "
                    "19(3), 321-334.",
        "url": "https://doi.org/10.1680/geot.1969.19.3.321",
        "holds": "Effective shear strength of Mercia Mudstone (Keuper Marl) by "
                 "weathering zone -- the origin of the zone scheme.",
    },
    "cripps-taylor-1981": {
        "citation": "Cripps, J.C. & Taylor, R.K. (1981). The engineering "
                    "properties of mudrocks. Quarterly Journal of Engineering "
                    "Geology, 14(4), 325-346.",
        "url": "https://doi.org/10.1144/GSL.QJEG.1981.014.04.10",
        "holds": "Plasticity against residual strength for UK mudrocks, and the "
                 "residual friction angle range this database carries for "
                 "mudstone.",
    },
    "tellam-lloyd-1981": {
        "citation": "Tellam, J.H. & Lloyd, J.W. (1981). Hydrogeology of British "
                    "onshore non-carbonate mudrocks. Quarterly Journal of "
                    "Engineering Geology, 14(4), 347-355.",
        "url": "https://doi.org/10.1144/GSL.QJEG.1981.014.04.11",
        "holds": "Intact and field permeability of British mudrocks, and the "
                 "anisotropy between them.",
    },
    "skempton-1964": {
        "citation": "Skempton, A.W. (1964). Long-term stability of clay slopes "
                    "(4th Rankine Lecture). Geotechnique, 14(2), 77-102.",
        "url": "https://doi.org/10.1680/geot.1964.14.2.77",
        "holds": "Residual shear strength of clays, and why a first-time slide "
                 "and a reactivated one are different problems.",
    },
    "stark-hussain-2013": {
        "citation": "Stark, T.D. & Hussain, M. (2013). Empirical correlations: "
                    "drained shear strength for slope stability analyses. "
                    "Journal of Geotechnical and Geoenvironmental Engineering, "
                    "139(6), 853-862.",
        "url": "https://doi.org/10.1061/(ASCE)GT.1943-5606.0000824",
        "holds": "Fully softened and residual drained friction angles against "
                 "liquid limit and clay fraction.",
    },
}

# ---------------------------------------------------------------------------
# The parameters, and what each one MEANS -- because half of these have a
# common name that hides the distinction that matters.
# ---------------------------------------------------------------------------
PARAMETERS = {
    "dry_density": {
        "label": "Dry bulk density", "unit": "kg/m3", "scale": "linear",
        "kind": "physical", "applies": ["rock", "soil"],
        "note": "Oven-dry bulk density of the material including its pore space.",
    },
    "porosity": {
        "label": "Porosity", "unit": "%", "scale": "linear",
        "kind": "hydraulic", "applies": ["rock", "soil"],
        "note": "Total porosity by volume. For a fractured rock this is the "
                "matrix porosity plus the fracture porosity, and the second is "
                "usually under 1% while carrying nearly all the flow.",
    },
    "hydraulic_conductivity": {
        "label": "Hydraulic conductivity (mass)", "unit": "m/s", "scale": "log",
        "kind": "hydraulic", "applies": ["rock", "soil"],
        "note": "The FORMATION value, fractures included -- what a pumping test "
                "measures and what a groundwater model wants. For crystalline "
                "rock this is dominated by fracturing and weathering, not by "
                "the rock itself.",
    },
    "matrix_hydraulic_conductivity": {
        "label": "Hydraulic conductivity (intact matrix)", "unit": "m/s",
        "scale": "log", "kind": "hydraulic", "applies": ["rock"],
        "note": "A core plug with no fractures in it. Commonly several orders "
                "of magnitude below the mass value; the gap IS the fracture "
                "network.",
    },
    "specific_yield": {
        "label": "Specific yield", "unit": "%", "scale": "linear",
        "kind": "hydraulic", "applies": ["rock", "soil"],
        "note": "The drainable fraction, which is what an unconfined aquifer "
                "actually gives up. Always below total porosity, and far below "
                "it for clay.",
    },
    "ucs": {
        "label": "Uniaxial compressive strength (intact)", "unit": "MPa",
        "scale": "log", "kind": "strength", "applies": ["rock"],
        "note": "INTACT specimen, unconfined, tested normal to any fabric. Not "
                "the strength of a jointed mass; see hoek_brown_mi and gsi.",
    },
    "tensile_strength": {
        "label": "Tensile strength (Brazilian)", "unit": "MPa", "scale": "log",
        "kind": "strength", "applies": ["rock"],
        "note": "Indirect tensile strength, typically 1/10 to 1/20 of UCS.",
    },
    "youngs_modulus": {
        "label": "Young's modulus (intact)", "unit": "GPa", "scale": "log",
        "kind": "deformation", "applies": ["rock"],
        "note": "Tangent modulus of an intact specimen at 50% of peak. The "
                "rock MASS modulus is lower, by the same fracturing that lowers "
                "its strength.",
    },
    "poissons_ratio": {
        "label": "Poisson's ratio", "unit": "-", "scale": "linear",
        "kind": "deformation", "applies": ["rock", "soil"],
        "note": "Drained, intact, in the elastic range.",
    },
    "friction_angle": {
        "label": "Friction angle (peak, intact)", "unit": "degrees",
        "scale": "linear", "kind": "strength", "applies": ["rock", "soil"],
        "note": "Effective peak friction angle of the material. For a rock "
                "slope, the joint angle below usually governs instead.",
    },
    "cohesion": {
        "label": "Cohesion (peak, intact)", "unit": "MPa", "scale": "log",
        "kind": "strength", "applies": ["rock", "soil"],
        "note": "Effective peak cohesion of the intact material. A jointed rock "
                "mass has a small fraction of this and a slip surface has none.",
    },
    "residual_friction_angle": {
        "label": "Residual friction angle", "unit": "degrees", "scale": "linear",
        "kind": "residual", "applies": ["rock", "soil"],
        "note": "AFTER FAILURE, on a surface that has already slipped: the "
                "basic friction angle of a smooth joint in rock, and the "
                "residual angle of a polished slip surface in soil. This is the "
                "strength that governs a reactivated landslide, and for clay it "
                "can be less than half the peak.",
    },
    "residual_cohesion": {
        "label": "Residual cohesion", "unit": "MPa", "scale": "log",
        "kind": "residual", "applies": ["rock", "soil"],
        "note": "Effectively zero on any surface that has slipped. Carried "
                "explicitly so a model cannot inherit peak cohesion by "
                "omission -- which is the commonest way a back-analysis comes "
                "out unconservative.",
    },
    "hoek_brown_mi": {
        "label": "Hoek-Brown constant mi", "unit": "-", "scale": "linear",
        "kind": "rockmass", "applies": ["rock"],
        "note": "The intact material constant in the Hoek-Brown criterion. With "
                "UCS and a GSI it gives a rock MASS strength, which is the "
                "number a slope model needs.",
    },
    "gsi_typical": {
        "label": "Geological Strength Index (typical field range)", "unit": "-",
        "scale": "linear", "kind": "rockmass", "applies": ["rock"],
        "note": "INDICATIVE ONLY. GSI is a field observation of blockiness and "
                "joint-surface condition, not a property of a rock name. The "
                "range here says what is commonly seen in this lithology; it "
                "cannot replace looking at the outcrop.",
    },
    "slake_durability": {
        "label": "Slake durability index Id2", "unit": "%", "scale": "linear",
        "kind": "durability", "applies": ["rock"],
        "note": "Resistance to weakening on wetting and drying. Below about 60% "
                "the material degrades in months, which is why mudrock cut "
                "slopes fail long after they were built.",
    },
}

# ---------------------------------------------------------------------------
# THE REFERENCE LITHOLOGIES.
#
# Values are [min, max] with an optional typical. `b` is the basis and `s` the
# source keys. A parameter absent from an entry is absent because the
# literature does not support a distinct value for it, not because it was
# forgotten -- the resolver reports it as unknown rather than filling it in.
# ---------------------------------------------------------------------------
def P(vmin, vmax, typical=None, basis="compilation", sources=(), note=None):
    entry = {"min": vmin, "max": vmax, "basis": basis, "sources": list(sources)}
    if typical is not None:
        entry["typical"] = typical
    if note:
        entry["note"] = note
    return entry


HB = ["hoek-practical", "hoek-brown-1997"]
MR = ["hoek-practical", "deere-1968", "palmstrom-singh-2001"]
FC = ["freeze-cherry-1979", "domenico-schwartz-1990"]
GEO = ["goodman-1989", "zhang-2016", "lama-vutukuri-1978"]
SLOPE = ["wyllie-mah-2004", "barton-choubey-1977"]
SOIL = ["terzaghi-peck-mesri-1996", "bell-2007"]

REFERENCE = {
    # ---------------- IGNEOUS: plutonic ----------------
    "granite": dict(state="rock", props={
        "dry_density": P(2520, 2810, 2650, sources=GEO + ["schon-2015"]),
        "porosity": P(0.1, 4.0, 1.0, sources=GEO + ["heath-1983"]),
        "hydraulic_conductivity": P(3e-9, 5e-5, 1e-7, sources=FC,
            note="Fractured and weathered granite. Unfractured granite is the "
                 "matrix value, seven orders of magnitude lower."),
        "matrix_hydraulic_conductivity": P(3e-14, 2e-10, sources=FC),
        "ucs": P(100, 300, 180, sources=GEO + ["hoek-practical"]),
        "tensile_strength": P(5, 20, 10, sources=GEO),
        "youngs_modulus": P(30, 80, 55, basis="derived", sources=MR,
            note="MR 300-550 (Table 8) applied to the UCS range."),
        "poissons_ratio": P(0.10, 0.33, 0.22, sources=GEO),
        "friction_angle": P(45, 60, 52, sources=GEO + SLOPE),
        "cohesion": P(15, 55, 30, sources=GEO),
        "residual_friction_angle": P(29, 35, 31, sources=SLOPE,
            note="Basic friction angle of a smooth joint surface in granite."),
        "residual_cohesion": P(0, 0.05, 0, sources=SLOPE),
        "hoek_brown_mi": P(29, 35, 32, basis="table", sources=HB,
            note="Hoek Practical Rock Engineering Table 3: granite 32 +/- 3."),
        "gsi_typical": P(45, 85, 65, sources=["hoek-brown-2019"]),
        "slake_durability": P(95, 100, 99, sources=["bell-2007"]),
    }),
    "granodiorite": dict(state="rock", parent="granite", props={
        "hoek_brown_mi": P(26, 32, 29, basis="table", sources=HB,
            note="Table 3: granodiorite (29 +/- 3)."),
        "youngs_modulus": P(30, 70, 50, basis="derived", sources=MR,
            note="MR 400-450."),
    }),
    "diorite": dict(state="rock", parent="granite", props={
        "dry_density": P(2720, 2960, 2850, sources=GEO),
        "ucs": P(100, 250, 170, sources=GEO),
        "hoek_brown_mi": P(20, 30, 25, basis="table", sources=HB,
            note="Table 3: diorite 25 +/- 5."),
        "youngs_modulus": P(30, 70, 48, basis="derived", sources=MR,
            note="MR 300-350."),
    }),
    "gabbro": dict(state="rock", props={
        "dry_density": P(2850, 3120, 2950, sources=GEO + ["schon-2015"]),
        "porosity": P(0.1, 2.0, 0.5, sources=GEO),
        "hydraulic_conductivity": P(5e-7, 4e-6, sources=FC,
            note="Weathered gabbro; unweathered is the matrix value."),
        "matrix_hydraulic_conductivity": P(3e-14, 2e-10, sources=FC),
        "ucs": P(100, 300, 200, sources=GEO),
        "tensile_strength": P(5, 25, 12, sources=GEO),
        "youngs_modulus": P(40, 100, 70, basis="derived", sources=MR,
            note="MR 400-500."),
        "poissons_ratio": P(0.12, 0.33, 0.24, sources=GEO),
        "friction_angle": P(45, 58, 52, sources=GEO),
        "cohesion": P(20, 60, 35, sources=GEO),
        "residual_friction_angle": P(29, 35, 32, sources=SLOPE),
        "residual_cohesion": P(0, 0.05, 0, sources=SLOPE),
        "hoek_brown_mi": P(24, 30, 27, basis="table", sources=HB,
            note="Table 3: gabbro 27 +/- 3."),
        "gsi_typical": P(45, 85, 65, sources=["hoek-brown-2019"]),
        "slake_durability": P(95, 100, 99, sources=["bell-2007"]),
    }),
    "norite": dict(state="rock", parent="gabbro", props={
        "hoek_brown_mi": P(15, 25, 20, basis="table", sources=HB,
            note="Table 3: norite 20 +/- 5."),
        "youngs_modulus": P(35, 90, 62, basis="derived", sources=MR,
            note="MR 350-400."),
    }),
    "peridotite": dict(state="rock", parent="gabbro", props={
        "dry_density": P(3150, 3400, 3250, sources=["schon-2015"]),
        "ucs": P(80, 250, 150, sources=GEO),
        "hoek_brown_mi": P(20, 30, 25, basis="table", sources=HB,
            note="Table 3: peridotite (25 +/- 5)."),
        "youngs_modulus": P(25, 70, 45, basis="derived", sources=MR,
            note="MR 250-300."),
        "slake_durability": P(60, 95, 85, sources=["bell-2007"],
            note="Serpentinised peridotite degrades markedly on wetting."),
    }),
    "dolerite": dict(state="rock", props={
        "dry_density": P(2800, 3050, 2950, sources=GEO),
        "porosity": P(0.1, 3.0, 1.0, sources=GEO),
        "hydraulic_conductivity": P(3e-9, 3e-4, 1e-7, sources=FC,
            note="Dyke rock: flow is along cooling joints and margins."),
        "matrix_hydraulic_conductivity": P(3e-14, 2e-10, sources=FC),
        "ucs": P(150, 350, 250, sources=GEO + ["hoek-practical"]),
        "tensile_strength": P(10, 30, 18, sources=GEO),
        "youngs_modulus": P(45, 105, 75, basis="derived", sources=MR,
            note="MR 300-400."),
        "poissons_ratio": P(0.12, 0.30, 0.22, sources=GEO),
        "friction_angle": P(48, 60, 55, sources=GEO),
        "cohesion": P(25, 70, 45, sources=GEO),
        "residual_friction_angle": P(30, 38, 34, sources=SLOPE),
        "residual_cohesion": P(0, 0.05, 0, sources=SLOPE),
        "hoek_brown_mi": P(11, 21, 16, basis="table", sources=HB,
            note="Table 3: dolerite (16 +/- 5)."),
        "gsi_typical": P(45, 85, 65, sources=["hoek-brown-2019"]),
        "slake_durability": P(95, 100, 99, sources=["bell-2007"]),
    }),
    "pegmatite": dict(state="rock", parent="granite", props={
        "ucs": P(50, 200, 120, sources=GEO,
            note="Coarse crystal size lowers strength against a granite of the "
                 "same composition."),
    }),

    # ---------------- IGNEOUS: volcanic ----------------
    "basalt": dict(state="rock", props={
        "dry_density": P(2700, 3000, 2900, sources=GEO + ["schon-2015"]),
        "porosity": P(0.2, 25.0, 5.0, sources=GEO + ["heath-1983"],
            note="Vesicular flow tops reach the top of this range; a dense flow "
                 "interior is at the bottom of it."),
        "hydraulic_conductivity": P(2e-11, 2e-2, 1e-6, sources=FC,
            note="The widest range of any rock here, and it is real: a young "
                 "permeable basalt with open flow contacts is an aquifer, a "
                 "dense unfractured flow is an aquiclude."),
        "matrix_hydraulic_conductivity": P(1e-13, 1e-9, sources=FC),
        "specific_yield": P(3, 20, 8, basis="table", sources=["heath-1983"],
            note="Heath (1983): young basalt, porosity 11%, specific yield 8%."),
        "ucs": P(100, 350, 200, sources=GEO + ["hoek-practical"]),
        "tensile_strength": P(6, 25, 14, sources=GEO),
        "youngs_modulus": P(25, 110, 60, basis="derived", sources=MR,
            note="MR 250-450."),
        "poissons_ratio": P(0.10, 0.35, 0.25, sources=GEO),
        "friction_angle": P(45, 58, 51, sources=GEO),
        "cohesion": P(15, 60, 35, sources=GEO),
        "residual_friction_angle": P(31, 38, 35, sources=SLOPE),
        "residual_cohesion": P(0, 0.05, 0, sources=SLOPE),
        "hoek_brown_mi": P(20, 30, 25, basis="table", sources=HB,
            note="Table 3: basalt (25 +/- 5)."),
        "gsi_typical": P(35, 75, 55, sources=["hoek-brown-2019"],
            note="Columnar jointing and flow contacts commonly put basalt "
                 "lower than an equivalent plutonic rock."),
        "slake_durability": P(85, 100, 96, sources=["bell-2007"]),
    }),
    "andesite": dict(state="rock", parent="basalt", props={
        "dry_density": P(2500, 2800, 2650, sources=GEO),
        "ucs": P(100, 300, 180, sources=GEO),
        "hoek_brown_mi": P(20, 30, 25, basis="table", sources=HB,
            note="Table 3: andesite 25 +/- 5."),
        "youngs_modulus": P(30, 90, 55, basis="derived", sources=MR,
            note="MR 300-500."),
    }),
    "rhyolite": dict(state="rock", parent="basalt", props={
        "dry_density": P(2400, 2700, 2550, sources=GEO),
        "ucs": P(80, 250, 160, sources=GEO),
        "hoek_brown_mi": P(20, 30, 25, basis="table", sources=HB,
            note="Table 3: rhyolite (25 +/- 5)."),
        "youngs_modulus": P(24, 80, 48, basis="derived", sources=MR,
            note="MR 300-500."),
        "poissons_ratio": P(0.10, 0.30, 0.20, sources=GEO),
    }),
    "dacite": dict(state="rock", parent="andesite", props={
        "hoek_brown_mi": P(22, 28, 25, basis="table", sources=HB,
            note="Table 3: dacite (25 +/- 3)."),
        "youngs_modulus": P(28, 90, 56, basis="derived", sources=MR,
            note="MR 350-450."),
    }),
    "tuff": dict(state="rock", props={
        "dry_density": P(1300, 2400, 1900, sources=GEO + ["schon-2015"],
            note="Welded tuff is at the top of this range; an unwelded ash-fall "
                 "tuff is at the bottom and behaves as a weak rock."),
        "porosity": P(10.0, 60.0, 30.0, sources=GEO + ["schon-2015"]),
        "hydraulic_conductivity": P(1e-9, 1e-4, 1e-6, sources=FC),
        "matrix_hydraulic_conductivity": P(1e-11, 1e-7, sources=FC),
        "ucs": P(5, 100, 30, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 places tuff in grade R5 where welded; unwelded "
                 "tuff is R2-R3 and can be excavated by hand."),
        "tensile_strength": P(0.5, 8, 2.5, sources=GEO),
        "youngs_modulus": P(1, 40, 9, basis="derived", sources=MR,
            note="MR 200-400."),
        "poissons_ratio": P(0.10, 0.30, 0.20, sources=GEO),
        "friction_angle": P(28, 45, 35, sources=GEO),
        "cohesion": P(0.5, 15, 4, sources=GEO),
        "residual_friction_angle": P(25, 33, 29, sources=SLOPE),
        "residual_cohesion": P(0, 0.02, 0, sources=SLOPE),
        "hoek_brown_mi": P(8, 18, 13, basis="table", sources=HB,
            note="Table 3: tuff (13 +/- 5)."),
        "gsi_typical": P(30, 65, 45, sources=["hoek-brown-2019"]),
        "slake_durability": P(30, 90, 65, sources=["bell-2007"],
            note="Zeolitised and glassy tuffs slake readily; this is a common "
                 "cause of progressive slope failure in volcanic terrain."),
    }),
    "agglomerate": dict(state="rock", parent="tuff", props={
        "ucs": P(20, 150, 60, sources=GEO),
        "hoek_brown_mi": P(16, 22, 19, basis="table", sources=HB,
            note="Table 3: agglomerate (19 +/- 3)."),
        "youngs_modulus": P(8, 90, 30, basis="derived", sources=MR,
            note="MR 400-600."),
    }),
    "obsidian": dict(state="rock", parent="rhyolite", props={
        "porosity": P(0.0, 2.0, 0.5, sources=["schon-2015"]),
        "hoek_brown_mi": P(16, 22, 19, basis="table", sources=HB,
            note="Table 3: obsidian (19 +/- 3)."),
    }),

    # ---------------- SEDIMENTARY: siliciclastic ----------------
    "sandstone": dict(state="rock", props={
        "dry_density": P(1900, 2700, 2300, sources=GEO + ["schon-2015"]),
        "porosity": P(5.0, 30.0, 15.0, basis="table", sources=FC + ["heath-1983"],
            note="Freeze & Cherry Table 2.4: sandstone 5-30%."),
        "hydraulic_conductivity": P(3e-10, 6e-6, 1e-7, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: sandstone 3e-10 to 6e-6 m/s."),
        "matrix_hydraulic_conductivity": P(1e-11, 1e-6, sources=FC),
        "specific_yield": P(5, 20, 10, sources=["heath-1983"]),
        "ucs": P(20, 170, 70, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 puts sandstone across grades R4 and R5. The "
                 "spread is cementation: a friable Cenozoic sandstone and a "
                 "silica-cemented Palaeozoic one share a name and little else."),
        "tensile_strength": P(1, 15, 5, sources=GEO),
        "youngs_modulus": P(4, 60, 20, basis="derived", sources=MR,
            note="MR 200-350."),
        "poissons_ratio": P(0.08, 0.35, 0.20, sources=GEO),
        "friction_angle": P(30, 50, 40, sources=GEO + SLOPE),
        "cohesion": P(1, 30, 8, sources=GEO),
        "residual_friction_angle": P(25, 35, 30, sources=SLOPE,
            note="Basic friction angle of a sandstone joint."),
        "residual_cohesion": P(0, 0.02, 0, sources=SLOPE),
        "hoek_brown_mi": P(13, 21, 17, basis="table", sources=HB,
            note="Table 3: sandstone 17 +/- 4."),
        "gsi_typical": P(35, 75, 55, sources=["hoek-brown-2019"]),
        "slake_durability": P(80, 99, 95, sources=["bell-2007"]),
    }),
    "siltstone": dict(state="rock", props={
        "dry_density": P(2000, 2700, 2400, sources=GEO),
        "porosity": P(5.0, 35.0, 20.0, sources=FC),
        "hydraulic_conductivity": P(1e-11, 1.4e-8, 1e-9, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: siltstone 1e-11 to 1.4e-8 m/s."),
        "matrix_hydraulic_conductivity": P(1e-12, 1e-9, sources=FC),
        "ucs": P(10, 120, 40, sources=GEO + ["hoek-practical"]),
        "tensile_strength": P(0.5, 10, 3, sources=GEO),
        "youngs_modulus": P(3.5, 48, 16, basis="derived", sources=MR,
            note="MR 350-400."),
        "poissons_ratio": P(0.08, 0.30, 0.18, sources=GEO),
        "friction_angle": P(27, 45, 35, sources=GEO),
        "cohesion": P(0.5, 20, 5, sources=GEO),
        "residual_friction_angle": P(23, 32, 27, sources=SLOPE),
        "residual_cohesion": P(0, 0.02, 0, sources=SLOPE),
        "hoek_brown_mi": P(5, 9, 7, basis="table", sources=HB,
            note="Table 3: siltstone 7 +/- 2."),
        "gsi_typical": P(30, 70, 50, sources=["hoek-brown-2019"]),
        "slake_durability": P(40, 95, 75, sources=["bell-2007"]),
    }),
    "mudstone": dict(state="rock", props={
        "dry_density": P(1900, 2600, 2300, sources=GEO),
        "porosity": P(1.0, 40.0, 25.0, basis="table",
            sources=["hobbs-mercia-2002", "tellam-lloyd-1981"],
            note="20-40% for the Mercia Mudstone Group (BGS RR/01/02 s4.9); an "
                 "indurated Palaeozoic mudstone is at the bottom of the range."),
        "hydraulic_conductivity": P(1e-11, 1e-6, 1e-8, basis="table",
            sources=["hobbs-mercia-2002", "tellam-lloyd-1981", "bgs-ngpd"],
            note="FIELD (mass) values, 1e-6 to 1e-8 m/s, mainly parallel to "
                 "bedding -- Tellam & Lloyd (1981) via BGS RR/01/02 s4.9. This "
                 "is two to three orders of magnitude ABOVE the Freeze & Cherry "
                 "shale range, and the difference is fissuring: 'the mass "
                 "permeability of highly indurated mudrocks tends to be "
                 "dominated by the presence of fissures that are capable of "
                 "increasing the mass permeability by orders of magnitude over "
                 "the intact permeability'. Taking the laboratory number for a "
                 "mudrock aquitard is the commonest way a groundwater model "
                 "under-predicts flow through one."),
        "matrix_hydraulic_conductivity": P(1e-11, 1e-9, basis="table",
            sources=["hobbs-mercia-2002", "tellam-lloyd-1981"],
            note="Laboratory values PERPENDICULAR to bedding, 1e-9 to 1e-11 "
                 "m/s. The anisotropy is the point: the same material measured "
                 "along and across its fabric differs by orders of magnitude."),
        "ucs": P(5, 100, 25, sources=GEO + ["hoek-practical"]),
        "tensile_strength": P(0.2, 8, 2, sources=GEO),
        "poissons_ratio": P(0.10, 0.40, 0.25, sources=GEO),
        "friction_angle": P(20, 40, 28, sources=GEO),
        "cohesion": P(0.2, 15, 2, sources=GEO),
        "friction_angle": P(25, 42, 32, basis="table",
            sources=["hobbs-mercia-2002", "chandler-1969"],
            note="MEASURED BY WEATHERING ZONE, which is how a mudrock's "
                 "strength actually varies (Chandler 1969; Cripps & Taylor "
                 "1981, via BGS RR/01/02): Zone 1 c'=28 kPa phi'=40 deg; Zone 3 "
                 "c'=17 kPa phi'=42-32 deg; Zone 4 c'=17 kPa phi'=32-25 deg. A "
                 "single value for 'mudstone' spans that whole weathering "
                 "profile, and the profile is what a slope sits in."),
        "cohesion": P(0.017, 0.028, 0.02, basis="table",
            sources=["hobbs-mercia-2002", "chandler-1969"],
            note="17-28 kPa effective cohesion across weathering zones 1 to 4 "
                 "(Chandler 1969). Note the UNIT: this is 0.02 MPa, two orders "
                 "of magnitude below an intact rock cohesion, because a "
                 "weathered mudrock behaves as a stiff clay."),
        "residual_friction_angle": P(18, 30, 24, basis="table",
            sources=["hobbs-mercia-2002", "cripps-taylor-1981",
                     "skempton-1964", "stark-hussain-2013"],
            note="THE PARAMETER THAT DECIDES MOST MUDROCK LANDSLIDES. On a "
                 "surface that has already slipped the clay minerals align and "
                 "the angle falls to a fraction of the peak; Skempton (1964) is "
                 "why a reactivated slide is a different problem from a "
                 "first-time one. Measured: 18-30 deg for the Mercia Mudstone "
                 "(Cripps & Taylor 1981), 22-30 deg for Zone IVa material "
                 "(Jones & Hobbs 1994) -- and a high-plasticity clay is lower "
                 "again, which is why the clay entry runs to 6 deg."),
        "residual_cohesion": P(0, 0.01, 0, sources=["skempton-1964"]),
        "youngs_modulus": P(1, 30, 11.9, basis="table",
            sources=["hobbs-mercia-2002"],
            note="11.9 GPa quoted as typical for Mercia Mudstone (BGS RR/01/02 "
                 "s4.10). In situ pressuremeter moduli ran up to an order of "
                 "magnitude above laboratory values on the same material -- "
                 "which method produced a modulus matters as much as which "
                 "rock it came from."),
        "hoek_brown_mi": P(2, 6, 4, basis="table", sources=HB,
            note="Table 3: claystone 4 +/- 2."),
        "gsi_typical": P(25, 65, 45, sources=["hoek-brown-2019"],
            note="RQD for Mercia Mudstone measured at 36-40%, which is the "
                 "'poor' band (BGS RR/01/02 s4.11) -- consistent with the lower "
                 "half of this GSI range."),
        "slake_durability": P(10, 80, 45, sources=["bell-2007"],
            note="Low durability is the defining engineering property of "
                 "mudrock: cut slopes degrade over months to years, so a "
                 "stability analysis at excavation is not the governing case."),
    }),
    "shale": dict(state="rock", parent="mudstone", props={
        "ucs": P(5, 100, 25, sources=GEO),
        "youngs_modulus": P(0.75, 25, 5, basis="derived", sources=MR,
            note="MR 150-250, and strongly anisotropic."),
        "hoek_brown_mi": P(4, 8, 6, basis="table", sources=HB,
            note="Table 3: shale 6 +/- 2."),
        "poissons_ratio": P(0.10, 0.40, 0.25, sources=GEO,
            note="Anisotropic: the value normal to fissility differs markedly "
                 "from the value parallel to it."),
    }),
    "claystone": dict(state="rock", parent="mudstone", props={
        "hoek_brown_mi": P(2, 6, 4, basis="table", sources=HB,
            note="Table 3: claystone 4 +/- 2."),
    }),
    "conglomerate": dict(state="rock", parent="sandstone", props={
        "dry_density": P(2000, 2700, 2400, sources=GEO),
        "ucs": P(20, 150, 60, sources=GEO),
        "youngs_modulus": P(6, 60, 21, basis="derived", sources=MR,
            note="MR 300-400."),
        "hoek_brown_mi": P(18, 24, 21, basis="table", sources=HB,
            note="Table 3: conglomerate (21 +/- 3). Hoek notes conglomerates "
                 "range from sandstone-like to fine-sediment-like depending "
                 "entirely on the cement."),
    }),
    "breccia": dict(state="rock", parent="sandstone", props={
        "hoek_brown_mi": P(14, 24, 19, basis="table", sources=HB,
            note="Table 3: breccia (19 +/- 5)."),
        "youngs_modulus": P(4.6, 52, 18, basis="derived", sources=MR,
            note="MR 230-350."),
    }),
    "greywacke": dict(state="rock", parent="sandstone", props={
        "ucs": P(50, 250, 120, sources=GEO),
        "hoek_brown_mi": P(15, 21, 18, basis="table", sources=HB,
            note="Table 3: greywacke (18 +/- 3)."),
        "youngs_modulus": P(17.5, 87, 42, basis="derived", sources=MR,
            note="MR 350."),
    }),
    "marl": dict(state="rock", parent="mudstone", props={
        "hoek_brown_mi": P(5, 9, 7, basis="table", sources=HB,
            note="Table 3: marl (7 +/- 2)."),
        "youngs_modulus": P(0.75, 20, 4, basis="derived", sources=MR,
            note="MR 150-200."),
    }),

    # ---------------- SEDIMENTARY: carbonate ----------------
    "limestone": dict(state="rock", props={
        "dry_density": P(2200, 2750, 2600, sources=GEO + ["schon-2015"]),
        "porosity": P(0.0, 20.0, 8.0, basis="table", sources=FC + ["heath-1983"],
            note="Freeze & Cherry Table 2.4: limestone and dolomite 0-20%. "
                 "Karstified limestone reaches 50% and is a different material."),
        "hydraulic_conductivity": P(1e-9, 6e-6, 1e-7, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: limestone/dolomite 1e-9 to 6e-6. "
                 "KARST is 1e-6 to 2e-2 m/s -- four orders higher, and the "
                 "difference is dissolution, not lithology. See `karst`."),
        "matrix_hydraulic_conductivity": P(1e-11, 1e-7, sources=FC),
        "specific_yield": P(2, 18, 10, basis="table", sources=["heath-1983"]),
        "ucs": P(30, 250, 100, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 spans grades R4 and R5 for limestone."),
        "tensile_strength": P(2, 20, 7, sources=GEO),
        "youngs_modulus": P(12, 200, 50, basis="derived", sources=MR,
            note="MR 400-1000 across crystalline, sparitic and micritic."),
        "poissons_ratio": P(0.10, 0.33, 0.25, sources=GEO),
        "friction_angle": P(33, 55, 42, sources=GEO + SLOPE),
        "cohesion": P(3, 50, 15, sources=GEO),
        "residual_friction_angle": P(30, 40, 34, sources=SLOPE,
            note="Basic friction angle of a limestone joint; a polished, "
                 "solution-widened bedding plane is lower."),
        "residual_cohesion": P(0, 0.02, 0, sources=SLOPE),
        "hoek_brown_mi": P(6, 15, 10, basis="table", sources=HB,
            note="Table 3: crystalline limestone (12 +/- 3), sparitic (10 +/- "
                 "2), micritic (9 +/- 2)."),
        "gsi_typical": P(40, 80, 60, sources=["hoek-brown-2019"]),
        "slake_durability": P(90, 100, 98, sources=["bell-2007"]),
    }),
    "dolostone": dict(state="rock", parent="limestone", props={
        "dry_density": P(2500, 2900, 2750, sources=GEO),
        "ucs": P(40, 250, 120, sources=GEO),
        "hoek_brown_mi": P(6, 12, 9, basis="table", sources=HB,
            note="Table 3: dolomite (9 +/- 3)."),
        "youngs_modulus": P(14, 125, 50, basis="derived", sources=MR,
            note="MR 350-500."),
    }),
    "chalk": dict(state="rock", props={
        "dry_density": P(1300, 2200, 1800, sources=GEO + ["bell-2007"]),
        "porosity": P(20.0, 50.0, 35.0, sources=["bell-2007", "schon-2015"],
            note="Among the most porous rocks there is, and most of that "
                 "porosity does not transmit water -- the flow is in fractures."),
        "hydraulic_conductivity": P(1e-8, 1e-3, 1e-5, sources=FC + ["bell-2007"],
            note="A major aquifer in NW Europe, and it is the fracture network "
                 "that makes it one: the matrix conductivity is a thousandth "
                 "of the mass value."),
        "matrix_hydraulic_conductivity": P(1e-9, 1e-7, sources=["bell-2007"]),
        "specific_yield": P(1, 5, 2, sources=["bell-2007"],
            note="Very low against its porosity: the pores are too fine to "
                 "drain under gravity."),
        "ucs": P(1, 30, 8, sources=["hoek-practical", "bell-2007"],
            note="Hoek Table 2 puts chalk in grade R2, 5-25 MPa -- weak enough "
                 "to peel with a knife."),
        "tensile_strength": P(0.1, 2, 0.5, sources=["bell-2007"]),
        "youngs_modulus": P(1, 30, 8, basis="derived", sources=MR,
            note="MR 1000+, which is why chalk is stiff for its strength."),
        "poissons_ratio": P(0.10, 0.35, 0.25, sources=["bell-2007"]),
        "friction_angle": P(25, 42, 33, sources=["bell-2007"]),
        "cohesion": P(0.1, 5, 1, sources=["bell-2007"]),
        "residual_friction_angle": P(25, 32, 28, sources=SLOPE),
        "residual_cohesion": P(0, 0.01, 0, sources=SLOPE),
        "hoek_brown_mi": P(5, 9, 7, basis="table", sources=HB,
            note="Table 3: chalk 7 +/- 2."),
        "gsi_typical": P(35, 75, 55, sources=["hoek-brown-2019"]),
        "slake_durability": P(20, 80, 50, sources=["bell-2007"]),
    }),
    "karst": dict(state="rock", parent="limestone", props={
        "porosity": P(5.0, 50.0, 20.0, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.4: karst limestone 5-50%."),
        "hydraulic_conductivity": P(1e-6, 2e-2, 1e-4, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: karst limestone 1e-6 to 2e-2 m/s. "
                 "Flow is in conduits, so Darcy's law and an equivalent porous "
                 "medium are both approximations here."),
        "specific_yield": P(5, 30, 15, sources=FC),
    }),
    "travertine": dict(state="rock", parent="limestone", props={
        "porosity": P(5.0, 40.0, 20.0, sources=["schon-2015"]),
        "ucs": P(20, 100, 50, sources=GEO),
    }),

    # ---------------- SEDIMENTARY: evaporite and chemical ----------------
    "gypsum": dict(state="rock", props={
        "dry_density": P(2200, 2400, 2300, sources=GEO),
        "porosity": P(1.0, 15.0, 5.0, sources=["schon-2015"]),
        "hydraulic_conductivity": P(1e-12, 1e-7, 1e-9, sources=FC,
            note="Low, until dissolution opens a path -- gypsum karst develops "
                 "in decades rather than the millennia limestone karst takes."),
        "matrix_hydraulic_conductivity": P(1e-13, 1e-10, sources=FC),
        "ucs": P(10, 60, 25, sources=GEO + ["bell-2007"]),
        "tensile_strength": P(0.5, 5, 2, sources=GEO),
        "youngs_modulus": P(3.5, 21, 9, basis="derived", sources=MR,
            note="MR (350), estimated in Table 8 on geological logic."),
        "poissons_ratio": P(0.15, 0.35, 0.25, sources=GEO),
        "friction_angle": P(28, 40, 33, sources=GEO),
        "cohesion": P(1, 12, 4, sources=GEO),
        "residual_friction_angle": P(24, 32, 28, sources=SLOPE),
        "residual_cohesion": P(0, 0.01, 0, sources=SLOPE),
        "hoek_brown_mi": P(6, 10, 8, basis="table", sources=HB,
            note="Table 3: gypsum 8 +/- 2."),
        "gsi_typical": P(35, 70, 50, sources=["hoek-brown-2019"]),
        "slake_durability": P(10, 60, 30, sources=["bell-2007"],
            note="Soluble. Durability tests in water are not meaningful and the "
                 "engineering problem is dissolution, not slaking."),
    }),
    "anhydrite": dict(state="rock", parent="gypsum", props={
        "dry_density": P(2800, 3000, 2900, sources=GEO),
        "hydraulic_conductivity": P(4e-13, 2e-8, 1e-11, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: anhydrite 4e-13 to 2e-8 m/s."),
        "ucs": P(40, 130, 80, sources=GEO),
        "hoek_brown_mi": P(10, 14, 12, basis="table", sources=HB,
            note="Table 3: anhydrite 12 +/- 2."),
        "slake_durability": P(20, 70, 45, sources=["bell-2007"],
            note="Hydration to gypsum involves a large volume increase, which "
                 "is a heave problem in tunnels rather than a slope one."),
    }),
    "halite": dict(state="rock", props={
        "dry_density": P(2100, 2200, 2160, sources=GEO),
        "porosity": P(0.0, 5.0, 1.0, sources=["schon-2015"]),
        "hydraulic_conductivity": P(1e-12, 1e-10, sources=FC,
            note="Freeze & Cherry Table 2.2: salt 1e-12 to 1e-10 m/s. Effectively "
                 "impermeable, which is why salt is a seal and a repository host."),
        "matrix_hydraulic_conductivity": P(1e-14, 1e-11, sources=FC),
        "ucs": P(5, 40, 20, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 puts rocksalt in grade R2."),
        "tensile_strength": P(0.5, 3, 1.5, sources=GEO),
        "youngs_modulus": P(2, 40, 15, sources=GEO),
        "poissons_ratio": P(0.20, 0.40, 0.30, sources=GEO),
        "friction_angle": P(25, 45, 35, sources=GEO),
        "cohesion": P(1, 10, 4, sources=GEO),
        "residual_friction_angle": P(20, 30, 25, sources=SLOPE),
        "residual_cohesion": P(0, 0.01, 0, sources=SLOPE),
        "gsi_typical": P(50, 90, 75, sources=["hoek-brown-2019"]),
        "slake_durability": P(0, 20, 5, sources=["bell-2007"],
            note="Dissolves. The governing behaviour is creep, not brittle "
                 "failure, and no static strength describes it."),
    }),
    "chert": dict(state="rock", props={
        "dry_density": P(2400, 2650, 2550, sources=GEO),
        "porosity": P(0.1, 10.0, 2.0, sources=["schon-2015"]),
        "hydraulic_conductivity": P(1e-11, 1e-6, 1e-8, sources=FC,
            note="Fracture-controlled; the matrix is effectively impermeable."),
        "matrix_hydraulic_conductivity": P(1e-13, 1e-10, sources=FC),
        "ucs": P(100, 400, 250, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 lists chert among the grade R6 examples -- it "
                 "can only be chipped with a hammer."),
        "tensile_strength": P(8, 30, 18, sources=GEO),
        "youngs_modulus": P(30, 90, 60, sources=GEO),
        "poissons_ratio": P(0.08, 0.25, 0.15, sources=GEO),
        "friction_angle": P(45, 60, 52, sources=GEO),
        "cohesion": P(20, 70, 40, sources=GEO),
        "residual_friction_angle": P(30, 38, 34, sources=SLOPE),
        "residual_cohesion": P(0, 0.02, 0, sources=SLOPE),
        "gsi_typical": P(40, 80, 60, sources=["hoek-brown-2019"]),
        "slake_durability": P(95, 100, 99, sources=["bell-2007"]),
    }),
    "coal": dict(state="rock", props={
        "dry_density": P(1100, 1800, 1400, sources=GEO + ["bell-2007"]),
        "porosity": P(2.0, 20.0, 8.0, sources=["schon-2015"]),
        "hydraulic_conductivity": P(1e-10, 1e-5, 1e-7, sources=FC,
            note="Cleat-controlled, and strongly stress-dependent -- coal seam "
                 "permeability falls by orders of magnitude with depth."),
        "matrix_hydraulic_conductivity": P(1e-12, 1e-9, sources=FC),
        "ucs": P(5, 50, 20, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 places coal in grade R3."),
        "tensile_strength": P(0.5, 5, 2, sources=GEO),
        "youngs_modulus": P(1, 8, 3, sources=GEO),
        "poissons_ratio": P(0.20, 0.40, 0.32, sources=GEO),
        "friction_angle": P(25, 45, 35, sources=GEO),
        "cohesion": P(0.5, 8, 2, sources=GEO),
        "residual_friction_angle": P(18, 30, 24, sources=SLOPE),
        "residual_cohesion": P(0, 0.01, 0, sources=SLOPE),
        "hoek_brown_mi": P(8, 21, 14, sources=["hoek-brown-2019"]),
        "gsi_typical": P(25, 60, 40, sources=["hoek-brown-2019"]),
        "slake_durability": P(20, 80, 50, sources=["bell-2007"]),
    }),

    # ---------------- METAMORPHIC ----------------
    "gneiss": dict(state="rock", props={
        "dry_density": P(2600, 2900, 2750, sources=GEO + ["schon-2015"]),
        "porosity": P(0.1, 3.0, 1.0, sources=GEO),
        "hydraulic_conductivity": P(8e-9, 3e-4, 1e-7, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: fractured igneous and metamorphic "
                 "8e-9 to 3e-4 m/s."),
        "matrix_hydraulic_conductivity": P(3e-14, 2e-10, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: unfractured igneous and "
                 "metamorphic 3e-14 to 2e-10 m/s."),
        "ucs": P(80, 300, 160, sources=GEO + ["hoek-practical"]),
        "tensile_strength": P(4, 20, 10, sources=GEO),
        "youngs_modulus": P(24, 225, 70, basis="derived", sources=MR,
            note="MR 300-750, and strongly dependent on the loading direction "
                 "relative to the foliation."),
        "poissons_ratio": P(0.10, 0.30, 0.22, sources=GEO),
        "friction_angle": P(40, 58, 48, sources=GEO),
        "cohesion": P(10, 50, 25, sources=GEO),
        "residual_friction_angle": P(26, 35, 30, sources=SLOPE),
        "residual_cohesion": P(0, 0.05, 0, sources=SLOPE),
        "hoek_brown_mi": P(13, 23, 18, basis="table", sources=HB,
            note="Table 3: gneiss 18 +/- 5, tested normal to foliation."),
        "gsi_typical": P(40, 80, 60, sources=["hoek-brown-2019"]),
        "slake_durability": P(90, 100, 98, sources=["bell-2007"]),
    }),
    "schist": dict(state="rock", props={
        "dry_density": P(2500, 2900, 2700, sources=GEO),
        "porosity": P(0.5, 5.0, 2.0, sources=GEO),
        "hydraulic_conductivity": P(8e-9, 3e-4, 1e-7, sources=FC),
        "matrix_hydraulic_conductivity": P(3e-14, 2e-10, sources=FC),
        "ucs": P(20, 160, 70, sources=GEO + ["hoek-practical"],
            note="STRONGLY ANISOTROPIC. Hoek notes a graphitic phyllite whose "
                 "UCS varies by a factor of about 5 with loading direction; "
                 "schist behaves the same way, and a single value for it is a "
                 "statement about the test, not the rock."),
        "tensile_strength": P(1, 12, 4, sources=GEO),
        "youngs_modulus": P(5, 176, 30, basis="derived", sources=MR,
            note="MR 250-1100 -- the widest band in Table 8, and the width is "
                 "the anisotropy."),
        "poissons_ratio": P(0.05, 0.35, 0.20, sources=GEO),
        "friction_angle": P(25, 45, 35, sources=GEO + SLOPE),
        "cohesion": P(2, 25, 8, sources=GEO),
        "residual_friction_angle": P(18, 30, 24, sources=SLOPE,
            note="A mica-rich schistosity surface is one of the lowest-friction "
                 "discontinuities in rock, and it is why schist terrain slides."),
        "residual_cohesion": P(0, 0.02, 0, sources=SLOPE),
        "hoek_brown_mi": P(9, 15, 12, basis="table", sources=HB,
            note="Table 3: schist 12 +/- 3, normal to foliation."),
        "gsi_typical": P(25, 65, 45, sources=["hoek-brown-2019"]),
        "slake_durability": P(60, 95, 85, sources=["bell-2007"]),
    }),
    "phyllite": dict(state="rock", parent="schist", props={
        "ucs": P(15, 120, 50, sources=GEO),
        "hoek_brown_mi": P(4, 10, 7, basis="table", sources=HB,
            note="Table 3: phyllite (7 +/- 3)."),
        "youngs_modulus": P(4.5, 96, 20, basis="derived", sources=MR,
            note="MR 300-800."),
        "residual_friction_angle": P(15, 28, 21, sources=SLOPE),
    }),
    "slate": dict(state="rock", parent="schist", props={
        "dry_density": P(2600, 2900, 2750, sources=GEO),
        "ucs": P(50, 250, 120, sources=GEO),
        "hoek_brown_mi": P(3, 11, 7, basis="table", sources=HB,
            note="Table 3: slate 7 +/- 4."),
        "youngs_modulus": P(20, 150, 60, basis="derived", sources=MR,
            note="MR 400-600."),
        "residual_friction_angle": P(20, 32, 26, sources=SLOPE),
        "slake_durability": P(80, 99, 93, sources=["bell-2007"]),
    }),
    "quartzite": dict(state="rock", props={
        "dry_density": P(2600, 2800, 2650, sources=GEO),
        "porosity": P(0.1, 5.0, 1.0, sources=GEO),
        "hydraulic_conductivity": P(1e-11, 1e-5, 1e-8, sources=FC,
            note="Fracture-controlled: the quartz fabric itself is tight."),
        "matrix_hydraulic_conductivity": P(1e-13, 1e-10, sources=FC),
        "ucs": P(150, 400, 250, sources=GEO + ["hoek-practical"],
            note="Hoek Table 2 lists quartzite among the grade R6 examples."),
        "tensile_strength": P(10, 30, 18, sources=GEO),
        "youngs_modulus": P(45, 180, 85, basis="derived", sources=MR,
            note="MR 300-450."),
        "poissons_ratio": P(0.08, 0.25, 0.15, sources=GEO),
        "friction_angle": P(48, 60, 55, sources=GEO),
        "cohesion": P(25, 70, 45, sources=GEO),
        "residual_friction_angle": P(30, 40, 35, sources=SLOPE),
        "residual_cohesion": P(0, 0.05, 0, sources=SLOPE),
        "hoek_brown_mi": P(17, 23, 20, basis="table", sources=HB,
            note="Table 3: quartzite 20 +/- 3."),
        "gsi_typical": P(45, 85, 65, sources=["hoek-brown-2019"]),
        "slake_durability": P(97, 100, 99, sources=["bell-2007"]),
    }),
    "marble": dict(state="rock", parent="limestone", props={
        "dry_density": P(2600, 2850, 2700, sources=GEO),
        "porosity": P(0.1, 2.0, 0.5, sources=GEO),
        "ucs": P(50, 200, 100, sources=GEO + ["hoek-practical"]),
        "youngs_modulus": P(35, 200, 70, basis="derived", sources=MR,
            note="MR 700-1000."),
        "hoek_brown_mi": P(6, 12, 9, basis="table", sources=HB,
            note="Table 3: marble 9 +/- 3."),
        "slake_durability": P(95, 100, 99, sources=["bell-2007"]),
    }),
    "amphibolite": dict(state="rock", parent="gneiss", props={
        "dry_density": P(2800, 3100, 2950, sources=GEO),
        "ucs": P(100, 300, 200, sources=GEO),
        "hoek_brown_mi": P(20, 32, 26, basis="table", sources=HB,
            note="Table 3: amphibolite 26 +/- 6."),
        "youngs_modulus": P(40, 150, 80, basis="derived", sources=MR,
            note="MR 400-500."),
    }),
    "hornfels": dict(state="rock", parent="gneiss", props={
        "ucs": P(100, 350, 200, sources=GEO),
        "hoek_brown_mi": P(15, 23, 19, basis="table", sources=HB,
            note="Table 3: hornfels (19 +/- 4)."),
        "youngs_modulus": P(40, 245, 90, basis="derived", sources=MR,
            note="MR 400-700."),
    }),
    "migmatite": dict(state="rock", parent="gneiss", props={
        "hoek_brown_mi": P(26, 32, 29, basis="table", sources=HB,
            note="Table 3: migmatite (29 +/- 3)."),
        "youngs_modulus": P(28, 120, 60, basis="derived", sources=MR,
            note="MR 350-400."),
    }),
    "serpentinite": dict(state="rock", parent="schist", props={
        "dry_density": P(2400, 2800, 2600, sources=GEO),
        "ucs": P(20, 120, 50, sources=GEO),
        "friction_angle": P(20, 40, 30, sources=GEO),
        "residual_friction_angle": P(12, 25, 18, sources=SLOPE,
            note="Serpentine minerals are among the weakest surfaces in rock; "
                 "serpentinite slopes creep at angles other rocks stand at."),
        "slake_durability": P(30, 85, 60, sources=["bell-2007"]),
    }),
    "mylonite": dict(state="rock", parent="schist", props={
        "ucs": P(20, 150, 60, sources=GEO),
        "residual_friction_angle": P(15, 28, 21, sources=SLOPE),
        "gsi_typical": P(20, 55, 35, sources=["hoek-brown-2019"],
            note="A shear zone is blocky-to-disturbed by definition."),
    }),
    "fault_gouge": dict(state="soil", props={
        "dry_density": P(1600, 2100, 1850, sources=SOIL),
        "porosity": P(20.0, 45.0, 32.0, sources=SOIL),
        "hydraulic_conductivity": P(1e-11, 1e-7, 1e-9, sources=FC,
            note="A clay gouge is a barrier ACROSS the fault and often a "
                 "conduit ALONG it. One number cannot carry that anisotropy."),
        "ucs": P(0.25, 1.0, 0.5, basis="table", sources=["hoek-practical"],
            note="Hoek Table 2 grade R0, 0.25-1 MPa: 'stiff fault gouge', "
                 "indented by thumbnail."),
        "friction_angle": P(12, 30, 20, sources=SLOPE + SOIL),
        "cohesion": P(0, 0.05, 0.01, sources=SLOPE),
        "residual_friction_angle": P(6, 20, 12, sources=["skempton-1964",
            "stark-hussain-2013"],
            note="Already at residual by definition -- the surface has slipped. "
                 "The lowest strength in this database, and it controls more "
                 "large landslides than any intact rock property."),
        "residual_cohesion": P(0, 0.005, 0, sources=["skempton-1964"]),
        "gsi_typical": P(5, 25, 15, sources=["hoek-brown-2019"]),
    }),

    # ---------------- UNCONSOLIDATED / SOIL ----------------
    "gravel": dict(state="soil", props={
        "dry_density": P(1600, 2200, 1900, sources=SOIL),
        "porosity": P(24.0, 40.0, 28.0, basis="table", sources=FC + ["heath-1983"],
            note="Freeze & Cherry Table 2.4: gravel 25-40%. Heath (1983): 20%."),
        "hydraulic_conductivity": P(3e-4, 3e-2, 3e-3, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: gravel 3e-4 to 3e-2 m/s -- the most "
                 "transmissive natural material in this database."),
        "specific_yield": P(15, 30, 19, basis="table", sources=["heath-1983"],
            note="Heath (1983): gravel, porosity 20%, specific yield 19%."),
        "friction_angle": P(34, 50, 40, sources=SOIL,
            note="Effective angle; the upper end is dense angular gravel."),
        "cohesion": P(0, 0, 0, sources=SOIL,
            note="Cohesionless. Any apparent cohesion in the field is suction "
                 "or interlock and disappears on saturation -- which is when "
                 "the slope is being analysed."),
        "residual_friction_angle": P(30, 40, 34, sources=SOIL),
        "residual_cohesion": P(0, 0, 0, sources=SOIL),
        "poissons_ratio": P(0.15, 0.35, 0.25, sources=SOIL),
    }),
    "sand": dict(state="soil", props={
        "dry_density": P(1400, 2000, 1700, sources=SOIL),
        "porosity": P(25.0, 50.0, 35.0, basis="table", sources=FC + ["heath-1983"],
            note="Freeze & Cherry Table 2.4: sand 25-50%."),
        "hydraulic_conductivity": P(1e-9, 2e-3, 1e-5, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: clean sand 2e-7 to 2e-3, silty "
                 "sand 1e-9 to 2e-5 m/s."),
        "specific_yield": P(10, 30, 22, basis="table", sources=["heath-1983"],
            note="Heath (1983): sand, porosity 25%, specific yield 22%."),
        "friction_angle": P(28, 45, 34, sources=SOIL),
        "cohesion": P(0, 0, 0, sources=SOIL, note="Cohesionless."),
        "residual_friction_angle": P(26, 36, 31, sources=SOIL,
            note="A sand's residual angle is close to its critical-state angle; "
                 "unlike clay it does not lose most of its strength."),
        "residual_cohesion": P(0, 0, 0, sources=SOIL),
        "poissons_ratio": P(0.20, 0.40, 0.30, sources=SOIL),
    }),
    "silt": dict(state="soil", props={
        "dry_density": P(1300, 1900, 1600, sources=SOIL),
        "porosity": P(35.0, 50.0, 42.0, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.4: silt 35-50%."),
        "hydraulic_conductivity": P(1e-9, 2e-5, 1e-7, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: silt and loess 1e-9 to 2e-5 m/s."),
        "specific_yield": P(3, 20, 10, sources=["heath-1983"]),
        "friction_angle": P(26, 36, 30, sources=SOIL),
        "cohesion": P(0, 0.03, 0.005, sources=SOIL),
        "residual_friction_angle": P(22, 32, 27, sources=SOIL),
        "residual_cohesion": P(0, 0, 0, sources=SOIL),
        "poissons_ratio": P(0.25, 0.40, 0.32, sources=SOIL),
    }),
    "clay": dict(state="soil", props={
        "dry_density": P(1200, 1900, 1600, sources=SOIL),
        "porosity": P(40.0, 70.0, 50.0, basis="table", sources=FC + ["heath-1983"],
            note="Freeze & Cherry Table 2.4: clay 40-70%. The most porous "
                 "material here and the least permeable, which is the standard "
                 "counter-example to reading permeability off porosity."),
        "hydraulic_conductivity": P(1e-13, 1e-9, 1e-11, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: unweathered marine clay 8e-13 to "
                 "2e-9 m/s. A weathered, fissured clay is orders of magnitude "
                 "higher, and that difference is what makes a clay slope drain "
                 "or not."),
        "specific_yield": P(1, 5, 2, basis="table", sources=["heath-1983"],
            note="Heath (1983): clay, porosity 50%, specific yield 2%, specific "
                 "retention 48% -- it holds almost all of its water."),
        "friction_angle": P(17, 30, 24, sources=SOIL,
            note="Effective peak angle. Total-stress analyses use undrained "
                 "shear strength instead, which is not a friction angle and is "
                 "not carried here."),
        "cohesion": P(0, 0.05, 0.01, sources=SOIL,
            note="Effective cohesion of a normally consolidated clay is near "
                 "zero; an overconsolidated clay shows more, and loses it."),
        "residual_friction_angle": P(6, 20, 12, sources=["skempton-1964",
            "stark-hussain-2013"],
            note="THE NUMBER THAT DECIDES CLAY SLOPE STABILITY. On a slip "
                 "surface the platy minerals align and the angle falls to 6-12 "
                 "degrees in a high-plasticity clay -- a third of peak or less. "
                 "Skempton (1964) established that old slip surfaces in London "
                 "Clay stand at residual and nothing higher."),
        "residual_cohesion": P(0, 0, 0, sources=["skempton-1964"]),
        "poissons_ratio": P(0.30, 0.45, 0.40, sources=SOIL),
    }),
    "till": dict(state="soil", props={
        "dry_density": P(1800, 2300, 2100, sources=SOIL + ["bell-2007"]),
        "porosity": P(10.0, 35.0, 22.0, sources=FC),
        "hydraulic_conductivity": P(1e-12, 2e-6, 1e-9, basis="table", sources=FC,
            note="Freeze & Cherry Table 2.2: glacial till 1e-12 to 2e-6 m/s. "
                 "Six orders of magnitude, and the control is the fissuring and "
                 "sand content, not the name."),
        "specific_yield": P(2, 15, 6, sources=["heath-1983"]),
        "friction_angle": P(28, 40, 33, sources=SOIL + ["bell-2007"]),
        "cohesion": P(0, 0.1, 0.02, sources=SOIL),
        "residual_friction_angle": P(20, 32, 26, sources=SOIL),
        "residual_cohesion": P(0, 0, 0, sources=SOIL),
        "poissons_ratio": P(0.25, 0.40, 0.30, sources=SOIL),
    }),
    "alluvium": dict(state="soil", parent="sand", props={
        "hydraulic_conductivity": P(1e-7, 1e-2, 1e-4, sources=FC,
            note="Alluvium is a setting rather than a material: channel gravels "
                 "and overbank silts sit in the same deposit and differ by five "
                 "orders of magnitude."),
        "friction_angle": P(28, 42, 34, sources=SOIL),
    }),
    "colluvium": dict(state="soil", parent="till", props={
        "friction_angle": P(25, 38, 30, sources=SOIL + SLOPE),
        "residual_friction_angle": P(15, 30, 22, sources=SLOPE,
            note="Colluvium IS former landslide debris on many slopes, so much "
                 "of it is already at or near residual before anything is built "
                 "on it. Treat a colluvial slope as reactivatable by default."),
        "hydraulic_conductivity": P(1e-8, 1e-4, 1e-6, sources=FC),
    }),
    "loess": dict(state="soil", parent="silt", props={
        "dry_density": P(1100, 1600, 1400, sources=SOIL + ["bell-2007"]),
        "porosity": P(40.0, 55.0, 48.0, sources=["bell-2007"]),
        "cohesion": P(0.01, 0.08, 0.03, sources=["bell-2007"],
            note="Apparent cohesion from clay bridges and carbonate cement, and "
                 "it is LOST ON WETTING -- loess collapse is a settlement and "
                 "slope hazard in its own right, not a strength reduction."),
        "friction_angle": P(25, 35, 30, sources=["bell-2007"]),
    }),
    "peat": dict(state="soil", props={
        "dry_density": P(80, 300, 150, sources=SOIL + ["bell-2007"],
            note="An order of magnitude below mineral soil: peat is mostly "
                 "water and organic matter."),
        "porosity": P(70.0, 95.0, 85.0, sources=["bell-2007"]),
        "hydraulic_conductivity": P(1e-9, 1e-4, 1e-6, sources=["bell-2007"],
            note="Falls by orders of magnitude as the peat compresses under "
                 "load, so a value measured before loading is not the value "
                 "during consolidation."),
        "friction_angle": P(20, 40, 30, sources=["bell-2007"],
            note="Fibre reinforcement gives high apparent angles at large "
                 "strain; conventional interpretation is unreliable here."),
        "cohesion": P(0, 0.02, 0.005, sources=["bell-2007"]),
        "residual_friction_angle": P(15, 30, 22, sources=["bell-2007"]),
        "residual_cohesion": P(0, 0, 0, sources=["bell-2007"]),
        "poissons_ratio": P(0.30, 0.50, 0.40, sources=SOIL),
    }),
    "laterite": dict(state="soil", parent="clay", props={
        "dry_density": P(1300, 2000, 1650, sources=["bell-2007"]),
        "friction_angle": P(25, 40, 32, sources=["bell-2007"],
            note="Higher than its clay content suggests, because the iron "
                 "cementation carries load until it is broken down."),
        "hydraulic_conductivity": P(1e-8, 1e-4, 1e-6, sources=["bell-2007"]),
        "residual_friction_angle": P(15, 28, 21, sources=["bell-2007"]),
    }),
    "regolith": dict(state="soil", parent="till", props={
        "hydraulic_conductivity": P(1e-8, 1e-4, 1e-6, sources=FC,
            note="The weathered mantle over bedrock is very often the aquifer "
                 "in crystalline terrain, and very often the landslide "
                 "material too."),
    }),
}

# ---------------------------------------------------------------------------
# INHERITANCE. Every lithology in the dictionary that is not a reference gets
# one, and the rule that gave it is recorded so it can be argued with.
#
# Matched in order: an exact name, then a substring, then the dictionary's own
# (class, type, group), then (class, type), then class. The dictionary's own
# taxonomy doing most of the work is the point -- it is Macrostrat's
# classification, not ours.
# ---------------------------------------------------------------------------
BY_NAME = {
    "gravel": "gravel", "sand": "sand", "silt": "silt", "mud": "clay",
    "clay": "clay", "soil": "regolith", "till": "till", "tillite": "till",
    "diamicton": "till", "diamictite": "conglomerate", "drift": "till",
    "alluvium": "alluvium", "colluvium": "colluvium", "eluvium": "regolith",
    "regolith": "regolith", "paleosol": "clay", "loess": "loess",
    "peat": "peat", "gyttja": "peat", "coal": "coal", "lignite": "coal",
    "anthracite": "coal", "tar": "coal",
    "laterite": "laterite", "bauxite": "laterite",
    "sandstone": "sandstone", "arenite": "sandstone", "arkose": "sandstone",
    "subarkose": "sandstone", "litharenite": "sandstone",
    "sublitharenite": "sandstone", "quartz arenite": "sandstone",
    "greensand": "sandstone", "grit": "sandstone", "wacke": "greywacke",
    "graywacke": "greywacke", "greywacke": "greywacke",
    "siltstone": "siltstone", "mudstone": "mudstone", "claystone": "claystone",
    "shale": "shale", "argillite": "mudstone", "pelite": "mudstone",
    "marl": "marl", "conglomerate": "conglomerate", "breccia": "breccia",
    "siliciclastic": "sandstone", "sedimentary": "sandstone",
    "limestone": "limestone", "lime mudstone": "limestone",
    "dolostone": "dolostone", "dolomite": "dolostone", "ankerite": "dolostone",
    "chalk": "chalk", "travertine": "travertine", "tufa": "travertine",
    "carbonate": "limestone", "micrite": "limestone", "oolite": "limestone",
    "coquina": "limestone", "encrinite": "limestone", "calcarenite": "limestone",
    "calcilutite": "limestone", "calcisiltite": "limestone",
    "mixed carbonate-siliciclastic": "limestone",
    "chert": "chert", "flint": "chert", "novaculite": "chert",
    "porcellanite": "chert", "radiolarite": "chert", "diatomite": "chalk",
    "siliceous ooze": "chalk", "calcareous ooze": "chalk",
    "gypsum": "gypsum", "anhydrite": "anhydrite", "halite": "halite",
    "trona": "halite", "evaporite": "gypsum",
    "phosphorite": "limestone", "ironstone": "sandstone",
    "iron formation": "chert", "siderite": "dolostone",
    "granite": "granite", "leucogranite": "granite",
    "monzogranite": "granite", "syenogranite": "granite", "alaskite": "granite",
    "granodiorite": "granodiorite", "tonalite": "granodiorite",
    "trondhjemite": "granodiorite", "diorite": "diorite",
    "monzonite": "diorite", "quartz monzonite": "granodiorite",
    "syenite": "granite", "charnockite": "granite",
    "gabbro": "gabbro", "norite": "norite", "troctolite": "gabbro",
    "anorthosite": "gabbro", "peridotite": "peridotite", "dunite": "peridotite",
    "harzburgite": "peridotite", "lherzolite": "peridotite",
    "wehrlite": "peridotite", "websterite": "peridotite",
    "pyroxenite": "peridotite", "clinopyroxenite": "peridotite",
    "orthopyroxenite": "peridotite", "hornblendite": "peridotite",
    "picrite": "peridotite", "komatiite": "basalt",
    "dolerite": "dolerite", "diabase": "dolerite", "lamprophyre": "dolerite",
    "pegmatite": "pegmatite", "aplite": "granite", "granophyre": "granite",
    "basalt": "basalt", "spilite": "basalt", "hawaiite": "basalt",
    "mugearite": "basalt", "ankaramite": "basalt", "basanite": "basalt",
    "tephrite": "basalt", "foidite": "basalt", "foidolite": "basalt",
    "benmoreite": "andesite", "andesite": "andesite", "adakite": "andesite",
    "trachyandesite": "andesite", "latite": "andesite",
    "dacite": "dacite", "rhyodacite": "dacite",
    "rhyolite": "rhyolite", "comendite": "rhyolite", "felsite": "rhyolite",
    "trachyte": "rhyolite", "phonolite": "rhyolite",
    "obsidian": "obsidian", "volcanic glass": "obsidian", "pumice": "tuff",
    "scoria": "tuff", "ash": "tuff", "tephra": "tuff", "tuff": "tuff",
    "welded tuff": "tuff", "tuffite": "tuff", "ignimbrite": "tuff",
    "agglomerate": "agglomerate", "hyaloclastite": "tuff",
    "volcaniclastic": "tuff", "bentonite": "clay", "kimberlite": "peridotite",
    "carbonatite": "limestone", "mafite": "gabbro", "mafic": "gabbro",
    "gneiss": "gneiss", "orthogneiss": "gneiss", "paragneiss": "gneiss",
    "granofel": "gneiss", "granulite": "gneiss", "migmatite": "migmatite",
    "diatexite": "migmatite", "schist": "schist", "phyllite": "phyllite",
    "slate": "slate", "phyllonite": "phyllite", "greenschist": "schist",
    "blueschist": "schist", "greenstone": "amphibolite",
    "amphibolite": "amphibolite", "eclogite": "amphibolite",
    "metabasalt": "amphibolite", "metabasite": "amphibolite",
    "metagabbro": "amphibolite", "serpentinite": "serpentinite",
    "quartzite": "quartzite", "metasandstone": "quartzite",
    "marble": "marble", "skarn": "marble", "hornfels": "hornfels",
    "mylonite": "mylonite", "cataclasite": "mylonite",
    "pseudotachylite": "mylonite", "fault breccia": "fault_gouge",
    "fault gouge": "fault_gouge",
    "metapelite": "schist", "metasiltstone": "phyllite",
    "metagraywacke": "quartzite", "metaconglomerate": "quartzite",
    "metarhyolite": "quartzite", "metavolcanic": "amphibolite",
    "metasedimentary": "schist", "metaigneous": "gneiss",
    "metamorphic": "gneiss", "igneous": "granite", "plutonic": "granite",
    "volcanic": "basalt",
}

BY_TYPE = {
    ("sedimentary", "siliciclastic"): "sandstone",
    ("sedimentary", "carbonate"): "limestone",
    ("sedimentary", "evaporite"): "gypsum",
    ("sedimentary", "chemical"): "chert",
    ("sedimentary", "organic"): "coal",
    ("sedimentary", "regolith"): "regolith",
    ("sedimentary", "sedimentary"): "sandstone",
    ("igneous", "plutonic"): "granite",
    ("igneous", "volcanic"): "basalt",
    ("igneous", "igneous"): "granite",
    ("metamorphic", "metamorphic"): "gneiss",
    ("metamorphic", "metasedimentary"): "schist",
    ("metamorphic", "metavolcanic"): "amphibolite",
    ("metamorphic", "metaigneous"): "gneiss",
    ("metamorphic", "cataclastic"): "mylonite",
}

BY_CLASS = {"sedimentary": "sandstone", "igneous": "granite",
            "metamorphic": "gneiss"}


# ---------------------------------------------------------------------------
# ALIASES: the vocabulary the MAP uses that the DICTIONARY does not list.
#
# Coverage here is structural only as far as the dictionary goes, and measured
# against 3,377 distinct `lith` strings from twelve surveys the dictionary's
# 214 names resolve **98.2%** of them. The remaining 1.8% are three kinds of
# thing, and none of them is an error in the compilation:
#
#   ADJECTIVAL FORMS   "granitic rocks", "andesitic rocks", "dioritic-to-
#                      gabbroic rocks" -- the survey naming a composition
#                      rather than a rock.
#   REGIONAL NAMES     `siltite` (264 uses -- a Belt Supergroup term for a
#                      siltstone), `psammite` and `semipelite` (the British
#                      metamorphic vocabulary), `metasandstone`, `calc-silicate`.
#   RARE ROCKS         bronzitite, monzogabbro, leucomonzonite, trachybasalt.
#
# Each maps to the reference whose ENGINEERING BEHAVIOUR it shares, which is a
# different judgement from what it is petrologically -- a psammite is filed
# under quartzite because that is how it behaves in a slope, not because the
# two are the same rock. Where the two readings would differ the note says so.
#
# Deliberately NOT aliased: "ice, snow", "mainly blocks (landslide)". Neither
# is bedrock, and giving a landslide deposit a rock's strength is the single
# worst answer this database could give.
# ---------------------------------------------------------------------------
ALIASES = {
    # British and regional metamorphic vocabulary.
    "psammite": "quartzite",
    "metapsammite": "quartzite",
    "semipelite": "schist",
    "metasandstone": "quartzite",
    "metasiltstone": "phyllite",
    "calc-silicate": "hornfels",
    "calcsilicate": "hornfels",
    "granofels": "gneiss",
    "metabasite": "amphibolite",
    "metasediment": "schist",
    "orthoquartzite": "quartzite",
    "metaquartzite": "quartzite",
    # Belt Supergroup and other regional sedimentary terms.
    "siltite": "siltstone",
    "argillite": "mudstone",
    "dolomudstone": "dolostone",
    "mudrock": "mudstone",
    "turbidite": "greywacke",
    "megabreccia": "breccia",
    "jasperoid": "chert",
    "pebble": "conglomerate",
    # Compositional adjectives -- a survey naming what a rock is made of.
    "granitic": "granite",
    "granodioritic": "granodiorite",
    "dioritic": "diorite",
    "gabbroic": "gabbro",
    "basaltic": "basalt",
    "andesitic": "andesite",
    "rhyolitic": "rhyolite",
    "dacitic": "dacite",
    "doleritic": "dolerite",
    "ultramafic": "peridotite",
    "mafic": "gabbro",
    "felsic": "granite",
    "tuffaceous": "tuff",
    "volcaniclastic": "tuff",
    "pyroclastic": "tuff",
    "cataclastic": "mylonite",
    "quartzitic": "quartzite",
    "cherty": "chert",
    "conglomeratic": "conglomerate",
    "arenaceous": "sandstone",
    "argillaceous": "mudstone",
    "calcareous": "limestone",
    "dolomitic": "dolostone",
    "carbonaceous": "coal",
    "siliciclastic": "sandstone",
    # Rare igneous rocks the dictionary does not name.
    "monzogabbro": "gabbro",
    "leucomonzonite": "granite",
    "monzodiorite": "diorite",
    "bronzitite": "peridotite",
    "trachybasalt": "basalt",
    "olivine trachybasalt": "basalt",
    "alkalic intrusive": "granite",
    "porphyry": "dolerite",
    "lapilli": "tuff",
    "ash-flow": "tuff",
    # The last of the tail, measured: these are the only remaining terms in
    # 11,000 map units that name a rock and had no home.
    "granitoid": "granite",
    "metagranitoid": "gneiss",
    "metadiorite": "amphibolite",
    "metaperidotite": "serpentinite",
    "nephelinite": "basalt",
    "ultra-basite": "peridotite",
    "ultrabasite": "peridotite",
    # "basic" in the older usage means mafic, and "basic dikes" is the string
    # it appears in. Not "basement", which the word boundary already excludes.
    "basic": "dolerite",
}

def load_dictionary():
    """Macrostrat's own lithology dictionary, cached so a re-bake is offline."""
    if os.path.exists(DICT_CACHE):
        with open(DICT_CACHE) as fh:
            return json.load(fh)
    req = urllib.request.Request(DICT_URL, headers={"User-Agent": "GeoID/1.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    rows = body["success"]["data"]
    with open(DICT_CACHE, "w") as fh:
        json.dump(rows, fh)
    return rows


def reference_for(entry):
    """Which reference lithology answers for this one, and by what rule."""
    name = entry["name"].strip().lower()
    if name in REFERENCE:
        return name, "itself"
    if name in BY_NAME:
        return BY_NAME[name], f"named mapping: {name} -> {BY_NAME[name]}"
    # A compound name carrying a known one ("welded tuff", "quartz monzonite").
    for key in sorted(BY_NAME, key=len, reverse=True):
        if key in name:
            return BY_NAME[key], f"name contains '{key}'"
    cls, typ = entry["class"], entry["type"]
    if (cls, typ) in BY_TYPE:
        return BY_TYPE[(cls, typ)], f"Macrostrat class/type: {cls}/{typ}"
    if cls in BY_CLASS:
        return BY_CLASS[cls], f"Macrostrat class: {cls}"
    return None, "no rule"


def resolve_props(ref_name):
    """A reference's own values, over its parent's, over nothing."""
    ref = REFERENCE[ref_name]
    props = {}
    parent = ref.get("parent")
    if parent:
        props.update({k: dict(v) for k, v in resolve_props(parent).items()})
        for value in props.values():
            value["basis"] = "inherited"
            value["inherited_from"] = parent
    for key, value in ref["props"].items():
        props[key] = dict(value)
    return props


def main():
    rows = load_dictionary()
    lithologies = {}
    unresolved = []
    for entry in rows:
        ref_name, rule = reference_for(entry)
        if not ref_name:
            unresolved.append(entry["name"])
            continue
        record = {
            "name": entry["name"],
            "class": entry["class"],
            "type": entry["type"],
            "group": entry["group"] or None,
            "lith_id": entry["lith_id"],
            "macrostrat_colour": entry["color"],
            "reference": ref_name,
            "state": REFERENCE[ref_name]["state"],
        }
        if ref_name != entry["name"].strip().lower():
            record["inherited_via"] = rule
        lithologies[entry["name"].strip().lower()] = record

    references = {}
    for name in REFERENCE:
        references[name] = {
            "state": REFERENCE[name]["state"],
            "parent": REFERENCE[name].get("parent"),
            "properties": resolve_props(name),
        }

    out = {
        "$comment": "Generated by GeoID_GIS/services/bake-rock-properties.py. "
                    "Do not hand-edit: edit the baker and re-run it.",
        "version": 1,
        "vocabulary": {
            "name": "Macrostrat lithology dictionary",
            "url": DICT_URL,
            "count": len(rows),
            "note": "Every free-text `lith` string on the world geology layer is "
                    "built from these names, so covering them covers the map at "
                    "every zoom and in every survey the compilation composites.",
        },
        "warning": {
            "headline": "Published ranges for a rock NAME, not measurements of "
                        "your site.",
            "intact_vs_mass": "UCS, modulus and friction are INTACT-specimen "
                              "values. A slope fails through the rock mass, "
                              "whose strength is one to two orders of magnitude "
                              "lower; use hoek_brown_mi with a field GSI to get "
                              "there.",
            "matrix_vs_formation": "hydraulic_conductivity is the formation "
                                   "value including fractures; "
                                   "matrix_hydraulic_conductivity is the intact "
                                   "core. For crystalline rock they differ by "
                                   "seven orders of magnitude.",
            "residual": "residual_* is the strength AFTER failure, on a surface "
                        "that has already slipped. It governs reactivated "
                        "landslides and is a fraction of peak in clay-rich "
                        "materials.",
            "use": "A prior for screening and regional modelling. Replace with "
                   "site investigation before any design.",
        },
        "bibliography": BIBLIOGRAPHY,
        "parameters": PARAMETERS,
        "references": references,
        "lithologies": lithologies,
        "aliases": {term: {"reference": ref, "state": REFERENCE[ref]["state"]}
                    for term, ref in ALIASES.items() if ref in REFERENCE},
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=False)
        fh.write("\n")

    bad_alias = [t for t, r in ALIASES.items() if r not in REFERENCE]
    if bad_alias:
        print(f"BAD ALIAS TARGETS: {', '.join(bad_alias)}")
    covered = len(lithologies)
    own = sum(1 for v in lithologies.values() if "inherited_via" not in v)
    print(f"dictionary        {len(rows)}")
    print(f"covered           {covered} ({100 * covered / len(rows):.1f}%)")
    print(f"reference bodies  {len(references)}")
    print(f"named directly    {own}")
    print(f"inherited         {covered - own}")
    if unresolved:
        print(f"UNRESOLVED        {len(unresolved)}: {', '.join(unresolved)}")
    size = os.path.getsize(OUT)
    print(f"aliases           {len(ALIASES)}")
    print(f"written           {OUT} ({size / 1024:.0f} KB)")
    return 1 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main())
