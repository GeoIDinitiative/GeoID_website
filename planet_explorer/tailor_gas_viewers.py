#!/usr/bin/env python3
"""
Tailors the copied saturn-viewer.js / saturn-manifest.js files
in jupiter/, uranus/, neptune/ to match each planet's actual data.

Run from planet_explorer/:
    python3 tailor_gas_viewers.py
"""

import csv, json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))

# ─── helpers ──────────────────────────────────────────────────────────────────

def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

def patch(text, old, new):
    if old not in text:
        raise ValueError(f"Pattern not found:\n{old[:120]!r}")
    return text.replace(old, new, 1)

def patch_all(text, old, new):
    if old not in text:
        raise ValueError(f"Pattern not found (replace_all):\n{old[:120]!r}")
    return text.replace(old, new)

# ─── CSV → moon feature data ──────────────────────────────────────────────────

_GAS_MOON_TYPE_MAP = {
    "Patera, paterae":          "Volcanic patera",
    "Fluctus, fluctūs":         "Lava flow field",
    "Mons, montes":             "Mons",
    "Planum, plana":            "Planum",
    "Regio, regiones":          "Regio",
    "Crater, craters":          "Impact crater",
    "Catena, catenae":          "Crater chain",
    "Linea, lineae":            "Linea",
    "Sulcus, sulci":            "Sulcus",
    "Tholus, tholi":            "Tholus",
    "Tessera, tesserae":        "Tessera",
    "Fossa, fossae":            "Fossa",
    "Chasma, chasmata":         "Chasma",
    "Chaos":                    "Chaos terrain",
    "Macula, maculae":          "Macula",
    "Facula, faculae":          "Facula",
    "Rupes, rupēs":             "Rupes",
    "Corona, coronae":          "Corona",
    "Dorsum, dorsa":            "Dorsum",
    "Vallis, valles":           "Vallis",
    "Satellite Feature":        "Satellite feature",
}

def _feat_type(raw):
    return _GAS_MOON_TYPE_MAP.get(raw, raw)

def _moon_theme(moon_name):
    return "moon"

def build_gas_moon_feature_data(planet_name, centered_moons_list):
    """Build the full 'const moonFeatureData = [...];' JS line from IAU CSVs.

    centered_moons_list  — list of moon names that use TEXTURE_CENTERED CRS,
                           i.e. lon = (540 - csv_lon_w) % 360.
    Standard moons use  lon = (360 - csv_lon_w) % 360.
    """
    csv_dir = os.path.join(BASE, planet_name, "viewer", "moon_label_locations")
    centered = set(centered_moons_list)
    features = []
    for fname in sorted(os.listdir(csv_dir)):
        if not fname.endswith(".csv"):
            continue
        moon_name = fname[:-4].capitalize()
        path = os.path.join(csv_dir, fname)
        with open(path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                row = {" ".join(k.split()): v.strip() for k, v in row.items()}
                feat_type_raw = row.get("Feature Type", "")
                if feat_type_raw == "Satellite Feature":
                    continue
                try:
                    lat   = float(row["Center Latitude"])
                    lon_w = float(row["Center Longitude"])
                    diam  = float(row["Diameter"])
                except (ValueError, KeyError):
                    continue
                if moon_name in centered:
                    lon = (540.0 - lon_w) % 360.0
                else:
                    lon = (360.0 - lon_w) % 360.0
                dim_str = f"{diam:.1f} km" if diam > 0 else ""
                origin  = row.get("Origin", "").replace('"', '\\"').strip(";").strip()
                features.append({
                    "name":        row["Feature Name"],
                    "type":        _feat_type(feat_type_raw),
                    "theme":       "moon",
                    "moon_name":   moon_name,
                    "lat":         round(lat, 2),
                    "lon":         round(lon, 2),
                    "description": origin,
                    "dimension":   dim_str,
                })
    arr = json.dumps(features, separators=(",", ":"))
    return f"    const moonFeatureData = {arr};"


# ─── per-planet data ──────────────────────────────────────────────────────────

PLANETS = {

"jupiter": {
    "planet_upper": "JUPITER",
    "planet_cap":   "Jupiter",
    "eq_radius_km": 71492,
    "mean_radius_km": 69911,
    "rot_real_expr": "9.9250 * 3600000",
    "rot_comment":   "System III sidereal day",
    "display_period_ms": 600000,
    "body_scale_y": 0.935,
    "axial_tilt_deg": 3.13,
    "heavy_core_r": 0.22,
    "metallic_h_r": 0.58,
    "molecular_r":  0.96,
    "ring_reference_km": """\
    const JUPITER_RING_REFERENCE_KM = {
      dInner: 92000, cInner: 122500, bInner: 128940, cassiniInner: 128940,
      aInner: 129000, aOuter: 129200, enckeCenter: 128000, keelerCenter: 128500,
      fRing: 129400, mainOuter: 129200,
    };""",
    "texture_centered_moons": '["Ganymede", "Callisto"]',
    "west_positive_moons": '[]',
    "moon_periods_days": """\
    const MOON_PERIODS_DAYS = {
      "Io": 1.7692, "Europa": 3.5512, "Ganymede": 7.1549, "Callisto": 16.6890,
    };""",
    "moon_self_rot_days": '    const MOON_SELF_ROT_DAYS = {};',
    "moon_viewer_textures": """\
    const MOON_VIEWER_TEXTURES = {
      Io:       "assets/io_color_map.jpg",
      Europa:   "assets/europa_color_map.jpg",
      Ganymede: "assets/ganymede_color_map.jpg",
      Callisto: "assets/callisto_color_map.jpg",
    };""",
    "label_data": r"""    const labelData = [{"name":"Great Red Spot","type":"Anticyclonic storm","lat":-22.0,"lon":310.0,"theme":"storm","description":"Jupiter's long-lived anticyclonic storm system, large enough to dominate the southern tropical atmosphere."},{"name":"Great Red Spot Hollow","type":"Storm wake region","lat":-23.0,"lon":326.0,"theme":"storm","description":"The turbulent atmospheric wake downstream of the Great Red Spot, where smaller vortices and cloud filaments are common."},{"name":"North Equatorial Belt","type":"Dark cloud belt","lat":12.0,"lon":40.0,"theme":"band","description":"A prominent dark belt north of the equator shaped by fast zonal winds and recurring convective outbreaks."},{"name":"South Equatorial Belt","type":"Dark cloud belt","lat":-7.0,"lon":140.0,"theme":"band","description":"A major dark belt south of Jupiter's equator where bright storms and plume outbreaks can disturb the band."},{"name":"Equatorial Zone","type":"Bright cloud zone","lat":0.0,"lon":0.0,"theme":"band","description":"A bright equatorial cloud zone crossed by fast jet streams, waves, and high-altitude haze."},{"name":"North Temperate Belt","type":"Temperate belt","lat":24.0,"lon":90.0,"theme":"band","description":"A mid-latitude belt marking one of Jupiter's organized jet-stream corridors."},{"name":"South Temperate Belt","type":"Temperate belt","lat":-28.0,"lon":250.0,"theme":"band","description":"A southern mid-latitude belt that hosts white ovals, smaller vortices, and turbulent cloud structures."},{"name":"Oval BA","type":"Anticyclonic oval","lat":-33.0,"lon":210.0,"theme":"storm","description":"A large anticyclonic oval sometimes called Red Spot Jr., formed from the merger of three white ovals."},{"name":"North Tropical Zone","type":"Bright zone","lat":20.0,"lon":0.0,"theme":"band","description":"A bright tropical band between the equatorial and temperate circulation systems."},{"name":"South Tropical Zone","type":"Bright zone","lat":-20.0,"lon":0.0,"theme":"band","description":"A southern tropical bright band linking the equatorial circulation to the stormier southern mid-latitudes."},{"name":"North Polar Haze","type":"Polar atmosphere","lat":68.0,"lon":35.0,"theme":"polar","description":"A high-latitude haze region above Jupiter's northern polar atmosphere."},{"name":"South Polar Cyclone Region","type":"Polar cyclone field","lat":-68.0,"lon":215.0,"theme":"polar","description":"Representative southern polar region where spacecraft imaging reveals organized cyclone structures."},{"name":"Juno Perijove Track","type":"Mission corridor","lat":7.0,"lon":190.0,"theme":"landing","description":"Representative close-approach corridor for NASA's Juno mission during perijove science passes."},{"name":"Galileo Probe Entry Region","type":"Probe entry region","lat":6.5,"lon":4.0,"theme":"landing","description":"Approximate atmospheric entry latitude and longitude region for the Galileo probe."}];""",
    "ring_label_data": "    const ringLabelData = [];",
    "moon_data": r"""    const moonData = [{"name":"Io","type":"Major moon","theme":"moon","description":"The innermost Galilean moon, volcanically active and tidally heated by Jupiter.","moon_anchor":[6.0,0.1,6.8],"moon_radius":0.115,"moon_label_lift":0.235,"moon_color":"#d8b45d","mean_radius_km":"1,822 km","orbit_distance_km":"~421,700 km","texture_source_url":null},{"name":"Europa","type":"Major moon","theme":"moon","description":"An icy Galilean moon with a young fractured surface and a probable subsurface ocean.","moon_anchor":[-8.8,-0.05,6.4],"moon_radius":0.105,"moon_label_lift":0.225,"moon_color":"#d7d1bf","mean_radius_km":"1,561 km","orbit_distance_km":"~671,100 km","texture_source_url":null},{"name":"Ganymede","type":"Major moon","theme":"moon","description":"The largest moon in the Solar System, with bright grooved terrain, dark cratered regions, and its own magnetic field.","moon_anchor":[-12.4,0.12,-7.8],"moon_radius":0.15,"moon_label_lift":0.27,"moon_color":"#9d9080","mean_radius_km":"2,634 km","orbit_distance_km":"~1,070,400 km","texture_source_url":null},{"name":"Callisto","type":"Major moon","theme":"moon","description":"A heavily cratered outer Galilean moon preserving an ancient impact-scarred surface.","moon_anchor":[15.0,-0.1,-12.0],"moon_radius":0.138,"moon_label_lift":0.258,"moon_color":"#726b62","mean_radius_km":"2,410 km","orbit_distance_km":"~1,882,700 km","texture_source_url":null}];""",
    "moon_feature_data": r"""    const moonFeatureData = [{"name":"Loki Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":12.6,"lon":51.2,"description":"One of Io's most powerful and persistent volcanic centers."},{"name":"Prometheus Plume","type":"Volcanic plume field","theme":"moon","moon_name":"Io","lat":-1.5,"lon":206.1,"description":"A long-lived plume-producing volcanic region on Io."},{"name":"Chaos Terrain","type":"Disrupted icy terrain","theme":"moon","moon_name":"Europa","lat":0.0,"lon":270.0,"description":"Representative broken and rotated ice terrain associated with Europa's active shell."},{"name":"Conamara Chaos","type":"Chaos terrain","theme":"moon","moon_name":"Europa","lat":9.7,"lon":86.0,"description":"A well-known disrupted terrain region on Europa."},{"name":"Galileo Regio","type":"Dark terrain","theme":"moon","moon_name":"Ganymede","lat":20.0,"lon":235.0,"description":"A broad ancient dark terrain province on Ganymede."},{"name":"Uruk Sulcus","type":"Grooved terrain","theme":"moon","moon_name":"Ganymede","lat":0.0,"lon":160.0,"description":"Representative bright grooved terrain on Ganymede."},{"name":"Valhalla Basin","type":"Multi-ring basin","theme":"moon","moon_name":"Callisto","lat":15.9,"lon":304.0,"description":"Callisto's enormous multi-ring impact basin."},{"name":"Asgard Basin","type":"Impact basin","theme":"moon","moon_name":"Callisto","lat":30.0,"lon":218.0,"description":"A large multi-ring basin on Callisto."}];""",
    "manifest_planet_key": "jupiter",
    "manifest_extra": '"body_scale_y": 0.935, "axial_tilt_deg": 3.13',
    "rings_in_manifest": False,
    # UI strings
    "preload_texture":  "jupiter_color.jpg",
    "preload_elevation": "jupiter_elevation.png",
    "preload_geology":  "jupiter_geology_sim3292.png",
    "icon_src":         "../../../assets/jupiter_icon.png",
    "audio_label":      "NASA Juno mission sounds of Jupiter",
    "audio_src":        "assets/jupiter_sounds.mp4",
    "seismic_no_mag":   "No seismic magnitude filtering is available for Jupiter.",
    "seismic_no_time":  "No seismic timeline is available for Jupiter.",
    "intro_text":       "Drag to orbit, scroll to zoom, and inspect Jupiter as a textured 3D globe with atmospheric banding, polar structures, and optional derived context layers.",
    "core_hide_copy":   "Hide Jupiter's upper atmospheric shells in core view.",
    "core_inspect_copy":"Inspect Jupiter's inferred interior cutaway and layer labels.",
    "measure_copy":     "Choose a tool, then click on Jupiter to start measuring.",
    "interior_note":    "This cutaway is schematic. Jupiter's deep structure is inferred from gravity, magnetic-field measurements, and atmospheric modeling rather than direct sampling.",
    "envelope_li":      "<li>Molecular envelope: most of Jupiter by volume is hydrogen-helium fluid under increasing pressure</li>",
    "about_heading":    "About Jupiter",
    "about_text":       "Jupiter is the fifth planet from the Sun and the largest in the Solar System, with an equatorial radius of ~71,492 km. Its atmosphere is dominated by hydrogen and helium, with the Great Red Spot — a storm larger than Earth — persisting for centuries. Jupiter has at least 95 known moons, including the four large Galilean moons Io, Europa, Ganymede, and Callisto.",
    "guide_kicker":     "GeoID Jupiter Guide",
    "guide_title":      "Using The Jupiter Explorer",
    "reset_help":       "beside the Jupiter title in the top-left panel header to return to the default framing and clear any active tour or moon viewer.",
    "panel_help":       "The left panel runs from navigation to interpretation. <strong>Tour Mode</strong> steps through curated stop sequences by theme. <strong>Locations</strong> controls surface labels by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and cloud displacement. <strong>Regions</strong> masks broad latitudinal zones. <strong>Core View</strong> shows Jupiter's layered interior structure. <strong>Moon Viewer</strong> flies to Jupiter's major moons. The bottom-right HUD shows live cursor latitude, longitude, and map scale.",
    "moon_help":        "Select one of Jupiter's Galilean moons — Io, Europa, Ganymede, or Callisto — from the Moon Viewer section to fly out to the moon in close orbit. The panel focuses to show moon-specific labels including volcanic centers, chaos terrain, and geological features. Click any moon feature label for its description and orbital data.",
    "geology_desc":     "Enhanced atmospheric context layer derived from the official NASA Jupiter image, emphasising banding and cloud structure.",
},

"uranus": {
    "planet_upper": "URANUS",
    "planet_cap":   "Uranus",
    "eq_radius_km": 25559,
    "mean_radius_km": 25362,
    "rot_real_expr": "17.24 * 3600000",
    "rot_comment":   "retrograde sidereal day",
    "display_period_ms": 600000,
    "body_scale_y": 0.9771,
    "axial_tilt_deg": 97.77,
    "heavy_core_r": 0.22,
    "metallic_h_r": 0.58,
    "molecular_r":  0.96,
    "ring_reference_km": """\
    const URANUS_RING_REFERENCE_KM = {
      dInner: 37000, cInner: 41900, bInner: 44700, cassiniInner: 46500,
      aInner: 47200, aOuter: 51000, enckeCenter: 48300, keelerCenter: 50000,
      fRing: 51100, mainOuter: 51500,
    };""",
    "texture_centered_moons": '["Titania", "Oberon"]',
    "west_positive_moons": '[]',
    "moon_periods_days": """\
    const MOON_PERIODS_DAYS = {
      "Miranda": 1.4135, "Ariel": 2.5204, "Umbriel": 4.1442,
      "Titania": 8.7059, "Oberon": 13.4632,
    };""",
    "moon_self_rot_days": '    const MOON_SELF_ROT_DAYS = {};',
    "moon_viewer_textures": """\
    const MOON_VIEWER_TEXTURES = {
      Miranda: "assets/miranda_color_map.jpg",
      Ariel:   "assets/ariel_color_map.jpg",
      Umbriel: "assets/umbriel_color_map.jpg",
      Titania: "assets/titania_color_map.jpg",
      Oberon:  "assets/oberon_color_map.jpg",
    };""",
    "label_data": r"""    const labelData = [{"name":"North Polar Hood","type":"Polar haze cap","lat":70.0,"lon":20.0,"theme":"polar","description":"A bright high-latitude hood associated with Uranus' seasonal polar atmosphere."},{"name":"South Polar Region","type":"Polar atmosphere","lat":-70.0,"lon":210.0,"theme":"polar","description":"Representative southern polar atmosphere shaped by Uranus' extreme axial tilt."},{"name":"Equatorial Band","type":"Subtle cloud band","lat":0.0,"lon":0.0,"theme":"band","description":"A muted equatorial cloud band visible in enhanced contrast products."},{"name":"Northern Mid-Latitude Band","type":"Cloud band","lat":32.0,"lon":120.0,"theme":"band","description":"A representative northern mid-latitude band where methane haze and cloud contrast vary."},{"name":"Southern Mid-Latitude Band","type":"Cloud band","lat":-32.0,"lon":300.0,"theme":"band","description":"A representative southern band used for tracking subtle atmospheric circulation."},{"name":"North Temperate Belt","type":"Temperate belt","lat":45.0,"lon":60.0,"theme":"band","description":"A northern mid-latitude belt showing subtle banding in methane-sensitive imaging."},{"name":"South Temperate Belt","type":"Temperate belt","lat":-45.0,"lon":240.0,"theme":"band","description":"A southern temperate belt visible in high-contrast atmospheric views."},{"name":"Bright Cloud Complex","type":"Methane cloud complex","lat":28.0,"lon":80.0,"theme":"storm","description":"A representative bright methane cloud region in Uranus' upper atmosphere."},{"name":"Dark Spot Latitude","type":"Storm latitude","lat":-27.0,"lon":240.0,"theme":"storm","description":"Representative latitude for dark storm systems observed in Uranus monitoring campaigns."},{"name":"Epsilon Ring Equatorial Crossing","type":"Ring plane","lat":0.0,"lon":180.0,"theme":"landing","description":"Representative location where Uranus' ring plane intersects the equator in the texture projection."},{"name":"Voyager 2 Closest Approach","type":"Mission corridor","lat":-14.0,"lon":35.0,"theme":"landing","description":"Representative encounter region for Voyager 2's 1986 Uranus flyby."}];""",
    "ring_label_data": r"""    const ringLabelData = [{"name":"6 Ring","type":"Narrow inner ring","theme":"ring","description":"One of Uranus' innermost narrow rings.","ring_region":"Inner narrow ring","ring_radius_km":"~41,800 km from Uranus center","ring_anchor":[4.4166,0,1.6075],"ring_label":[4.8394,0.18,1.7614],"ring_line_end":[4.6233,0.12,1.6827]},{"name":"Beta Ring","type":"Narrow ring","theme":"ring","description":"A narrow ring in the inner ring system of Uranus.","ring_region":"Inner ring system","ring_radius_km":"~45,700 km from Uranus center","ring_anchor":[1.7785,0,4.8864],"ring_label":[1.9324,0.18,5.3093],"ring_line_end":[1.8537,0.12,5.0931]},{"name":"Eta Ring","type":"Narrow ring","theme":"ring","description":"A narrow ring in the middle ring system of Uranus.","ring_region":"Middle ring system","ring_radius_km":"~47,200 km from Uranus center","ring_anchor":[-3.5996,0,4.2898],"ring_label":[-3.8889,0.18,4.6346],"ring_line_end":[-3.741,0.12,4.4584]},{"name":"Epsilon Ring","type":"Bright narrow ring","theme":"ring","description":"The brightest and outermost of Uranus' main narrow rings.","ring_region":"Outer main ring","ring_radius_km":"~51,100 km from Uranus center","ring_anchor":[-5.5426,0,-3.2],"ring_label":[-5.9323,0.18,-3.425],"ring_line_end":[-5.7331,0.12,-3.31]},{"name":"Mu Ring","type":"Diffuse dusty ring","theme":"ring","description":"A diffuse dusty outer ring discovered by Hubble.","ring_region":"Outer diffuse ring","ring_radius_km":"~97,700 km from Uranus center","ring_anchor":[3.6,0,-6.2354],"ring_label":[3.825,0.18,-6.6251],"ring_line_end":[3.71,0.12,-6.4259]}];""",
    "moon_data": r"""    const moonData = [{"name":"Miranda","type":"Major moon","theme":"moon","description":"A small icy moon with dramatic tectonic coronae and varied terrain, including Verona Rupes — one of the tallest cliffs in the Solar System.","moon_anchor":[6.8,0.08,4.4],"moon_radius":0.07,"moon_label_lift":0.19,"moon_color":"#b9b4aa","mean_radius_km":"236 km","orbit_distance_km":"~129,900 km","texture_source_url":null},{"name":"Ariel","type":"Major moon","theme":"moon","description":"A bright icy moon marked by canyons, scarps, and extensive resurfacing.","moon_anchor":[-7.6,-0.06,5.8],"moon_radius":0.092,"moon_label_lift":0.212,"moon_color":"#c9c6bd","mean_radius_km":"579 km","orbit_distance_km":"~190,900 km","texture_source_url":null},{"name":"Umbriel","type":"Major moon","theme":"moon","description":"A darker icy moon with an ancient cratered surface and a mysterious bright ring near its equator.","moon_anchor":[-9.8,0.04,-6.4],"moon_radius":0.09,"moon_label_lift":0.21,"moon_color":"#77736c","mean_radius_km":"585 km","orbit_distance_km":"~266,000 km","texture_source_url":null},{"name":"Titania","type":"Major moon","theme":"moon","description":"Uranus' largest moon, cut by major rift valleys and impact basins.","moon_anchor":[11.5,0.1,-8.6],"moon_radius":0.12,"moon_label_lift":0.24,"moon_color":"#aaa49b","mean_radius_km":"789 km","orbit_distance_km":"~436,300 km","texture_source_url":null},{"name":"Oberon","type":"Major moon","theme":"moon","description":"A distant major moon with old cratered terrain and bright crater deposits.","moon_anchor":[14.0,-0.12,8.8],"moon_radius":0.115,"moon_label_lift":0.235,"moon_color":"#8f8980","mean_radius_km":"761 km","orbit_distance_km":"~583,500 km","texture_source_url":null}];""",
    "moon_feature_data": r"""    const moonFeatureData = [{"name":"Verona Rupes","type":"Fault scarp","theme":"moon","moon_name":"Miranda","lat":-22.8,"lon":347.8,"description":"A dramatic scarp on Miranda often cited among the tallest cliffs in the Solar System."},{"name":"Arden Corona","type":"Corona terrain","theme":"moon","moon_name":"Miranda","lat":-35.0,"lon":0.0,"description":"A large ovoid tectonic terrain on Miranda centered on the sub-Uranus hemisphere."},{"name":"Kachina Chasmata","type":"Chasmata","theme":"moon","moon_name":"Ariel","lat":-9.0,"lon":246.0,"description":"A major canyon system on Ariel."},{"name":"Wunda Crater","type":"Impact crater","theme":"moon","moon_name":"Umbriel","lat":-7.9,"lon":273.6,"description":"A bright-ringed crater on dark Umbriel."},{"name":"Messina Chasma","type":"Rift valley","theme":"moon","moon_name":"Titania","lat":-33.3,"lon":335.0,"description":"A major extensional valley system on Titania."},{"name":"Hamlet Crater","type":"Impact crater","theme":"moon","moon_name":"Oberon","lat":-46.1,"lon":44.4,"description":"A prominent bright-rayed crater on Oberon."}];""",
    "manifest_planet_key": "uranus",
    "manifest_extra": '"body_scale_y": 0.9771, "axial_tilt_deg": 97.77',
    "rings_in_manifest": True,
    # UI strings
    "preload_texture":  "uranus_body_color.jpg",
    "preload_elevation": "uranus_elevation.png",
    "preload_geology":  "uranus_geology_sim3292.png",
    "icon_src":         "../../../assets/uranus_icon.png",
    "audio_label":      "NASA Voyager 2 sounds of Uranus",
    "audio_src":        "assets/uranus_sounds.mp4",
    "seismic_no_mag":   "No seismic magnitude filtering is available for Uranus.",
    "seismic_no_time":  "No seismic timeline is available for Uranus.",
    "intro_text":       "Drag to orbit, scroll to zoom, and inspect Uranus as a textured 3D globe with its tilted ring system, polar atmosphere, and optional derived context layers.",
    "core_hide_copy":   "Hide Uranus's upper atmospheric shells in core view.",
    "core_inspect_copy":"Inspect Uranus's inferred interior cutaway and layer labels.",
    "measure_copy":     "Choose a tool, then click on Uranus to start measuring.",
    "interior_note":    "This cutaway is schematic. Uranus's deep structure is inferred from gravity, magnetic-field measurements, and atmospheric modeling rather than direct sampling.",
    "envelope_li":      "<li>Molecular envelope: most of Uranus by volume is a water-methane-ammonia ice mixture under increasing pressure — sometimes called an ice giant mantle</li>",
    "about_heading":    "About Uranus",
    "about_text":       "Uranus is the seventh planet from the Sun, an ice giant with an equatorial radius of ~25,559 km and an extreme axial tilt of ~98°, causing each pole to face the Sun for about 42 years at a time. Its blue-green colour comes from methane absorbing red light in the upper atmosphere. Uranus has 13 known rings and 28 known moons, the five largest being Miranda, Ariel, Umbriel, Titania, and Oberon.",
    "guide_kicker":     "GeoID Uranus Guide",
    "guide_title":      "Using The Uranus Explorer",
    "reset_help":       "beside the Uranus title in the top-left panel header to return to the default framing and clear any active tour or moon viewer.",
    "panel_help":       "The left panel runs from navigation to interpretation. <strong>Tour Mode</strong> steps through curated stop sequences by theme. <strong>Locations</strong> controls surface labels by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and cloud displacement. <strong>Regions</strong> masks broad latitudinal zones. <strong>Core View</strong> shows Uranus's layered interior structure. <strong>Moon Viewer</strong> flies to Uranus's major moons. The bottom-right HUD shows live cursor latitude, longitude, and map scale.",
    "moon_help":        "Select one of Uranus's major moons — Miranda, Ariel, Umbriel, Titania, or Oberon — from the Moon Viewer section to fly out to the moon in close orbit. The panel focuses to show moon-specific labels including chasms, coronae, and crater features. Click any moon feature label for its description and orbital data.",
    "geology_desc":     "Enhanced atmospheric context layer derived from the official NASA Uranus image, emphasising subtle banding and haze structure.",
    "rings_manifest": {
        "path": "assets/uranus_rings.png",
        "inner_km": 37000, "outer_km": 51500,
        "inner_radius": 3.552, "outer_radius": 7.596,
        "opacity": 0.72, "texture_repeat": 1, "texture_offset": 0,
        "source_page_url": "https://science.nasa.gov/uranus/facts/",
    },
},

"neptune": {
    "planet_upper": "NEPTUNE",
    "planet_cap":   "Neptune",
    "eq_radius_km": 24622,
    "mean_radius_km": 24341,
    "rot_real_expr": "16.11 * 3600000",
    "rot_comment":   "sidereal day",
    "display_period_ms": 600000,
    "body_scale_y": 0.9886,
    "axial_tilt_deg": 28.32,
    "heavy_core_r": 0.22,
    "metallic_h_r": 0.58,
    "molecular_r":  0.96,
    "ring_reference_km": """\
    const NEPTUNE_RING_REFERENCE_KM = {
      dInner: 41900, cInner: 53200, bInner: 53450, cassiniInner: 62000,
      aInner: 62400, aOuter: 62950, enckeCenter: 62200, keelerCenter: 62700,
      fRing: 62932, mainOuter: 63000,
    };""",
    "texture_centered_moons": '["Triton"]',
    "west_positive_moons": '[]',
    "moon_periods_days": """\
    const MOON_PERIODS_DAYS = {
      "Triton": -5.8769, "Proteus": 1.1223, "Nereid": 360.1362,
      "Larissa": 0.5554, "Galatea": 0.4287,
    };""",
    "moon_self_rot_days": '    const MOON_SELF_ROT_DAYS = {};',
    "moon_viewer_textures": """\
    const MOON_VIEWER_TEXTURES = {
      Triton: "assets/triton_color_map.jpg",
    };""",
    "label_data": r"""    const labelData = [{"name":"Great Dark Spot","type":"Dark vortex","lat":-22.0,"lon":210.0,"theme":"storm","description":"Representative location for Neptune's large dark vortex systems observed by Voyager 2 and later monitoring."},{"name":"Scooter Cloud","type":"Bright methane cloud","lat":-42.0,"lon":150.0,"theme":"storm","description":"A bright fast-moving methane cloud feature associated with Neptune's dynamic weather."},{"name":"Dark Spot 2","type":"Small dark vortex","lat":-55.0,"lon":45.0,"theme":"storm","description":"A smaller dark spot observed by Voyager 2 south of the Great Dark Spot, tracking alongside it."},{"name":"South Polar Band","type":"Polar atmosphere","lat":-70.0,"lon":260.0,"theme":"polar","description":"Representative high-latitude southern atmosphere and cloud structure."},{"name":"North Polar Haze","type":"Polar haze","lat":68.0,"lon":30.0,"theme":"polar","description":"A northern high-latitude haze region in enhanced atmospheric views."},{"name":"Equatorial Zone","type":"Cloud zone","lat":0.0,"lon":0.0,"theme":"band","description":"A broad equatorial cloud zone shaped by Neptune's high-speed zonal winds."},{"name":"Southern Mid-Latitude Belt","type":"Cloud belt","lat":-35.0,"lon":95.0,"theme":"band","description":"A southern mid-latitude belt where bright methane clouds and darker bands recur."},{"name":"Northern Mid-Latitude Belt","type":"Cloud belt","lat":35.0,"lon":285.0,"theme":"band","description":"A representative northern band used for orientation in the cloud-top texture."},{"name":"South Polar Region","type":"Polar atmosphere","lat":-85.0,"lon":0.0,"theme":"polar","description":"Neptune's south polar region, which appears slightly brighter at thermal wavelengths due to seasonal heating."},{"name":"Triton Ring Plane Crossing Zone","type":"Ring plane zone","lat":0.0,"lon":180.0,"theme":"landing","description":"Equatorial zone used as orientation for Neptune's ring system and Triton's highly inclined retrograde orbit."},{"name":"Voyager 2 Closest Approach","type":"Mission corridor","lat":-30.0,"lon":45.0,"theme":"landing","description":"Representative encounter region for Voyager 2's 1989 Neptune flyby."}];""",
    "ring_label_data": r"""    const ringLabelData = [{"name":"Galle Ring","type":"Diffuse inner ring","theme":"ring","description":"Neptune's faint diffuse innermost ring.","ring_region":"Inner ring","ring_radius_km":"~41,900 km from Neptune center","ring_anchor":[4.5315,0,2.1131],"ring_label":[4.9394,0.18,2.3033],"ring_line_end":[4.7309,0.12,2.2061]},{"name":"Le Verrier Ring","type":"Narrow ring","theme":"ring","description":"A narrow ring in Neptune's middle ring system.","ring_region":"Middle ring","ring_radius_km":"~53,200 km from Neptune center","ring_anchor":[-1.6047,0,5.9887],"ring_label":[-1.7211,0.18,6.4234],"ring_line_end":[-1.6616,0.12,6.2012]},{"name":"Adams Ring","type":"Arc-bearing ring","theme":"ring","description":"Neptune's outermost and brightest ring, famous for its distinct bright arcs — Liberté, Égalité, and Fraternité.","ring_region":"Outer main ring","ring_radius_km":"~62,900 km from Neptune center","ring_anchor":[4.5886,0,-6.5532],"ring_label":[4.8467,0.18,-6.9218],"ring_line_end":[4.7148,0.12,-6.7334]}];""",
    "moon_data": r"""    const moonData = [{"name":"Triton","type":"Major moon","theme":"moon","description":"Neptune's largest moon, a captured Kuiper Belt object with nitrogen geysers and a retrograde orbit that slowly decays toward Neptune.","moon_anchor":[7.8,0.1,5.8],"moon_radius":0.135,"moon_label_lift":0.255,"moon_color":"#d7c7b9","mean_radius_km":"1,353 km","orbit_distance_km":"~354,800 km","texture_source_url":null},{"name":"Proteus","type":"Inner moon","theme":"moon","description":"A dark irregular inner moon and one of Neptune's largest regular satellites, discovered by Voyager 2.","moon_anchor":[-8.8,-0.06,6.6],"moon_radius":0.07,"moon_label_lift":0.19,"moon_color":"#5c5853","mean_radius_km":"210 km","orbit_distance_km":"~117,600 km","texture_source_url":null},{"name":"Nereid","type":"Irregular moon","theme":"moon","description":"A distant moon with a highly eccentric orbit, discovered before the Voyager encounter.","moon_anchor":[-12.4,0.12,-8.0],"moon_radius":0.052,"moon_label_lift":0.172,"moon_color":"#8b8174","mean_radius_km":"170 km","orbit_distance_km":"~5,513,400 km","texture_source_url":null},{"name":"Larissa","type":"Inner moon","theme":"moon","description":"A small dark inner moon orbiting near Neptune's rings.","moon_anchor":[9.8,-0.08,-7.6],"moon_radius":0.044,"moon_label_lift":0.164,"moon_color":"#615d58","mean_radius_km":"97 km","orbit_distance_km":"~73,500 km","texture_source_url":null},{"name":"Galatea","type":"Inner moon","theme":"moon","description":"An inner moon whose gravity helps confine structure in Neptune's Adams ring arcs.","moon_anchor":[6.2,0.05,-8.4],"moon_radius":0.038,"moon_label_lift":0.158,"moon_color":"#6a6660","mean_radius_km":"88 km","orbit_distance_km":"~62,000 km","texture_source_url":null}];""",
    "moon_feature_data": r"""    const moonFeatureData = [{"name":"Triton South Polar Cap","type":"Nitrogen frost cap","theme":"moon","moon_name":"Triton","lat":-75.0,"lon":0.0,"description":"A bright volatile frost region on Triton's south polar terrain."},{"name":"Hili Plume","type":"Plume source region","theme":"moon","moon_name":"Triton","lat":-57.0,"lon":28.0,"description":"One of Triton's active geyser plumes observed by Voyager 2, erupting nitrogen gas and dark particles."},{"name":"Cipango Planum","type":"Cantaloupe terrain","theme":"moon","moon_name":"Triton","lat":11.5,"lon":34.0,"description":"A named region of Triton's distinctive cantaloupe terrain, formed by diapirism of icy material."},{"name":"Proteus Cratered Terrain","type":"Impact terrain","theme":"moon","moon_name":"Proteus","lat":0.0,"lon":120.0,"description":"Representative old cratered terrain on Proteus."},{"name":"Nereid Reference Meridian","type":"Reference sector","theme":"moon","moon_name":"Nereid","lat":0.0,"lon":0.0,"description":"A representative orientation marker for Nereid in the moon viewer."}];""",
    "manifest_planet_key": "neptune",
    "manifest_extra": '"body_scale_y": 0.9886, "axial_tilt_deg": 28.32',
    "rings_in_manifest": True,
    # UI strings
    "preload_texture":  "neptune_color.jpg",
    "preload_elevation": "neptune_elevation.png",
    "preload_geology":  "neptune_geology_sim3292.png",
    "icon_src":         "../../../assets/neptune_icon.png",
    "audio_label":      "NASA Voyager 2 sounds of Neptune",
    "audio_src":        "assets/neptune_sounds.mp4",
    "seismic_no_mag":   "No seismic magnitude filtering is available for Neptune.",
    "seismic_no_time":  "No seismic timeline is available for Neptune.",
    "intro_text":       "Drag to orbit, scroll to zoom, and inspect Neptune as a textured 3D globe with dynamic storm systems, faint rings, and optional derived context layers.",
    "core_hide_copy":   "Hide Neptune's upper atmospheric shells in core view.",
    "core_inspect_copy":"Inspect Neptune's inferred interior cutaway and layer labels.",
    "measure_copy":     "Choose a tool, then click on Neptune to start measuring.",
    "interior_note":    "This cutaway is schematic. Neptune's deep structure is inferred from gravity, magnetic-field measurements, and atmospheric modeling rather than direct sampling.",
    "envelope_li":      "<li>Molecular envelope: most of Neptune by volume is a water-methane-ammonia ice mixture under increasing pressure — sometimes called an ice giant mantle</li>",
    "about_heading":    "About Neptune",
    "about_text":       "Neptune is the eighth and outermost planet from the Sun, an ice giant with an equatorial radius of ~24,622 km. Its deep blue colour comes from methane and possibly other compounds absorbing red light. Neptune has the strongest sustained winds in the Solar System, reaching ~2,100 km/h. It has 16 known moons; the largest, Triton, orbits retrograde and is likely a captured Kuiper Belt object.",
    "guide_kicker":     "GeoID Neptune Guide",
    "guide_title":      "Using The Neptune Explorer",
    "reset_help":       "beside the Neptune title in the top-left panel header to return to the default framing and clear any active tour or moon viewer.",
    "panel_help":       "The left panel runs from navigation to interpretation. <strong>Tour Mode</strong> steps through curated stop sequences by theme. <strong>Locations</strong> controls surface labels by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and cloud displacement. <strong>Regions</strong> masks broad latitudinal zones. <strong>Core View</strong> shows Neptune's layered interior structure. <strong>Moon Viewer</strong> flies to Neptune's major moons. The bottom-right HUD shows live cursor latitude, longitude, and map scale.",
    "moon_help":        "Select one of Neptune's moons — Triton, Proteus, Nereid, Larissa, or Galatea — from the Moon Viewer section to fly out to the moon in close orbit. The panel focuses to show moon-specific labels including Triton's polar caps, geysers, and cantaloupe terrain. Click any moon feature label for its description and orbital data.",
    "geology_desc":     "Enhanced atmospheric context layer derived from the official NASA Neptune image, emphasising cloud banding and storm features.",
    "rings_manifest": {
        "path": "assets/neptune_rings.png",
        "inner_km": 41900, "outer_km": 63000,
        "inner_radius": 3.552, "outer_radius": 7.596,
        "opacity": 0.55, "texture_repeat": 1, "texture_offset": 0,
        "source_page_url": "https://science.nasa.gov/neptune/facts/",
    },
},

}

# ─── Saturn originals to replace ─────────────────────────────────────────────

SATURN_EQ_RADIUS_LINE       = "    const SATURN_EQUATORIAL_RADIUS_KM = 60268;"
SATURN_RING_REF_BLOCK       = """\
    const SATURN_RING_REFERENCE_KM = {
      dInner: 66900,
      cInner: 74500,
      bInner: 92000,
      cassiniInner: 117580,
      aInner: 122170,
      enckeCenter: 133584,
      keelerCenter: 136505,
      aOuter: 136780,
      fRing: 140220,
      mainOuter: 143000,
    };"""
SATURN_TEXTURE_CENTERED     = '    const TEXTURE_CENTERED_MOONS = new Set(["Tethys", "Titan", "Phoebe"]);'
SATURN_WEST_POSITIVE        = '    const WEST_POSITIVE_TEXTURE_MOONS = new Set(["Hyperion"]);'
SATURN_MOON_PERIODS_BLOCK   = """\
    const MOON_PERIODS_DAYS = {
      "Pan": 0.5749, "Daphnis": 0.5940, "Atlas": 0.6017, "Prometheus": 0.6130,
      "Pandora": 0.6285, "Epimetheus": 0.6942, "Janus": 0.6945, "Aegaeon": 0.8081,
      "Methone": 1.0096, "Anthe": 1.0365, "Pallene": 1.1538, "Mimas": 0.9424,
      "Enceladus": 1.3702, "Telesto": 1.8878, "Tethys": 1.8878, "Calypso": 1.8878,
      "Dione": 2.7369, "Helene": 2.7369, "Polydeuces": 2.7369, "Rhea": 4.5175,
      "Titan": 15.9454, "Hyperion": 21.2766, "Iapetus": 79.3302, "Phoebe": -550.31,
    };"""
SATURN_MOON_SELF_ROT        = '    const MOON_SELF_ROT_DAYS = { "Hyperion": 13.0, "Phoebe": 0.38638 };'
SATURN_DISPLAY_PERIOD       = "    const _SATURN_DISPLAY_PERIOD_MS = 600000;"
SATURN_ROT_REAL             = "    const _SATURN_ROT_REAL_MS = 10.5606 * 3600000; // 38,018,160 ms"
SATURN_MOON_SPEED_FACTOR    = "    const _MOON_SPEED_FACTOR = _SATURN_ROT_REAL_MS / _SATURN_DISPLAY_PERIOD_MS; // ≈ 63.36×"
SATURN_MOON_VIEWER_TEXTURES = """\
    const MOON_VIEWER_TEXTURES = {
      // Major moons — mission-derived maps
      Mimas:      "assets/mimas_color_map.jpg",
      Enceladus:  "assets/enceladus_color_map.jpg",
      Tethys:     "assets/tethys_color.jpg",
      Dione:      "assets/Dione_Color_Map.jpg",
      Rhea:       "assets/rhea_color_map.jpg",
      Titan:      "assets/titan_color_map.jpg",
      Iapetus:    "assets/iapetus_color_map.jpg",
      Hyperion:   "assets/hyperion_color_map.jpg",
      Phoebe:     "assets/phoebe_color_map.jpg",
      // Mid-sized inner moons — individual Cassini-derived maps
      Epimetheus: "assets/epimetheus_color_map.jpg",
      Janus:      "assets/janus_color_map.jpg",
      Prometheus: "assets/prometheus_color_map.jpg",
      // Trojan / shepherd moons — generic icy surface stand-in
      Pandora:    "assets/pandora_color_map.jpg",
      Pan:        "assets/pan_color_map.jpg",
      Atlas:      "assets/atlas_color_map.jpg",
      Helene:     "assets/helene_color_map.jpg",
      Calypso:    "assets/calypso_color_map.jpg",
      Telesto:    "assets/telesto_color_map.jpg",
      Daphnis:    "assets/daphnis_color_map.jpg",
    };"""
SATURN_MEAN_RADIUS          = "    const SATURN_MEAN_RADIUS_KM = MARS_MEAN_RADIUS_KM;"
SATURN_VIEW_MODE_SELECT     = '    const saturnViewModeSelect = document.getElementById("saturn-view-mode");'
SATURN_INTERIOR_FRACS       = """\
      const SATURN_HEAVY_CORE_RADIUS = 0.22;
      const SATURN_METALLIC_HYDROGEN_RADIUS = 0.58;
      const SATURN_MOLECULAR_ENVELOPE_RADIUS = 0.96;"""

# Read the labelData / ringLabelData / moonData / moonFeatureData lines from
# the saturn-viewer.js file at runtime so we don't embed a 30 kB string here.
def read_saturn_data_line(src_text, varname):
    """Extract a const array declaration (may span multiple lines): 'const varname = [...];'"""
    idx = src_text.find(f"const {varname} = [")
    if idx == -1:
        raise ValueError(f"Could not find: const {varname}")
    # Walk back to start of line
    line_start = src_text.rfind("\n", 0, idx) + 1
    # Find the closing '];'
    end = src_text.find("];", idx)
    if end == -1:
        raise ValueError(f"Could not find closing ]; for {varname}")
    return src_text[line_start:end + 2]


# ─── manifest builder ─────────────────────────────────────────────────────────

def build_manifest_js(planet_name, p, manifest_json_path, template_manifest_path):
    """Build {planet}-manifest.js by reading the planet's manifest.json and
    injecting the planet key + rings block, then formatting like saturn-manifest.js."""

    with open(manifest_json_path, encoding="utf-8") as f:
        mdata = json.load(f)

    pu = planet_name  # "jupiter"
    # Ensure asset paths are prefixed with "assets/"
    def prefix(path):
        if path and not path.startswith("assets/") and not path.startswith("http"):
            return "assets/" + path
        return path

    def prefixed_mdata(d):
        """Recursively prefix bare paths in manifest dict."""
        if isinstance(d, dict):
            for k, v in d.items():
                if k == "path" and isinstance(v, str):
                    d[k] = prefix(v)
                elif k == "feature_path" and isinstance(v, str):
                    d[k] = prefix(v)
                elif k == "legend_path" and isinstance(v, str):
                    d[k] = prefix(v)
                elif isinstance(v, (dict, list)):
                    prefixed_mdata(v)
        elif isinstance(d, list):
            for item in d:
                prefixed_mdata(item)

    prefixed_mdata(mdata)

    # Add planet key with body_scale_y, axial_tilt_deg, and optional rings
    planet_block = {
        "body_scale_y": p["body_scale_y"],
        "axial_tilt_deg": p["axial_tilt_deg"],
    }
    if p.get("rings_in_manifest") and "rings_manifest" in p:
        planet_block["rings"] = p["rings_manifest"]
    mdata[pu] = planet_block

    # Read the template manifest.js boilerplate (lines 2 onward)
    tmpl = read(template_manifest_path)
    boilerplate_start = tmpl.index("\n", tmpl.index("const manifest")) + 1
    boilerplate = tmpl[boilerplate_start:]

    # Build the manifest line
    manifest_line = "    const manifest = " + json.dumps(mdata, separators=(",", ":")) + ";"
    # Replace Saturn window globals in boilerplate with planet-specific names
    boilerplate = boilerplate.replace("__saturnViewerManifest", f"__{pu}ViewerManifest")
    boilerplate = boilerplate.replace("__saturnViewerStartup",  f"__{pu}ViewerStartup")
    boilerplate = boilerplate.replace("__saturnViewerDebug",    f"__{pu}ViewerDebug")
    return manifest_line + "\n" + boilerplate


# ─── viewer patcher ───────────────────────────────────────────────────────────

def patch_viewer(src_text, planet_name, p):
    P = p["planet_upper"]   # "JUPITER"
    Pc = p["planet_cap"]    # "Jupiter"
    pl = planet_name        # "jupiter"
    plc = pl                # same for variable names

    t = src_text

    # ── data arrays (single-line replacements, read from src) ──────────────
    t = patch(t, read_saturn_data_line(t, "labelData"),       p["label_data"])
    t = patch(t, read_saturn_data_line(t, "ringLabelData"),   p["ring_label_data"])
    t = patch(t, read_saturn_data_line(t, "moonData"),        p["moon_data"])
    t = patch(t, read_saturn_data_line(t, "moonFeatureData"), p["moon_feature_data"])

    # ── SATURN_ prefix constant renames (all occurrences) ──────────────────
    t = patch_all(t, "SATURN_EQUATORIAL_RADIUS_KM", f"{P}_EQUATORIAL_RADIUS_KM")
    t = patch_all(t, "SATURN_SCENE_RADIUS",         f"{P}_SCENE_RADIUS")
    t = patch_all(t, "SATURN_KM_TO_SCENE",          f"{P}_KM_TO_SCENE")
    t = patch_all(t, "SATURN_EXPOSED_INTERIOR_RFRAC", f"{P}_EXPOSED_INTERIOR_RFRAC")
    t = patch_all(t, "SATURN_RING_REFERENCE_KM",    f"{P}_RING_REFERENCE_KM")
    t = patch_all(t, "SATURN_HEAVY_CORE_RADIUS",    f"{P}_HEAVY_CORE_RADIUS")
    t = patch_all(t, "SATURN_METALLIC_HYDROGEN_RADIUS", f"{P}_METALLIC_HYDROGEN_RADIUS")
    t = patch_all(t, "SATURN_MOLECULAR_ENVELOPE_RADIUS", f"{P}_MOLECULAR_ENVELOPE_RADIUS")
    t = patch_all(t, "SATURN_MEAN_RADIUS_KM",       f"{P}_MEAN_RADIUS_KM")
    t = patch_all(t, "_SATURN_DISPLAY_PERIOD_MS",   "_PLANET_DISPLAY_PERIOD_MS")
    t = patch_all(t, "_SATURN_ROT_REAL_MS",         "_PLANET_ROT_REAL_MS")
    t = patch_all(t, "saturnViewModeSelect",         f"{plc}ViewModeSelect")
    t = patch_all(t, "saturnSceneGroup",             f"{plc}SceneGroup")
    t = patch_all(t, "saturnConfig",                 f"{plc}Config")
    t = patch_all(t, "saturnBodyScaleY",             f"{plc}BodyScaleY")
    t = patch_all(t, "saturnAxialTiltDeg",           f"{plc}AxialTiltDeg")
    t = patch_all(t, "createCalibratedSaturnRingTexture", f"createCalibrated{Pc}RingTexture")
    t = patch_all(t, '"saturn-view-mode"',           f'"{pl}-view-mode"')
    t = patch_all(t, '"saturn-interior-surface"',    f'"{pl}-interior-surface"')
    t = patch_all(t, "manifest.saturn",              f"manifest.{pl}")

    # ── numeric constant values ─────────────────────────────────────────────
    t = patch(t,
        f"    const {P}_EQUATORIAL_RADIUS_KM = 60268;",
        f"    const {P}_EQUATORIAL_RADIUS_KM = {p['eq_radius_km']};"
    )
    t = patch(t,
        f"    const {P}_MEAN_RADIUS_KM = MARS_MEAN_RADIUS_KM;",
        f"    const {P}_MEAN_RADIUS_KM = MARS_MEAN_RADIUS_KM; // {p['mean_radius_km']} km"
    )

    # ── ring reference block ───────────────────────────────────────────────
    old_ring_ref = SATURN_RING_REF_BLOCK.replace("SATURN_RING_REFERENCE_KM", f"{P}_RING_REFERENCE_KM")
    t = patch(t, old_ring_ref, p["ring_reference_km"])

    # ── TEXTURE_CENTERED_MOONS / WEST_POSITIVE_TEXTURE_MOONS ──────────────
    t = patch(t, SATURN_TEXTURE_CENTERED,
        f'    const TEXTURE_CENTERED_MOONS = new Set({p["texture_centered_moons"]});')
    t = patch(t, SATURN_WEST_POSITIVE,
        f'    const WEST_POSITIVE_TEXTURE_MOONS = new Set({p["west_positive_moons"]});')

    # ── MOON_PERIODS_DAYS block ────────────────────────────────────────────
    t = patch(t, SATURN_MOON_PERIODS_BLOCK, p["moon_periods_days"])

    # ── MOON_SELF_ROT_DAYS ─────────────────────────────────────────────────
    t = patch(t, SATURN_MOON_SELF_ROT, p["moon_self_rot_days"])

    # ── rotation period / display period ──────────────────────────────────
    t = patch(t,
        "    const _PLANET_DISPLAY_PERIOD_MS = 600000;",
        f"    const _PLANET_DISPLAY_PERIOD_MS = {p['display_period_ms']};"
    )
    t = patch(t,
        "    const _PLANET_ROT_REAL_MS = 10.5606 * 3600000; // 38,018,160 ms",
        f"    const _PLANET_ROT_REAL_MS = {p['rot_real_expr']}; // {p['rot_comment']}"
    )
    t = patch(t,
        "    const _MOON_SPEED_FACTOR = _PLANET_ROT_REAL_MS / _PLANET_DISPLAY_PERIOD_MS; // ≈ 63.36×",
        "    const _MOON_SPEED_FACTOR = _PLANET_ROT_REAL_MS / _PLANET_DISPLAY_PERIOD_MS;"
    )

    # ── MOON_VIEWER_TEXTURES block ─────────────────────────────────────────
    t = patch(t, SATURN_MOON_VIEWER_TEXTURES, p["moon_viewer_textures"])

    # ── interior structure fracs ───────────────────────────────────────────
    old_fracs = SATURN_INTERIOR_FRACS.replace("SATURN_", f"{P}_")
    new_fracs = f"""\
      const {P}_HEAVY_CORE_RADIUS = {p['heavy_core_r']};
      const {P}_METALLIC_HYDROGEN_RADIUS = {p['metallic_h_r']};
      const {P}_MOLECULAR_ENVELOPE_RADIUS = {p['molecular_r']};"""
    t = patch(t, old_fracs, new_fracs)

    # ── sweep remaining SATURN_ / SATURN (UPPER_CASE) identifiers ────────
    t = t.replace("SATURN_", f"{P}_")
    t = t.replace("SATURN", P)   # bare uppercase (e.g. "SATURN CLOUD TOPS")

    # ── sweep remaining camelCase/PascalCase saturn symbols ───────────────
    # Covers: buildSaturnSolidInterior, saturnSolidInterior, saturnCenter,
    #         configureSaturnUi, applySaturnViewMode, etc.
    t = t.replace("Saturn", Pc)   # PascalCase
    t = t.replace("saturn", pl)   # camelCase / lowercase

    return t


# ─── index.html patcher ───────────────────────────────────────────────────────

def patch_index(src_text, planet_name, p):
    t = src_text
    pl = planet_name
    Pc = p["planet_cap"]

    # ── script / asset references ──────────────────────────────────────────
    t = t.replace("saturn-manifest.js", f"{pl}-manifest.js")
    t = t.replace("saturn-viewer.js",   f"{pl}-viewer.js")
    t = t.replace('"saturn-view-mode"', f'"{pl}-view-mode"')

    # ── head preloads ──────────────────────────────────────────────────────
    t = t.replace('href="assets/saturn_body_color.jpg"',
                  f'href="assets/{p["preload_texture"]}"')
    t = t.replace('href="assets/saturn_elevation.png"',
                  f'href="assets/{p["preload_elevation"]}"')
    t = t.replace('href="assets/saturn_geology_sim3292.png"',
                  f'href="assets/{p["preload_geology"]}"')

    # ── title / heading ────────────────────────────────────────────────────
    t = t.replace('<title>Saturn</title>', f'<title>{Pc}</title>')
    t = t.replace('<h1>Saturn</h1>', f'<h1>{Pc}</h1>')

    # ── intro paragraph ────────────────────────────────────────────────────
    t = t.replace(
        'Drag to orbit, scroll to zoom, and inspect Saturn as a textured 3D globe with atmospheric banding, polar structures, and optional derived context layers.',
        p["intro_text"]
    )

    # ── brand logo ─────────────────────────────────────────────────────────
    t = t.replace(
        'src="../../../assets/saturn_icon.png" alt="Saturn icon"',
        f'src="{p["icon_src"]}" alt="{Pc} icon"'
    )

    # ── audio ──────────────────────────────────────────────────────────────
    t = t.replace(
        'aria-label="Play / pause Saturn sounds"',
        f'aria-label="Play / pause {Pc} sounds"'
    )
    t = t.replace(
        '<p class="mars-audio-label">NASA Saturn-Enceladus radio emissions</p>',
        f'<p class="mars-audio-label">{p["audio_label"]}</p>'
    )
    t = t.replace(
        '<source src="assets/saturn_sounds.mp4" type="audio/mp4">',
        f'<source src="{p["audio_src"]}" type="audio/mp4">'
    )

    # ── seismic placeholders ───────────────────────────────────────────────
    t = t.replace(
        'No seismic magnitude filtering is available for Saturn.',
        p["seismic_no_mag"]
    )
    t = t.replace(
        'No seismic timeline is available for Saturn.',
        p["seismic_no_time"]
    )

    # ── core view copy ─────────────────────────────────────────────────────
    t = t.replace(
        "Hide Saturn's upper atmospheric shells in core view.",
        p["core_hide_copy"]
    )
    t = t.replace(
        "Inspect Saturn's inferred interior cutaway and layer labels.",
        p["core_inspect_copy"]
    )

    # ── measure tool ──────────────────────────────────────────────────────
    t = t.replace(
        'Choose a tool, then click on Saturn to start measuring.',
        p["measure_copy"]
    )

    # ── hemisphere locator ─────────────────────────────────────────────────
    t = t.replace(
        'aria-label="Saturn hemisphere locator"',
        f'aria-label="{Pc} hemisphere locator"'
    )

    # ── interior schematic note ────────────────────────────────────────────
    t = t.replace(
        "This cutaway is schematic. Saturn's deep structure is inferred from gravity, magnetic-field measurements, ring seismology, and atmospheric modeling rather than direct sampling.",
        p["interior_note"]
    )
    t = t.replace(
        "<li>Molecular envelope: most of Saturn by volume is hydrogen-helium fluid under increasing pressure</li>",
        p["envelope_li"]
    )

    # ── help panel ─────────────────────────────────────────────────────────
    t = t.replace(
        '<p class="viewer-help-kicker">GeoID Saturn Guide</p>',
        f'<p class="viewer-help-kicker">{p["guide_kicker"]}</p>'
    )
    t = t.replace(
        '<h2 id="viewer-help-title">Using The Saturn Explorer</h2>',
        f'<h2 id="viewer-help-title">{p["guide_title"]}</h2>'
    )
    t = t.replace(
        'Use the reset button beside the Saturn title in the top-left panel header to return to the default framing and clear any active tour or moon viewer.',
        f'Use the reset button {p["reset_help"]}'
    )
    t = t.replace(
        "The left panel runs from navigation to interpretation. <strong>Tour Mode</strong> steps through curated stop sequences by theme. <strong>Locations</strong> controls surface labels by category. <strong>Basemap &amp; Relief</strong> sets the globe texture and cloud displacement. <strong>Regions</strong> masks broad latitudinal zones. <strong>Core View</strong> shows Saturn's layered interior structure. <strong>Moon Viewer</strong> flies to Saturn's major moons. The bottom-right HUD shows live cursor latitude, longitude, and map scale.",
        p["panel_help"]
    )
    t = t.replace(
        "Select one of Saturn's major moons — Titan, Enceladus, Mimas, Tethys, Dione, Rhea, or Iapetus — from the Moon Viewer section to fly out to the moon in close orbit. The panel focuses to show moon-specific labels including craters, chasms, and geological features. Click any moon feature label for its description and orbital data.",
        p["moon_help"]
    )

    # ── geology description ────────────────────────────────────────────────
    t = t.replace(
        'Enhanced atmospheric context layer derived from the official NASA Saturn image, emphasising banding and cloud structure.',
        p["geology_desc"]
    )

    # ── about section ──────────────────────────────────────────────────────
    t = t.replace('<h3>About Saturn</h3>', f'<h3>{p["about_heading"]}</h3>')
    t = t.replace(
        "Saturn is the sixth planet from the Sun and the second largest in the Solar System, with an equatorial radius of ~60,268 km. Its iconic ring system spans up to ~480,000 km from the planet's centre and consists primarily of water ice particles. Saturn's atmosphere is dominated by hydrogen and helium with ammonia ice clouds visible at the ~1 bar pressure level. The planet has at least 146 known moons — seven of which are large enough to be nearly spherical.",
        p["about_text"]
    )

    # ── boot function / window globals ─────────────────────────────────────
    t = t.replace("bootSaturnViewer",          f"boot{Pc}Viewer")
    t = t.replace("__saturnViewerManifest",    f"__{pl}ViewerManifest")
    t = t.replace("__saturnViewerStartup",     f"__{pl}ViewerStartup")
    t = t.replace('"20260430-saturn"',         f'"20260508-{pl}"')
    t = t.replace("?v=20260430-saturn",        f"?v=20260508-{pl}")

    return t


# ─── main ─────────────────────────────────────────────────────────────────────

# Build CSV-driven moon feature data for each planet.
for _pname, _p in PLANETS.items():
    centered = json.loads(_p.get("texture_centered_moons", "[]"))
    _p["moon_feature_data"] = build_gas_moon_feature_data(_pname, centered)

saturn_viewer_src = None  # loaded once, reused

for planet_name, p in PLANETS.items():
    print(f"\n── {p['planet_cap']} ──────────────────────────────────────")
    dst = os.path.join(BASE, planet_name, "viewer")

    # Load saturn-viewer.js once (all three folders have identical copies)
    src_path = os.path.join(dst, "saturn-viewer.js")
    if not os.path.exists(src_path):
        print(f"  SKIP: saturn-viewer.js not found in {dst}")
        continue

    saturn_src = read(src_path)

    # ── viewer ──────────────────────────────────────────────────────────────
    viewer_text = patch_viewer(saturn_src, planet_name, p)
    viewer_out  = os.path.join(dst, f"{planet_name}-viewer.js")
    write(viewer_out, viewer_text)
    print(f"  wrote {planet_name}-viewer.js")

    # ── manifest ────────────────────────────────────────────────────────────
    # Jupiter's manifest.json is in assets/, Neptune's is in assets/, Uranus is manifest.json in viewer/
    manifest_candidates = [
        os.path.join(dst, "assets", "manifest.json"),
        os.path.join(dst, "manifest.json"),
    ]
    manifest_json = next((c for c in manifest_candidates if os.path.exists(c)), None)
    if not manifest_json:
        print(f"  WARN: manifest.json not found, skipping manifest")
    else:
        template_manifest = os.path.join(dst, "saturn-manifest.js")
        manifest_js = build_manifest_js(planet_name, p, manifest_json, template_manifest)
        manifest_out = os.path.join(dst, f"{planet_name}-manifest.js")
        write(manifest_out, manifest_js)
        print(f"  wrote {planet_name}-manifest.js")

    # ── index.html ──────────────────────────────────────────────────────────
    index_path = os.path.join(dst, "index.html")
    if os.path.exists(index_path):
        index_text = patch_index(read(index_path), planet_name, p)
        write(index_path, index_text)
        print(f"  updated index.html")

    print(f"  done")

print("\nAll done.")
