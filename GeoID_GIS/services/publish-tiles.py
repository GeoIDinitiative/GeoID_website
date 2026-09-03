#!/usr/bin/env python3
"""
Put a baked tile pyramid in object storage, and point its manifest at it.

The baked maps outgrew the repository. GitHub Pages' limit is 1 GB and the
tracked tree is already past it; GLiM alone is 169 MB and the soil map another
27 MB, on top of ~200 MB of pyramids already shipped. They are pure static
files with stable paths and a content fingerprint, which is exactly what object
storage is for.

WHAT MOVES AND WHAT STAYS. The tile bytes move; the **manifest stays with the
site**. That split is the whole design and it is not an accident of
convenience: `manifest.json` is 10-20 KB and carries `has()` — which stops the
client asking for the thousands of ocean tiles that were never baked — and
every tile's SIZE, which is what `chooseZoom` weighs a view against BEFORE it
fetches anything. Put the manifest in the bucket too and a slow or unreachable
bucket stalls the zoom chooser rather than merely costing tiles.

So this does two things, and the second is the one that is easy to forget:

  1. uploads `data/global/<name>/` to `<remote>/<name>/`
  2. rewrites the LOCAL manifest's `tiles_base` to the public URL

Run it after a bake:

    python3 GeoID_GIS/services/publish-tiles.py glim \\
        --base https://data.example.com/glim

    python3 GeoID_GIS/services/publish-tiles.py glim --unpublish   # back to local

CREDENTIALS ARE RCLONE'S, NEVER THIS SCRIPT'S. It shells out to a configured
rclone remote and reads no key, no token and no secret of its own — there is
nowhere in this file for one to be typed, and nothing here writes one down.
Configure the remote once with `rclone config`; this only ever names it.

THE BUCKET MUST BE PUBLICLY READABLE AND CORS-ENABLED, and neither is something
this script can do: rclone speaks the S3 data API, while public access, a
custom domain and a CORS policy are account-level settings. Cloudflare's own
`r2.dev` development URL is rate-limited and documented as unsuitable for
production, so a real deployment wants a custom domain. `--check` verifies both
from outside once they are set, which is the only way to know they are right.

CACHE-CONTROL IS SET AT UPLOAD, immutable and long — safe because the client
appends the bake's own version fingerprint to every tile it asks for, so a
re-bake changes the URL. A pyramid uploaded without that header is served with
whatever default the bucket has, which for a tile that never changes is a
wasted round trip on every view.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"

# A year, and immutable: the client appends `?v=<fingerprint>` from the
# manifest, so a re-baked pyramid is a different URL and can never be served
# from a stale cache.
CACHE_CONTROL = "public, max-age=31536000, immutable"


def die(message: str) -> None:
    sys.exit(f"publish-tiles: {message}")


def pyramid(name: str) -> pathlib.Path:
    path = GLOBAL / name
    if not (path / "manifest.json").is_file():
        die(f"no baked pyramid at {path.relative_to(ROOT)} "
            "(is it baked, and is the name right?)")
    return path


def upload(path: pathlib.Path, remote: str, dry: bool) -> int:
    if not shutil.which("rclone"):
        die("rclone is not installed; it is what talks to the bucket")
    args = ["rclone", "copy", str(path), remote,
            "--header-upload", f"Cache-Control: {CACHE_CONTROL}",
            "--transfers", "16", "--checkers", "16",
            "--stats-one-line", "--stats", "30s"]
    if dry:
        args.append("--dry-run")
    print(f"  rclone copy -> {remote}")
    done = subprocess.run(args)
    return done.returncode


def stamp(path: pathlib.Path, base: str | None) -> dict:
    """
    Point the local manifest at the bucket — or back at itself.

    Rewritten in place rather than regenerated, because regenerating means
    re-baking, and a bake is an hour for GLiM. The field is dropped entirely
    when unpublishing so the file is byte-identical to what the bake wrote.
    """
    manifest = path / "manifest.json"
    body = json.loads(manifest.read_text())
    if base:
        body["tiles_base"] = base.rstrip("/")
    else:
        body.pop("tiles_base", None)
    manifest.write_text(json.dumps(body, separators=(",", ":")))
    return body


def check(body: dict, path: pathlib.Path) -> int:
    """
    Ask the bucket, from outside, the two questions rclone cannot answer.

    A private bucket and a missing CORS policy both present as a map that
    simply draws nothing, which is why this exists as a command rather than as
    an instruction to look at the dashboard.
    """
    base = body.get("tiles_base")
    if not base:
        die("this manifest names no tiles_base — nothing to check")
    sample = next(iter(body.get("tiles") or {}), None)
    if not sample:
        die("the manifest lists no tiles")
    url = f"{base}/{sample}.mvt"
    version = body.get("version")
    if version:
        url += f"?v={version}"
    print(f"  GET {url}")
    request = urllib.request.Request(url, method="GET", headers={
        # The header a browser would send, which is what makes the reply's
        # CORS header meaningful. Fetched without an Origin, a bucket looks
        # fine and the page still fails.
        "Origin": "https://geoidinitiative.com",
        # AND A USER AGENT, because Cloudflare's bot rules 403 the default one.
        #
        # Measured on the live bucket, identical URL and Origin: curl/7.81.0
        # and Mozilla/5.0 both answered 200, Python-urllib/3.10 answered 403.
        # Without this the check reported "is it publicly readable?" about a
        # bucket that was serving perfectly — a false negative that sends
        # somebody into the dashboard hunting a permission problem which does
        # not exist. The point of this command is to answer the question a
        # BROWSER would ask, so it has to look like one.
        "User-Agent": "Mozilla/5.0 (compatible; GeoID publish-tiles check)",
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body_bytes = response.read()
            allow = response.headers.get("access-control-allow-origin")
            cache = response.headers.get("cache-control")
    except urllib.error.HTTPError as error:
        die(f"the bucket answered HTTP {error.code} — is it publicly readable?")
    except urllib.error.URLError as error:
        die(f"could not reach {base} ({error.reason}) — is the domain bound?")

    ok = True
    print(f"  {len(body_bytes):,} bytes")
    if allow:
        print(f"  access-control-allow-origin: {allow}")
    else:
        print("  NO access-control-allow-origin — a browser will refuse this. "
              "Set a CORS policy on the bucket allowing GET from the site.")
        ok = False
    print(f"  cache-control: {cache or 'NOT SET — every view re-fetches'}")
    if not cache:
        ok = False
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", help="pyramid under data/global, e.g. glim")
    parser.add_argument("--remote", default="r2:geoid-maps",
                        help="rclone destination (default: r2:geoid-maps)")
    parser.add_argument("--base", help="public URL the tiles will be served from")
    parser.add_argument("--unpublish", action="store_true",
                        help="drop tiles_base so the pyramid is read locally again")
    parser.add_argument("--check", action="store_true",
                        help="verify the published tiles are readable and CORS-open")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    path = pyramid(args.name)

    if args.check:
        return check(json.loads((path / "manifest.json").read_text()), path)

    if args.unpublish:
        stamp(path, None)
        print(f"{args.name}: tiles_base dropped — read from the site again")
        return 0

    if not args.base:
        die("--base is required: the public URL the tiles will be served from "
            "(a custom domain on the bucket, not the rate-limited r2.dev one)")

    code = upload(path, f"{args.remote.rstrip('/')}/{args.name}", args.dry_run)
    if code != 0:
        die(f"rclone exited {code}; the manifest was NOT changed")
    if args.dry_run:
        print("dry run — the manifest was not changed")
        return 0

    body = stamp(path, args.base)
    print(f"{args.name}: {len(body.get('tiles') or {}):,} tiles now served from "
          f"{body['tiles_base']}")
    print("  next: python3 GeoID_GIS/services/publish-tiles.py "
          f"{args.name} --check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
