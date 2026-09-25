#!/usr/bin/env python3
"""Does the live site send the headers the runbook asks Cloudflare for?

    python3 scripts/headers-verify.py
    python3 scripts/headers-verify.py --host staging.example.com

Four of these CANNOT be set from this repository. `_headers` is a Cloudflare
*Pages* convention and this site is GitHub Pages behind Cloudflare, so the file
is inert -- measured, not assumed. `frame-ancestors` cannot live in a meta tag
at all, which is why there is no clickjacking protection until somebody makes
the Transform Rule. docs/security-runbook.md §1 has the rule to paste; this
says whether it took.

SEND A BROWSER-SHAPED User-Agent. Cloudflare's bot rules answer
`Python-urllib` with 403 on this zone -- measured, curl 200 and urllib 403 on
the identical URL -- and a checker that reads that as "the header is missing"
sends somebody into the dashboard after a fault that is not there.

Exit 0 when every header is present and correct, 1 otherwise, so it can gate
a deploy once the rules are in.
"""
import sys
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

# header -> (what it must contain, why it matters in one line)
WANT = {
    "strict-transport-security": ("max-age=", "a stripped first request stays stripped"),
    "x-content-type-options": ("nosniff", "an uploaded file sniffed as script is script"),
    "referrer-policy": ("strict-origin", "full URLs leak to every third-party tile host"),
    "x-frame-options": ("sameorigin", "clickjacking, for browsers without frame-ancestors"),
    "content-security-policy": ("frame-ancestors", "clickjacking; a meta tag cannot carry it"),
    "permissions-policy": ("camera=", "a compromised page may ask for the camera"),
    "cross-origin-opener-policy": ("same-origin", "cross-window attacks; must allow-popups for OAuth"),
}


def head(url):
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": UA, "Accept": "text/html,*/*", "Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            # The header object is case-insensitive; dict() would lose that.
            return {k.lower(): v for k, v in r.headers.items()}, None
    except urllib.error.HTTPError as e:
        return {k.lower(): v for k, v in e.headers.items()}, None
    except Exception as e:                                   # noqa: BLE001
        return None, str(e)


def main():
    host = "geoidinitiative.com"
    if "--host" in sys.argv:
        host = sys.argv[sys.argv.index("--host") + 1]
    url = f"https://{host}/"
    got, error = head(url)
    if got is None:
        print(f"could not reach {url}: {error}", file=sys.stderr)
        return 2

    print(f"{url}\n")
    missing = 0
    for name, (needle, why) in WANT.items():
        value = got.get(name, "")
        ok = needle.lower() in value.lower()
        missing += 0 if ok else 1
        mark = "ok " if ok else "MISSING"
        print(f"  {mark:8s} {name}")
        print(f"           {value if value else why}")

    # The service worker held for four hours is a fix nobody can receive.
    sw, _ = head(f"https://{host}/sw.js")
    cache = (sw or {}).get("cache-control", "")
    sw_ok = "no-cache" in cache or "max-age=0" in cache
    missing += 0 if sw_ok else 1
    print(f"\n  {'ok ' if sw_ok else 'MISSING':8s} /sw.js cache-control")
    print(f"           {cache or 'not sent'}")

    print(f"\n{missing} of {len(WANT) + 1} not set."
          if missing else f"\nall {len(WANT) + 1} present.")
    if missing:
        print("These are Cloudflare Transform Rules, not repository files:\n"
              "  docs/security-runbook.md §1 has the rule to paste.")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
