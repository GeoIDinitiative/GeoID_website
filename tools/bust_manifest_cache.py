#!/usr/bin/env python3
"""Append (or refresh) ?v=<mtime> on every "path": "...local-asset..." string in
every viewer's manifest JS, so the browser sees a unique URL whenever the
underlying asset is replaced.

Idempotent — running with no asset changes is a no-op. Only updates a path's
?v= value if the asset's mtime is different from the version already there.

Skips:
  - URLs with a scheme (http/https/data)
  - Paths that don't resolve to an actual file on disk

Run after deploying / before pushing:
    python3 tools/bust_manifest_cache.py
"""
import os, re, sys, glob

ROOT = "/home/owen/GeoID_webpage"
MANIFESTS = glob.glob(f"{ROOT}/**/*-manifest.js", recursive=True)
# Match: "path": "assets/foo.jpg"   or   "path": "assets/foo.jpg?v=1234567890"
PATH_RE = re.compile(r'("path"\s*:\s*")([^"]*?)(?:\?v=\d+)?(")')

def mtime_token(asset_path):
    try:
        return str(int(os.path.getmtime(asset_path)))
    except OSError:
        return None

total_updates = 0
files_changed = 0

for manifest in MANIFESTS:
    s = open(manifest).read()
    orig = s
    viewer_dir = os.path.dirname(manifest)

    def repl(m):
        head, raw_path, tail = m.group(1), m.group(2), m.group(3)
        # Skip empty paths, URLs, data: URIs
        if not raw_path or raw_path.startswith(("http://", "https://", "data:", "//")):
            return f"{head}{raw_path}{tail}"
        # Resolve relative to the manifest's directory
        local = os.path.normpath(os.path.join(viewer_dir, raw_path))
        ver = mtime_token(local)
        if ver is None:
            return f"{head}{raw_path}{tail}"  # asset not present locally — leave alone
        return f"{head}{raw_path}?v={ver}{tail}"

    s = PATH_RE.sub(repl, s)
    if s != orig:
        # Count diff occurrences as a rough update count
        n = sum(1 for a, b in zip(orig, s) if a != b)
        files_changed += 1
        open(manifest, "w").write(s)
        rel = manifest.replace(ROOT + "/", "")
        print(f"  updated: {rel}")
        total_updates += 1

print(f"\nManifests updated: {files_changed}/{len(MANIFESTS)}")
