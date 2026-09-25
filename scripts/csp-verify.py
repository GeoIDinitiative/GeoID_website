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

PAGES = [
    "/about/", "/about_geohub/", "/dashboard/", "/membership/",
    "/membership/welcome/", "/team/", "/contact/", "/get-involved/",
    "/data/", "/researchers/", "/updates/", "/fund.html", "/privacy/",
    "/terms/", "/disclaimer/", "/refund/", "/sign-in/", "/account/",
    "/404.html",
]


def main():
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

        for page in PAGES:
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
            deadline = time.time() + 6
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
    print(f"\n{problems} CSP refusal(s) across {len(PAGES)} pages")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
