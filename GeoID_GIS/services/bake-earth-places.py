#!/usr/bin/env python3
"""Bake the Earth place-name gazetteer: data/global/earth-places.json.

Thousands of named places for the Earth viewer's label engine, each with a
category, a significance rank (lod 1 = continent-scale ... 5 = local), an
anchor that sits ON the feature and a short description.

Sources, all open:
  Natural Earth 1:10m (public domain) — rivers, lakes, named seas, landform
      regions, capes/islands/waterfalls, peaks and cities.
  GEM Global Active Faults (CC BY-SA 4.0) — named faults, grouped by name.
  Bird (2003) PB2002 plates, via fraxen/tectonicplates — plate names.
  Wikipedia (CC BY-SA 4.0) — the description's opening sentences, found
      through each Natural Earth feature's own Wikidata id (CC0).

WHY min_label IS THE RANK. Every Natural Earth layer carries the web-map zoom
at which its cartographers first label a feature. That is a significance
judgement made once, by one team, on one scale for rivers, seas, deserts and
cities alike — so ranking by it makes a sea and a river comparable, which a
per-layer rule (river length, lake area, city population) cannot.

Usage:  python3 bake-earth-places.py [--work DIR] [--offline]
The work directory holds the downloads and every Wikipedia answer, so a re-run
fetches nothing it already has.
"""
import argparse, json, math, os, subprocess, sys, time, urllib.parse, urllib.request, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "global", "earth-places.json")
NE = "https://naciscdn.org/naturalearth/10m/"
LAYERS = {
    "rivers": "physical/ne_10m_rivers_lake_centerlines",
    "lakes": "physical/ne_10m_lakes",
    "regions": "physical/ne_10m_geography_regions_polys",
    "points": "physical/ne_10m_geography_regions_points",
    "peaks": "physical/ne_10m_geography_regions_elevation_points",
    "marine": "physical/ne_10m_geography_marine_polys",
    "cities": "cultural/ne_10m_populated_places",
}
FAULTS = ("https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults"
          "/master/geojson/gem_active_faults_harmonized.geojson")
PLATES = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_plates.json"
UA = "GeoID-Initiative-gazetteer-bake/1.0 (https://geoidinitiative.com)"

# How many of each category survive, most significant first. The totals are
# what a globe can carry: ~2,800 names, at most a few hundred on screen.
BUDGET = {"river": 500, "lake": 290, "marine": 300, "mountain": 520, "landform": 450,
          "island": 270, "tectonic": 300, "city": 320}


def lower(props):
    return {k.lower(): v for k, v in props.items()}


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
        f.write(r.read())
    os.replace(path + ".part", path)
    return path


def ne_layer(work, key):
    stem = os.path.basename(LAYERS[key])
    gj = os.path.join(work, stem + ".geojson")
    if not os.path.exists(gj):
        z = fetch(NE + LAYERS[key] + ".zip", os.path.join(work, stem + ".zip"))
        subprocess.run(["ogr2ogr", "-f", "GeoJSON", gj, f"/vsizip/{z}/{stem}.shp"], check=True)
    return json.load(open(gj))["features"]


def lod_from_label(min_label):
    """Natural Earth's label zoom to the viewer's five significance tiers."""
    if min_label is None:
        return 5
    m = float(min_label)
    return 1 if m <= 2 else 2 if m <= 3.7 else 3 if m <= 5 else 4 if m <= 6.5 else 5


# ---- geometry -------------------------------------------------------------

def hav_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))


def parts_of(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return c
    if t == "Point":
        return [[c]]
    return []


def line_anchor(parts):
    """The middle vertex of the longest part: a name at a line's END reads as
    belonging to whatever else is at that coast, and a system's stub must not
    claim its name (the rule point-labels.js already uses)."""
    best, best_len = None, -1
    for p in parts:
        L = sum(hav_km(p[i], p[i + 1]) for i in range(len(p) - 1))
        if L > best_len:
            best, best_len = p, L
    if not best:
        return None, 0
    # walk to half the length rather than taking the middle INDEX, which
    # lands wherever the digitiser happened to put more vertices
    half, run = best_len / 2, 0
    for i in range(len(best) - 1):
        d = hav_km(best[i], best[i + 1])
        if run + d >= half and d > 0:
            t = (half - run) / d
            return [best[i][0] + (best[i + 1][0] - best[i][0]) * t,
                    best[i][1] + (best[i + 1][1] - best[i][1]) * t], best_len
        run += d
    return best[len(best) // 2], best_len


def total_length(parts):
    return sum(hav_km(p[i], p[i + 1]) for p in parts for i in range(len(p) - 1))


def poly_anchor(geom):
    """A point INSIDE the polygon (its largest part): a centroid of a crescent,
    a lake with an arm or an archipelago lands in the water or the sea."""
    from shapely.geometry import shape
    g = shape(geom)
    if g.geom_type == "MultiPolygon":
        g = max(g.geoms, key=lambda x: x.area)
    if not g.is_valid:
        g = g.buffer(0)
    p = g.representative_point()
    return [p.x, p.y], g


def plate_anchor(geom):
    """Plates straddle the antimeridian, so the anchor is taken on the sphere:
    the mean of each ring vertex as a unit vector, back to lat/lon."""
    from shapely.geometry import shape, Point
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    x = y = z = 0.0
    n = 0
    for poly in polys:
        for lon, lat in poly[0]:
            la, lo = math.radians(lat), math.radians(lon)
            x += math.cos(la) * math.cos(lo); y += math.cos(la) * math.sin(lo); z += math.sin(la)
            n += 1
    r = math.sqrt(x * x + y * y + z * z) or 1
    return [math.degrees(math.atan2(y, x)), math.degrees(math.asin(z / r))]


def sphere_area_km2(geom):
    from shapely.geometry import shape
    # coarse and good enough to RANK plates: planar area in degrees scaled by
    # cos(latitude) at the part's own centroid
    g = shape(geom)
    parts = g.geoms if g.geom_type == "MultiPolygon" else [g]
    return sum(p.area * math.cos(math.radians(p.centroid.y)) * 111.32 ** 2 for p in parts)


# ---- descriptions ---------------------------------------------------------

def wiki_summaries(work, qids, offline=False):
    """{qid: (title, first two sentences)} for every id with an English article."""
    cache_path = os.path.join(work, "wiki-cache.json")
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {"title": {}, "text": {}}

    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.load(r)
            except Exception as err:  # noqa: BLE001 — a flaky call is retried, then skipped
                time.sleep(2 * (attempt + 1))
        print("  gave up on", url[:120], file=sys.stderr)
        return {}

    todo = [q for q in qids if q and q not in cache["title"]]
    if todo and not offline:
        print(f"  wikidata: {len(todo)} ids")
        for i in range(0, len(todo), 50):
            batch = todo[i:i + 50]
            data = get("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
                "action": "wbgetentities", "ids": "|".join(batch), "props": "sitelinks|descriptions",
                "sitefilter": "enwiki", "languages": "en", "format": "json"}))
            for q in batch:
                ent = (data.get("entities") or {}).get(q) or {}
                title = ((ent.get("sitelinks") or {}).get("enwiki") or {}).get("title")
                cache["title"][q] = title or ""
                cache.setdefault("wd", {})[q] = ((ent.get("descriptions") or {}).get("en") or {}).get("value", "")
            time.sleep(0.2)
        json.dump(cache, open(cache_path, "w"))
    titles = sorted({cache["title"].get(q) for q in qids if cache["title"].get(q)} - set(cache["text"]))
    if titles and not offline:
        print(f"  wikipedia: {len(titles)} articles")
        for i in range(0, len(titles), 20):
            batch = titles[i:i + 20]
            data = get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
                "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
                "exsentences": 2, "exlimit": 20, "redirects": 1, "format": "json",
                "titles": "|".join(batch)}))
            q = data.get("query") or {}
            back = {r["to"]: r["from"] for r in q.get("redirects", [])}
            norm = {n["to"]: n["from"] for n in q.get("normalized", [])}
            for page in (q.get("pages") or {}).values():
                t = page.get("title", "")
                src = back.get(t, t)
                src = norm.get(src, src)
                cache["text"][src] = (page.get("extract") or "").strip()
            for t in batch:
                cache["text"].setdefault(t, "")
            time.sleep(0.2)
            if i % 400 == 0:
                json.dump(cache, open(cache_path, "w"))
        json.dump(cache, open(cache_path, "w"))
    out = {}
    for q in qids:
        t = cache["title"].get(q)
        text = clean(cache["text"].get(t, "")) if t else ""
        if not text:
            text = (cache.get("wd") or {}).get(q, "")
            # a one-word Wikidata gloss ("mountain") says less than the type
            text = text[:1].upper() + text[1:] + "." if len(text) >= 20 else ""
        out[q] = (t or "", text)
    return out


def clean(text):
    import re
    text = re.sub(r"\s*\([^()]*\)", "", text)          # pronunciations and native names
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace(" ,", ",").replace(" .", ".")
    return text[:420].rsplit(" ", 1)[0] + "…" if len(text) > 420 else text


# ---- the layers -----------------------------------------------------------

def fmt_int(n):
    return f"{int(round(n)):,}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(ROOT, "data", "global", ".places-work"))
    ap.add_argument("--offline", action="store_true", help="use only cached Wikipedia answers")
    args = ap.parse_args()
    os.makedirs(args.work, exist_ok=True)
    cand = {k: [] for k in BUDGET}

    def add(cat, name, typ, lon, lat, lod, score, qid=None, facts="", source="Natural Earth 1:10m", extra=None):
        if not name or lon is None or lat is None:
            return
        item = {"name": name.strip(), "type": typ, "category": cat, "lat": round(lat, 4),
                "lon": round(lon, 4), "lod": int(lod), "_score": score, "_qid": qid,
                "_facts": facts, "_source": source}
        if extra:
            item.update(extra)
        cand[cat].append(item)

    # Rivers: grouped by river (rivernum, else name), the anchor on the longest
    # stretch. A lake centreline is the lake's, not a river's.
    groups = {}
    for f in ne_layer(args.work, "rivers"):
        p = lower(f["properties"])
        if not p.get("name") or "Lake Centerline" in (p.get("featurecla") or "") or not f["geometry"]:
            continue
        key = p.get("wikidataid") or p.get("name")
        g = groups.setdefault(key, {"p": p, "parts": [], "min": 99})
        g["parts"] += parts_of(f["geometry"])
        g["min"] = min(g["min"], float(p.get("min_label") or 99))
    for g in groups.values():
        p = g["p"]
        anchor, _ = line_anchor(g["parts"])
        if not anchor:
            continue
        L = total_length(g["parts"])
        kind = "Canal" if p.get("featurecla") == "Canal" else "Intermittent river" if "Intermittent" in (p.get("featurecla") or "") else "River"
        # A short delta branch Natural Earth labels early (Borcea, Damietta)
        # is not a continental river: length caps the tier from above.
        lod = max(lod_from_label(g["min"]), 4 if L < 250 else 3 if L < 700 else 1)
        add("river", p.get("name_en") or p["name"], kind, anchor[0], anchor[1], lod,
            -g["min"] + L / 1e5, p.get("wikidataid"),
            f"Mapped course in view: about {fmt_int(L)} km at 1:10m.", extra={"geometry_km": round(L)})

    for f in ne_layer(args.work, "lakes"):
        p = lower(f["properties"])
        if not p.get("name") or not f["geometry"]:
            continue
        (lon, lat), g = poly_anchor(f["geometry"])
        area = g.area * math.cos(math.radians(lat)) * 111.32 ** 2
        typ = "Reservoir" if p.get("featurecla") == "Reservoir" else "Salt lake" if "Alkaline" in (p.get("featurecla") or "") else "Lake"
        facts = f"Reservoir behind {p['dam_name']}." if p.get("dam_name") else ""
        add("lake", p.get("name_en") or p["name"], typ, lon, lat, lod_from_label(p.get("min_label")),
            -float(p.get("min_label") or 9) + area / 1e6, p.get("wikidataid"), facts)

    for f in ne_layer(args.work, "marine"):
        p = lower(f["properties"])
        if not p.get("name") or not f["geometry"]:
            continue
        (lon, lat), _ = poly_anchor(f["geometry"])
        cla = (p.get("featurecla") or "sea").lower()
        typ = {"generic": "Sea area"}.get(cla, cla.capitalize())
        lod = 1 if cla == "ocean" else lod_from_label(p.get("min_label"))
        add("marine", p.get("name_en") or p["name"].title(), typ, lon, lat, lod,
            -float(p.get("min_label") or 9), p.get("wikidataid"))

    LANDFORM = {"Range/mtn": ("mountain", "Mountain range"), "Island": ("island", "Island"),
                "Island group": ("island", "Island group"), "Plateau": ("landform", "Plateau"),
                "Desert": ("landform", "Desert"), "Pen/cape": ("landform", "Peninsula"),
                "Peninsula": ("landform", "Peninsula"), "Geoarea": ("landform", "Region"),
                "Coast": ("landform", "Coast"), "Plain": ("landform", "Plain"),
                "Delta": ("landform", "River delta"), "Basin": ("landform", "Basin"),
                "Continent": ("landform", "Continent"), "Valley": ("landform", "Valley"),
                "Lowland": ("landform", "Lowland"), "Tundra": ("landform", "Tundra"),
                "Isthmus": ("landform", "Isthmus"), "Wetlands": ("landform", "Wetland"),
                "Gorge": ("landform", "Gorge"), "Foothills": ("landform", "Foothills")}
    for f in ne_layer(args.work, "regions"):
        p = lower(f["properties"])
        cat, typ = LANDFORM.get(p.get("featurecla"), ("landform", (p.get("featurecla") or "Region")))
        if not p.get("name") or not f["geometry"]:
            continue
        (lon, lat), _ = poly_anchor(f["geometry"])
        lod = 1 if typ == "Continent" else lod_from_label(p.get("min_label"))
        region = " · ".join(x for x in (p.get("subregion"), p.get("region")) if x)
        add(cat, (p.get("name_en") or p["name"]).strip(), typ, lon, lat, lod,
            -float(p.get("min_label") or 9), p.get("wikidataid"), extra={"region": region} if region else None)

    POINT = {"island": ("island", "Island"), "island group": ("island", "Island group"),
             "cape": ("landform", "Cape"), "waterfall": ("river", "Waterfall"),
             "pole": ("landform", "Pole"), "plain": ("landform", "Plain")}
    for f in ne_layer(args.work, "points"):
        p = lower(f["properties"])
        cat, typ = POINT.get(p.get("featurecla"), ("landform", "Landmark"))
        c = f["geometry"]["coordinates"] if f["geometry"] else [p.get("long_x"), p.get("lat_y")]
        add(cat, p.get("name_en") or p.get("name"), typ, c[0], c[1],
            lod_from_label(p.get("min_zoom")), -float(p.get("min_zoom") or 9), p.get("wikidataid"))

    for f in ne_layer(args.work, "peaks"):
        p = lower(f["properties"])
        if not p.get("name"):
            continue
        c = f["geometry"]["coordinates"] if f["geometry"] else [p.get("long_x"), p.get("lat_y")]
        elev = p.get("elevation")
        cla = p.get("featurecla")
        typ = {"mountain": "Mountain summit", "depression": "Depression", "pass": "Mountain pass",
               "plateau": "Plateau", "spot elevation": "Summit"}.get(cla, "Summit")
        lod = lod_from_label(p.get("min_zoom"))
        # A peak's significance is also its HEIGHT: every 8,000er outranks
        # its label zoom, every 6,000er is at least tier 3.
        if isinstance(elev, (int, float)):
            lod = min(lod, 2 if elev >= 8000 else 3 if elev >= 6000 else 4 if elev >= 4000 else lod)
        facts = ""   # the card's own meta line already states the height
        cat = "landform" if cla in ("depression", "plateau") else "mountain"
        add(cat, p.get("name_en") or p["name"], typ, c[0], c[1], lod,
            (elev or 0) / 1000 - float(p.get("min_zoom") or 9), p.get("wikidataid"), facts,
            extra={"elevation_m": elev} if isinstance(elev, (int, float)) else None)

    for f in ne_layer(args.work, "cities"):
        p = lower(f["properties"])
        cla = p.get("featurecla") or ""
        capital = cla.startswith("Admin-0 capital")
        mz = float(p.get("min_zoom") or 9)
        if not (capital or mz <= 4.0 or p.get("megacity") == 1):
            continue
        lod = 2 if mz <= 2 else 3 if mz <= 3.5 else 4 if capital or mz <= 4 else 5
        pop = p.get("pop_max") or 0
        typ = "Capital city" if capital else "City"
        where = ", ".join(x for x in (p.get("adm1name") if not capital else None, p.get("adm0name")) if x)
        facts = f"{typ} of {p.get('adm0name')}." if capital else (f"City in {where}." if where else "")
        if pop:
            facts += f" Metropolitan population about {fmt_int(pop)}."
        add("city", p.get("nameascii") or p.get("name"), typ, p.get("longitude"), p.get("latitude"), lod,
            math.log10(pop + 1) - mz + (3 if capital else 0), p.get("wikidataid"), facts.strip(),
            extra={"population": pop} if pop else None)

    # Faults: GEM's traces grouped by name, ranked by mapped length. A name
    # given to many unrelated little segments ("unnamed", "Fault 12") is not
    # a place, so a name must carry letters and a real length.
    faults = json.load(open(fetch(FAULTS, os.path.join(args.work, "gem_faults.geojson"))))["features"]
    fg = {}
    for f in faults:
        p = f["properties"]
        name = (p.get("name") or "").strip()
        if len(name) < 4 or not any(ch.isalpha() for ch in name) or name.lower().startswith(("unnamed", "unknown", "fault ")):
            continue
        g = fg.setdefault(name, {"p": p, "parts": []})
        g["parts"] += parts_of(f["geometry"]) if f["geometry"] else []
    rows = []
    for name, g in fg.items():
        L = total_length(g["parts"])
        if L >= 40:
            rows.append((L, name, g))
    rows.sort(reverse=True)
    for rank, (L, name, g) in enumerate(rows):
        p = g["p"]
        anchor, _ = line_anchor(g["parts"])
        if not anchor:
            continue
        lod = 2 if L >= 800 else 3 if L >= 300 else 4 if L >= 120 else 5
        def tup(s):
            head = (str(s or "").strip("()").split(",")[0] or "").strip()
            try:
                return f"{float(head):g}"
            except ValueError:
                return ""
        bits = [f"{p.get('slip_type') or 'Active'} fault, about {fmt_int(L)} km of mapped trace"]
        if tup(p.get("average_dip")):
            bits.append(f"dipping about {tup(p.get('average_dip'))}°{(' ' + p['dip_dir']) if p.get('dip_dir') else ''}")
        if tup(p.get("net_slip_rate")):
            bits.append(f"net slip about {tup(p.get('net_slip_rate'))} mm/yr")
        typ = "Fault" if "fault" not in name.lower() and "zone" not in name.lower() else "Fault"
        add("tectonic", name if any(w in name.lower() for w in ("fault", "zone", "thrust", "rift", "trench", "system")) else f"{name} Fault",
            f"{p.get('slip_type') or 'Active'} fault", anchor[0], anchor[1], lod, L / 100,
            facts=", ".join(bits) + " (GEM Global Active Faults).",
            source="GEM Global Active Faults — CC BY-SA 4.0", extra={"length_km": round(L)})

    plates = json.load(open(fetch(PLATES, os.path.join(args.work, "pb2002_plates.json"))))["features"]
    for f in plates:
        p = f["properties"]
        name = p.get("PlateName") or p.get("Code")
        area = sphere_area_km2(f["geometry"])
        lon, lat = plate_anchor(f["geometry"])
        lod = 1 if area >= 2e7 else 2 if area >= 3e6 else 3 if area >= 5e5 else 4
        label = name if name.lower().endswith("plate") else f"{name} Plate"
        add("tectonic", label, "Tectonic plate", lon, lat, lod, 100 + area / 1e6,
            facts=f"Tectonic plate of about {fmt_int(area / 1e6 * 1e6)} km² in Bird's (2003) PB2002 model.",
            source="Bird (2003), PB2002 plate model", extra={"area_km2": round(area)})

    # ---- select, dedupe, describe -----------------------------------------
    chosen = []
    for cat, items in cand.items():
        items.sort(key=lambda it: (it["lod"], -it["_score"]))
        seen, keep = set(), []
        for it in items:
            # one label per FEATURE: Natural Earth cuts an ocean at the
            # antimeridian and a range into pieces, each with the same name
            key = it["_qid"] or it["name"].lower()
            if key in seen:
                continue
            seen.add(key)
            keep.append(it)
            if len(keep) >= BUDGET[cat]:
                break
        chosen += keep
    # the same place in two layers (an island as polygon and point) keeps the
    # first, most significant, entry
    final, taken, qids = [], [], set()
    for it in sorted(chosen, key=lambda it: it["lod"]):
        # the same Wikidata item in two layers (a river and its estuary as a
        # "marine" polygon, a range as polygon and as peak cluster) is one place
        if it["_qid"] and it["_qid"] in qids:
            continue
        clash = any(o["name"].lower() == it["name"].lower() and abs(o["lat"] - it["lat"]) < 1.5
                    and abs(((o["lon"] - it["lon"] + 180) % 360) - 180) < 1.5 for o in taken)
        if clash:
            continue
        taken.append(it)
        final.append(it)
        if it["_qid"]:
            qids.add(it["_qid"])

    summaries = wiki_summaries(args.work, sorted({it["_qid"] for it in final if it["_qid"]}), args.offline)
    places = []
    described = 0
    for it in final:
        title, text = summaries.get(it["_qid"], ("", "")) if it["_qid"] else ("", "")
        desc = text
        if desc:
            described += 1
        if it["_facts"]:
            desc = (desc + " " + it["_facts"]).strip() if desc else it["_facts"]
        if not desc:
            desc = f"{it['type']} named on Natural Earth's 1:10m map."
        src = it["_source"] + (" · Wikipedia (CC BY-SA 4.0)" if text and title else "")
        # A lake is "Albert" in Natural Earth and "Lake Albert" to everyone
        # else; its article title says which word the name carries.
        if it["category"] in ("lake", "river") and title:
            import re
            t = re.sub(r"\s*\([^)]*\)$", "", title)
            if it["name"].lower() in t.lower() and len(t) <= len(it["name"]) + 12:
                it["name"] = t
        row = {k: v for k, v in it.items() if not k.startswith("_")}
        row["lon"] = round(row["lon"] % 360, 4)          # the viewer's east-positive 0–360
        row["description"] = desc
        row["source"] = src
        if it["_qid"]:
            row["wikidata"] = it["_qid"]
        if title:
            row["wikipedia"] = title
        places.append(row)
    places.sort(key=lambda r: (r["lod"], r["category"], r["name"]))
    counts = {}
    for r in places:
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    tiers = [sum(1 for r in places if r["lod"] == k) for k in range(1, 6)]
    doc = {
        "_source": ("Natural Earth 1:10m (public domain); GEM Global Active Faults (CC BY-SA 4.0); "
                    "Bird (2003) PB2002 plates; descriptions from Wikipedia (CC BY-SA 4.0) via Wikidata (CC0)."),
        "baked": time.strftime("%Y-%m-%d"),
        "counts": counts, "lod_counts": tiers,
        "places": places,
    }
    json.dump(doc, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: {len(places)} places, {described} with a Wikipedia summary")
    print("  by category:", counts)
    print("  by tier 1–5:", tiers)


if __name__ == "__main__":
    main()
