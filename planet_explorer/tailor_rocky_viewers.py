#!/usr/bin/env python3
"""
tailor_rocky_viewers.py  —  Tailor copied mars-viewer/manifest/index files
for Mercury, Venus, and Earth.

Usage:  python3 tailor_rocky_viewers.py
Outputs: {planet}/viewer/{planet}-viewer.js
         {planet}/viewer/{planet}-manifest.js
         {planet}/viewer/index.html  (patched in-place)
         earth/viewer/assets/manifest.json  (created for Earth)
"""

import csv
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Per-planet data
# ---------------------------------------------------------------------------

EARTH_LABEL_DATA = r"""[{"name":"Mount Everest","type":"Mountain summit","lat":27.9881,"lon":86.925,"theme":"standard","description":"Highest point above sea level on Earth, located in the central Himalaya. Built by the ongoing India-Eurasia collision, the summit sits in the jet stream and experiences some of the most extreme weather on the planet.","elevation_m":8849},{"name":"K2","type":"Mountain summit","lat":35.8811,"lon":76.5151,"theme":"standard","description":"Second highest peak on Earth, on the China-Pakistan border in the Karakoram range. Notorious for its technical difficulty and high fatality rate among climbers.","elevation_m":8611},{"name":"Mariana Trench","type":"Ocean trench","lat":11.35,"lon":142.2,"theme":"standard","description":"Deepest known point on Earth, the Challenger Deep reaches approximately 10,930 m below sea level. Formed by Pacific oceanic crust subducting beneath the Mariana plate.","elevation_m":-10930},{"name":"Pacific Ocean","type":"Ocean basin","lat":0,"lon":210,"theme":"standard","description":"Largest ocean basin on Earth, covering more area than all land combined. Bounded by subduction zones around its rim and spreading centres across its floor.","elevation_m":-4500},{"name":"Atlantic Ocean","type":"Ocean basin","lat":5,"lon":330,"theme":"standard","description":"Ocean basin defined by the Mid-Atlantic Ridge at its centre and passive continental margins on either side. Formed by the breakup of Pangaea around 200 Ma.","elevation_m":-3500},{"name":"Indian Ocean","type":"Ocean basin","lat":-20,"lon":80,"theme":"standard","description":"Third largest ocean basin, bordered by Africa, Asia, and Australia. The northern basin is landlocked and receives monsoon-driven freshwater inputs.","elevation_m":-3900},{"name":"Arctic Ocean","type":"Ocean basin","lat":85,"lon":0,"theme":"standard","description":"Smallest and shallowest of Earth's ocean basins, mostly covered by sea ice. The Arctic is warming at roughly four times the global average rate.","elevation_m":-1200},{"name":"Southern Ocean","type":"Ocean basin","lat":-65,"lon":180,"theme":"standard","description":"Circumpolar ocean surrounding Antarctica. Defined by the Antarctic Circumpolar Current, it connects all other ocean basins and drives deep global thermohaline circulation.","elevation_m":-4000},{"name":"Himalaya","type":"Mountain belt","lat":28,"lon":86,"theme":"standard","description":"Major continental collision belt formed by the ongoing convergence of the Indian and Eurasian plates. Home to all fourteen 8,000-metre peaks on Earth.","elevation_m":5000},{"name":"Andes","type":"Mountain belt","lat":-22,"lon":291,"theme":"volcanic","description":"Long volcanic and tectonic arc along western South America, formed by subduction of the Nazca plate. The longest continental mountain range on Earth.","elevation_m":4000},{"name":"Alps","type":"Mountain belt","lat":46.5,"lon":9.5,"theme":"standard","description":"European mountain belt formed by collision of the African and Eurasian plates. Glaciated during the Pleistocene, the Alps radiate major river systems northward and southward.","elevation_m":3000},{"name":"Rocky Mountains","type":"Mountain belt","lat":45,"lon":249,"theme":"standard","description":"Broad cordilleran belt along western North America formed by multiple accretionary episodes. The Continental Divide separates Pacific and Atlantic drainage.","elevation_m":2500},{"name":"Amazon Basin","type":"Lowland basin","lat":-3,"lon":300,"theme":"standard","description":"Largest river basin and tropical rainforest on Earth. The Amazon River discharges roughly 20% of global freshwater river runoff into the Atlantic.","elevation_m":100},{"name":"Congo Basin","type":"Lowland basin","lat":-2,"lon":23,"theme":"standard","description":"Second largest tropical rainforest basin, centred on the Congo River drainage in central Africa. Underlain by a thick sedimentary record of central African geological history.","elevation_m":350},{"name":"Sahara","type":"Desert plateau","lat":23,"lon":15,"theme":"standard","description":"Largest hot desert on Earth, spanning most of North Africa. The Sahara oscillates between dry and wet phases driven by orbital forcing over 100,000-year cycles.","elevation_m":450},{"name":"Antarctic Ice Sheet","type":"Ice sheet","lat":-82,"lon":0,"theme":"standard","description":"Largest ice sheet on Earth, storing approximately 26.5 million km³ of ice. Full melting would raise sea level by roughly 58 metres.","elevation_m":2300},{"name":"Greenland Ice Sheet","type":"Ice sheet","lat":72,"lon":320,"theme":"standard","description":"Second largest ice sheet on Earth, covering most of Greenland. Rapid melt is contributing significantly to current sea-level rise.","elevation_m":2500},{"name":"Mid-Atlantic Ridge","type":"Spreading ridge","lat":0,"lon":335,"theme":"volcanic","description":"Divergent plate boundary and volcanic ridge running the full length of the Atlantic Ocean. Separates the North and South American plates from the Eurasian and African plates.","elevation_m":-2500},{"name":"East Pacific Rise","type":"Spreading ridge","lat":-15,"lon":250,"theme":"volcanic","description":"Fast-spreading mid-ocean ridge in the eastern Pacific, diverging at up to 150 mm/yr. A major source of oceanic crust and hydrothermal vent activity.","elevation_m":-2600},{"name":"Great Rift Valley","type":"Rift zone","lat":2,"lon":37,"theme":"volcanic","description":"Active continental rift system extending from the Afar Triple Junction south through Tanzania. The East African Rift is actively splitting Africa apart.","elevation_m":800},{"name":"Mauna Loa","type":"Shield volcano","lat":19.4756,"lon":204.254,"theme":"volcanic","description":"One of Earth's largest active shield volcanoes, built above the Hawaiian hotspot. Together with neighbouring Mauna Kea, forms the largest volcanic mountain on Earth by volume.","elevation_m":4169},{"name":"Mauna Kea","type":"Shield volcano","lat":19.821,"lon":204.481,"theme":"volcanic","description":"Tallest mountain on Earth measured from its oceanic base. Home to major astronomical observatories exploiting its exceptional atmospheric clarity.","elevation_m":4205},{"name":"Mount Etna","type":"Stratovolcano","lat":37.751,"lon":14.9934,"theme":"volcanic","description":"Most active volcano in Europe and one of the most continuously erupting volcanoes in the world. Built above the subducting African slab and the Malta Escarpment.","elevation_m":3357},{"name":"Mount Fuji","type":"Stratovolcano","lat":35.3606,"lon":138.7274,"theme":"volcanic","description":"Iconic stratovolcano and highest peak in Japan. Last erupted in 1707, Fuji is considered an active volcano with ongoing geothermal activity.","elevation_m":3776},{"name":"Kilauea","type":"Shield volcano","lat":19.421,"lon":204.622,"theme":"volcanic","description":"One of the world's most active volcanoes on the flanks of Mauna Loa in Hawaii. Continuously erupting with effusive lava flows since 1983.","elevation_m":1247},{"name":"Piton de la Fournaise","type":"Shield volcano","lat":-21.244,"lon":55.708,"theme":"volcanic","description":"One of Earth's most active volcanoes on Réunion Island in the Indian Ocean. A hotspot shield volcano erupting multiple times per year.","elevation_m":2632},{"name":"Popocatépetl","type":"Stratovolcano","lat":19.023,"lon":261.427,"theme":"volcanic","description":"Most active volcano in Mexico. Its persistent eruptive activity poses risk to over 25 million people in central Mexico.","elevation_m":5426},{"name":"Yellowstone Caldera","type":"Supervolcano","lat":44.43,"lon":249.55,"theme":"volcanic","description":"Active supervolcanic system above the Yellowstone hotspot. The last major eruption 640,000 years ago ejected roughly 1,000 km³ of material.","elevation_m":2440},{"name":"Iceland","type":"Volcanic island","lat":65,"lon":342,"theme":"volcanic","description":"Island built on the Mid-Atlantic Ridge and above the Iceland hotspot. One of the most volcanically productive regions on Earth per unit area.","elevation_m":400},{"name":"Grand Canyon","type":"Erosional canyon","lat":36.1069,"lon":247.5,"theme":"standard","description":"Iconic erosional gorge carved by the Colorado River in Arizona through nearly 2 billion years of sedimentary and crystalline rock.","elevation_m":800},{"name":"Nile River Basin","type":"River basin","lat":20,"lon":32,"theme":"standard","description":"Largest river basin in Africa and home to the world's longest river. The Nile flows northward through desert terrain before emptying into the Mediterranean.","elevation_m":200},{"name":"Mississippi River Basin","type":"River basin","lat":40,"lon":270,"theme":"standard","description":"Third largest drainage basin on Earth, covering much of central North America. The river drains to the Gulf of Mexico and distributes major sediment loads.","elevation_m":150},{"name":"Challenger Deep","type":"Ocean trench","lat":11.3733,"lon":142.5917,"theme":"standard","description":"The deepest known point on Earth, located in the southern Mariana Trench. Reaches approximately 10,935 m below sea level.","elevation_m":-10935},{"name":"Philippine Trench","type":"Ocean trench","lat":9.8,"lon":126.6,"theme":"standard","description":"Second deepest trench on Earth, formed by subduction of the Philippine Sea plate beneath the Philippine plate.","elevation_m":-10540},{"name":"Tonga Trench","type":"Ocean trench","lat":-23,"lon":186,"theme":"standard","description":"Among the deepest oceanic trenches on Earth, site of the fastest-subducting plate boundary. The Tonga-Kermadec zone has the highest rate of seismicity in the world.","elevation_m":-10882},{"name":"North Atlantic Hurricane Belt","type":"Storm corridor","lat":18,"lon":310,"theme":"storm","description":"Primary track for Atlantic tropical cyclones and hurricanes. Storms develop over warm tropical Atlantic water and track northwestward before curving northeast.","elevation_m":0},{"name":"Intertropical Convergence Zone","type":"Storm belt","lat":5,"lon":150,"theme":"storm","description":"Persistent low-latitude belt of ascending air, deep convection, and heavy rainfall. Migrates north and south with the seasons, driving monsoonal precipitation.","elevation_m":0},{"name":"Southern Ocean Storm Track","type":"Storm belt","lat":-52,"lon":60,"theme":"storm","description":"Circumpolar belt of intense westerly winds and frequent extratropical cyclone development. The most consistently stormy region on Earth.","elevation_m":0},{"name":"Bay of Bengal Cyclone Track","type":"Storm corridor","lat":15,"lon":90,"theme":"storm","description":"High-frequency cyclone development zone over the Bay of Bengal, affecting densely populated coastal areas of South Asia each monsoon season.","elevation_m":0},{"name":"Kennedy Space Center","type":"Launch site","lat":28.5729,"lon":279.6459,"theme":"landing","description":"Primary NASA launch facility on the Atlantic coast of Florida. Home to Apollo, Space Shuttle, and current Commercial Crew launches.","elevation_m":3},{"name":"Baikonur Cosmodrome","type":"Launch site","lat":45.92,"lon":63.342,"theme":"landing","description":"Oldest and largest operational space launch facility in the world, in Kazakhstan. Used for Sputnik, Vostok, Soyuz, and Proton launches.","elevation_m":90},{"name":"Guiana Space Centre","type":"Launch site","lat":5.239,"lon":307.772,"theme":"landing","description":"European Space Agency primary launch site near Kourou in French Guiana. Near-equatorial location provides significant launch performance advantage.","elevation_m":10},{"name":"Jiuquan Satellite Launch Centre","type":"Launch site","lat":40.9608,"lon":100.2981,"theme":"landing","description":"China's oldest space launch facility in the Gobi Desert, used for crewed Shenzhou missions and key satellite launches.","elevation_m":1000},{"name":"Satish Dhawan Space Centre","type":"Launch site","lat":13.7199,"lon":80.2304,"theme":"landing","description":"India's primary launch site on Sriharikota Island in the Bay of Bengal. Home of ISRO's PSLV and GSLV launchers.","elevation_m":5}]"""

EARTH_MOON_DATA = r"""[{"name":"Moon","type":"Major moon","theme":"moon","description":"Earth's only natural satellite, a geochemically differentiated body with a solid iron inner core, a partially molten outer core, a thick silicate mantle, and a highland anorthosite and mare basalt crust. Formed ~4.5 Ga from debris ejected by a giant impact between Earth and a Mars-sized protoplanet called Theia.","moon_anchor":[13.6,0,0],"moon_radius":0.24,"moon_label_lift":0.18,"moon_color":"#d8d4cd","mean_radius_km":"~1,737 km","orbit_distance_km":"~384,400 km","orbit_period_days":27.32,"texture_source_url":null}]"""

EARTH_MOON_ECCENTRICITY = """Object.freeze({
      Moon: 0.0549,
    })"""

# EARTH_MOON_FEATURE_DATA is built at run-time from the CSV in build_earth_moon_feature_data().
# IAU type string  →  viewer type label
_MOON_TYPE_MAP = {
    "Crater, craters":            "Impact crater",
    "Mare, maria":                "Lunar mare",
    "Lacus, lacūs":               "Lacus",
    "Sinus, sinūs":               "Sinus",
    "Palus, paludes":             "Palus",
    "Mons, montes":               "Mons",
    "Rima, rimae":                "Rima",
    "Dorsum, dorsa":              "Dorsum",
    "Rupes, rupēs":               "Rupes",
    "Catena, catenae":            "Catena",
    "Vallis, valles":             "Vallis",
    "Promontorium, promontoria":  "Promontorium",
    "Statio":                     "Landing site",
    "Astronaut-named features":   "Astronaut-named",
    "Satellite Feature":          "Satellite feature",
}

def build_earth_moon_feature_data():
    """Read moon_location_labels/moon.csv and return the JS-array string for moonFeatureData.

    Coordinate convention (matches annotated-map procedure):
      - CSV stores IAU signed east-positive lon_e (−180 to +180°E).
      - Viewer stores west-positive lon_w = (−lon_e) % 360, because
        moonDataLonToSceneLon(lon_w) = 360 − lon_w restores the east-positive
        scene lon used by the Three.js renderer.
    """
    csv_path = os.path.join(BASE, "earth", "viewer", "moon_location_labels", "moon.csv")
    features = []
    with open(csv_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            row = {" ".join(k.split()): v.strip() for k, v in row.items()}
            feat_type_raw = row.get("Feature Type", "")
            # Skip satellite sub-features (e.g. "Abbe H", "Tycho A")
            if feat_type_raw == "Satellite Feature":
                continue
            try:
                lat   = float(row["Center Latitude"])
                lon_e = float(row["Center Longitude"])
                diam  = float(row["Diameter"])
            except (ValueError, KeyError):
                continue
            lon_w = (-lon_e) % 360.0
            feat_type = _MOON_TYPE_MAP.get(feat_type_raw, feat_type_raw)
            dim_str = f"{diam:.1f} km" if diam > 0 else ""
            origin  = row.get("Origin", "").replace('"', '\\"').strip(";").strip()
            features.append({
                "name":        row["Feature Name"],
                "type":        feat_type,
                "moon_name":   "Moon",
                "lat":         round(lat,   2),
                "lon":         round(lon_w, 2),
                "description": origin,
                "dimension":   dim_str,
                "theme":       "moon",
            })
    return json.dumps(features, separators=(",", ":"))


EARTH_MOON_FEATURE_DATA = None   # populated in main() after CSV is available

PLANETS = {
    "mercury": {
        "planet_upper": "MERCURY",
        "planet_cap":   "Mercury",
        # Physical constants
        "mean_radius_km":  2439.7,
        "radius_meters":   2439700,
        "rot_real_expr":   "58.6462 * 24 * 3600000",
        "rot_comment":     "Mercury sidereal rotation period: 58.646 Earth days",
        "axial_tilt_deg":  0.034,
        # Interior structure (fraction of radius, rFrac 0=centre, 1=surface)
        "interior_layers": [
            {"name": "Inner Core",  "rMin": 0.000, "rMax": 0.600},
            {"name": "Outer Core",  "rMin": 0.600, "rMax": 0.830},
            {"name": "Mantle",      "rMin": 0.830, "rMax": 0.998},
            {"name": "Crust",       "rMin": 0.998, "rMax": 1.000},
        ],
        "interior_t_pts": [[0.000, 1800], [0.600, 1600], [0.830, 1300], [0.998, 200], [1.000, 170]],
        "interior_p_pts": [[0.000, 36.0], [0.600, 30.0], [0.830, 11.0], [0.998, 0.2], [1.000, 0.0]],
        "interior_layer_colors": {
            "Crust":      "#c8a070",
            "Mantle":     "#a06040",
            "Outer Core": "#e06020",
            "Inner Core": "#f0d090",
        },
        "inner_core_r": 0.600,
        "outer_core_r": 0.830,
        "mantle_r":     0.998,
        "inner_core_comment": "solid iron inner core (~1450 km, MESSENGER/BepiColombo estimates)",
        "outer_core_comment": "liquid iron-sulfide outer core (~2020 km outer boundary)",
        "mantle_comment":     "silicate mantle, near-crust boundary",
        # Data arrays
        "label_data":          "[]",
        "ring_label_data":     "[]",
        "moon_data":           "[]",
        "moon_orbit_eccentricity": "Object.freeze({})",
        "moon_feature_data":   "[]",
        "moon_viewer_textures_js": "{}",
        # UI strings
        "icon_src":            "../../../assets/mercury_icon.png",
        "preload_texture":     "assets/mercury_color.jpg",
        "preload_elev":        "assets/mercury_elevation.png",
        "preload_geology":     "assets/mercury_geology_sim3292.png",
        "viewer_info":         "Drag to orbit, scroll to zoom, and inspect Mercury as a textured 3D globe with topographic relief and an optional enhanced-color geology context overlay.",
        "audio_hidden":        True,
        "audio_label":         "Mercury audio unavailable",
        "audio_src":           "",
        "moon_viewer_copy":    "Mercury has no natural satellites.",
        "core_section_copy":   "Interior cutaway of Mercury.",
        "core_legend_html": """\
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#c8a882"></span>
                <div>
                  <div class="core-legend-label">Crust</div>
                  <div class="core-legend-copy">Thin silicate shell, ~20–30 km thick, rich in volcanic plains from ancient effusive activity.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#8c5030"></span>
                <div>
                  <div class="core-legend-label">Mantle</div>
                  <div class="core-legend-copy">Relatively thin silicate mantle, ~400 km thick, underlain by the enormous iron core.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#d04010"></span>
                <div>
                  <div class="core-legend-label">Outer Core</div>
                  <div class="core-legend-copy">Thin liquid iron-sulfide shell responsible for Mercury's surprisingly strong magnetic field.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#f0d090"></span>
                <div>
                  <div class="core-legend-label">Inner Core</div>
                  <div class="core-legend-copy">Enormous solid iron inner core, comprising ~85% of Mercury's radius — the largest proportional core of any planet.</div>
                </div>
              </div>""",
        "help_kicker":  "GeoID Mercury Guide",
        "help_title":   "Using The Mercury Explorer",
        "help_viewer_info": "The left panel runs from navigation to interpretation. <strong>Navigate</strong> holds search and reset. <strong>Tour Mode</strong> steps through curated stop sequences. <strong>Locations</strong> controls surface labels and mission markers by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and terrain displacement. <strong>Geology</strong> overlays the MESSENGER-derived enhanced-color context and structural data. The science panels below add mineral, thermal, modelled environment, sea level, and region-mask layers. The bottom-right HUD shows live cursor latitude, longitude, elevation, and map scale.",
        "help_datasets": """\
            <article class="viewer-help-card">
              <h4>Global basemaps</h4>
              <p>MESSENGER MD3 false-color mosaic, monochrome 750 nm mosaic, enhanced-color compositional mosaic, derived hillshade, and derived slope.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Science rasters</h4>
              <p>MESSENGER MDIS global mosaic products emphasising compositional and albedo differences across the surface.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Geology</h4>
              <p>Enhanced-color compositional context overlay derived from MESSENGER global products with interactive feature annotations.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Interior cutaway</h4>
              <p>Cross-section model of Mercury's interior based on MESSENGER and BepiColombo gravity and magnetic field data, showing the enormous iron core.</p>
            </article>""",
        "help_workflow": "Start with the MD3 color or enhanced-color mosaic for visual context. Add terrain relief to read crater depth and scarp height. Enable geology to identify compositional units, then compare MESSENGER raster products to investigate mineralogy or surface evolution. For final interpretation, treat each layer as one line of evidence rather than a definitive answer.",
        "help_moon_section": "",  # no moon section for Mercury
        "about_intro": "Mercury is the innermost and smallest planet in the Solar System — a heavily cratered, airless world with an enormous iron core that makes up roughly 85% of its radius. Its proximity to the Sun drives extreme temperature swings: surface temperatures range from −180°C on the night side to over 430°C in direct sunlight. Despite its small size, Mercury generates a weak but measurable global magnetic field, the only terrestrial planet other than Earth to do so. Its surface is dominated by ancient impact craters, smooth volcanic plains, and a network of large thrust scarps called rupes, which formed as the planet cooled and contracted over billions of years.",
        # Fallback version string for boot script
        "boot_version": "20260508-mercury",
    },

    "venus": {
        "planet_upper": "VENUS",
        "planet_cap":   "Venus",
        "mean_radius_km":  6051.8,
        "radius_meters":   6051800,
        "rot_real_expr":   "243.018 * 24 * 3600000",
        "rot_comment":     "Venus sidereal rotation period: 243.018 Earth days (retrograde)",
        "axial_tilt_deg":  177.36,
        "interior_layers": [
            {"name": "Inner Core",  "rMin": 0.000, "rMax": 0.270},
            {"name": "Outer Core",  "rMin": 0.270, "rMax": 0.520},
            {"name": "Mantle",      "rMin": 0.520, "rMax": 0.993},
            {"name": "Crust",       "rMin": 0.993, "rMax": 1.000},
        ],
        "interior_t_pts": [[0.000, 5000], [0.270, 4500], [0.520, 3000], [0.993, 460], [1.000, 460]],
        "interior_p_pts": [[0.000, 300.0], [0.270, 260.0], [0.520, 120.0], [0.993, 9.2], [1.000, 0.0]],
        "interior_layer_colors": {
            "Crust":      "#d4b070",
            "Mantle":     "#c08040",
            "Outer Core": "#e07030",
            "Inner Core": "#f5d8a0",
        },
        "inner_core_r": 0.270,
        "outer_core_r": 0.520,
        "mantle_r":     0.993,
        "inner_core_comment": "possible solid iron inner core (~1630 km radius, unconstrained)",
        "outer_core_comment": "liquid iron-sulfide outer core (~3145 km outer boundary, model-dependent)",
        "mantle_comment":     "silicate mantle, near-crust boundary",
        "label_data":          "[]",
        "ring_label_data":     "[]",
        "moon_data":           "[]",
        "moon_orbit_eccentricity": "Object.freeze({})",
        "moon_feature_data":   "[]",
        "moon_viewer_textures_js": "{}",
        "icon_src":            "../../../assets/venus_icon.png",
        "preload_texture":     "assets/venus_color.jpg",
        "preload_elev":        "assets/venus_elevation.png",
        "preload_geology":     "assets/venus_geology_sim3292.png",
        "viewer_info":         "Drag to orbit, scroll to zoom, and inspect Venus as a textured 3D globe with Magellan radar-derived topographic relief and a colorized topography geology context overlay.",
        "audio_hidden":        True,
        "audio_label":         "Venus audio unavailable",
        "audio_src":           "",
        "moon_viewer_copy":    "Venus has no natural satellites.",
        "core_section_copy":   "Interior cutaway of Venus.",
        "core_legend_html": """\
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#c8a882"></span>
                <div>
                  <div class="core-legend-label">Crust</div>
                  <div class="core-legend-copy">Basaltic crust, ~10–30 km thick, reshaped by widespread volcanic activity relatively recently in geologic history.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#8c5030"></span>
                <div>
                  <div class="core-legend-label">Mantle</div>
                  <div class="core-legend-label">Silicate mantle making up most of the planet's volume. Evidence for active or recent volcanism suggests the mantle is still convecting.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#d94f1e"></span>
                <div>
                  <div class="core-legend-label">Outer Core</div>
                  <div class="core-legend-copy">Liquid iron-nickel core; Venus has no detectable magnetic field, possibly due to its slow rotation preventing a self-sustaining dynamo.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#f0d59e"></span>
                <div>
                  <div class="core-legend-label">Inner Core</div>
                  <div class="core-legend-copy">Possible solid iron inner core; poorly constrained due to lack of seismic data from the surface.</div>
                </div>
              </div>""",
        "help_kicker":  "GeoID Venus Guide",
        "help_title":   "Using The Venus Explorer",
        "help_viewer_info": "The left panel runs from navigation to interpretation. <strong>Navigate</strong> holds search and reset. <strong>Tour Mode</strong> steps through curated stop sequences. <strong>Locations</strong> controls surface labels and mission markers by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and terrain displacement. <strong>Geology</strong> overlays the Magellan-derived topographic context and structural data. The science panels below add mineral, thermal, modelled environment, sea level, and region-mask layers. The bottom-right HUD shows live cursor latitude, longitude, elevation, and map scale.",
        "help_datasets": """\
            <article class="viewer-help-card">
              <h4>Global basemaps</h4>
              <p>Magellan synthetic-color colorized topography mosaic, global radar backscatter mosaic, emissivity mosaic, derived hillshade, and derived slope.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Science rasters</h4>
              <p>Magellan Fresnel reflectivity and microwave emissivity global products revealing surface material properties beneath the dense atmosphere.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Geology</h4>
              <p>Colorized topographic context overlay derived from Magellan global products with interactive feature annotations.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Interior cutaway</h4>
              <p>Cross-section model of Venus's interior, poorly constrained in the absence of seismic data, based on comparison with Earth and geophysical modelling.</p>
            </article>""",
        "help_workflow": "Start with the colorized topography or radar backscatter for surface context. Add terrain relief to read highland elevation and basin depth. Enable geology to identify major topographic provinces, then compare radar and emissivity products for surface material variations. For final interpretation, treat each layer as one line of evidence rather than a definitive answer.",
        "help_moon_section": "",
        "about_intro": "Venus is the second planet from the Sun and the closest in size to Earth, yet its surface environment is among the most hostile in the Solar System. A thick carbon dioxide atmosphere creates a runaway greenhouse effect, driving surface temperatures to around 465°C — hot enough to melt lead. Atmospheric pressure at the surface is about 92 times that of Earth. Most of what we know about Venus's surface comes from the Magellan radar mapper (1990–1994), which revealed a landscape dominated by volcanic plains, highland continents like Ishtar Terra and Aphrodite Terra, and thousands of volcanoes. Venus rotates extremely slowly and in the retrograde direction, completing one rotation every 243 Earth days while orbiting the Sun in just 225 days.",
        "boot_version": "20260508-venus",
    },

    "earth": {
        "planet_upper": "EARTH",
        "planet_cap":   "Earth",
        "mean_radius_km":  6371.0,
        "radius_meters":   6371000,
        "rot_real_expr":   "23.9345 * 3600000",
        "rot_comment":     "Earth sidereal rotation period: 23.9345 h",
        "axial_tilt_deg":  23.44,
        "interior_layers": [
            {"name": "Inner Core", "rMin": 0.000, "rMax": 0.192},
            {"name": "Outer Core", "rMin": 0.192, "rMax": 0.547},
            {"name": "Mantle",     "rMin": 0.547, "rMax": 0.995},
            {"name": "Crust",      "rMin": 0.995, "rMax": 1.000},
        ],
        "interior_t_pts": [[0.000, 5000], [0.192, 5000], [0.547, 3700], [0.995, 400], [1.000, 15]],
        "interior_p_pts": [[0.000, 360.0], [0.192, 330.0], [0.547, 135.0], [0.995, 0.4], [1.000, 0.0]],
        "interior_layer_colors": {
            "Crust":      "#d8704b",
            "Mantle":     "#b55d34",
            "Outer Core": "#f0a060",
            "Inner Core": "#f0d59e",
        },
        "inner_core_r": 0.192,
        "outer_core_r": 0.547,
        "mantle_r":     0.995,
        "inner_core_comment": "solid inner core (ICB at 1,220 km)",
        "outer_core_comment": "liquid outer core (CMB at 2,890 km)",
        "mantle_comment":     "mantle, near-crust boundary",
        "label_data":          EARTH_LABEL_DATA,
        "ring_label_data":     "[]",
        "moon_data":           EARTH_MOON_DATA,
        "moon_orbit_eccentricity": EARTH_MOON_ECCENTRICITY,
        "moon_feature_data":   EARTH_MOON_FEATURE_DATA,
        "moon_viewer_textures_js": '"Moon": "assets/moon_texture_1024.jpg"',
        "icon_src":            "../../../assets/earth_icon.png",
        "preload_texture":     "assets/earth_color.jpg",
        "preload_elev":        "assets/earth_elevation.png",
        "preload_geology":     "assets/earth_geology_sim3292.png",
        "viewer_info":         "Drag to orbit, scroll to zoom, and inspect Earth as a textured 3D globe with GEBCO topographic relief and bathymetry data.",
        "audio_hidden":        True,
        "audio_label":         "Earth audio unavailable",
        "audio_src":           "",
        "moon_viewer_copy":    "Jump to Earth's Moon.",
        "core_section_copy":   "Interior cutaway of Earth.",
        "core_legend_html": """\
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#d8704b"></span>
                <div>
                  <div class="core-legend-label">Crust</div>
                  <div class="core-legend-copy">Oceanic crust 5–10 km thick; continental crust 30–70 km thick. The outermost layer where all surface geology occurs.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#8b4513"></span>
                <div>
                  <div class="core-legend-label">Mantle</div>
                  <div class="core-legend-copy">Silicate rock from ~30 to 2,890 km depth. Convection in the mantle drives plate tectonics and volcanic activity at the surface.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#f0a060"></span>
                <div>
                  <div class="core-legend-label">Outer Core</div>
                  <div class="core-legend-copy">Liquid iron-nickel layer from ~2,890 to 5,150 km depth. Its convective motion generates Earth's protective magnetic field.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#f0d59e"></span>
                <div>
                  <div class="core-legend-label">Inner Core</div>
                  <div class="core-legend-copy">Solid iron-nickel sphere, radius ~1,220 km. Constrained by seismic P-wave travel times and normal-mode observations.</div>
                </div>
              </div>""",
        "help_kicker":  "GeoID Earth Guide",
        "help_title":   "Using The Earth Explorer",
        "help_viewer_info": "The left panel runs from navigation to interpretation. <strong>Navigate</strong> holds search and reset. <strong>Tour Mode</strong> steps through curated stop sequences. <strong>Locations</strong> controls surface labels and mission markers by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and terrain displacement. <strong>Geology</strong> overlays GEBCO-derived bathymetric context and structural annotations. The science panels below add mineral, thermal, modelled environment, sea level, and region-mask layers. The bottom-right HUD shows live cursor latitude, longitude, elevation, and map scale.",
        "help_datasets": """\
            <article class="viewer-help-card">
              <h4>Global basemaps</h4>
              <p>NASA Earth surface texture, GEBCO-derived hillshade, and GEBCO-derived slope basemap.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Science rasters</h4>
              <p>GEBCO 2025 bathymetry and topography products providing the highest-resolution global ocean-floor relief model.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Geology</h4>
              <p>GEBCO-derived bathymetric relief context overlay with interactive annotations of major landforms, ocean basins, and tectonic features.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Interior cutaway</h4>
              <p>Cross-section of Earth's interior based on the Preliminary Reference Earth Model (PREM) and seismic constraints from the global seismograph network.</p>
            </article>""",
        "help_workflow": "Start with the Earth surface texture or GEBCO hillshade for visual context. Add terrain relief to read ocean-basin depth and mountain elevation. Enable geology to identify major bathymetric provinces, then compare context overlays to investigate tectonic boundaries. Use the sea-level slider to explore ice-age inundation scenarios. For final interpretation, treat each layer as one line of evidence rather than a definitive answer.",
        "help_moon_section": '<section class="viewer-help-section"><h3>Moon Viewer</h3><p>Select Moon from the Moon Viewer section to fly out to Earth\'s Moon. The panel focuses to show lunar labels — crater names, maria, and basins — and the Earth surface labels scale proportionally in the background. Click any lunar feature label for its description and data. Exit moon viewer with the close button or by clicking an Earth surface feature in search.</p></section>',
        "about_intro": "Earth is the third planet from the Sun and the only known body in the universe confirmed to harbour life. Its surface is 71% ocean, with a mean ocean depth of about 3,688 m and a maximum depth of nearly 11 km in the Mariana Trench. The solid surface is divided into tectonic plates that move at rates of a few centimetres per year, driving seafloor spreading, mountain building, and volcanism. Earth's magnetic field, generated by convection in the liquid outer iron core, shields the surface from harmful solar radiation. A nitrogen-oxygen atmosphere and abundant liquid water maintain the conditions for complex chemistry and biological evolution.",
        "boot_version": "20260508-earth",
    },
}


# ---------------------------------------------------------------------------
# Earth assets/manifest.json (to be written before building manifest.js)
# ---------------------------------------------------------------------------

EARTH_ASSETS_MANIFEST = {
    "texture": {
        "path": "earth_color.jpg",
        "width": 1440,
        "source_page_url": "https://science.nasa.gov/3d-resources/earth-a/"
    },
    "elevation": {
        "path": "earth_elevation.png",
        "width": 4096,
        "height": 2048,
        "min_m": -10930,
        "max_m": 8627,
        "relief_m": 19557,
        "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global"
    },
    "geology": {
        "path": "earth_geology_sim3292.png",
        "size": [4096, 2048],
        "description": "Derived bathymetry and topography context layer based on GEBCO 2025 relief.",
        "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global"
    },
    "geology_interactive": {
        "feature_path": "earth_geology_features.json",
        "size": [4096, 2048],
        "feature_count": 0
    },
    "geology_layers": [
        {
            "id": "gebco-bathy-context",
            "label": "GEBCO Relief Context",
            "path": "earth_geology_sim3292.png",
            "description": "Derived bathymetry and topography context overlay based on GEBCO 2025.",
            "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global",
            "size": [4096, 2048],
            "default": True
        }
    ],
    "layers": [
        {
            "id": "earth-visible",
            "label": "Earth Surface",
            "path": "earth_color.jpg",
            "description": "NASA Earth surface texture basemap.",
            "source_page_url": "https://science.nasa.gov/3d-resources/earth-a/",
            "default": True
        },
        {
            "id": "derived-hillshade",
            "label": "GEBCO Hillshade",
            "path": "earth_hillshade.jpg",
            "description": "Derived hillshade generated from the GEBCO 2025 global elevation model.",
            "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global",
            "size": [4096, 2048]
        },
        {
            "id": "derived-slope",
            "label": "GEBCO Slope",
            "path": "earth_slope.jpg",
            "description": "Derived slope basemap generated from the GEBCO 2025 global elevation model.",
            "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global",
            "size": [4096, 2048]
        }
    ],
    "seismic": {
        "path": "earth_seismic_events.json",
        "description": "Placeholder catalog; no earthquake catalog is bundled in this Earth workflow.",
        "source_page_url": "https://earthquake.usgs.gov/",
        "event_count": 0,
        "located_event_count": 0,
        "clustered_event_count": 0
    },
    "mineral_layers": [],
    "sources": {
        "texture_url": "https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/earth-(a)/Earth%20(A).jpg",
        "dem_url": "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/",
        "geology_url": "derived/from-gebco-hillshade-and-earth-texture",
        "geology_database_path": "https://www.gebco.net/",
        "tes_albedo_url": "https://www.gebco.net/",
        "tes_thermal_inertia_url": "https://www.gebco.net/",
        "geology_notes_url": "https://www.gebco.net/",
        "geology_dmu_url": "https://www.gebco.net/",
        "geology_map_url": "https://www.gebco.net/",
        "geology_database_url": "https://www.gebco.net/",
        "geology_original_units_citation": "GEBCO Compilation Group (2025) GEBCO 2025 Grid, doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29.",
        "tes_albedo_page_url": "https://www.gebco.net/",
        "tes_thermal_inertia_page_url": "https://www.gebco.net/",
        "magnetic_anomaly_page_url": "https://science.nasa.gov/earth/",
        "themis_day_ir_page_url": "https://www.gebco.net/",
        "themis_night_ir_page_url": "https://www.gebco.net/"
    }
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  wrote {os.path.relpath(path, BASE)}")


def extract_data_line(src, varname):
    """Return the full 'const varname = [...];' line from src."""
    marker = f"const {varname} = ["
    idx = src.find(marker)
    if idx == -1:
        raise ValueError(f"Could not find '{marker}' in source")
    line_start = src.rfind("\n", 0, idx) + 1
    end = src.find("];", idx)
    if end == -1:
        raise ValueError(f"Could not find '];' after '{marker}'")
    return src[line_start:end + 2]


def extract_eccentricity_block(src):
    """Return the full MOON_ORBIT_ECCENTRICITY block."""
    marker = "const MOON_ORBIT_ECCENTRICITY = Object.freeze({"
    idx = src.find(marker)
    if idx == -1:
        raise ValueError("Could not find MOON_ORBIT_ECCENTRICITY block")
    line_start = src.rfind("\n", 0, idx) + 1
    end = src.find("});", idx)
    if end == -1:
        raise ValueError("Could not find '});' closing MOON_ORBIT_ECCENTRICITY")
    return src[line_start:end + 3]


def build_interior_layers_block(p):
    """Build the MARS_INTERIOR_LAYERS / T_PTS / P_PTS block as JS."""
    layers_js = json.dumps(p["interior_layers"], separators=(", ", ": ")).replace(
        '{"name"', '{ name'
    ).replace('"rMin"', 'rMin').replace('"rMax"', 'rMax').replace('}', '}')
    # Just build valid JSON-as-JS arrays
    layers = p["interior_layers"]
    lines = []
    lines.append("      { name: \"%-14s rMin: %.3f, rMax: %.3f }," % (
        layers[0]["name"] + '",', layers[0]["rMin"], layers[0]["rMax"]))
    for lay in layers[1:-1]:
        lines.append("      { name: \"%-14s rMin: %.3f, rMax: %.3f }," % (
            lay["name"] + '",', lay["rMin"], lay["rMax"]))
    lay = layers[-1]
    lines.append("      { name: \"%-14s rMin: %.3f, rMax: %.3f }," % (
        lay["name"] + '",', lay["rMin"], lay["rMax"]))
    layers_str = "\n".join(lines).rstrip(",")

    t_pts = json.dumps(p["interior_t_pts"])
    pr_pts = json.dumps(p["interior_p_pts"])

    block = (
        f"    // ── Mars interior model (depth-based) ────────────────────────────────────\n"
        f"    // Layer boundaries as fraction of planetary radius\n"
        f"    // rFrac = 0 → centre, rFrac = 1 → surface\n"
        f"    const MARS_INTERIOR_LAYERS = [\n"
        f"{layers_str}\n"
        f"    ];\n"
        f"    // Piecewise-linear T (°C) and P (GPa) profiles keyed on rFrac (sorted low→high)\n"
        f"    const MARS_INTERIOR_T_PTS = {t_pts};\n"
        f"    const MARS_INTERIOR_P_PTS = {pr_pts};\n"
    )
    return block


def build_interior_layer_colors_block(p):
    """Build the MARS_INTERIOR_LAYER_COLORS const block."""
    colors = p["interior_layer_colors"]
    lines = []
    for name, color in colors.items():
        lines.append(f'      "{name}": "{color}",')
    lines_str = "\n".join(lines).rstrip(",")
    return (
        f"    const MARS_INTERIOR_LAYER_COLORS = {{\n"
        f"{lines_str}\n"
        f"    }};\n"
    )


def patch_viewer(src, planet_name, p):
    """Apply all per-planet patches to mars-viewer.js text. Returns new text."""
    t = src
    pl  = planet_name          # lowercase: mercury
    Pc  = p["planet_cap"]      # Mercury
    P   = p["planet_upper"]    # MERCURY

    # ------------------------------------------------------------------
    # 1. Rotation period block
    # ------------------------------------------------------------------
    old_rot = (
        "    // Mars sidereal day: 24 h 37 m 22 s = 24.6228 h = 88,642,080 ms (IAU).\n"
        "    const _MARS_DISPLAY_PERIOD_MS = 600000; // 10 min visual rotation\n"
        "    const _MARS_ROT_REAL_MS = 24.6228 * 3600000; // 88,642,080 ms\n"
        "    const _MARS_MOON_SPEED_FACTOR = _MARS_ROT_REAL_MS / _MARS_DISPLAY_PERIOD_MS; // ≈ 147.74×"
    )
    new_rot = (
        f"    // {p['rot_comment']}.\n"
        f"    const _MARS_DISPLAY_PERIOD_MS = 600000; // 10 min visual rotation\n"
        f"    const _MARS_ROT_REAL_MS = {p['rot_real_expr']}; // rotation period in ms\n"
        f"    const _MARS_MOON_SPEED_FACTOR = _MARS_ROT_REAL_MS / _MARS_DISPLAY_PERIOD_MS; // scaled"
    )
    t = t.replace(old_rot, new_rot, 1)

    # ------------------------------------------------------------------
    # 2. labelData array
    # ------------------------------------------------------------------
    old_label = extract_data_line(src, "labelData")
    new_label = f"    const labelData = {p['label_data']};"
    t = t.replace(old_label, new_label, 1)

    # ------------------------------------------------------------------
    # 3. Spirit entry correction block (Mars-specific, remove)
    # ------------------------------------------------------------------
    spirit_block = (
        "    const spiritEntry = labelData.find((entry) => entry.name === \"Spirit\");\n"
        "    if (spiritEntry) {\n"
        "      spiritEntry.lat = -14.5;\n"
        "      spiritEntry.lon = 175.4;\n"
        "    }\n"
    )
    if spirit_block in t:
        t = t.replace(spirit_block, "", 1)

    # ------------------------------------------------------------------
    # 4. ringLabelData
    # ------------------------------------------------------------------
    old_ring = "    const ringLabelData = [];"
    new_ring = f"    const ringLabelData = {p['ring_label_data']};"
    t = t.replace(old_ring, new_ring, 1)

    # ------------------------------------------------------------------
    # 5. moonData array
    # ------------------------------------------------------------------
    old_moon = extract_data_line(src, "moonData")
    new_moon = f"    const moonData = {p['moon_data']};"
    t = t.replace(old_moon, new_moon, 1)

    # ------------------------------------------------------------------
    # 6. MOON_ORBIT_ECCENTRICITY block
    # ------------------------------------------------------------------
    old_ecc = extract_eccentricity_block(src)
    new_ecc = f"    const MOON_ORBIT_ECCENTRICITY = {p['moon_orbit_eccentricity']};"
    t = t.replace(old_ecc, new_ecc, 1)

    # ------------------------------------------------------------------
    # 7. moonFeatureData array
    # ------------------------------------------------------------------
    old_mfd = extract_data_line(src, "moonFeatureData")
    new_mfd = f"    const moonFeatureData = {p['moon_feature_data']};"
    t = t.replace(old_mfd, new_mfd, 1)

    # ------------------------------------------------------------------
    # 8. Interior layer definitions block
    # ------------------------------------------------------------------
    old_interior_start = (
        "    // ── Mars interior model (depth-based) ────────────────────────────────────\n"
        "    // Layer boundaries as fraction of planetary radius (from InSight + geophysical models)\n"
        "    // rFrac = 0 → centre, rFrac = 1 → surface\n"
        "    const MARS_INTERIOR_LAYERS = ["
    )
    old_interior_end_marker = "    const MARS_INTERIOR_P_PTS"
    idx_start = t.find(old_interior_start)
    if idx_start != -1:
        idx_end_marker = t.find(old_interior_end_marker, idx_start)
        if idx_end_marker != -1:
            end_of_line = t.find("\n", idx_end_marker)
            old_interior_block = t[idx_start:end_of_line + 1]
            new_interior_block = build_interior_layers_block(p)
            t = t.replace(old_interior_block, new_interior_block, 1)

    # ------------------------------------------------------------------
    # 9. Interior layer colors block
    # ------------------------------------------------------------------
    old_colors_start = "    const MARS_INTERIOR_LAYER_COLORS = {"
    idx_colors = t.find(old_colors_start)
    if idx_colors != -1:
        end_colors = t.find("\n    };\n", idx_colors)
        if end_colors != -1:
            old_colors_block = t[idx_colors:end_colors + 7]
            new_colors_block = build_interior_layer_colors_block(p).rstrip("\n")
            t = t.replace(old_colors_block, new_colors_block, 1)

    # ------------------------------------------------------------------
    # 10. MARS_MEAN_RADIUS_KM value
    # ------------------------------------------------------------------
    old_radius_km = "    const MARS_MEAN_RADIUS_KM = 3389.5;"
    new_radius_km = f"    const MARS_MEAN_RADIUS_KM = {p['mean_radius_km']};"
    t = t.replace(old_radius_km, new_radius_km, 1)

    # ------------------------------------------------------------------
    # 11. MARS_RADIUS_METERS value
    # ------------------------------------------------------------------
    old_radius_m = "    const MARS_RADIUS_METERS = 3396190;"
    new_radius_m = f"    const MARS_RADIUS_METERS = {p['radius_meters']};"
    t = t.replace(old_radius_m, new_radius_m, 1)

    # ------------------------------------------------------------------
    # 12. Interior radius fractions block
    # ------------------------------------------------------------------
    old_r_inner = f"      const MARS_INNER_CORE_RADIUS = 0.32;    // hypothetical dense inner core"
    new_r_inner = f"      const MARS_INNER_CORE_RADIUS = {p['inner_core_r']:.3f};  // {p['inner_core_comment']}"
    t = t.replace(old_r_inner, new_r_inner, 1)

    old_r_outer = f"      const MARS_OUTER_CORE_RADIUS = 0.54;    // liquid iron-sulfide core (InSight)"
    new_r_outer = f"      const MARS_OUTER_CORE_RADIUS = {p['outer_core_r']:.3f};  // {p['outer_core_comment']}"
    t = t.replace(old_r_outer, new_r_outer, 1)

    old_r_mantle = f"      const MARS_MANTLE_RADIUS = 0.985;       // mantle, near-crust boundary"
    new_r_mantle = f"      const MARS_MANTLE_RADIUS = {p['mantle_r']:.3f};  // {p['mantle_comment']}"
    t = t.replace(old_r_mantle, new_r_mantle, 1)

    # ------------------------------------------------------------------
    # 13. __marsViewerManifest global reference
    # ------------------------------------------------------------------
    t = t.replace("window.__marsViewerManifest", f"window.__{pl}ViewerManifest")
    t = t.replace("__marsViewerManifest", f"__{pl}ViewerManifest")

    # ------------------------------------------------------------------
    # 13b. MOON_VIEWER_TEXTURES — replace Mars moon texture map with planet-specific one
    # ------------------------------------------------------------------
    old_mvt = (
        '    const MOON_VIEWER_TEXTURES = {\n'
        '      "Phobos": "assets/phobos_color_map.jpg",\n'
        '      "Deimos": "assets/deimos_color_map.jpg",\n'
        '    };'
    )
    mvt_body = p["moon_viewer_textures_js"]
    if mvt_body and mvt_body != "{}":
        new_mvt = f'    const MOON_VIEWER_TEXTURES = {{\n      {mvt_body},\n    }};'
    else:
        new_mvt = '    const MOON_VIEWER_TEXTURES = {};'
    t = t.replace(old_mvt, new_mvt, 1)

    # ------------------------------------------------------------------
    # 14. Broad sweeps: MARS_ → PLANET_, MARS → PLANET, Mars → Planet, mars → planet
    # ------------------------------------------------------------------
    t = t.replace("MARS_", f"{P}_")
    t = t.replace("MARS",  P)
    t = t.replace("Mars",  Pc)
    t = t.replace("mars",  pl)

    return t


def build_manifest_js(planet_name, p, manifest_json_path, template_manifest_path):
    """Build {planet}-manifest.js from assets/manifest.json + template boilerplate."""
    pl = planet_name
    Pc = p["planet_cap"]

    # Load the planet's assets/manifest.json
    with open(manifest_json_path, "r", encoding="utf-8") as f:
        manifest_data = json.load(f)

    # Add / update planet key
    manifest_data["planet"] = {"axial_tilt_deg": p["axial_tilt_deg"]}

    # Prefix all asset paths with "assets/" where needed
    def prefix(path):
        if not path or path.startswith("assets/") or path.startswith("http") or path.startswith("../"):
            return path
        return "assets/" + path

    def prefix_paths_in(obj):
        if isinstance(obj, dict):
            for key in ["path", "legend_path", "sample_path", "feature_path"]:
                if key in obj and isinstance(obj[key], str):
                    obj[key] = prefix(obj[key])
            for v in obj.values():
                prefix_paths_in(v)
        elif isinstance(obj, list):
            for item in obj:
                prefix_paths_in(item)

    prefix_paths_in(manifest_data)

    manifest_json_str = json.dumps(manifest_data, separators=(", ", ": "))

    # Read boilerplate from mars-manifest.js (lines after the first const manifest = {...})
    template = read_file(template_manifest_path)
    # Find the end of the manifest line (first line)
    end_of_first_line = template.find("\n")
    boilerplate = template[end_of_first_line + 1:]

    # Replace mars globals with planet globals
    boilerplate = boilerplate.replace("window.__marsViewerManifest", f"window.__{pl}ViewerManifest")
    boilerplate = boilerplate.replace("window.__marsViewerStartup",  f"window.__{pl}ViewerStartup")
    boilerplate = boilerplate.replace("__marsViewerManifest", f"__{pl}ViewerManifest")
    boilerplate = boilerplate.replace("__marsViewerStartup",  f"__{pl}ViewerStartup")

    out = f"const manifest = {manifest_json_str};\n{boilerplate}"
    return out


def patch_index(src, planet_name, p):
    """Patch index.html with planet-specific strings. Returns new text."""
    t = src
    pl  = planet_name
    Pc  = p["planet_cap"]
    P   = p["planet_upper"]

    # ------------------------------------------------------------------
    # Title
    # ------------------------------------------------------------------
    t = t.replace("<title>Mars</title>", f"<title>{Pc}</title>", 1)

    # ------------------------------------------------------------------
    # Preloads
    # ------------------------------------------------------------------
    t = t.replace(
        '<link rel="preload" href="assets/mars_color.jpg" as="image">',
        f'<link rel="preload" href="{p["preload_texture"]}" as="image">',
        1,
    )
    t = t.replace(
        '<link rel="preload" href="assets/mars_elevation_upscaled.png" as="image">',
        f'<link rel="preload" href="{p["preload_elev"]}" as="image">',
        1,
    )
    t = t.replace(
        '<link rel="preload" href="assets/mars_geology_sim3292.png" as="image">',
        f'<link rel="preload" href="{p["preload_geology"]}" as="image">',
        1,
    )

    # ------------------------------------------------------------------
    # Brand logo icon
    # ------------------------------------------------------------------
    t = re.sub(
        r'src="[^"]*assets/mars_icon[^"]*"',
        f'src="{p["icon_src"]}"',
        t,
        count=1,
    )
    t = t.replace('alt="Mars icon"', f'alt="{Pc} icon"', 1)

    # ------------------------------------------------------------------
    # h1 title
    # ------------------------------------------------------------------
    t = t.replace("<h1>Mars</h1>", f"<h1>{Pc}</h1>", 1)

    # ------------------------------------------------------------------
    # Viewer info paragraph
    # ------------------------------------------------------------------
    t = t.replace(
        "Drag to orbit, scroll to zoom, and inspect Mars as a textured 3D globe with topographic relief and an optional geology overlay.",
        p["viewer_info"],
        1,
    )

    # ------------------------------------------------------------------
    # Brand audio section — make hidden if no audio
    # ------------------------------------------------------------------
    if p["audio_hidden"]:
        t = t.replace(
            '<div class="brand-audio">',
            '<div class="brand-audio" hidden>',
            1,
        )
    # Audio label
    t = t.replace(
        "Sounds of Mars - NASA InSight",
        p["audio_label"],
        1,
    )
    # Audio element source
    t = t.replace(
        '<source src="assets/mars_sound.wav" type="audio/wav">',
        f'<source src="{p["audio_src"]}" type="audio/wav">' if p["audio_src"] else "",
        1,
    )
    # Audio button aria-label
    t = t.replace(
        'aria-label="Play / pause Mars sounds"',
        f'aria-label="Play / pause {Pc} sounds"',
        1,
    )
    # Audio paragraph class
    t = t.replace(
        'class="mars-audio-label"',
        f'class="{planet_name}-audio-label"',
        1,
    )
    # Audio element id
    t = t.replace(
        'id="mars-audio-el"',
        f'id="{planet_name}-audio-el"',
        1,
    )

    # ------------------------------------------------------------------
    # Moon viewer section copy
    # ------------------------------------------------------------------
    t = t.replace(
        "Jump between Mars's moons.",
        p["moon_viewer_copy"],
        1,
    )

    # ------------------------------------------------------------------
    # Core view section copy
    # ------------------------------------------------------------------
    t = t.replace(
        "Interior cutaway of Mars.",
        p["core_section_copy"],
        1,
    )

    # ------------------------------------------------------------------
    # Core legend HTML
    # ------------------------------------------------------------------
    old_core_legend = """\
            <div class="core-legend" style="margin-top:0.35rem;">
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#c8a882"></span>
                <div>
                  <div class="core-legend-label">Crust</div>
                  <div class="core-legend-copy">Thin basaltic shell, ~20–70 km thick, formed by ancient volcanic activity.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#6b3a2a"></span>
                <div>
                  <div class="core-legend-label">Mantle</div>
                  <div class="core-legend-copy">Silicate rock making up the bulk of the planet, largely solidified and tectonically inactive.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#d94f1e"></span>
                <div>
                  <div class="core-legend-label">Liquid Outer Core</div>
                  <div class="core-legend-copy">Molten iron-sulfur layer; the source of Mars's past magnetic field, now largely dormant.</div>
                </div>
              </div>
              <div class="core-legend-row">
                <span class="core-swatch" style="background:#f0d59e"></span>
                <div>
                  <div class="core-legend-label">Inner Core</div>
                  <div class="core-legend-copy">Possible denser iron-rich centre; its solid or partially molten state remains uncertain.</div>
                </div>
              </div>
            </div>"""
    new_core_legend = f'            <div class="core-legend" style="margin-top:0.35rem;">\n{p["core_legend_html"]}\n            </div>'
    t = t.replace(old_core_legend, new_core_legend, 1)

    # ------------------------------------------------------------------
    # Hemisphere locator aria-label
    # ------------------------------------------------------------------
    t = t.replace(
        'aria-label="Mars hemisphere locator"',
        f'aria-label="{Pc} hemisphere locator"',
        1,
    )

    # ------------------------------------------------------------------
    # Help panel kicker and title
    # ------------------------------------------------------------------
    t = t.replace(
        '<p class="viewer-help-kicker">GeoID Mars Guide</p>',
        f'<p class="viewer-help-kicker">{p["help_kicker"]}</p>',
        1,
    )
    t = t.replace(
        '<h2 id="viewer-help-title">Using The Mars Explorer</h2>',
        f'<h2 id="viewer-help-title">{p["help_title"]}</h2>',
        1,
    )

    # ------------------------------------------------------------------
    # Help panel "Reset" description (mentions Mars title)
    # ------------------------------------------------------------------
    t = t.replace(
        "Use the reset button beside the Mars title in the top-left panel header to return to the default framing and clear any active tour or moon viewer.",
        f"Use the reset button beside the {Pc} title in the top-left panel header to return to the default framing and clear any active tour or moon viewer.",
        1,
    )

    # ------------------------------------------------------------------
    # Help panel — Control Panel Layout paragraph
    # ------------------------------------------------------------------
    old_ctrl_para = (
        "The left panel runs from navigation to interpretation. <strong>Navigate</strong> holds search and reset. <strong>Tour Mode</strong> steps through curated stop sequences. <strong>Locations</strong> controls surface labels and mission markers by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and terrain displacement. <strong>Geology</strong> overlays the USGS mapped units, contacts, and structures. The science panels below add mineral, thermal, modelled environment, sea level, and region-mask layers. The bottom-right HUD shows live cursor latitude, longitude, elevation, and map scale."
    )
    t = t.replace(old_ctrl_para, p["help_viewer_info"], 1)

    # ------------------------------------------------------------------
    # Help panel — Datasets section (replace article cards)
    # ------------------------------------------------------------------
    old_datasets = """\
            <article class="viewer-help-card">
              <h4>Global basemaps</h4>
              <p>Viking colour mosaic, CTX greyscale and colour streaming mosaic, derived hillshade, and derived slope.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Science rasters</h4>
              <p>TES Lambert albedo, TES thermal inertia, and 13 TES mineral abundance products including olivine, pyroxenes, hematite, sulfate, and carbonate.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Geology</h4>
              <p>USGS SIM-3292 mapped units with interactive feature tooltips, interpreted contact lines, and structural measurements (faults, volcanic traces, basin-related structures).</p>
            </article>
            <article class="viewer-help-card">
              <h4>Modelled environment</h4>
              <p>Derived surface-condition layers: temperature, pressure, wind, dust-devil potential, irradiation, brine stability, landing score, and related habitability estimates.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Seismic events</h4>
              <p>InSight seismic catalogue (UMD InSight v12, 2022) showing detected events by quality grade, magnitude, and distance from the lander.</p>
            </article>
            <article class="viewer-help-card">
              <h4>Paleo-sea overlay</h4>
              <p>Speculative northern-ocean threshold model. Drag the sea-level slider to explore flood depth from the minimum terrain elevation up to 0 m datum.</p>
            </article>"""
    t = t.replace(old_datasets, p["help_datasets"], 1)

    # ------------------------------------------------------------------
    # Help panel — Moon Viewer section (replace Phobos/Deimos text)
    # ------------------------------------------------------------------
    old_moon_section = """\
        <section class="viewer-help-section">
          <h3>Moon Viewer</h3>
          <p>Select Phobos or Deimos from the Moon Viewer section to fly out to the moon in close orbit. The panel focuses to show moon-specific labels — crater names, ridges, and grooves — and the Mars surface labels scale proportionally in the background. Click any moon feature label for its description and orbital data. Exit moon viewer with the close button or by clicking a Mars surface feature in search.</p>
        </section>"""
    if p["help_moon_section"]:
        t = t.replace(old_moon_section, p["help_moon_section"], 1)
    else:
        # For planets with no moons, remove the section entirely
        t = t.replace(old_moon_section, "", 1)

    # ------------------------------------------------------------------
    # Help panel — Suggested Workflow paragraph
    # ------------------------------------------------------------------
    old_workflow = (
        "Start with Viking or CTX for visual context. Add terrain relief or contours to read basin depth and volcano height. Enable geology to identify mapped units, then compare TES mineral products or modelled layers to test a region for composition or habitability interest. Use the sea-level slider to visualise northern-ocean scenarios. For final interpretation, treat each layer as one line of evidence rather than a definitive answer."
    )
    t = t.replace(old_workflow, p["help_workflow"], 1)

    # ------------------------------------------------------------------
    # Boot script — script tag src
    # ------------------------------------------------------------------
    t = t.replace(
        '<script src="mars-manifest.js" defer></script>',
        f'<script src="{pl}-manifest.js" defer></script>',
        1,
    )

    # ------------------------------------------------------------------
    # Boot script — function name
    # ------------------------------------------------------------------
    t = t.replace("async function bootMarsViewer()", f"async function boot{Pc}Viewer()", 1)
    t = t.replace("void bootMarsViewer();", f"void boot{Pc}Viewer();", 1)

    # ------------------------------------------------------------------
    # Boot script — manifest global references
    # ------------------------------------------------------------------
    t = t.replace("window.__marsViewerManifest", f"window.__{pl}ViewerManifest")
    t = t.replace("__marsViewerManifest", f"__{pl}ViewerManifest")

    # ------------------------------------------------------------------
    # Boot script — querySelector for manifest script
    # ------------------------------------------------------------------
    t = t.replace(
        'document.querySelector(\'script[src="mars-manifest.js"]\')',
        f'document.querySelector(\'script[src="{pl}-manifest.js"]\')',
        1,
    )

    # ------------------------------------------------------------------
    # Boot script — error messages
    # ------------------------------------------------------------------
    t = t.replace(
        '"Failed to load mars-manifest.js."',
        f'"Failed to load {pl}-manifest.js."',
        1,
    )
    t = t.replace(
        '"Failed to load mars-viewer.js."',
        f'"Failed to load {pl}-viewer.js."',
        1,
    )

    # ------------------------------------------------------------------
    # Boot script — version fallback string
    # ------------------------------------------------------------------
    t = t.replace(
        '"20260329-ctxsync"',
        f'"{p["boot_version"]}"',
        1,
    )

    # ------------------------------------------------------------------
    # Boot script — viewer script src
    # ------------------------------------------------------------------
    t = t.replace(
        'viewerScript.src = `mars-viewer.js?v=${encodeURIComponent(viewerScriptVersion)}&t=${Date.now()}`;',
        f'viewerScript.src = `{pl}-viewer.js?v=${{encodeURIComponent(viewerScriptVersion)}}&t=${{Date.now()}}`;',
        1,
    )

    return t


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Build Earth moon feature data from CSV before processing planets.
    PLANETS["earth"]["moon_feature_data"] = build_earth_moon_feature_data()

    for planet_name, p in PLANETS.items():
        viewer_dir = os.path.join(BASE, planet_name, "viewer")
        assets_dir = os.path.join(viewer_dir, "assets")
        print(f"\n=== {p['planet_cap']} ===")

        # -- Create Earth assets/manifest.json if needed --
        if planet_name == "earth":
            earth_manifest_path = os.path.join(assets_dir, "manifest.json")
            os.makedirs(assets_dir, exist_ok=True)
            write_file(earth_manifest_path, json.dumps(EARTH_ASSETS_MANIFEST, indent=2))

        manifest_json_path = os.path.join(assets_dir, "manifest.json")
        if not os.path.exists(manifest_json_path):
            print(f"  SKIP: no assets/manifest.json at {manifest_json_path}")
            continue

        mars_viewer_path    = os.path.join(viewer_dir, "mars-viewer.js")
        mars_manifest_path  = os.path.join(viewer_dir, "mars-manifest.js")
        index_path          = os.path.join(viewer_dir, "index.html")

        for path in [mars_viewer_path, mars_manifest_path, index_path]:
            if not os.path.exists(path):
                print(f"  SKIP: missing {path}")
                continue

        # -- Patch viewer --
        src_viewer = read_file(mars_viewer_path)
        new_viewer = patch_viewer(src_viewer, planet_name, p)
        write_file(os.path.join(viewer_dir, f"{planet_name}-viewer.js"), new_viewer)

        # Check for residual mars/Mars references
        residual = [
            line for line in new_viewer.split("\n")
            if re.search(r'\bmars\b|\bMars\b|\bMARS\b', line)
            and "marsoweb" not in line and "mars.asu.edu" not in line
            and "marsoweb" not in line
        ]
        if residual:
            print(f"  WARNING: {len(residual)} lines with residual mars/Mars in viewer")
            for r in residual[:5]:
                print(f"    {r[:100]}")

        # -- Build manifest.js --
        src_manifest = read_file(mars_manifest_path)
        new_manifest = build_manifest_js(planet_name, p, manifest_json_path, mars_manifest_path)
        write_file(os.path.join(viewer_dir, f"{planet_name}-manifest.js"), new_manifest)

        # -- Patch index.html --
        src_index = read_file(index_path)
        new_index = patch_index(src_index, planet_name, p)
        write_file(index_path, new_index)

        # Sanity check index for residual mars references
        residual_idx = [
            line for line in new_index.split("\n")
            if re.search(r'\bmars\b|\bMars\b|\bMARS\b', line, re.IGNORECASE)
            and "nasa" not in line.lower() and "asu.edu" not in line.lower()
            and "pubs.usgs" not in line.lower() and "marsoweb" not in line.lower()
            and "github.com" not in line.lower()
        ]
        if residual_idx:
            print(f"  WARNING: {len(residual_idx)} lines with residual Mars in index.html")
            for r in residual_idx[:5]:
                print(f"    {r.strip()[:120]}")

    print("\nDone.")


if __name__ == "__main__":
    main()
