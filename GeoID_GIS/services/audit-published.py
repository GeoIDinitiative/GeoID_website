#!/usr/bin/env python3
"""
Check that everything moved to the bucket is actually wired to be read from it.

Four things have moved: the baked pyramids' tiles, the loose files under
`data/global`, a viewer's own assets, and the references that name them. Each
can be wrong on its own, and the failures are quiet:

  * an object missing from the bucket  -> 404 in production only
  * a reference still naming a LOCAL path that is no longer tracked -> the same,
    and invisible on a dev server because the untracked file is still on disk
  * a reference naming the bucket for a file that was never uploaded
  * bucket content that has drifted from the local copy, so the site serves
    bytes nobody has looked at
  * a missing CORS header, which a browser reports as a network failure rather
    than as a status

So this asks the questions in the order they fail, and reports counts rather
than a bare pass. Run it after every publish.

    python3 GeoID_GIS/services/audit-published.py
    python3 GeoID_GIS/services/audit-published.py --full   # every tile, not a sample
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import random
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "global"
REMOTE = "r2:geoid-maps"
SITE = "https://geoidinitiative.com"
CODE = (".js", ".html", ".json", ".mjs")

# A browser's headers. Without the User-Agent Cloudflare's bot rules 403 the
# default Python one; without the production Referer, Hotlink Protection 403s
# any IMAGE — measured, and it is a fact about the zone rather than the files.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; GeoID audit)",
    "Origin": SITE,
    "Referer": SITE + "/",
}

fails: list[str] = []
notes: list[str] = []


def bad(m: str) -> None:
    fails.append(m)


def head(url: str) -> tuple[int | str, dict]:
    req = urllib.request.Request(url, method="HEAD", headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            # LOWERCASED: dict(r.headers) keeps the wire casing, so a lookup for
            # "access-control-allow-origin" misses "Access-Control-Allow-Origin"
            # and every object reads as CORS-less while curl shows the header.
            return r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        h = getattr(e, "headers", None)
        return e.code, {k.lower(): v for k, v in (h.items() if h else [])}
    except Exception as e:  # noqa: BLE001
        return f"ERR {e}", {}


def bucket_files(prefix: str) -> set[str]:
    out = subprocess.run(["rclone", "lsf", "-R", "--files-only", f"{REMOTE}/{prefix}"],
                         capture_output=True, text=True)
    return {l for l in out.stdout.split("\n") if l}


def drifted(local: pathlib.Path, prefix: str) -> list[str]:
    """Byte identity, via the S3 API rather than 3,000 HTTP requests."""
    if not local.is_dir():
        return []
    out = subprocess.run(["rclone", "check", str(local), f"{REMOTE}/{prefix}",
                          "--one-way", "--combined", "-"],
                         capture_output=True, text=True)
    return [l[2:] for l in out.stdout.split("\n") if l[:1] in ("*", "-")]


def tracked() -> set[str]:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, cwd=ROOT)
    return {x for x in out.stdout.split("\0") if x}


def code_files():
    for p in ROOT.rglob("*"):
        if p.suffix in CODE and p.is_file() and ".git/" not in str(p):
            yield p


def section(t: str) -> None:
    print(f"\n{t}\n{'-' * len(t)}")


def published_host() -> str:
    """The scheme+host things were published to, read from what was published."""
    src = GLOBAL / "sources.json"
    if src.is_file():
        base = json.loads(src.read_text()).get("base")
        if base:
            return base.rstrip("/")
    for man in GLOBAL.glob("*/manifest.json"):
        base = json.loads(man.read_text()).get("tiles_base")
        if base:
            return "/".join(base.rstrip("/").split("/")[:3])
    return ""


def audit_pyramids(full: bool) -> None:
    section("Baked pyramids")
    for man in sorted(GLOBAL.glob("*/manifest.json")):
        name = man.parent.name
        body = json.loads(man.read_text())
        base, version = body.get("tiles_base"), body.get("version")
        tiles = body.get("tiles") or {}
        if not base:
            notes.append(f"{name}: read locally (no tiles_base)")
            continue
        if not version:
            bad(f"{name}: published with NO version — its tiles sit at a bare URL "
                "under an immutable year-long cache, so a re-bake is invisible")
        objs = bucket_files(name)
        missing = [t for t in tiles if f"{t}.mvt" not in objs]
        if missing:
            bad(f"{name}: {len(missing)} of {len(tiles)} tiles absent from the bucket "
                f"(e.g. {missing[0]})")
        d = drifted(man.parent, name)
        # manifest.json differs on purpose: tiles_base is stamped locally after upload
        d = [x for x in d if x != "manifest.json"]
        if d:
            bad(f"{name}: {len(d)} objects differ from the local copy (e.g. {d[0]})")
        sample = sorted(tiles)
        if not full:
            sample = random.Random(0).sample(sample, min(12, len(sample)))
        codes, nocors = {}, 0
        for t in sample:
            url = f"{base}/{t}.mvt" + (f"?v={version}" if version else "")
            st, h = head(url)
            codes[st] = codes.get(st, 0) + 1
            if st == 200 and not h.get("access-control-allow-origin"):
                nocors += 1
        if set(codes) != {200}:
            bad(f"{name}: tile HTTP {codes}")
        if nocors:
            bad(f"{name}: {nocors} tiles answer 200 with NO CORS header")
        print(f"  {name:9s} {len(tiles):5d} tiles  bucket {len(objs):5d}  "
              f"sampled {len(sample):3d} -> {codes}  drift {len(d)}")


def audit_loose(full: bool) -> None:
    section("Loose files (sources.json)")
    src = GLOBAL / "sources.json"
    if not src.is_file():
        notes.append("no sources.json — the loose files are read from the site")
        return
    body = json.loads(src.read_text())
    base, files = body.get("base"), body.get("files") or {}
    if not base:
        notes.append("sources.json names no base")
        return
    if src.name in files:
        bad("sources.json lists ITSELF; it is what names the others and must ship")
    codes = {}
    for rel, stamp in sorted(files.items()):
        local = GLOBAL / rel
        if local.is_file():
            got = hashlib.sha256(local.read_bytes()).hexdigest()[:12]
            if got != stamp:
                bad(f"{rel}: sources.json says {stamp}, the local file hashes {got} "
                    "— the bucket is serving different bytes from the ones recorded")
        st, h = head(f"{base}/{rel}?v={stamp}")
        codes[st] = codes.get(st, 0) + 1
        if st == 200 and not h.get("access-control-allow-origin"):
            bad(f"{rel}: 200 with no CORS header")
    if set(codes) != {200}:
        bad(f"loose files HTTP {codes}")
    print(f"  {len(files)} files -> {codes}")


def audit_viewer_assets() -> None:
    section("Viewer assets")
    # OUR host only. `assets/<word>/` is a common shape on other people's
    # servers too — the Mars manifest cites an AWS URL with `/assets/palladium/`
    # in it — and auditing those reports failures about somebody else's CDN.
    host = published_host()
    if not host:
        print("  nothing published to a bucket host")
        return
    keys = set()
    for p in code_files():
        keys |= set(re.findall(re.escape(host) + r"/assets/(?:hotlink-ok/)?([a-z0-9-]+)/",
                               p.read_text(errors="surrogateescape")))
    for key in sorted(keys):
        objs = bucket_files(f"assets/hotlink-ok/{key}")
        urls = set()
        for p in code_files():
            urls |= set(re.findall(
                "(" + re.escape(host) + r"/assets/(?:hotlink-ok/)?" + re.escape(key) + r"/[A-Za-z0-9_./-]+(?:\?v=[0-9a-f]+)?)",
                p.read_text(errors="surrogateescape")))
        codes = {}
        for u in sorted(urls):
            st, h = head(u)
            codes[st] = codes.get(st, 0) + 1
            if st == 200 and not h.get("access-control-allow-origin"):
                bad(f"{key}: {u.rsplit('/', 1)[-1]} 200 with no CORS header")
        if set(codes) - {200}:
            bad(f"assets/{key}: referenced URLs HTTP {codes}")
        print(f"  assets/{key:14s} bucket {len(objs):4d} objects, "
              f"{len(urls):3d} referenced -> {codes}")


def audit_references(tracked_set: set[str]) -> None:
    """A reference to an untracked LOCAL file is a 404 that only production sees."""
    section("References to local files")
    published = set()
    src = GLOBAL / "sources.json"
    if src.is_file():
        published = {f"data/global/{r}" for r in (json.loads(src.read_text()).get("files") or {})}
    dangling = []
    for p in code_files():
        rel_dir = p.parent.relative_to(ROOT)
        text = p.read_text(errors="surrogateescape")
        for m in re.findall(r"""["'`(]\s*(/?(?:data/global|assets)/[A-Za-z0-9_./-]+\.[a-z0-9]{2,7})""", text):
            cand = m.lstrip("/")
            for path in ({cand, str(rel_dir / cand)} if not m.startswith("/") else {cand}):
                path = os.path.normpath(path)
                if (ROOT / path).is_file() or path in tracked_set:
                    # A path listed in sources.json is what `dataUrl` is HANDED;
                    # it resolves to the bucket at runtime, so naming it locally
                    # is the design rather than a dangling reference.
                    if (path not in tracked_set and (ROOT / path).is_file()
                            and path not in published):
                        dangling.append(f"{p.relative_to(ROOT)} -> {m} (on disk, UNTRACKED)")
                    break
    for d in dangling:
        bad(d)
    print(f"  dangling local references: {len(dangling)}")
    print(f"  files sources.json publishes: {len(published)}")


def audit_metadata(tracked_set: set[str]) -> None:
    section("Metadata that must ship with the site")
    must = [p for p in GLOBAL.rglob("*")
            if p.is_file() and p.name in ("manifest.json", "sources.json",
                                          "units.json", "classes.json")]
    for p in must:
        rel = str(p.relative_to(ROOT))
        if rel not in tracked_set:
            bad(f"{rel} is NOT tracked — it is read before any fetch and cannot "
                "live in the bucket it describes")
    print(f"  {len(must)} metadata files, all tracked: "
          f"{all(str(p.relative_to(ROOT)) in tracked_set for p in must)}")


def audit_hotlink() -> None:
    section("Cloudflare hotlink protection")
    probe = None
    for p in code_files():
        m = re.search(r"https://[a-z0-9.-]+/assets/[a-z0-9-]+/[A-Za-z0-9_./-]+\.(?:jpg|png)",
                      p.read_text(errors="surrogateescape"))
        if m:
            probe = m.group(0)
            break
    if not probe:
        print("  no published image to probe")
        return
    prod, _ = head(probe)
    req = urllib.request.Request(probe, method="HEAD", headers={
        **HEADERS, "Referer": "http://localhost:8125/", "Origin": "http://localhost:8125"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            local = r.status
    except urllib.error.HTTPError as e:
        local = e.code
    except Exception as e:  # noqa: BLE001
        local = f"ERR {e}"
    print(f"  image with production Referer: {prod}")
    print(f"  image with localhost  Referer: {local}")
    if prod == 200 and local != 200:
        notes.append("Hotlink Protection is ON: published IMAGES 403 for any "
                     "Referer other than the zone. Production is fine; LOCAL "
                     "DEVELOPMENT of those viewers is broken until it is off.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--full", action="store_true", help="every tile, not a sample")
    args = ap.parse_args()
    t = tracked()
    audit_pyramids(args.full)
    audit_loose(args.full)
    audit_viewer_assets()
    audit_references(t)
    audit_metadata(t)
    audit_hotlink()
    section("Result")
    for n in notes:
        print(f"  note: {n}")
    if fails:
        for f in fails:
            print(f"  FAIL: {f}")
        print(f"\n  {len(fails)} problem(s)")
        return 1
    print("  everything published is present, byte-identical, reachable and CORS-open.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
