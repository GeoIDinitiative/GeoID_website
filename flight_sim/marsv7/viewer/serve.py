#!/usr/bin/env python3
"""Run the Mars viewer locally with no cache and no paywall.

Serves the REPOSITORY ROOT (not this folder) because several things the viewer
needs live at the origin root and 404 otherwise:

    /sw-ctx-tiles.js        the CTX tile service worker
    /ctx-proxy/...          the same-origin tile route that worker implements
    /scripts/, /styles/     shared site assets

Opens dev.html, which wipes service workers, caches and localStorage, waits for
the CTX tile worker to take control, then hands off to the viewer. Every HTML
and JS response is sent with no-store so edits always land on reload.

Usage:  python3 serve.py [port]        (default 8000)
"""
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

VIEWER_PATH = "/flight_sim/mars/viewer/"
REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
)
os.chdir(REPO_ROOT)

# Never cached, so a reload always picks up source edits. Tiles and imagery are
# untouched — those are cached by the service worker on purpose.
NO_STORE_SUFFIXES = (".html", "/", ".js", ".json", ".css")


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # keep the console readable

    def end_headers(self):
        path = self.path.split("?")[0]
        if path.endswith(NO_STORE_SUFFIXES):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        # Required for the service worker to claim the /flight_sim/ scope.
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()


class Server(socketserver.TCPServer):
    allow_reuse_address = True  # avoids "Address already in use" on quick restarts
    daemon_threads = True


url = f"http://localhost:{PORT}{VIEWER_PATH}dev.html"

print(f"  repo root : {REPO_ROOT}")
print(f"  viewer    : http://localhost:{PORT}{VIEWER_PATH}")
print(f"  clean run : {url}")
print()
print("  Opening the clean-run URL. Bookmark THAT one — it clears service")
print("  workers, caches and localStorage before every launch.")
print("  Ctrl+C to stop.")
print()

threading.Timer(0.8, lambda: webbrowser.open(url)).start()

try:
    with Server(("", PORT), Handler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
except OSError as exc:
    print(f"\nCould not bind port {PORT}: {exc}")
    print(f"Try another port:  python3 serve.py {PORT + 1}")
    sys.exit(1)
