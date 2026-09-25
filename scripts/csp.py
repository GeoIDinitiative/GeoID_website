#!/usr/bin/env python3
"""Write each content page's Content-Security-Policy, hashing its own scripts.

    python3 scripts/csp.py            # rewrite every page's policy
    python3 scripts/csp.py --check    # exit 1 if any page's policy is stale

WHY A SCRIPT AND NOT A CONSTANT. The first policy shipped with
`script-src 'self' 'unsafe-inline'`, and a security review was right that it
bought almost nothing: `'unsafe-inline'` admits an inline event handler, and
`<img src=x onerror=…>` IS an inline event handler -- which is exactly the
payload an `innerHTML` injection delivers. A policy that permits the attack it
was written to stop is a comment, not a control.

What makes a strict `script-src` reachable here is a measurement: sixteen of
the nineteen pages carry NO inline script at all, so they take a bare
`'self'`. The other three carry small static ones, and a hash is exact for
those -- the objection to hashes is that they go stale on the next hand edit,
so this file is the answer to that rather than a reason not to use them.
`--check` runs in the test suite: edit a page's inline script without
re-running this and the suite says so, naming the page.

STYLE-SRC KEEPS `'unsafe-inline'`, deliberately. Every one of these pages has
inline <style> and style attributes, there is no build step to nonce them, and
the worst an injected style does is redraw the page -- where an injected
script reads the DOM, the session state and anything the origin can reach.
Trading a real script restriction for a theoretical style one would be the
wrong way round.

`frame-ancestors` is NOT here: a meta tag cannot carry it, and it is in
docs/security-runbook.md for the Cloudflare side with the rest of the headers
that need a response header to exist at all.
"""
import base64
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = [
    "about/index.html", "about_geohub/index.html", "dashboard/index.html",
    "membership/index.html", "membership/welcome/index.html", "team/index.html",
    "contact/index.html", "get-involved/index.html", "data/index.html",
    "researchers/index.html", "updates/index.html", "fund.html",
    "privacy/index.html", "terms/index.html", "disclaimer/index.html",
    "refund/index.html", "sign-in/index.html", "account/index.html", "404.html",
]

# Measured off the pages themselves: Google Fonts for the type, Formspree for
# the contact form's action and its fetch, buy.stripe.com for the membership
# links, docs.google.com for the Get Involved questionnaire, and the two
# geoidinitiative subdomains for the data bucket and the membership service.
BASE = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https://data.geoidinitiative.com",
    "connect-src 'self' https://data.geoidinitiative.com "
    "https://auth.geoidinitiative.com https://formspree.io",
    "frame-src 'self' https://docs.google.com",
    "form-action 'self' https://formspree.io https://buy.stripe.com "
    "https://docs.google.com",
    "upgrade-insecure-requests",
]

# An inline <script> that the browser will EXECUTE. Two exclusions and both
# matter: `[^>]*` alone matches one carrying a `src` (external, covered by
# `'self'`, with no inline body to hash), and a `type` the browser does not
# run -- `application/ld+json` above all -- is a DATA BLOCK, never executed and
# never subject to script-src. Hashing those would make every page's policy
# churn whenever its structured data changed, for no security at all.
# Verified in Chrome: a page whose ld+json is absent from the policy renders it
# with no refusal.
INLINE = re.compile(
    r"<script(?![^>]*\ssrc=)(?![^>]*type\s*=\s*[\"']?application/(?:ld\+json|json))"
    r"[^>]*>(.*?)</script>", re.S | re.I)
META = re.compile(
    r'^[ \t]*<meta http-equiv="Content-Security-Policy" content="[^"]*">[ \t]*\n',
    re.M)


def hashes_for(text):
    """A CSP hash per inline script, over the element's EXACT contents.

    The browser hashes the bytes between the tags with nothing stripped, so
    the whitespace either side is part of it -- taking `.strip()` here is the
    way this silently stops matching.
    """
    out = []
    for body in INLINE.findall(text):
        digest = hashlib.sha256(body.encode("utf-8")).digest()
        out.append(f"'sha256-{base64.b64encode(digest).decode('ascii')}'")
    return out


def policy_for(text):
    scripts = " ".join(["'self'", *hashes_for(text)])
    parts = list(BASE)
    parts.insert(3, f"script-src {scripts}")
    return "; ".join(parts)


def main():
    check = "--check" in sys.argv
    stale, written = [], []
    for rel in PAGES:
        path = ROOT / rel
        text = path.read_text(encoding="utf-8")
        wanted = f'  <meta http-equiv="Content-Security-Policy" content="{policy_for(text)}">\n'
        found = META.search(text)
        if found and found.group(0) == wanted:
            continue
        if check:
            stale.append(rel)
            continue
        if found:
            text = text[:found.start()] + wanted + text[found.end():]
        else:
            anchor = next(c for c in ('<meta charset="UTF-8">\n', '<meta charset="utf-8">\n')
                          if c in text)
            text = text.replace(anchor, anchor + wanted, 1)
        path.write_text(text, encoding="utf-8")
        written.append(rel)

    if check:
        for rel in stale:
            print(f"STALE  {rel}")
        print(f"{len(stale)} page(s) stale of {len(PAGES)}"
              if stale else f"all {len(PAGES)} policies current")
        return 1 if stale else 0
    print(f"wrote {len(written)} of {len(PAGES)} policies")
    for rel in written:
        n = len(hashes_for((ROOT / rel).read_text(encoding="utf-8")))
        print(f"  {rel}{f'  ({n} inline script hash(es))' if n else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
