#!/usr/bin/env python3
"""Bake the Smithsonian Volcanoes of the World catalogue into the site.

    python3 GeoID_GIS/services/bake-volcanoes.py

Baked rather than fetched at runtime, for the same three reasons the geology
tiles are: it works offline, it lands in one round trip, and it cannot be taken
out by somebody else's CDN having cached a response without its CORS header.
The catalogue is also not a live feed — GVP revises it on a slow editorial
cycle, not by the minute — so a copy taken today is a copy of the catalogue,
not a stale snapshot of a stream.

WHAT IT ADDS TO THE SOURCE, and why each one is a derivation rather than a
fact GVP publishes:

- `activity` — GVP does NOT publish "active/dormant/extinct", and that is
  deliberate on their part: the terms have no agreed definition and "extinct"
  has been wrong often enough to be dangerous. What it publishes is
  `Last_Eruption_Year`. So the bands here are recency bands, named for what
  they are ("Erupted since 1980"), never for a status the source declines to
  assert. A volcano with no dated eruption is "Holocene, undated" -- 366 of
  them -- which is a statement about the RECORD, not about the volcano.
- `type_group` — 28 primary types is more than any categorical palette can
  hold, and `categoricalSymbology` folds everything past twelve into one grey
  "other" that would swallow half the map. Nine groups keep the raw
  `Primary_Volcano_Type` alongside for the popup, so nothing is lost by
  colouring with the simpler one.
- `epoch` — Holocene or Pleistocene, so the two catalogues can share one layer
  and still be told apart. Pleistocene volcanoes carry far less certainty and
  no eruption dates at all; keeping them separable is the honest way to ship
  them together.

Licence: the Global Volcanism Program database is Smithsonian Institution,
free for non-commercial use with citation. The citation line travels with the
file, in `_source`, and the catalogue entry shows it beside the layer.
"""
import json
import pathlib
import sys
import urllib.parse
import urllib.request

WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows"
LAYERS = {
    "Holocene": "GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes",
    "Pleistocene": "GVP-VOTW:Smithsonian_VOTW_Pleistocene_Volcanoes",
}
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "global" / "volcanoes.geojson"

CITATION = ("Global Volcanism Program, Smithsonian Institution. "
            "Volcanoes of the World (v. 5.x). Free for non-commercial use with citation.")

# Raw GVP type -> the group it is coloured by. Everything not listed falls to
# "Other", which is a real answer here rather than a shrug: maars, tuff rings
# and subglacial forms are each a handful of volcanoes worldwide.
TYPE_GROUPS = {
    "Stratovolcano": "Stratovolcano",
    "Stratovolcano(es)": "Stratovolcano",
    "Stratovolcano?": "Stratovolcano",
    "Compound": "Stratovolcano",
    "Complex": "Complex",
    "Complex(es)": "Complex",
    "Shield": "Shield",
    "Shield(s)": "Shield",
    "Caldera": "Caldera",
    "Caldera(s)": "Caldera",
    "Volcanic field": "Volcanic field",
    "Pyroclastic cone": "Cone",
    "Pyroclastic cone(s)": "Cone",
    "Cone": "Cone",
    "Cone(s)": "Cone",
    "Pyroclastic shield": "Shield",
    "Lava dome": "Lava dome",
    "Lava dome(s)": "Lava dome",
    "Lava cone": "Cone",
    "Lava cone(s)": "Cone",
    "Fissure vent": "Fissure vent",
    "Fissure vent(s)": "Fissure vent",
    "Crater rows": "Fissure vent",
    "Submarine": "Submarine",
    "Submarine(es)": "Submarine",
    "Subglacial": "Other",
    "Maar": "Other",
    "Maar(s)": "Other",
    "Tuff cone": "Other",
    "Tuff cone(s)": "Other",
    "Tuff ring": "Other",
    "Tuff ring(s)": "Other",
    "Explosion crater": "Other",
    "Explosion crater(s)": "Other",
    "Lava dome?": "Lava dome",
    "Caldera?": "Caldera",
    "Volcanic field?": "Volcanic field",
}


def fetch(type_name):
    q = ("?service=WFS&version=1.0.0&request=GetFeature"
         f"&typeName={urllib.parse.quote(type_name)}"
         "&outputFormat=application%2Fjson")
    with urllib.request.urlopen(WFS + q, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def clip(text, limit=460):
    """The first few sentences, with the full record one link away.

    The summaries are 39% of the file and run to 1,776 characters -- three
    paragraphs of regional geology in a map popup nobody will read to the end
    of. Cut on a sentence boundary rather than mid-word, and only when there is
    a meaningful saving; `gvp_url` carries whoever wants the rest to GVP's own
    page for that volcano, which is where a citable version lives anyway.
    """
    if not text or len(text) <= limit:
        return text or None
    cut = text[:limit]
    stop = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[:stop + 1] if stop > limit * 0.5 else cut.rstrip() + "\u2026")


def activity_of(year):
    """Recency bands, named for the record rather than for a status."""
    if year in (None, "", "Unknown"):
        return "Holocene, undated"
    try:
        y = int(year)
    except (TypeError, ValueError):
        return "Holocene, undated"
    if y >= 1980:
        return "Erupted since 1980"
    if y >= 1900:
        return "Erupted since 1900"
    if y >= 1500:
        return "Historical (since 1500)"
    if y >= 0:
        return "Holocene, dated CE"
    return "Holocene, dated BCE"


def main():
    features = []
    for epoch, layer in LAYERS.items():
        try:
            raw = fetch(layer)
        except Exception as error:                      # noqa: BLE001
            print(f"  {epoch}: FAILED — {error}", file=sys.stderr)
            return 1
        print(f"  {epoch}: {len(raw['features'])} volcanoes")
        for f in raw["features"]:
            p = f.get("properties") or {}
            geom = f.get("geometry")
            if not geom or geom.get("type") != "Point":
                continue
            lon, lat = geom["coordinates"][:2]
            raw_type = (p.get("Primary_Volcano_Type") or "").strip()
            year = p.get("Last_Eruption_Year")
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                "properties": {
                    # Name first: `feature-popup.js` and the layer card both
                    # lead with whatever reads as the feature's name.
                    "name": p.get("Volcano_Name"),
                    "type_group": TYPE_GROUPS.get(raw_type, "Other"),
                    "activity": activity_of(year) if epoch == "Holocene"
                                else "Pleistocene (no Holocene eruption)",
                    "epoch": epoch,
                    "volcano_type": raw_type or None,
                    "landform": p.get("Volcanic_Landform"),
                    "last_eruption": year,
                    "elevation_m": p.get("Elevation"),
                    "country": p.get("Country"),
                    "region": p.get("Region"),
                    "subregion": p.get("Subregion"),
                    "tectonic_setting": p.get("Tectonic_Setting"),
                    "rock_type": p.get("Major_Rock_Type"),
                    "evidence": p.get("Evidence_Category"),
                    "summary": clip(p.get("Geological_Summary")),
                    "photo": p.get("Primary_Photo_Link"),
                    "photo_caption": p.get("Primary_Photo_Caption"),
                    "photo_credit": p.get("Primary_Photo_Credit"),
                    "gvp_number": p.get("Volcano_Number"),
                    # Straight to the source's own page for this volcano: the
                    # summary here is an extract, and somebody checking it
                    # should land on the record rather than on a search.
                    "gvp_url": (f"https://volcano.si.edu/volcano.cfm?vn={p['Volcano_Number']}"
                                if p.get("Volcano_Number") else None),
                },
            })

    # Drop empty properties: 2,666 features x a dozen nulls is most of a
    # megabyte of "null" over the wire for no information.
    for f in features:
        f["properties"] = {k: v for k, v in f["properties"].items()
                           if v not in (None, "", "Unknown")}

    doc = {
        "type": "FeatureCollection",
        "_source": {
            "name": "Smithsonian Global Volcanism Program — Volcanoes of the World",
            "url": "https://volcano.si.edu/",
            "service": WFS,
            "citation": CITATION,
            "derived_fields": {
                "activity": "recency band from Last_Eruption_Year; GVP does not "
                            "publish active/dormant/extinct and neither does this",
                "type_group": "Primary_Volcano_Type collapsed to 9 groups for symbology",
                "epoch": "which GVP catalogue the record came from",
            },
        },
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT} — {len(features)} volcanoes, {kb:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
