#!/usr/bin/env python3
"""Make the /explore/ pages' share cards from their screenshots.

    python3 scripts/explore-images.py            # write assets/social/explore-*.jpg
    python3 scripts/explore-images.py --check    # exit 1 if a screenshot or card is missing

Each page's screenshot is assets/explore/<slug>.jpg (800x450, a capture of the
running tool). Its card, assets/social/explore-<slug>.jpg, is that capture at
1200x630 -- the size every link preview crops to (see social-cards.py) -- with
the tool's name and "Free in your browser" set along the foot, so a link
posted anywhere says what it opens. The hub's card is assets/social/explore.jpg.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "explore" / "features.json").read_text(encoding="utf-8"))
FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]
ACCENT = (255, 62, 200)


def font(size):
    from PIL import ImageFont
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def card(src, dst, name):
    from PIL import Image, ImageDraw
    im = Image.open(src).convert("RGB")
    # 1200x630 is 1.905:1; the capture is 16:9, so lose a strip top and bottom.
    w, h = im.size
    ch = round(w / (1200 / 630))
    top = max(0, (h - ch) // 2)
    im = im.crop((0, top, w, top + ch)).resize((1200, 630), Image.LANCZOS)
    shade = Image.new("L", (1, 630))
    for y in range(630):
        shade.putpixel((0, y), int(max(0, (y - 380) / 250) * 215))
    black = Image.new("RGB", (1200, 630), (8, 0, 20))
    im = Image.composite(black, im, shade.resize((1200, 630)))
    d = ImageDraw.Draw(im)
    d.rectangle((60, 520, 66, 590), fill=ACCENT)
    d.text((86, 512), name, font=font(46), fill=(255, 255, 255))
    d.text((88, 568), "GeoID GeoHUB  ·  free in your browser", font=font(24), fill=(230, 220, 240))
    im.save(dst, quality=84, optimize=True, progressive=True)


def jobs():
    yield ROOT / "assets" / "explore" / DATA["hub"]["image"]["file"], ROOT / "assets" / "social" / "explore.jpg", "Explore GeoHUB"
    for f in DATA["features"]:
        yield ROOT / "assets" / "explore" / f"{f['slug']}.jpg", ROOT / "assets" / "social" / f"explore-{f['slug']}.jpg", f["name"]


def main():
    check = "--check" in sys.argv
    missing = []
    for src, dst, name in jobs():
        if not src.exists():
            missing.append(str(src.relative_to(ROOT)))
            continue
        if check:
            if not dst.exists():
                missing.append(str(dst.relative_to(ROOT)))
            continue
        card(src, dst, name)
    for m in missing:
        print("MISSING  " + m)
    if check:
        print("all explore images present" if not missing else f"{len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
