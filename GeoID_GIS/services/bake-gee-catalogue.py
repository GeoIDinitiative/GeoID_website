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


def main():
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

    payload = {
        "baked": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
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
    return 0 if entries else 1


if __name__ == "__main__":
    sys.exit(main())
