#!/usr/bin/env python3
"""Prepare the transit hero tiles from the supplied photographs.

`transit/backrounds/` holds the masters — real spacecraft and telescope imagery,
placed there by hand. This turns each one into the tile the page actually
loads: `assets/hero/<body>.jpg`, sized for the tile and cheap enough to sit in
front of a viewer that is still loading.

WHERE THE OTHER BODIES COME FROM. A photograph exists for seven of the ten
destinations. Mercury, the Moon and Earth (the ISS destination arrives over
Earth) keep the oblique RENDERED from their own viewer by bake-hero-tiles.py,
so no destination is left without a tile and the page needs no special case.
Drop a matching file into transit/backrounds/ and re-run this to replace one.

The masters are kept rather than being replaced by their output: a derived
asset should be reproducible from the thing it was derived from, and these were
cropped and levelled by eye.

TWO THINGS THIS DOES NOT DO, both deliberate. It does not upscale — Jupiter's
master is 399x501, and enlarging it would trade honest softness for a bigger
file that is no sharper. And it does not crop to the tile's shape: the tile is
about 3.7:1 and every master is nearer square, so a crop here would bake one
aspect ratio into the asset and lose the rest of the picture at every other
breakpoint. `background-size: cover` does that at render time, where it can
answer to the width the tile actually has.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MASTERS = ROOT / "transit" / "backrounds"
OUT_DIR = ROOT / "assets" / "hero"

# The tile is ~840 CSS px at its widest; twice that covers a high-DPI screen,
# and nothing here is large enough to want more.
MAX_WIDTH = 1680
QUALITY = 84

# Master stem -> destination key in transit/index.html's table.
KEYS = {
    "jupiter": "jupiter", "mars": "mars", "neptune": "neptune",
    "pluto": "pluto", "saturn": "saturn", "uranus": "uranus", "venus": "venus",
}


def main() -> int:
    if not MASTERS.is_dir():
        print(f"No masters at {MASTERS.relative_to(ROOT)}")
        return 2
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    seen = set()
    for path in sorted(MASTERS.iterdir()):
        key = KEYS.get(path.stem.lower())
        if not key:
            print(f"  {path.name:<16} SKIPPED — no destination named {path.stem!r}")
            continue
        im = Image.open(path)
        # A PNG's alpha is composited onto black rather than dropped: these are
        # pictures of space, so the ground behind them is black by definition,
        # and flattening onto white would ring every limb.
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            flat = Image.new("RGB", im.size, (0, 0, 0))
            flat.paste(im, mask=im.split()[-1])
            im = flat
        else:
            im = im.convert("RGB")

        was = im.size
        if im.width > MAX_WIDTH:
            im = im.resize((MAX_WIDTH, round(im.height * MAX_WIDTH / im.width)),
                           Image.LANCZOS)

        out = OUT_DIR / f"{key}.jpg"
        before = out.stat().st_size if out.exists() else 0
        im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        seen.add(key)
        print(f"  {key:<9} {was[0]}x{was[1]} -> {im.width}x{im.height}  "
              f"{out.stat().st_size // 1024:>4} KB"
              + (f"  (was {before // 1024} KB)" if before else ""))

    rendered = sorted({"mercury", "moon", "earth"})
    print(f"\n  {len(seen)} from photographs; {', '.join(rendered)} stay as the "
          f"renders from bake-hero-tiles.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
