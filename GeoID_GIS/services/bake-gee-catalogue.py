#!/usr/bin/env python3
"""
Bake Google's whole Earth Engine catalogue into one searchable index.

The service the page talks to used to offer THIRTEEN datasets, because the
list was an allowlist written by hand. Earth Engine publishes upward of a
thousand, and the app had no way to show them: the catalogue is a STAC tree
of 1 root + 130 provider catalogs + one JSON per dataset, and the provider
catalogs carry only mangled ids — no title, no description, no keywords — so
walking it from the browser gives a list nobody can search. Eleven hundred
fetches at page open is not an option either.

So it is walked ONCE, here, and the useful half of each record is written to
`data/global/gee-catalogue.json`: id, title, one-line summary, type, status,
Google's own categories and keywords, the temporal extent, the resolution,
the licence and provider — and the DEFAULT VISUALISATION, which is the part
that makes any of them requestable. `summaries["gee:visualizations"]` is how
Google itself renders that dataset in its own catalogue, so a page using it
is showing each dataset the way its publisher meant it to look, rather than
guessing at bands and a stretch.

Run it when the catalogue should be refreshed:

    python3 GeoID_GIS/services/bake-gee-catalogue.py
    python3 GeoID_GIS/services/bake-gee-catalogue.py --report-new   # no fetch

WHAT IS NEW IS A DIFFERENCE BETWEEN TWO BAKES, so it has to be recorded at the
moment it can still be computed — a snapshot cannot be asked what changed. Each
entry therefore carries `firstSeen` (the bake it first appeared in) and, where
a collection's temporal extent has moved forward, `extended`. That second one
is the honest reading of "new imagery" for something still being flown: on one
six-day gap it caught Sentinel-2 advancing 2026-08-28 to 2026-09-01, along with
176 other collections. `carry_baseline` holds the rules, including why the
FIRST bake must mark nothing new.

The file records `baked` so the panel can say how old the list is; the STAC
is public, keyless and CORS-open (`access-control-allow-origin: *`), which
is why no credential appears anywhere in this script.
"""

import concurrent.futures
import html
import json
import pathlib
import re
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = "https://storage.googleapis.com/earthengine-stac/catalog/catalog.json"
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "global" / "gee-catalogue.json"
THREADS = 24
MAX_CLASSES = 200


def fetch(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.loads(response.read())


def fetch_all(urls, what):
    """Every URL, in parallel, reporting what failed rather than dropping it."""
    out, failed = [], []

    def one(url):
        try:
            return fetch(url)
        except Exception as error:                       # noqa: BLE001
            return {"__error": str(error), "__url": url}

    with concurrent.futures.ThreadPoolExecutor(THREADS) as pool:
        for record in pool.map(one, urls):
            (failed if "__error" in record else out).append(record)
    if failed:
        print(f"  {len(failed)} {what} could not be read; first: {failed[0]['__url']}")
    return out


def children(catalog):
    return [link["href"] for link in catalog.get("links", []) if link.get("rel") == "child"]


def summary_of(record):
    """
    The first sentence of the description, as plain text.

    Descriptions run to thousands of characters of Markdown and the whole
    catalogue's worth would be megabytes; one sentence is what a card can
    show, and search runs over the title, id and keywords anyway.
    """
    text = record.get("description") or ""
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)   # links to their text
    text = re.sub(r"[*_`#>]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    cut = re.split(r"(?<=[.!?]) ", text)
    first = cut[0] if cut else ""
    if len(first) > 240:
        first = first[:237].rsplit(" ", 1)[0] + "…"
    return first


def classes_of(record, bands):
    """
    A classification band's own colour table: value, colour, name.

    Land cover is published with no stretch at all — the band carries
    `gee:classes` and Earth Engine's own catalogue draws it from that — so
    without this, 25 of the most useful datasets in the catalogue (ESA
    WorldCover, Copernicus land cover, Dynamic World) have nothing to render
    with and come out as grey noise under a legend that says nothing.
    """
    if len(bands) != 1:
        return None
    for band in (record.get("summaries") or {}).get("eo:bands") or []:
        if band.get("name") != bands[0]:
            continue
        classes = band.get("gee:classes") or []
        if not classes:
            return None
        # LANDFIRE's existing-vegetation map publishes 24,201 classes, and
        # three of them together took this file from 869 KB to 8.5 MB. Past a
        # couple of hundred a class table is not a legend anybody reads and
        # not a palette a thumbnail can show, so those datasets keep their
        # entry and are honestly marked as having no default rendering.
        if len(classes) > MAX_CLASSES:
            return None
        return [
            {
                "v": c.get("value"),
                "c": c.get("color"),
                "n": html.unescape(c.get("description") or ""),
            }
            for c in classes
            if c.get("value") is not None and c.get("color")
        ]
    return None


def visualisation_of(record):
    """
    Google's own default rendering: bands, stretch, and a palette or gamma.

    Only the IMAGE visualisation is kept. A table's is a point/polygon style
    that says nothing about how to make a picture of it, and this index's
    consumer drapes rasters.
    """
    for item in (record.get("summaries") or {}).get("gee:visualizations") or []:
        band_vis = (item.get("image_visualization") or {}).get("band_vis")
        if not band_vis:
            continue
        vis = {"bands": band_vis.get("bands") or []}
        # min/max arrive as LISTS, one per band or one for all of them.
        for key in ("min", "max", "gamma"):
            value = band_vis.get(key)
            if isinstance(value, list) and value:
                vis[key] = value[0] if len(value) == 1 else value
            elif value is not None:
                vis[key] = value
        if band_vis.get("palette"):
            vis["palette"] = band_vis["palette"]
        if item.get("display_name"):
            vis["name"] = item["display_name"]
        classes = classes_of(record, vis["bands"])
        if classes:
            vis["classes"] = classes
        return vis
    return None


def interval_of(record):
    """The temporal extent as plain dates. An open end is null, not today."""
    interval = (((record.get("extent") or {}).get("temporal") or {})
                .get("interval") or [[None, None]])[0]
    return [(value or "")[:10] or None for value in interval]


def gsd_of(record):
    """Nominal resolution in metres — the smallest, where a record lists several."""
    gsd = (record.get("summaries") or {}).get("gsd")
    if isinstance(gsd, list) and gsd:
        numbers = [g for g in gsd if isinstance(g, (int, float))]
        return min(numbers) if numbers else None
    return gsd if isinstance(gsd, (int, float)) else None


def units_of(record, vis):
    """
    The unit of the band being visualised, where the record states one.

    It is what lets the page put a real legend on an arbitrary dataset — and
    `gee-sample.js` invert the palette back to numbers, so a drape somebody
    pulled today can be extracted like the curated ones. 614 of the 1,139
    records carry units; the rest honestly have none.
    """
    if not vis or len(vis.get("bands") or []) != 1:
        return None                                   # an RGB composite has no unit
    wanted = vis["bands"][0]
    for band in (record.get("summaries") or {}).get("eo:bands") or []:
        if band.get("name") == wanted:
            return band.get("gee:units")
    return None


def entry_of(record, href=None):
    start, end = interval_of(record)
    entry = {
        "id": record["id"],
        "title": record.get("title") or record["id"],
        "type": record.get("gee:type"),
        "status": record.get("gee:status") or "ready",
        "cats": record.get("gee:categories") or [],
        "kw": record.get("keywords") or [],
        "summary": summary_of(record),
        "provider": next((p.get("name") for p in record.get("providers") or []), None),
        "licence": record.get("license"),
    }
    if start:
        entry["start"] = start
    if end:
        entry["end"] = end
    gsd = gsd_of(record)
    if gsd:
        entry["gsd"] = gsd
    vis = visualisation_of(record)
    if vis:
        entry["vis"] = vis
        units = units_of(record, vis)
        if units:
            entry["units"] = units
    if href:
        # The STAC record itself, so a card can offer the full description,
        # every band and the terms of use rather than the sentence kept here.
        entry["href"] = href
    return entry


def carry_baseline(entries, previous):
    """
    Stamp each entry with WHEN THIS BAKE FIRST SAW IT, carried from the last one.

    This is what lets the panel say "new" about anything. A catalogue is a
    snapshot, so "new" cannot be read out of one — it is the difference between
    two, and the difference has to be recorded at the moment it can still be
    computed. Two fields, both dates:

      firstSeen  the bake this id first appeared in
      extended   the bake at which its temporal extent last moved FORWARD,
                 which is the honest reading of "new imagery" for a collection
                 that is still being flown

    Read them by EQUALITY against the payload's own `baked`: an entry is new at
    this bake when `firstSeen == baked`. No date arithmetic in the page, and a
    stale index cannot make an old dataset look new by the passage of time.

    THE FIRST BAKE ANNOUNCES NOTHING. With no previous file every id is
    unknown, so every one would be stamped today and the panel would greet
    somebody with eleven hundred "new" datasets — the same fault `atlas-watch`
    records as its first rule, in a different costume. That run sets
    `baseline: true` on the payload and the page treats the whole file as
    already-seen. A previous file WITHOUT the field is a different case and is
    not a baseline: its ids are known to have existed by its own bake date, so
    they take that date and anything absent from it is genuinely new.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    known = {e["id"]: e for e in (previous or {}).get("datasets", [])}
    fallback = (previous or {}).get("baked") or today
    fresh = extended = 0
    for entry in entries:
        was = known.get(entry["id"])
        if was is None:
            entry["firstSeen"] = today
            fresh += 1
            continue
        entry["firstSeen"] = was.get("firstSeen") or fallback
        # An END that has moved forward is the collection gaining imagery. A
        # missing or open end is not a retreat, so it is carried rather than
        # cleared: a publisher who stops stating an end has not un-flown the
        # satellite.
        moved = entry.get("end") and was.get("end") and entry["end"] > was["end"]
        if moved:
            entry["extended"] = today
            extended += 1
        elif was.get("extended"):
            entry["extended"] = was["extended"]
    return {"new": fresh, "extended": extended, "baseline": previous is None}


def read_previous():
    """The last bake, or None. A corrupt file is treated as absent, loudly."""
    if not OUT.exists():
        return None
    try:
        return json.loads(OUT.read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        print(f"  previous {OUT.name} unreadable ({error}); baking a fresh baseline")
        return None


def report_new():
    """
    Print what the LAST bake found new, as markdown. Fetches nothing.

    Split from the bake itself so the scheduled check can re-bake once and then
    describe the result, rather than walking the catalogue a second time to
    answer a question the file already holds.
    """
    payload = read_previous()
    if not payload:
        print("_No baked catalogue to report on._")
        return 1
    fresh = [e for e in payload["datasets"] if e.get("firstSeen") == payload["baked"]]
    extended = [e for e in payload["datasets"] if e.get("extended") == payload["baked"]]
    print("<details><summary>Newly published datasets"
          f" ({len(fresh)})</summary>\n")
    for entry in fresh[:40]:
        print(f"- `{entry['id']}` — {entry['title']}")
    if not fresh:
        print("- (none — the change is collections gaining imagery)")
    if len(fresh) > 40:
        print(f"- …and {len(fresh) - 40} more")
    print("\n</details>\n")
    print("<details><summary>Collections whose imagery now reaches further"
          f" ({len(extended)})</summary>\n")
    for entry in extended[:40]:
        print(f"- `{entry['id']}` — now to {entry.get('end') or 'an open end'}")
    if len(extended) > 40:
        print(f"- …and {len(extended) - 40} more")
    print("\n</details>")
    return 0


def main():
    if "--report-new" in sys.argv[1:]:
        return report_new()
    print("Reading the Earth Engine STAC catalogue…")
    root = fetch(ROOT)
    providers = children(root)
    print(f"  {len(providers)} provider catalogs")

    catalogs = fetch_all(providers, "provider catalogs")
    dataset_urls = [url for catalog in catalogs for url in children(catalog)]
    print(f"  {len(dataset_urls)} datasets")

    records = fetch_all(dataset_urls, "datasets")
    # The href cannot be derived from the id: 109 of the 1,139 are filed under
    # `projects/<owner>/assets/…` yet live in a provider folder named nothing
    # like their first path segment, so it is carried rather than computed.
    hrefs = {record.get("id"): url for record, url in zip(records, dataset_urls)}
    entries = sorted((entry_of(r, hrefs.get(r.get("id"))) for r in records),
                     key=lambda e: e["id"])

    previous = read_previous()
    change = carry_baseline(entries, previous)
    payload = {
        "baked": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "previousBake": (previous or {}).get("baked"),
        # The panel reads this: a baseline bake has nothing to be new against.
        "baseline": change["baseline"],
        "source": ROOT,
        "count": len(entries),
        "datasets": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    kinds = {}
    for entry in entries:
        kinds[entry["type"]] = kinds.get(entry["type"], 0) + 1
    # Drapeable means there is something to RENDER it with: a stretch, or a
    # classification's own colour table. Bands alone are not enough.
    drapeable = sum(
        1 for e in entries
        if e["type"] in ("image", "image_collection") and e.get("vis")
        and e["vis"].get("bands")
        and (e["vis"].get("classes")
             or (e["vis"].get("min") is not None and e["vis"].get("max") is not None))
    )
    print(f"Wrote {OUT} — {OUT.stat().st_size / 1024:.0f} KB")
    print(f"  by type: {kinds}")
    print(f"  drapeable (image or collection, with a default visualisation): {drapeable}")
    if change["baseline"]:
        print("  BASELINE bake — no previous file, so nothing is marked new")
    else:
        gone = len({e["id"] for e in previous.get("datasets", [])}
                   - {e["id"] for e in entries})
        print(f"  since {previous.get('baked')}: {change['new']} new, "
              f"{change['extended']} extended, {gone} withdrawn")
    return 0 if entries else 1


if __name__ == "__main__":
    sys.exit(main())
