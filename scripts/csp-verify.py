#!/usr/bin/env python3
"""Load every page that carries a policy and report what the browser refused.

    python3 serve.py &                     # or any server on :8125
    python3 scripts/csp-verify.py

WHY THIS IS A SCRIPT AND NOT A TEST. `csp.test.mjs` checks the policies are
CURRENT -- that every inline script is hashed and none is stale. It cannot
check that a policy does not BREAK a page, because that needs a browser: a
refusal is a console message, not an error anybody would otherwise see, and a
page with a wrong hash renders perfectly except that its script never ran.

So this drives headless Chrome over each page and collects every Content
Security Policy refusal. Proven against a deliberate fault: one character
changed inside an inline script, without re-running `scripts/csp.py`, and this
reported the refusal Chrome raised.

It needs Chrome and a server, which is why it is run by hand rather than by
`tests/run.mjs`.

THIS SCRIPT CRASHED THE LAPTOP ONCE, on 2026-09-25, and the shape of that is
worth stating because it is not obvious: it was widened from 19 content pages
to 35 by adding the app pages, and every app page boots a WebGL globe under
swiftshader. Sixteen of those in one long-lived Chrome is a heavy-load loop
wearing the name of a checker. So:

  * the DEFAULT run is the light pages, and it is safe;
  * the app pages need --app, take a FRESH Chrome each (one globe per browser,
    torn down after), and are capped by --max;
  * --all is refused outright, because there is no safe way to ask for sixteen.

The static half of this question is answered for free by
`GeoID_GIS/viewer/gis/csp.test.mjs`, which checks every page's hashes are
current, that no script-src carries 'unsafe-inline', that no page carries an
inline handler and that no page code calls eval. That is the part that
regresses. This script answers the other part -- whether a policy BREAKS a
page -- and one app page proves the mechanism as well as sixteen do.
"""
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "GeoID_GIS" / "tests"))
from smoke import CDP, WebSocket  # noqa: E402

PORT = 9334
PROFILE = "/tmp/geoid-csp-verify-profile"
BASE = "http://localhost:8125"

# (path, seconds to watch). A content page has settled in a moment; an app
# page streams a globe and a tile pyramid, and a refusal it would raise on its
# tenth second is still a refusal -- so these are watched for as long as they
# take to boot. That is most of this script's runtime and it is the point of
# it: the app pages are the ones that had no policy at all until now.
LIGHT = [(p, 6) for p in [
    "/about/", "/about_geohub/", "/dashboard/", "/membership/",
    "/membership/welcome/", "/team/", "/contact/", "/get-involved/",
    "/data/", "/researchers/", "/updates/", "/fund.html", "/privacy/",
    "/terms/", "/disclaimer/", "/refund/", "/sign-in/", "/account/",
    "/404.html",
]] + [("/explorer/", 6), ("/transit/", 10)]

# Every one of these boots a globe. Ordered lightest first, so a capped run
# spends its budget where a policy fault is as likely and the machine is not.
APP = [(p, 16) for p in [
    "/everest/", "/earth_explorer/", "/earth_explorer/etna/",
    "/GeoID_GIS/viewer/", "/",
]] + [(f"/planet_explorer/{w}/viewer/", 16) for w in
      ("pluto", "mercury", "venus", "mars", "moon",
       "jupiter", "saturn", "uranus", "neptune")]


def run(pages, fresh_browser_each):
    """Drive `pages`. With fresh_browser_each, one globe per Chrome."""
    if not fresh_browser_each:
        return sweep(pages)
    problems = 0
    for one in pages:
        problems += sweep([one])
    return problems


def sweep(pages):
    shutil.rmtree(PROFILE, ignore_errors=True)
    proc = subprocess.Popen([
        "google-chrome", "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE}", "--window-size=1440,900",
        "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    problems = 0
    try:
        ws = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                ws = next(t for t in tabs if t["type"] == "page")["webSocketDebuggerUrl"]
                break
            except Exception:
                time.sleep(0.3)
        if not ws:
            print("chrome never came up", file=sys.stderr)
            return 1
        cdp = CDP(WebSocket(ws))
        cdp.call("Page.enable")
        cdp.call("Log.enable")
        cdp.call("Runtime.enable")

        for page, watch in pages:
            # Drain whatever the previous page left queued, or its messages
            # are read as this one's.
            cdp.ws.sock.settimeout(0.2)
            try:
                while True:
                    cdp.ws.recv()
            except Exception:
                pass

            cdp.ws.sock.settimeout(10)
            cdp.call("Page.navigate", {"url": BASE + page})
            deadline = time.time() + watch
            found = []
            cdp.ws.sock.settimeout(1.5)
            while time.time() < deadline:
                try:
                    msg = json.loads(cdp.ws.recv())
                except Exception:
                    continue
                method = msg.get("method")
                text = ""
                if method == "Log.entryAdded":
                    text = msg["params"]["entry"].get("text", "")
                elif method == "Runtime.consoleAPICalled":
                    text = " ".join(str(a.get("value", ""))
                                    for a in msg["params"].get("args", []))
                if text and ("Content Security Policy" in text or "Refused to" in text):
                    found.append(text.strip()[:220])
            cdp.ws.sock.settimeout(10)
            found = sorted(set(found))
            print(f"{page:26s} {f'{len(found)} refusal(s)' if found else 'clean'}")
            for line in found:
                print(f"    {line}")
                problems += 1
        cdp.ws.sock.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(PROFILE, ignore_errors=True)
    return problems


def main():
    if "--all" in sys.argv:
        print("Refused: --all means sixteen WebGL globes in one run, which is\n"
              "what crashed this laptop. Use --app --max N (default 2).",
              file=sys.stderr)
        return 2
    want_app = "--app" in sys.argv
    cap = 2
    if "--max" in sys.argv:
        cap = int(sys.argv[sys.argv.index("--max") + 1])
    pages = APP[:cap] if want_app else LIGHT
    if want_app:
        print(f"{len(pages)} app page(s), a fresh Chrome each "
              f"(of {len(APP)}; raise with --max)\n")
    problems = run(pages, fresh_browser_each=want_app)
    print(f"\n{problems} CSP refusal(s) across {len(pages)} page(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
