#!/usr/bin/env python3
"""Tiny helper: serve the GeoID site root over http:// and open the flight sim.

The flight sim is a fork of the Mars viewer and streams every asset (CTX tiles,
basemaps, labels, elevation) from /planet_explorer/mars/viewer/, so the whole
site root must be served — not just this folder.

Usage:  python3 serve.py   [port]
"""
import http.server, socketserver, webbrowser, sys, os, threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
# Serve the repository root (two levels up from this folder).
os.chdir(os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))

url = f"http://localhost:{PORT}/flight_sim/mars_flightsim/"
handler = http.server.SimpleHTTPRequestHandler

class Quiet(handler):
    def log_message(self, *a):  # keep the console clean
        pass

    def end_headers(self):
        # HTML and JS must never be cached: a stale index.html/flightsim.js kept
        # serving old UI defaults ("absolutely no change" after fixes). Tiles and
        # images keep normal caching.
        if self.path.split("?")[0].endswith((".html", "/", ".js")):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

print(f"Serving Mars Flight Sim at  {url}")
print("Press Ctrl+C to stop.")
threading.Timer(0.6, lambda: webbrowser.open(url)).start()
with socketserver.TCPServer(("", PORT), Quiet) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
