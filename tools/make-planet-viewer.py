#!/usr/bin/env python3
"""
make-planet-viewer.py
─────────────────────
Generate a planet-specific viewer JS by applying a planet config to the
canonical Mars viewer source template.

Usage:
    python3 tools/make-planet-viewer.py --planet earth
    python3 tools/make-planet-viewer.py --planet moon --out GeoID_Moon/viewer/moon-viewer.js

The script reads:
  • planet_explorer/mars/viewer/mars-viewer.js   (source template, never modified)
  • tools/planet-configs/<planet>.json           (all planet-specific values)

It writes to:
  • <out>  (default: GeoID_<Planet>/viewer/<planet>-viewer.js)
"""

import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_SRC = os.path.join(REPO_ROOT, "planet_explorer", "mars", "viewer", "mars-viewer.js")
CONFIGS_DIR  = os.path.join(REPO_ROOT, "tools", "planet-configs")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--planet", required=True, help="Planet name (must match a file in tools/planet-configs/)")
    p.add_argument("--out",    default=None,  help="Output path for the viewer JS (auto-derived if omitted)")
    p.add_argument("--dry-run", action="store_true", help="Print substitution summary but do not write output")
    return p.parse_args()


# ─── Filter-spec → JS lambda ──────────────────────────────────────────────────

def filter_spec_to_js(spec: dict) -> str:
    t = spec["type"]
    if t == "type_regex":
        pat = spec["pattern"]
        return f'(item) => /{pat}/i.test(String(item.type || ""))'
    if t == "theme":
        v = spec["value"]
        return f'(item) => item.theme === "{v}"'
    if t == "theme_or_type_regex":
        theme = spec["theme"]
        pat   = spec["pattern"]
        return f'(item) => item.theme === "{theme}" || /{pat}/i.test(String(item.type || ""))'
    if t == "lat_abs_min":
        v = spec["value"]
        return (f'(item) => {{\n'
                f'          const lat = Number(item.lat);\n'
                f'          return Number.isFinite(lat) && Math.abs(lat) >= {v};\n'
                f'        }}')
    if t == "name_or_type_regex_or_lat":
        pat     = spec["pattern"]
        lat_min = spec["lat_min"]
        return (f'(item) => {{\n'
                f'          const lat = Number(item.lat);\n'
                f'          return /{pat}/i.test(String(item.type || "") + " " + String(item.name || ""))\n'
                f'            || (Number.isFinite(lat) && Math.abs(lat) >= {lat_min});\n'
                f'        }}')
    if t == "moon":
        return '(item) => item.theme === "moon" || Boolean(item.moon_name)'
    raise ValueError(f"Unknown filter type: {t!r}")


# ─── TOUR_MODE_FACETS generator ───────────────────────────────────────────────

def build_tour_mode_facets_js(facets: list) -> str:
    lines = ["    const TOUR_MODE_FACETS = ["]
    for facet in facets:
        label       = facet["label"].replace('"', '\\"')
        description = facet["description"].replace('"', '\\"')
        matches_js  = filter_spec_to_js(facet["filter"])
        lines.append(f'      {{')
        lines.append(f'        id: "{facet["id"]}",')
        lines.append(f'        label: "{label}",')
        lines.append(f'        description: "{description}",')
        lines.append(f'        matches: {matches_js},')
        lines.append(f'      }},')
    lines.append("    ];")
    return "\n".join(lines)


# ─── Compute-spec → JS lambda ─────────────────────────────────────────────────

def compute_spec_to_js(spec: dict, planet_cap: str) -> str:
    """Convert a sc_params compute spec to a JS arrow function string."""
    fn = spec["fn"]
    P  = planet_cap          # e.g. "Earth"
    p  = planet_cap.lower()  # e.g. "earth"

    if fn == "null":
        return "null"
    if fn == "temperature":
        return f"(lat, elev) => estimate{P}Temperature(lat, elev)"
    if fn == "pressure":
        return f"(_lat, elev) => estimate{P}Pressure(elev)"
    if fn == "wind":
        return f"(lat, elev) => estimate{P}WindSpeed(lat, elev)"
    if fn == "irradiance":
        return f"(lat, elev) => estimate{P}Irradiance(lat, elev)"
    if fn == "radiation":
        return f"(lat, elev) => estimate{P}Radiation(lat, elev)"
    if fn == "diurnal":
        return f"(lat, elev) => estimate{P}DiurnalRange(lat, elev)"

    # Physics helpers that delegate to the planet's own surface functions
    if fn == "atm_density_ideal_gas":
        R = spec["R_specific"]
        return (f"(_lat, elev) => {{\n"
                f"          const T_K = estimate{P}Temperature(0, elev) + 273.15;\n"
                f"          const P_ = estimate{P}Pressure(elev);\n"
                f"          return Math.round((P_ / ({R} * T_K)) * 10000) / 10000;\n"
                f"        }}")
    if fn == "sound_speed":
        gamma = spec["gamma"]
        R     = spec["R_specific"]
        return (f"(_lat, elev) => {{\n"
                f"          const T_K = estimate{P}Temperature(0, elev) + 273.15;\n"
                f"          return Math.round(Math.sqrt({gamma} * {R} * T_K));\n"
                f"        }}")
    if fn == "freezing_probability":
        freeze = spec["freeze_c"]
        rng    = spec["range_c"]
        return (f"(lat, _elev) => {{\n"
                f"          const T_mean = estimate{P}Temperature(lat, 0);\n"
                f"          return Math.round(Math.max(0, Math.min(1, ({freeze} - T_mean) / {rng})) * 100) / 100;\n"
                f"        }}")
    if fn == "permafrost_depth":
        grad = spec["gradient_mk_m"]
        return (f"(_lat, elev) => {{\n"
                f"          const T_C = estimate{P}Temperature(_lat, elev);\n"
                f"          return Math.round(Math.max(0, -T_C / {grad / 1000}));\n"
                f"        }}")
    if fn == "convective_instability":
        lat_amp = spec["lat_amp"]
        base    = spec["base"]
        elev_d  = spec["elev_div"]
        scale   = spec["scale"]
        return (f"(lat, elev) => {{\n"
                f"          const latRad = lat * Math.PI / 180;\n"
                f"          const DR = ({lat_amp} * Math.cos(latRad) ** 2 + {base}) + Math.max(0, elev) / {elev_d};\n"
                f"          const P_ = estimate{P}Pressure(elev);\n"
                f"          const P0 = estimate{P}Pressure(0);\n"
                f"          return Math.round(DR * Math.sqrt(P0 / P_) * {scale});\n"
                f"        }}")
    if fn == "solar_panel_output":
        eff   = spec["efficiency"]
        cloud = spec["cloud_factor"]
        return (f"(lat, elev) => {{\n"
                f"          const latRad = lat * Math.PI / 180;\n"
                f"          const cosLat = Math.max(Math.cos(latRad), 0.03);\n"
                f"          const irr = estimate{P}Irradiance(lat, elev);\n"
                f"          return Math.round(irr * {eff});\n"
                f"        }}")
    if fn == "liquid_water_stability":
        max_elev = spec["max_elev"]
        return (f"(lat, elev) => {{\n"
                f"          const T_mean = estimate{P}Temperature(lat, elev);\n"
                f"          const isAboveFreezing = T_mean > 0 ? 1 : 0;\n"
                f"          const isBelowBoiling  = T_mean < 100 ? 1 : 0;\n"
                f"          const elevPenalty = Math.max(0, 1 - Math.max(0, elev) / {max_elev});\n"
                f"          return Math.round(isAboveFreezing * isBelowBoiling * elevPenalty * 100) / 100;\n"
                f"        }}")
    if fn == "inline":
        return spec["js"]

    raise ValueError(f"Unknown compute fn: {fn!r}")


# ─── SC_PARAMS block generator ────────────────────────────────────────────────

def build_sc_params_js(sc_params: dict, planet_cap: str) -> str:
    lines = ["    const SC_PARAMS = {"]
    for key, p in sc_params.items():
        label   = p["label"].replace('"', '\\"')
        unit    = p["unit"].replace('"', '\\"')
        desc    = p["description"].replace('"', '\\"')
        stops   = json.dumps(p["stops"])
        compute = compute_spec_to_js(p["compute"], planet_cap)
        lines.append(f'      {key}: {{')
        lines.append(f'        label: "{label}", unit: "{unit}", min: {p["min"]}, max: {p["max"]},')
        lines.append(f'        stops: {stops},')
        lines.append(f'        compute: {compute},')
        lines.append(f'        legendA: "{p["legendA"]}", legendB: "{p["legendB"]}",')
        lines.append(f'        description: "{desc}",')
        lines.append(f'      }},')
    lines.append("    };")
    return "\n".join(lines)


# ─── Surface function bodies ──────────────────────────────────────────────────

def build_surface_functions_js(sf: dict, planet_cap: str) -> str:
    P = planet_cap
    blocks = []

    # Temperature
    t = sf["temperature"]
    if t["formula"] == "lat_elevation":
        b, d, l = t["base_c"], t["lat_drop"], t["lapse_per_km"]
        blocks.append(
            f"    function estimate{P}Temperature(latDeg, elevMeters) {{\n"
            f"      const latRad = latDeg * Math.PI / 180;\n"
            f"      const baseTempC = {b} - {d} * Math.sin(latRad) ** 2;\n"
            f"      return Math.round(baseTempC - {l} * (elevMeters / 1000));\n"
            f"    }}"
        )

    # Pressure
    p = sf["pressure"]
    if p["formula"] == "barometric":
        p0, h = p["sea_level_pa"], p["scale_height_m"]
        blocks.append(
            f"    function estimate{P}Pressure(elevMeters) {{\n"
            f"      return Math.round({p0} * Math.exp(-elevMeters / {h}));\n"
            f"    }}"
        )

    # Wind
    w = sf["wind"]
    if w["formula"] == "lat_jet_stream":
        base, jet, elev_d = w["base_speed"], w["jet_amplitude"], w["elev_boost_div"]
        blocks.append(
            f"    function estimate{P}WindSpeed(latDeg, elevMeters) {{\n"
            f"      const latRad = latDeg * Math.PI / 180;\n"
            f"      const jetStream = {jet} * Math.sin(2 * latRad) ** 2;\n"
            f"      const elevBoost = Math.max(0, elevMeters / {elev_d});\n"
            f"      return Math.round(({base} + jetStream + elevBoost) * 10) / 10;\n"
            f"    }}"
        )

    # Irradiance
    ir = sf["irradiance"]
    if ir["formula"] == "solar_lat_cloud":
        peak, cloud, elev_s = ir["peak_w_m2"], ir["cloud_factor"], ir["elev_scale"]
        blocks.append(
            f"    function estimate{P}Irradiance(latDeg, elevMeters) {{\n"
            f"      const latRad = latDeg * Math.PI / 180;\n"
            f"      const latFactor = Math.max(0, Math.cos(latRad));\n"
            f"      const cloudFactor = {cloud};\n"
            f"      const elevFactor = 1 + Math.max(0, elevMeters) / {elev_s};\n"
            f"      return Math.round({peak} * latFactor * cloudFactor * elevFactor);\n"
            f"    }}"
        )

    # Radiation (UV index)
    rd = sf["radiation"]
    if rd["formula"] == "uv_lat_elev":
        peak, elev_d = rd["peak_index"], rd["elev_boost_div"]
        blocks.append(
            f"    function estimate{P}Radiation(latDeg, elevMeters) {{\n"
            f"      const latRad = latDeg * Math.PI / 180;\n"
            f"      const latFactor = Math.max(0.1, Math.cos(latRad));\n"
            f"      const elevFactor = 1 + Math.max(0, elevMeters) / {elev_d};\n"
            f"      return Math.round(latFactor * {peak} * elevFactor * 10) / 10;\n"
            f"    }}"
        )

    # Diurnal
    di = sf["diurnal"]
    if di["formula"] == "lat_elev_range":
        amp, base, elev_d = di["lat_amplitude"], di["base_range"], di["elev_boost_div"]
        blocks.append(
            f"    function estimate{P}DiurnalRange(latDeg, elevMeters) {{\n"
            f"      const latRad = latDeg * Math.PI / 180;\n"
            f"      const base = {amp} * Math.cos(latRad) ** 2 + {base};\n"
            f"      return Math.round(base + Math.max(0, elevMeters) / {elev_d});\n"
            f"    }}"
        )

    return "\n\n".join(blocks)


# ─── REGION_MASK_DEFS generator ───────────────────────────────────────────────

def build_region_mask_defs_js(defs: dict) -> str:
    lines = ["    const REGION_MASK_DEFS = {"]
    for group_key, circles in defs.items():
        lines.append(f'      "{group_key}": [')
        for c in circles:
            lines.append(f'        {{ lat: {c["lat"]}, lon: {c["lon"]}, radiusDeg: {c["radiusDeg"]}, color: "{c["color"]}" }},')
        lines.append(f'      ],')
    lines.append("    };")
    return "\n".join(lines)


# ─── CORE_LAYER_DATA generator ────────────────────────────────────────────────

def build_core_layer_data_js(layers: list) -> str:
    lines = ["    const CORE_LAYER_DATA = ["]
    for layer in layers:
        def esc(s): return s.replace('"', '\\"').replace('\n', '\\n')
        lines.append(f'      {{')
        lines.append(f'        id: "{layer["id"]}",')
        lines.append(f'        name: "{esc(layer["name"])}",')
        lines.append(f'        type: "{esc(layer["type"])}",')
        lines.append(f'        description: "{esc(layer["description"])}",')
        lines.append(f'        depth: "{esc(layer["depth"])}",')
        lines.append(f'        composition: "{esc(layer["composition"])}",')
        lines.append(f'        temperature: "{esc(layer["temperature"])}",')
        lines.append(f'        labelX: {layer["labelX"]}, labelY: {layer["labelY"]},')
        lines.append(f'        anchorY: {layer["anchorY"]},')
        lines.append(f'      }},')
    lines.append("    ];")
    return "\n".join(lines)


# ─── BASE_LAYER_GROUPS generator ─────────────────────────────────────────────

def build_base_layer_groups_js(groups: list) -> str:
    lines = ["      const BASE_LAYER_GROUPS = ["]
    for g in groups:
        ids_js = json.dumps(g["ids"])
        lines.append(f'        {{ label: "{g["label"]}",  ids: {ids_js} }},')
    lines.append("      ];")
    return "\n".join(lines)


# ─── Interior model generators ────────────────────────────────────────────────

def build_interior_model_js(interior: dict, PLANET: str) -> str:
    layers_js = json.dumps(interior["layers"], separators=(",", ": "))
    # Reformat for readability
    layers_lines = ["    const {PLANET}_INTERIOR_LAYERS = [".format(PLANET=PLANET)]
    for layer in interior["layers"]:
        layers_lines.append(f'      {{ name: "{layer["name"]}", rMin: {layer["rMin"]:.3f}, rMax: {layer["rMax"]:.3f} }},')
    layers_lines.append("    ];")

    t_pts = json.dumps(interior["t_pts"])
    p_pts = json.dumps(interior["p_pts"])

    return (
        f"    // ── {PLANET} interior model (PREM-based) ──────────────────────────────\n"
        f"    // rFrac = 0 → centre, rFrac = 1 → surface\n"
        + "\n".join(layers_lines) + "\n"
        + f"    const {PLANET}_INTERIOR_T_PTS = {t_pts};\n"
        + f"    const {PLANET}_INTERIOR_P_PTS = {p_pts};"
    )


def build_interior_layer_colors_js(colors: dict, PLANET: str, planet_cap: str) -> str:
    lines = [f"    const {PLANET}_INTERIOR_LAYER_COLORS = {{"]
    for name, color in colors.items():
        lines.append(f'      "{name}": "{color}",')
    lines.append("    };")
    lines.append(f"")
    lines.append(f"    function {planet_cap.lower()}InteriorLayerColor(layerName) {{")
    lines.append(f'      return {PLANET}_INTERIOR_LAYER_COLORS[layerName] ?? "#f6dcc8";')
    lines.append(f"    }}")
    return "\n".join(lines)


# ─── Main substitution engine ─────────────────────────────────────────────────

def apply_config(src: str, cfg: dict) -> str:
    planet_lower = cfg["planet"]["name_lower"]            # "earth"
    planet_cap   = planet_lower.capitalize()              # "Earth"
    PLANET       = planet_lower.upper()                   # "EARTH"
    PLANET_OLD   = "MARS"
    planet_old   = "mars"
    planet_old_c = "Mars"

    def rep(old, new, count=0):
        nonlocal src
        if old not in src:
            print(f"  WARN: not found: {old[:70]!r}", file=sys.stderr)
            return
        src = src.replace(old, new) if count == 0 else src.replace(old, new, count)

    # ── 1. Debug / manifest globals ──────────────────────────────────────────
    rep(f'console.log("[ctxPatchDebug] mars-viewer.js loaded", {{ manifest: window.__marsViewerManifest',
        f'console.log("[ctxPatchDebug] {cfg["planet"]["debug_log_name"]} loaded", {{ manifest: window.__earthViewerManifest'.replace("earth", planet_lower))
    rep(f'const manifest = window.__marsViewerManifest;',
        f'const manifest = window.__{planet_lower}ViewerManifest;')

    # ── 2. labelData (single line) ────────────────────────────────────────────
    label_json = json.dumps(cfg["label_data"], ensure_ascii=False, separators=(",", ":"))
    label_js   = f"    const labelData = {label_json};"
    src = re.sub(r'    const labelData = \[.*?\];', label_js, src, count=1, flags=re.DOTALL)

    # ── 3. Remove Mars spirit-entry patch ────────────────────────────────────
    if not cfg["planet"].get("has_spirit_entry_patch", False):
        spirit_block = (
            '    const spiritEntry = labelData.find((entry) => entry.name === "Spirit");\n'
            '    if (spiritEntry) {\n'
            '      spiritEntry.lat = -14.5;\n'
            '      spiritEntry.lon = 175.4;\n'
            '    }'
        )
        rep(spirit_block, f'    // {planet_cap} viewer: no rover entry correction needed.')

    # ── 4. moonData ───────────────────────────────────────────────────────────
    moon_json = json.dumps(cfg["moon_data"], ensure_ascii=False, separators=(",", ":"))
    src = re.sub(r'const moonData = \[.*?\];', f'const moonData = {moon_json};', src, count=1)

    # ── 5. MOON_ORBIT_ECCENTRICITY ────────────────────────────────────────────
    old_eccentricity = (
        '    const MOON_ORBIT_ECCENTRICITY = Object.freeze({\n'
        '      Phobos: 0.0151,\n'
        '      Deimos: 0.0002,\n'
        '    });'
    )
    new_eccentricity_lines = ['    const MOON_ORBIT_ECCENTRICITY = Object.freeze({']
    for name, val in cfg["moon_orbit_eccentricity"].items():
        new_eccentricity_lines.append(f'      {name}: {val},')
    new_eccentricity_lines.append('    });')
    rep(old_eccentricity, "\n".join(new_eccentricity_lines))

    # ── 6. moonFeatureData ────────────────────────────────────────────────────
    mfd_json = json.dumps(cfg["moon_feature_data"], ensure_ascii=False, separators=(",", ":"))
    src = re.sub(r'    const moonFeatureData = \[.*?\];', f'    const moonFeatureData = {mfd_json};', src, count=1, flags=re.DOTALL)

    # ── 7. TOUR_MODE_FACETS ───────────────────────────────────────────────────
    old_tour = re.search(r'    const TOUR_MODE_FACETS = \[.*?\n    \];', src, re.DOTALL)
    if old_tour:
        src = src[:old_tour.start()] + build_tour_mode_facets_js(cfg["tour_mode_facets"]) + src[old_tour.end():]
    else:
        print("  WARN: TOUR_MODE_FACETS not found", file=sys.stderr)

    # ── 8. Surface estimation functions ───────────────────────────────────────
    funcs_new = build_surface_functions_js(cfg["surface_functions"], planet_cap)

    # Replace Mars temperature function
    rep(
        '    function estimateMarsTemperature(latDeg, elevMeters) {\n'
        '      const latRad = latDeg * Math.PI / 180;\n'
        '      const baseTempC = -20 - 80 * Math.sin(latRad) ** 2;\n'
        '      return Math.round(baseTempC - 2.5 * (elevMeters / 1000));\n'
        '    }',
        funcs_new.split('\n\n')[0]  # temperature block
    )
    rep(
        '    function estimateMarsPressure(elevMeters) {\n'
        '      return Math.round(636 * Math.exp(-elevMeters / 11100));\n'
        '    }',
        funcs_new.split('\n\n')[1]  # pressure block
    )
    rep(
        '    function estimateMarsWindSpeed(latDeg, elevMeters) {\n'
        '      const latRad = latDeg * Math.PI / 180;\n'
        '      const jetStream = 6 * Math.sin(2 * latRad) ** 2;\n'
        '      const elevBoost = Math.max(0, elevMeters / 4000);\n'
        '      return Math.round((3 + jetStream + elevBoost) * 10) / 10;\n'
        '    }',
        funcs_new.split('\n\n')[2]  # wind block
    )
    rep(
        '    function estimateMarsIrradiance(latDeg, elevMeters) {\n'
        '      const latRad = latDeg * Math.PI / 180;\n'
        '      const latFactor = Math.max(0, Math.cos(latRad));\n'
        '      const elevFactor = 1 + Math.max(0, elevMeters) / 300000;\n'
        '      return Math.round(590 * latFactor * elevFactor);\n'
        '    }',
        funcs_new.split('\n\n')[3]  # irradiance block
    )
    rep(
        '    function estimateMarsRadiation(elevMeters) {\n'
        '      return Math.round((0.5 * Math.exp(elevMeters / 14000) + 0.2) * 100) / 100;\n'
        '    }',
        funcs_new.split('\n\n')[4]  # radiation block
    )
    rep(
        '    function estimateMarsDiurnalRange(latDeg, elevMeters) {\n'
        '      const latRad = latDeg * Math.PI / 180;\n'
        '      const base = 80 * Math.cos(latRad) ** 2 + 20;\n'
        '      return Math.round(base + elevMeters / 3000);\n'
        '    }',
        funcs_new.split('\n\n')[5]  # diurnal block
    )

    # ── 9. Interior model data ────────────────────────────────────────────────
    interior = cfg["interior"]
    rep(
        '    // ── Mars interior model (depth-based) ────────────────────────────────────\n'
        '    // Layer boundaries as fraction of planetary radius (from InSight + geophysical models)\n'
        '    // rFrac = 0 → centre, rFrac = 1 → surface\n'
        '    const MARS_INTERIOR_LAYERS = [\n'
        '      { name: "Inner Core",        rMin: 0.000, rMax: 0.320 },\n'
        '      { name: "Liquid Outer Core", rMin: 0.320, rMax: 0.540 },\n'
        '      { name: "Mantle",            rMin: 0.540, rMax: 0.985 },\n'
        '      { name: "Crust",             rMin: 0.985, rMax: 1.000 },\n'
        '    ];\n'
        '    // Piecewise-linear T (°C) and P (GPa) profiles keyed on rFrac (sorted low→high)\n'
        '    const MARS_INTERIOR_T_PTS = [[0.000, 2100], [0.320, 1900], [0.540, 1500], [0.985, 700], [1.000, -50]];\n'
        '    const MARS_INTERIOR_P_PTS = [[0.000, 40.0], [0.320, 37.0], [0.540, 23.0], [0.985,  1.2], [1.000,   0]];',
        build_interior_model_js(interior, PLANET)
    )

    # ── 10. Interior interpolation function renames ───────────────────────────
    p_lower = planet_lower
    rep(
        '    function estimateMarsInteriorTemperature(rFrac) {\n'
        '      return Math.round(_interiorInterp(MARS_INTERIOR_T_PTS, rFrac));\n'
        '    }\n\n'
        '    function estimateMarsInteriorPressure(rFrac) {\n'
        '      return Math.round(_interiorInterp(MARS_INTERIOR_P_PTS, rFrac) * 10) / 10;\n'
        '    }\n\n'
        '    function marsInteriorLayerName(rFrac) {\n'
        '      for (const layer of MARS_INTERIOR_LAYERS) {\n'
        '        if (rFrac >= layer.rMin && rFrac <= layer.rMax) return layer.name;\n'
        '      }\n'
        '      return "Unknown";\n'
        '    }',
        f'    function estimate{planet_cap}InteriorTemperature(rFrac) {{\n'
        f'      return Math.round(_interiorInterp({PLANET}_INTERIOR_T_PTS, rFrac));\n'
        f'    }}\n\n'
        f'    function estimate{planet_cap}InteriorPressure(rFrac) {{\n'
        f'      return Math.round(_interiorInterp({PLANET}_INTERIOR_P_PTS, rFrac) * 10) / 10;\n'
        f'    }}\n\n'
        f'    function {p_lower}InteriorLayerName(rFrac) {{\n'
        f'      for (const layer of {PLANET}_INTERIOR_LAYERS) {{\n'
        f'        if (rFrac >= layer.rMin && rFrac <= layer.rMax) return layer.name;\n'
        f'      }}\n'
        f'      return "Unknown";\n'
        f'    }}'
    )

    # ── 11. Interior layer colors ─────────────────────────────────────────────
    rep(
        '    const MARS_INTERIOR_LAYER_COLORS = {\n'
        '      "Crust":             "#d4b896",\n'
        '      "Mantle":            "#c07848",\n'
        '      "Liquid Outer Core": "#ff6633",\n'
        '      "Inner Core":        "#f5e0a8",\n'
        '    };\n\n'
        '    function marsInteriorLayerColor(layerName) {\n'
        '      return MARS_INTERIOR_LAYER_COLORS[layerName] ?? "#f6dcc8";\n'
        '    }',
        build_interior_layer_colors_js(interior["layer_colors"], PLANET, planet_cap)
    )

    # ── 12. Interior temp/pressure color functions (update range) ─────────────
    max_t = interior["temp_color_max_c"]
    rep(
        '    function marsInteriorTempColor(tempC) {\n'
        '      // Interpolate blue → cyan → yellow → red across -50°C to 2100°C\n'
        '      const t = Math.max(0, Math.min(1, (tempC + 50) / 2150));',
        f'    function {p_lower}InteriorTempColor(tempC) {{\n'
        f'      // Interpolate blue → cyan → yellow → red across -50°C to {max_t}°C\n'
        f'      const t = Math.max(0, Math.min(1, (tempC + 50) / {max_t + 50}));'
    )
    max_p = interior["pressure_color_max_gpa"]
    rep(
        '    function marsInteriorPressureColor(gpa) {\n'
        '      // Interpolate green → yellow → red across 0–40 GPa\n'
        '      const t = Math.max(0, Math.min(1, gpa / 40));',
        f'    function {p_lower}InteriorPressureColor(gpa) {{\n'
        f'      // Interpolate green → yellow → red across 0–{max_p} GPa\n'
        f'      const t = Math.max(0, Math.min(1, gpa / {max_p}));'
    )

    # ── 13. MOON_VIEWER_TEXTURES ──────────────────────────────────────────────
    textures = cfg["moon_viewer_textures"]
    tex_lines = ['    const MOON_VIEWER_TEXTURES = {']
    for name, path in textures.items():
        val = f'"{path}"' if path else "null"
        tex_lines.append(f'      "{name}": {val},')
    tex_lines.append('    };')
    rep(
        '    const MOON_VIEWER_TEXTURES = {\n'
        '      "Phobos": "assets/phobos_color_map.jpg",\n'
        '      "Deimos": "assets/deimos_color_map.jpg",\n'
        '    };',
        "\n".join(tex_lines)
    )

    # ── 14. Radii constants ───────────────────────────────────────────────────
    rep('    const MARS_MEAN_RADIUS_KM = 3389.5;',
        f'    const {PLANET}_MEAN_RADIUS_KM = {cfg["planet"]["radius_km"]};')
    rep('    const MARS_RADIUS_METERS = 3396190;',
        f'    const {PLANET}_RADIUS_METERS = {cfg["planet"]["radius_meters"]};')

    # ── 15. REGION_MASK_DEFS ─────────────────────────────────────────────────
    rep(
        '    const REGION_MASK_DEFS = {\n'
        '      "volcanic-provinces": [\n'
        '        { lat: 7, lon: 247, radiusDeg: 28, color: "rgba(255,96,76,0.78)" },\n'
        '        { lat: 24, lon: 147, radiusDeg: 16, color: "rgba(255,112,82,0.78)" },\n'
        '        { lat: 9, lon: 67, radiusDeg: 13, color: "rgba(255,126,88,0.78)" },\n'
        '      ],\n'
        '      basins: [\n'
        '        { lat: -42.4, lon: 70.5, radiusDeg: 18, color: "rgba(84,166,255,0.76)" },\n'
        '        { lat: 13.9, lon: 88.4, radiusDeg: 12, color: "rgba(104,186,255,0.76)" },\n'
        '        { lat: 46.7, lon: 117.5, radiusDeg: 18, color: "rgba(84,166,255,0.76)" },\n'
        '        { lat: -49.8, lon: 316.7, radiusDeg: 14, color: "rgba(104,186,255,0.76)" },\n'
        '      ],\n'
        '    };',
        build_region_mask_defs_js(cfg["region_mask_defs"])
    )

    # ── 16. CORE_LAYER_DATA ───────────────────────────────────────────────────
    old_core = re.search(r'    const CORE_LAYER_DATA = \[.*?\n    \];', src, re.DOTALL)
    if old_core:
        src = src[:old_core.start()] + build_core_layer_data_js(cfg["core_layer_data"]) + src[old_core.end():]
    else:
        print("  WARN: CORE_LAYER_DATA not found", file=sys.stderr)

    # ── 17. SC_PARAMS ─────────────────────────────────────────────────────────
    sc_start_idx = src.find('    const SC_PARAMS = {\n      temperature: {')
    hab_search   = src.find('      habitability: {\n        label: "Human Habitability Score"')
    sc_end_idx   = src.find('\n    };\n', hab_search) + len('\n    };\n')
    if sc_start_idx >= 0 and hab_search >= 0:
        new_sc = build_sc_params_js(cfg["sc_params"], planet_cap) + "\n"
        src = src[:sc_start_idx] + new_sc + src[sc_end_idx:]
    else:
        print("  WARN: SC_PARAMS boundaries not found", file=sys.stderr)

    # ── 18. DEFAULT_NAVIGATE_BASE_LAYER_ID ───────────────────────────────────
    rep('    const DEFAULT_NAVIGATE_BASE_LAYER_ID = "ctx-mosaic-color";',
        f'    const DEFAULT_NAVIGATE_BASE_LAYER_ID = "{cfg["planet"]["default_base_layer_id"]}";')

    # ── 19. locatorViewState property rename ─────────────────────────────────
    rep('    const locatorViewState = { camera: null, marsGroup: null, globe: null };',
        '    const locatorViewState = { camera: null, planetGroup: null, globe: null };')

    # ── 20. Core cutaway geometry constants ───────────────────────────────────
    ic  = interior["inner_core_radius_frac"]
    oc  = interior["outer_core_radius_frac"]
    man = interior["mantle_radius_frac"]
    rep(
        '      const MARS_INNER_CORE_RADIUS = 0.32;    // hypothetical dense inner core\n'
        '      const MARS_OUTER_CORE_RADIUS = 0.54;    // liquid iron-sulfide core (InSight)\n'
        '      const MARS_MANTLE_RADIUS = 0.985;       // mantle, near-crust boundary',
        f'      const {PLANET}_INNER_CORE_RADIUS = {ic};  // inner core boundary\n'
        f'      const {PLANET}_OUTER_CORE_RADIUS = {oc};  // outer core / mantle boundary\n'
        f'      const {PLANET}_MANTLE_RADIUS = {man};     // mantle / crust boundary'
    )

    # ── 21. BASE_LAYER_GROUPS ─────────────────────────────────────────────────
    old_blg = (
        '      const BASE_LAYER_GROUPS = [\n'
        '        { label: "Imagery",          ids: ["viking-color", "ctx-mosaic-color", "ctx-mosaic"] },\n'
        '        { label: "Thermal & Albedo", ids: ["tes-albedo", "tes-thermal-inertia"] },\n'
        '        { label: "Terrain",          ids: ["elevation-dem", "derived-hillshade", TERRAIN_PICKER_SLOPE_LAYER_ID] },\n'
        '      ];'
    )
    rep(old_blg, build_base_layer_groups_js(cfg["base_layer_groups"]))

    # ── 22. CTX tile service ──────────────────────────────────────────────────
    if not cfg["planet"].get("has_ctx_tile_service", True):
        rep('      baseLayers.unshift(CTX_LAYER);\n      baseLayers.unshift(CTX_COLOR_LAYER);',
            f'      // {planet_cap} viewer: no CTX tile layer')

    # ── 23. Initial layer fallback ────────────────────────────────────────────
    fallback_id = cfg["planet"].get("initial_layer_fallback_id", "earth-visible")
    rep('      const initialLayer = baseLayers.find((layer) => layer.id === "viking-color")',
        f'      const initialLayer = baseLayers.find((layer) => layer.id === "{fallback_id}")')

    # ── 24. SC_LAYERS asset paths ─────────────────────────────────────────────
    rep('"assets/mars_sc_', f'"assets/{planet_lower}_sc_')

    # ── 25. "MARS SURFACE" HUD label ─────────────────────────────────────────
    rep(f'"MARS SURFACE"', f'"{cfg["planet"]["surface_hud_label"]}"')

    # ── 26. Module-level variable renames ─────────────────────────────────────
    rep('marsSceneGroup', f'{planet_lower}SceneGroup')
    rep('marsGlobeRef',   f'{planet_lower}GlobeRef')
    rep('locatorViewState.marsGroup', 'locatorViewState.planetGroup')

    # ── 27. Global identifier renames ────────────────────────────────────────
    # Window globals
    rep('window.__marsViewerManifest', f'window.__{planet_lower}ViewerManifest')
    rep('window.__marsViewerStartup',  f'window.__{planet_lower}ViewerStartup')
    rep('window.__marsViewerDebug',    f'window.__{planet_lower}ViewerDebug')

    # MARS_* constants → PLANET_* constants
    for suffix in ['MEAN_RADIUS_KM', 'RADIUS_METERS',
                   'INTERIOR_LAYERS', 'INTERIOR_T_PTS', 'INTERIOR_P_PTS',
                   'INTERIOR_LAYER_COLORS',
                   'INNER_CORE_RADIUS', 'OUTER_CORE_RADIUS', 'MANTLE_RADIUS']:
        rep(f'MARS_{suffix}', f'{PLANET}_{suffix}')

    # Function renames
    for fn in ['Temperature', 'Pressure', 'WindSpeed', 'Irradiance', 'Radiation', 'DiurnalRange',
               'InteriorTemperature', 'InteriorPressure']:
        rep(f'estimateMars{fn}', f'estimate{planet_cap}{fn}')
    for fn in ['InteriorLayerName', 'InteriorLayerColor', 'InteriorTempColor', 'InteriorPressureColor']:
        rep(f'mars{fn}', f'{planet_lower}{fn}')

    # Other module-level variable names
    for suffix in ['UPPER_FACE_MAT', 'InteriorSphereMaterials', 'InteriorCapMaterials']:
        rep(f'MARS_{suffix}' if suffix[0].isupper() else f'mars{suffix}',
            f'{PLANET}_{suffix}' if suffix[0].isupper() else f'{planet_lower}{suffix}')
    rep('MARS_UPPER_FACE_MAT', f'{PLANET}_UPPER_FACE_MAT')
    rep('marsInteriorSphereMaterials', f'{planet_lower}InteriorSphereMaterials')
    rep('marsInteriorCapMaterials',    f'{planet_lower}InteriorCapMaterials')

    # Inline radius constant in interior depth readout
    rep('const MARS_RADIUS_KM = 3389.5;', f'const {PLANET}_RADIUS_KM = {cfg["planet"]["radius_km"]};')
    rep('(1.0 - rFrac) * MARS_RADIUS_KM', f'(1.0 - rFrac) * {PLANET}_RADIUS_KM')

    # Cosmetic comment
    rep('// THREE.Vector3 in Mars body-local space (unspun)',
        f'// THREE.Vector3 in {planet_cap} body-local space (unspun)')
    rep('// Mars has no tilted/untilted toggle',
        f'// {planet_cap} has no tilted/untilted toggle')

    return src


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    planet = args.planet.lower()

    config_path = os.path.join(CONFIGS_DIR, f"{planet}.json")
    if not os.path.exists(config_path):
        sys.exit(f"Error: config not found: {config_path}")

    if not os.path.exists(TEMPLATE_SRC):
        sys.exit(f"Error: template source not found: {TEMPLATE_SRC}")

    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    planet_lower = cfg["planet"]["name_lower"]
    planet_cap   = planet_lower.capitalize()

    out_path = args.out or os.path.join(
        REPO_ROOT, f"GeoID_{planet_cap}", "viewer", f"{planet_lower}-viewer.js"
    )
    out_dir = os.path.dirname(out_path)

    print(f"  Source  : {TEMPLATE_SRC}")
    print(f"  Config  : {config_path}")
    print(f"  Output  : {out_path}")

    with open(TEMPLATE_SRC, "r", encoding="utf-8") as f:
        src = f.read()

    print(f"  Template: {len(src):,} chars, {src.count(chr(10)):,} lines")

    result = apply_config(src, cfg)

    # Sanity check
    mars_refs = re.findall(
        r'\b(MARS_[A-Z_]+|estimateMars\w+|marsInterior\w+|marsScene\w+|'
        r'marsGlobe\w+|__marsViewer\w*|"MARS [A-Z]+")\b', result
    )
    if mars_refs:
        unique = sorted(set(mars_refs))
        print(f"  WARN: {len(unique)} remaining Mars identifiers: {unique[:10]}", file=sys.stderr)
    else:
        print(f"  OK: no remaining Mars identifiers")

    print(f"  Result  : {len(result):,} chars, {result.count(chr(10)):,} lines")

    if args.dry_run:
        print("  Dry run — output not written.")
        return

    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(result)
    print(f"  Written : {out_path}")


if __name__ == "__main__":
    main()
