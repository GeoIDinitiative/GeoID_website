#!/usr/bin/env python3
"""
Enrich Moon label descriptions to match the Mars-viewer standard.

For each entry in `planet_explorer/moon/viewer/label-data.json`, this script
replaces the short IAU nomenclature blurb with a structured description:

  <Name> is a <size-adjective> <feature-type-phrase> [<dimension>] in the
  <hemispheric-zone> of the lunar <nearside|farside>. <Type-specific science
  in plain language with the formal terms>.  Named for <original nomenclature
  origin> (Approved by the IAU in <year/date>).

The IAU naming attribution is preserved verbatim; only the leading scientific
paragraph is new.

Re-runnable: it overwrites `description` in place and is idempotent — if the
script's output marker is detected, the original IAU blurb is reused rather
than appended twice.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "planet_explorer/moon/viewer/label-data.json"

# A small sentinel we tuck into a NUL-safe spot so we can spot already-enriched
# entries on re-run. The Mars-style descriptions never contain this token.
NOMEN_MARKER = "Named for"

DIM_RE = re.compile(r"~?\s*([\d.]+)\s*km")

# Match IAU approval clause at the end of the original description.
IAU_RE = re.compile(r"\bApproved by the IAU(?:\s*in)?\s+([^\.]+?)\.?\s*$", flags=re.IGNORECASE)
# Strip common HTML-entity remnants seen in the source data.
JUNK_RE = re.compile(r"[“”\"]\s*;\s*|;\s*$|\s+", flags=re.UNICODE)

def clean(text: str) -> str:
    if not text:
        return ""
    # Replace odd "“;…“;" wrappers and collapse whitespace.
    t = text.replace("“;", "“").replace(";”", "”").replace(";\"", "\"").replace("\";", "\"")
    t = re.sub(r"\s+", " ", t).strip()
    return t

def parse_km(text):
    if not text: return None
    m = DIM_RE.search(str(text))
    if not m: return None
    try: return float(m.group(1))
    except ValueError: return None

def hemispheric_zone(lat):
    """Latitude-band phrase, Mars-style."""
    a = abs(lat)
    if a >= 75: return ("polar region" if lat > 0 else "south-polar region")
    if a >= 55: return ("high northern latitudes" if lat > 0 else "high southern latitudes")
    if a >= 30: return ("northern mid-latitudes" if lat > 0 else "southern mid-latitudes")
    if a >= 15: return ("northern equatorial belt" if lat > 0 else "southern equatorial belt")
    return "equatorial region"

def nearside_phrase(lon):
    """Moon-specific: tidal-lock means |lon| < 90° is Earth-facing nearside."""
    a = abs(lon)
    if a <= 80:  return "lunar nearside"
    if a >= 100: return "lunar farside"
    return "limb region between nearside and farside"

def size_adjective_crater(km):
    if km is None:        return "impact crater"
    if km < 3:            return "very small impact crater"
    if km < 8:            return "small simple impact crater"
    if km < 18:           return "simple impact crater"
    if km < 40:           return "transitional complex crater"
    if km < 100:          return "complex impact crater"
    if km < 200:          return "large complex crater"
    if km < 400:          return "very large impact crater approaching basin scale"
    return "multi-ring impact basin"

def size_phrase(km):
    if km is None: return ""
    if km < 1:   return f" {km:.1f} km across"
    if km < 100: return f" {km:.0f} km across"
    return f" {km:.0f} km in diameter"

# ── Type-specific science paragraphs ────────────────────────────────────────
# Each returns a sentence (or two) ending without a trailing space. The
# generator stitches these between the opening "X is a …" clause and the
# closing nomenclature attribution.

def science_crater(km, lat):
    if km is None or km < 5:
        return ("As a small simple impact crater it likely retains a bowl-shaped floor with no central peak, "
                "consistent with the threshold below which lunar gravity is insufficient to drive a complex collapse on impact.")
    if km < 18:
        return ("At this scale lunar craters typically preserve a simple bowl shape with raised rim and ejecta blanket, "
                "though slumping and downslope mass-wasting begin to modify the wall geometry.")
    if km < 40:
        return ("Craters in this size range straddle the simple-to-complex transition (~15–20 km on the Moon), "
                "often showing a flat floor, incipient central peak, and the first hints of terraced walls.")
    if km < 100:
        return ("Complex craters of this size develop a prominent central peak, terraced walls produced by post-impact slumping, "
                "and an ejecta blanket whose secondary chains can extend over hundreds of kilometres.")
    if km < 200:
        return ("Large complex craters exhibit terraced rim walls, broad flat floors, and well-developed central peak structures — "
                "the gravitational collapse of the transient cavity at this scale is the primary control on final morphology.")
    if km < 400:
        return ("At this size the crater approaches basin scale, with central peak ring development beginning to replace simple central peaks "
                "as the transient cavity deepens past the crust into the lunar mantle.")
    return ("A multi-ring impact basin of this size excavates deep into the lunar mantle and is associated with concentric ring structures, "
            "extensive ejecta deposits, and post-impact basaltic mare flooding of the central depression.")

def science_mare(km, lat):
    return ("A mare is a vast, dark basaltic plain formed when low-viscosity lava flooded an earlier impact basin, "
            "predominantly between roughly 3.8 and 3.0 billion years ago. The smooth surface and lower albedo reflect iron-rich basalts "
            "with characteristic high-titanium and low-titanium provinces mapped from Clementine and Kaguya spectral data.")

def science_oceanus(km, lat):
    return ("An oceanus is the largest class of mare expanse on the Moon — a contiguous basaltic plain that floods multiple impact basins, "
            "shaped by long-lived mare volcanism between roughly 3.9 and 1.2 Ga and crossed by wrinkle ridges and rille systems.")

def science_sinus(km, lat):
    return ("A sinus (bay) is a relatively small basaltic plain embayed into highland terrain — a discrete arm of mare volcanism "
            "where lava flows pooled against pre-existing topography rather than forming a full circular basin fill.")

def science_lacus(km, lat):
    return ("A lacus is a small isolated mare patch — a localised basaltic flow whose limited extent reflects either short-lived volcanism, "
            "a constrained source region, or partial flooding of a small antecedent depression.")

def science_palus(km, lat):
    return ("A palus (marsh) denotes an intermediate-albedo dark plain — a transitional area between mare basalts and the higher-albedo "
            "highland terrain, often partially flooded or mantled by pyroclastic deposits.")

def science_promontorium(km, lat):
    return ("A promontorium is a cape-like extension of highland terra protruding into a mare — a remnant of pre-mare topography "
            "left standing as basaltic lavas embayed the surrounding lowland.")

def science_mons(km, lat):
    return ("A mons is an isolated lunar peak or compact massif. Most are remnants of pre-impact highland topography preserved "
            "within or alongside mare-flooded basins, or — less commonly — domical features built from short-lived volcanic constructs.")

def science_montes(km, lat):
    return ("Lunar montes are mountain ranges, usually the uplifted rim segments or peak rings of large impact basins rather than tectonic ranges. "
            "Their morphology records the radial transport of crustal blocks during basin formation.")

def science_vallis(km, lat):
    return ("A vallis is a sinuous valley or graben-like depression. Lunar valles include collapsed lava tubes (sinuous rilles), "
            "tectonic graben opening along arcuate faults, and impact-driven chasms aligned with basin radial features.")

def science_rima(km, lat):
    return ("A rima (rille) is a narrow channel-like depression. Sinuous rimae are typically collapsed lava-tube roofs or thermally eroded "
            "lava channels marking ancient mare effusions; arcuate and straight rimae are graben formed by extensional tectonics during basin subsidence.")

def science_dorsum(km, lat):
    return ("A dorsum is a wrinkle ridge — a low compressional fold within mare basalts, produced by post-emplacement contraction of the basin fill "
            "as the lava cooled and the underlying basin subsided. They preserve the dominant compressional stress directions of each mare.")

def science_catena(km, lat):
    return ("A catena is a chain of aligned craters. Most lunar catenae are secondary impact chains radial to a parent basin, "
            "though some — such as crater chains aligned with rilles — record collapse along subsurface lava tubes or fault systems.")

def science_rupes(km, lat):
    return ("A rupes is a scarp or cliff. Lunar rupes are typically lobate thrust-fault scarps generated by global contraction "
            "as the Moon's interior cooled — their crisp morphology indicates that some are geologically young, on the order of 100 Myr or less.")

def science_fossa(km, lat):
    return ("A fossa is a long, narrow trough, generally a graben formed by extensional tectonics. On the Moon these are most often associated "
            "with the early subsidence of mare-filled impact basins or with radial fracturing around large impacts.")

def science_planitia(km, lat):
    return ("A planitia is a broad lowland plain. On the Moon this designation is rare and tends to refer to flat-floored regions that may be "
            "partially mare-flooded or covered by thick ejecta deposits from neighbouring basins.")

def science_albedo(km, lat):
    return ("An albedo feature is a region distinguished primarily by surface brightness contrast rather than topography — typically reflecting "
            "compositional or maturity differences in the regolith, such as ray systems, fresh ejecta, or unusual mare units.")

def science_statio(km, lat):
    return ("A statio is a named station on the lunar surface — almost always the touchdown site of a crewed or robotic lander. "
            "It marks a specific geological investigation point, not a natural landform.")

def science_astronaut(km, lat):
    return ("An astronaut-named feature is a small landmark formally recognised by the IAU at a crewed-mission landing site. "
            "These include named craters, rocks, and boulders along the EVA traverses that anchor the science notebooks of the surface crews "
            "and remain the smallest officially named features on the Moon.")

TYPE_HANDLERS = [
    (r"^Crater",                  science_crater,       size_adjective_crater),
    (r"^Oceanus\b",               science_oceanus,      lambda km: "lunar oceanus"),
    (r"^Mare\b",                  science_mare,         lambda km: "basaltic mare"),
    (r"^Sinus\b",                 science_sinus,        lambda km: "mare bay (sinus)"),
    (r"^Lacus\b",                 science_lacus,        lambda km: "lacus mare patch"),
    (r"^Palus\b",                 science_palus,        lambda km: "palus marsh-plain"),
    (r"^Promontorium\b",          science_promontorium, lambda km: "promontorium cape"),
    (r"^Montes\b",                science_montes,       lambda km: "mountain range"),
    (r"^Mons\b",                  science_mons,         lambda km: "isolated lunar peak"),
    (r"^Vallis\b",                science_vallis,       lambda km: "lunar valley"),
    (r"^Rima\b",                  science_rima,         lambda km: "lunar rille (rima)"),
    (r"^Dorsum\b",                science_dorsum,       lambda km: "wrinkle ridge (dorsum)"),
    (r"^Catena\b",                science_catena,       lambda km: "crater chain (catena)"),
    (r"^Rupes\b",                 science_rupes,        lambda km: "lobate scarp (rupes)"),
    (r"^Fossa\b",                 science_fossa,        lambda km: "tectonic trough (fossa)"),
    (r"^Planitia\b",              science_planitia,     lambda km: "lunar plain"),
    (r"^Statio\b",                science_statio,       lambda km: "landing-site station"),
    (r"^Astronaut",               science_astronaut,    lambda km: "astronaut-named landmark"),
    (r"^Albedo Feature",          science_albedo,       lambda km: "albedo feature"),
]

def classify_type(t):
    if not t: return None
    for pat, sci, label in TYPE_HANDLERS:
        if re.search(pat, t, flags=re.IGNORECASE):
            return sci, label
    return None

def split_nomen(desc):
    """Return (origin_phrase, iau_clause) from the original description."""
    if not desc:
        return ("", "")
    d = clean(desc)
    m = IAU_RE.search(d)
    if not m:
        return (d.rstrip(" .") , "")
    iau_when = m.group(1).strip().rstrip(" .")
    origin = d[: m.start()].rstrip(" .;,").strip()
    # Treat "-" / "?" / "unknown" as missing dates.
    iau_clause = "Approved by the IAU."
    if iau_when and iau_when not in {"-", "?", "unknown", "Unknown"}:
        iau_clause = f"Approved by the IAU in {iau_when}."
    return (origin, iau_clause)

def fix_article(text: str) -> str:
    """Repair 'a vs an' before vowels in the constructed opening clause."""
    return re.sub(
        r"\b(is\s+|with\s+|of\s+|by\s+)a(\s+)([aeiouAEIOU])",
        lambda m: m.group(1) + "an" + m.group(2) + m.group(3),
        text,
    )

def is_enriched(desc):
    if not desc: return False
    return NOMEN_MARKER in desc and " is a " in desc[:200]

def build_description(entry):
    name = (entry.get("name") or "").strip()
    t    = entry.get("type") or ""
    lat  = float(entry.get("lat") or 0)
    lon  = float(entry.get("lon") or 0)
    km   = parse_km(entry.get("dimension"))
    original = entry.get("description") or ""

    handler = classify_type(t)
    if not handler:
        # Unknown type — leave the original description alone.
        return original

    science_fn, label_fn = handler
    type_label = label_fn(km) if science_fn is science_crater else label_fn(km if False else None)
    # Re-derive type_label for craters which depend on km, and for others use static.
    if science_fn is science_crater:
        type_label = size_adjective_crater(km)
    else:
        type_label = label_fn(None)

    size_clause = size_phrase(km) if science_fn is science_crater else ""
    zone   = hemispheric_zone(lat)
    side   = nearside_phrase(lon)
    science = science_fn(km, lat)
    origin, iau = split_nomen(original)

    opening = f"{name} is a {type_label}{size_clause} in the {zone} of the {side}."
    parts = [opening, science]
    if origin:
        # Tidy a few common origin patterns.
        origin = origin.rstrip(" ;,")
        parts.append(f"Named for {origin}.")
    if iau:
        parts.append(iau)
    return fix_article(" ".join(parts).strip())

def main():
    data = json.loads(PATH.read_text())
    updated = 0
    skipped = 0
    untouched = 0
    for entry in data:
        if is_enriched(entry.get("description","")):
            skipped += 1
            continue
        new_desc = build_description(entry)
        if new_desc and new_desc != entry.get("description"):
            entry["description"] = new_desc
            updated += 1
        else:
            untouched += 1
    PATH.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"updated:   {updated}")
    print(f"skipped (already enriched): {skipped}")
    print(f"untouched (unknown type):   {untouched}")
    print(f"total:     {len(data)}")

if __name__ == "__main__":
    main()
