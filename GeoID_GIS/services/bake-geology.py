#!/usr/bin/env python3
"""Bake the world's geology tiles into the site.

Why bake at all, when the tiles stream perfectly well from Macrostrat: because
a map you do not hold is a map that can change, rate-limit, go down, or answer
without a CORS header (which theirs does, for some cached objects — see
`macrostrat.js`). The world view is the one everybody sees first, so the world
view should be ours, on disk, deterministic and offline.

Why only to zoom 5: measured over the whole planet, one zoom at a time —

    z0    0.7 MB      z3   10.8 MB
    z1    1.6 MB      z4   14.4 MB
    z2    1.3 MB      z5   17.0 MB      z6   ~150 MB

so z0-z5 is about 46 MB, the same order as the Natural Earth vectors already
shipped, and z6 alone is three times the rest put together. Past z5 the tiles
are fetched live, which is the right way round: the coarse levels are asked for
constantly and change never; the fine ones are asked for rarely and are where
the source's own updates matter.

The file written is the tile exactly as served — one MVT holding both the
`units` and `lines` layers — so nothing is re-encoded here and the decoder is
the same one either way.

    python3 GeoID_GIS/services/bake-geology.py            # z0-z5, the default
    python3 GeoID_GIS/services/bake-geology.py --max-zoom 4
    python3 GeoID_GIS/services/bake-geology.py --check    # report, write nothing

Licence: Macrostrat's Burwell compilation, CC BY 4.0, plus the credit each
source map carries in its own `ref_*` fields. That is recorded in the manifest
beside the tiles rather than left to a README nobody reads.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib
import sys
import urllib.error
import urllib.request

TILES = "https://tiles.macrostrat.org/carto"
OUT = pathlib.Path(__file__).resolve().parents[2] / "data" / "global" / "geology"

# Under this a tile is an empty envelope: ocean, ice, or ground nobody has
# mapped. Recording it as absent keeps the manifest honest and saves the client
# a request that would answer with nothing.
EMPTY_BYTES = 200


def fetch(z: int, x: int, y: int, tries: int = 2) -> bytes | None:
    for attempt in range(tries):
        # The query string on a retry is deliberate: some cached objects come
        # back without their CORS header, and a URL the cache has not got is a
        # miss, which does carry it. Harmless here, load-bearing in the browser.
        url = f"{TILES}/{z}/{x}/{y}.mvt" + ("" if attempt == 0 else "?bake=1")
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    return None


def bake(max_zoom: int, check: bool) -> int:
    manifest: dict[str, int] = {}
    failures: list[str] = []
    total = 0
    for z in range(0, max_zoom + 1):
        side = 2 ** z
        wanted = [(x, y) for x in range(side) for y in range(side)]
        kept = 0
        bytes_here = 0

        def one(coords):
            x, y = coords
            data = fetch(z, x, y)
            return x, y, data

        with concurrent.futures.ThreadPoolExecutor(6) as pool:
            for x, y, data in pool.map(one, wanted):
                if data is None:
                    failures.append(f"{z}/{x}/{y}")
                    continue
                if len(data) <= EMPTY_BYTES:
                    continue
                kept += 1
                bytes_here += len(data)
                manifest[f"{z}/{x}/{y}"] = len(data)
                if not check:
                    path = OUT / str(z) / str(x) / f"{y}.mvt"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
        total += bytes_here
        print(f"z{z}: {kept} of {len(wanted)} tiles carry data, {bytes_here / 1e6:.1f} MB")

    print(f"total {total / 1e6:.1f} MB in {len(manifest)} tiles"
          + (f", {len(failures)} unreachable" if failures else ""))
    if failures:
        print("unreachable:", ", ".join(failures[:12]))
    if check:
        return 0

    (OUT / "manifest.json").write_text(json.dumps({
        "source": "Macrostrat Burwell compilation",
        "endpoint": TILES,
        "licence": "CC BY 4.0, plus the credit each source map carries",
        "format": "Mapbox Vector Tile, layers: units (polygons), lines (contacts and faults)",
        "max_zoom": max_zoom,
        "note": "Baked by GeoID_GIS/services/bake-geology.py. Tiles past max_zoom "
                "are fetched live from the endpoint above.",
        "tiles": manifest,
    }, indent=1, sort_keys=True) + "\n")
    print(f"manifest: {len(manifest)} tiles -> {OUT / 'manifest.json'}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-zoom", type=int, default=5)
    parser.add_argument("--check", action="store_true",
                        help="fetch and measure, write nothing")
    args = parser.parse_args()
    return bake(args.max_zoom, args.check)


if __name__ == "__main__":
    sys.exit(main())
