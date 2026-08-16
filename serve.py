#!/usr/bin/env python3
"""Run GeoID locally — the whole thing, in one command.

    python3 serve.py

Starts two processes and prints where to go:

  1. a static web server for the site (the viewers, the GIS page, the Research
     Hub) — everything the browser needs, served from this folder;
  2. the sidecar, the local helper that lets the Research Hub run real work —
     GALES, training scripts, external Python — and read/write projects as real
     folders on disk instead of in the browser.

The site works on its own; the sidecar is what turns it from a viewer into a
workbench. Both stop together on Ctrl+C.

Nothing to install: standard-library Python only, the same as the rest of the
tooling here. Open the URL it prints, and — once — paste the sidecar line it
prints into the Hub under Settings ▸ Sidecar.

Options:
  --port N          static server port (default 8125)
  --projects PATH   the geoid_projects folder the sidecar serves
                    (default ~/geoid_projects, created if absent)
  --no-sidecar      serve the static site only
  --no-token        run the sidecar without an auth token (single-user machine)
"""

from __future__ import annotations

import argparse
import signal
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
SIDECAR = REPO_ROOT / "GeoID_GIS" / "sidecar" / "geoid_sidecar.py"

RULE = "─" * 68


def start_static(port: int) -> ThreadingHTTPServer:
    class QuietHandler(SimpleHTTPRequestHandler):
        # A launcher should print the two URLs that matter, not a line per asset.
        def log_message(self, *_args):
            pass

        def end_headers(self):
            """HTML is never cached; everything else keeps its stamp.

            Every module URL carries `?v=<sha>`, so a module cannot go stale —
            but the HTML that names those URLs carries no stamp at all, and a
            browser is entitled to keep it. The result is a page holding last
            week's script tags while every file on disk is current: fixes land,
            tests pass, and the tab shows none of it. That failure is invisible
            from this side and indistinguishable, from the other, from work
            that was never done.

            `no-store` on documents costs one small request per navigation and
            removes the whole class.
            """
            # NOTHING is cached by the development server.
            #
            # The stamp was supposed to make this unnecessary: every module URL
            # carries `?v=<sha>`, so a changed module is a changed URL. But the
            # stamp IS the git sha, so editing a file and re-stamping before
            # committing produces the SAME `?v=` — and the browser then serves
            # its cached copy of a URL whose contents have changed underneath
            # it. Measured here: the server was sending a module containing
            # `originProblem` while the page held a copy without it, at the same
            # stamped URL.
            #
            # From the outside that is indistinguishable from a fix that was
            # never made, and it has been mistaken for exactly that more than
            # once in this project. On a loopback dev server the cost of
            # `no-store` is nothing; the cost of a stale module is a day.
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            super().end_headers()
    handler = partial(QuietHandler, directory=str(REPO_ROOT))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def start_sidecar(projects: Path, no_token: bool) -> subprocess.Popen:
    # -u matters: the sidecar's banner carries the token, and Python block-buffers
    # a stdout that is not a terminal. Piped into a log, a launcher or an IDE
    # console, the connect line — the one thing the user copies — sat in a buffer
    # and never appeared, which looks like a sidecar that failed to start.
    argv = [sys.executable, "-u", str(SIDECAR), "--root", str(projects)]
    if no_token:
        argv.append("--no-token")
    # Inherit stdout so the sidecar prints its own banner.
    return subprocess.Popen(argv)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the GeoID site and sidecar locally.")
    parser.add_argument("--port", type=int, default=8125)
    parser.add_argument("--projects", default=str(Path.home() / "geoid_projects"))
    parser.add_argument("--no-sidecar", action="store_true")
    parser.add_argument("--no-token", action="store_true")
    args = parser.parse_args()

    try:
        httpd = start_static(args.port)
    except OSError as exc:
        print(f"Could not start the web server on port {args.port}: {exc}", file=sys.stderr)
        print("Another copy may already be running, or the port is taken. "
              "Try --port 8126.", file=sys.stderr)
        return 1

    # localhost, deliberately: the project folder picker and the secure-context
    # features need it — http://0.0.0.0 is not a secure context and the picker
    # silently vanishes there.
    site_url = f"http://localhost:{args.port}/myGeoID/"

    sidecar_proc = None
    if not args.no_sidecar and SIDECAR.exists():
        Path(args.projects).expanduser().mkdir(parents=True, exist_ok=True)
        sidecar_proc = start_sidecar(Path(args.projects).expanduser(), args.no_token)

    print(RULE)
    print("  GeoID is running.")
    print()
    print(f"  Open   {site_url}")
    if sidecar_proc:
        print()
        print("  The sidecar started too (its connect line is just above this box).")
        print("  Paste that line into the Hub: Research ▸ Settings ▸ Sidecar,")
        print("  and projects become real folders the desktop app can open.")
    elif args.no_sidecar:
        print()
        print("  Sidecar disabled (--no-sidecar). Projects are kept in the browser;")
        print("  running GALES and scripts needs the sidecar.")
    print()
    print("  Ctrl+C to stop.")
    print(RULE)

    stop = threading.Event()

    def shutdown(*_):
        stop.set()
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        # Wake if the sidecar dies on its own, so we do not sit pretending both
        # are up when only one is.
        while not stop.is_set():
            if sidecar_proc and sidecar_proc.poll() is not None:
                print("\nThe sidecar exited. The static site is still serving; "
                      "Ctrl+C to stop it too.")
                sidecar_proc = None
            stop.wait(0.5)
    finally:
        print("\nstopping…")
        httpd.shutdown()
        if sidecar_proc and sidecar_proc.poll() is None:
            sidecar_proc.terminate()
            try:
                sidecar_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                sidecar_proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
