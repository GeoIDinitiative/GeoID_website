#!/usr/bin/env python3
"""The page-mount smoke test — boot the real app and mount all 64 pages.

The Research Hub is a registry of pages, which is exactly the shape that lets a
page rot silently: a broken import or a bad mount does not fail a build (there
is no build) and does not fail the other pages. This boots the actual site in a
real headless browser and walks every page, asserting each mounts without
throwing. It is the one test that would have caught "a page went blank" before a
user did.

Dependency-free by design, like the sidecar and the extractor: it serves the
repo with `http.server`, launches the Chrome that is already on the machine with
`--headless`, and speaks the DevTools protocol over a hand-rolled WebSocket
(stdlib `socket`) — no pip, no npm, no puppeteer, no chromium download.

    python3 GeoID_GIS/tests/smoke.py            # exit 0 when every page mounts

It finds Chrome at $GEOID_CHROME or the usual names; skips (exit 0) with a note
if none is installed, so it never fails a machine that simply has no browser.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PAGE_PATH = "/myGeoID/"
READY_TIMEOUT = 45          # the full app (viewer + hub) can take a few seconds
CHROME_NAMES = ("google-chrome", "google-chrome-stable", "chromium",
                "chromium-browser", "chrome")


# ── Static server ─────────────────────────────────────────────────────────────

def start_server() -> tuple[ThreadingHTTPServer, int]:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):   # keep the smoke output to the result
            pass
    handler = partial(QuietHandler, directory=str(REPO_ROOT))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


# ── Chrome ────────────────────────────────────────────────────────────────────

def find_chrome() -> str | None:
    override = os.environ.get("GEOID_CHROME")
    if override:
        return override if Path(override).exists() or shutil.which(override) else None
    for name in CHROME_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def launch_chrome(chrome: str, port: int, profile: str) -> subprocess.Popen:
    argv = [
        chrome, "--headless=new", "--disable-gpu",
        f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
        "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--disable-background-networking",
        # A software WebGL context, so the viewer's three.js does not abort and
        # leave the hub half-initialised.
        "--enable-unsafe-swiftshader", "--use-gl=angle",
        "--use-angle=swiftshader", "--window-size=1600,1000",
        "about:blank",
    ]
    return subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def devtools_json(port: int, path: str) -> object:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as resp:
        return json.loads(resp.read())


def wait_for_page_target(port: int, timeout: float = 20) -> str:
    """The websocket URL of a page target, once DevTools is answering."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            targets = devtools_json(port, "/json")
            for t in targets:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"]
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(0.25)
    raise RuntimeError("Chrome DevTools did not expose a page target in time.")


# ── A minimal WebSocket client (RFC 6455), text frames only ───────────────────

class WebSocket:
    """Just enough of the protocol to carry CDP JSON: masked client frames,
    reassembled server frames, ping/pong and close handled."""

    def __init__(self, url: str):
        # ws://127.0.0.1:<port>/devtools/page/<id>
        assert url.startswith("ws://")
        rest = url[len("ws://"):]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(handshake.encode())
        # Read past the end of the HTTP upgrade response headers.
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("WebSocket upgrade failed.")
            buf += chunk
        if b" 101 " not in buf.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"WebSocket upgrade rejected: {buf[:80]!r}")
        self._tail = buf.split(b"\r\n\r\n", 1)[1]

    def _recv_exact(self, n: int) -> bytes:
        while len(self._tail) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("WebSocket closed mid-frame.")
            self._tail += chunk
        out, self._tail = self._tail[:n], self._tail[n:]
        return out

    def send(self, text: str) -> None:
        payload = text.encode()
        header = bytearray([0x81])          # FIN + text opcode
        mask = os.urandom(4)
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv(self) -> str:
        """Return the next complete text message, transparently handling
        fragmentation and answering pings."""
        message = bytearray()
        while True:
            b0, b1 = self._recv_exact(2)
            fin = b0 & 0x80
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            data = self._recv_exact(length)  # server frames are not masked
            if opcode == 0x9:                # ping → pong
                self._send_control(0xA, data)
                continue
            if opcode == 0x8:                # close
                raise RuntimeError("WebSocket closed by peer.")
            if opcode == 0xA:                # pong
                continue
            message += data
            if fin:
                return message.decode()

    def _send_control(self, opcode: int, data: bytes) -> None:
        mask = os.urandom(4)
        header = bytes([0x80 | opcode, 0x80 | len(data)]) + mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + masked)

    def close(self) -> None:
        try:
            self._send_control(0x8, b"")
        except OSError:
            pass
        self.sock.close()


class CDP:
    """Command/response over the WebSocket, matched by id."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self._id = 0

    def call(self, method: str, params: dict | None = None, timeout: float = 60) -> dict:
        self._id += 1
        want = self._id
        self.ws.send(json.dumps({"id": want, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            message = json.loads(self.ws.recv())
            if message.get("id") == want:
                if "error" in message:
                    raise RuntimeError(f"{method} failed: {message['error']}")
                return message.get("result", {})
            # events are ignored; we only correlate command responses
        raise RuntimeError(f"{method} timed out.")

    def evaluate(self, expression: str, await_promise: bool = True, timeout: float = 90) -> object:
        result = self.call("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True,
        }, timeout=timeout)
        details = result.get("exceptionDetails")
        if details:
            raise RuntimeError("page threw: "
                               + json.dumps(details.get("exception", details))[:300])
        return result.get("result", {}).get("value")


# ── The sweep, run inside the page ────────────────────────────────────────────

# Waits for the hub, ensures a project, then mounts every registered page and
# reports the ones that throw or come up as a "failed to open" / "not built"
# stub. Mirrors the manual sweep exactly.
SWEEP_JS = r"""
(async () => {
  // The shell builds the viewer iframe after its own scripts run, so wait for
  // it — evaluating right after navigate beats it into existence.
  const t0 = Date.now();
  let iframe = null;
  while (!(iframe = document.querySelector('iframe')) && Date.now() - t0 < 40000) {
    await new Promise(r => setTimeout(r, 200));
  }
  const w = iframe && iframe.contentWindow;
  if (!w) return { error: 'no iframe appeared' };

  // Wait for the hub to exist inside it.
  while (!(w.GeoIDResearch && w.GeoIDResearch.setPage) && Date.now() - t0 < 60000) {
    await new Promise(r => setTimeout(r, 200));
  }
  const R = w.GeoIDResearch;
  if (!R || !R.setPage) return { error: 'hub never came up' };
  const store = R.store;

  // Ensure a project so project-scoped pages render fully (needProject is a
  // valid mount, but a real project exercises more).
  try {
    if (!store.getActive()) {
      await store.useBrowserStorage();
      const existing = await store.listProjects(null).catch(() => []);
      if (existing.length) await store.openProject(existing[0]);
      else await store.createProject('smoketest', { body: 'earth' });
    }
  } catch (e) { /* proceed without a project */ }

  try { w.GeoIDModeManager && w.GeoIDModeManager.setMode('research'); } catch (e) {}
  await new Promise(r => setTimeout(r, 300));

  // The page id list from STAGES, at whatever stamp the app loaded.
  const idxSrc = [...w.document.querySelectorAll('script[type=module]')]
    .map(s => s.src).find(s => s.includes('research/index.js')) || '';
  const stamp = (idxSrc.match(/\?v=([^&"]+)/) || [])[1] || '';
  const stages = await import('/GeoID_GIS/viewer/gis/research/stages.js?v=' + stamp);
  const ids = stages.allPageIds();

  const d = w.document;
  const problems = [];

  // Atlas is global furniture rather than a page, so nothing above would notice
  // it disappearing. It has to be present, styled, and closed on arrival.
  const launcher = d.getElementById('atlas-launcher');
  if (!launcher) problems.push({ id: 'Atlas', reason: 'no launcher on the page' });
  else if (w.getComputedStyle(launcher).position !== 'fixed') {
    problems.push({ id: 'Atlas', reason: 'launcher is not fixed to the viewport' });
  }
  if (!d.querySelector('link[data-atlas-assistant]')) {
    problems.push({ id: 'Atlas', reason: 'stylesheet not loaded' });
  }
  const atlasPanel = d.getElementById('atlas-panel');
  if (atlasPanel && !atlasPanel.hidden) {
    problems.push({ id: 'Atlas', reason: 'panel is open before it is asked for' });
  }
  if (!w.GeoIDAtlas || typeof w.GeoIDAtlas.notify !== 'function') {
    problems.push({ id: 'Atlas', reason: 'the notify seam is missing' });
  }

  for (const id of ids) {
    try {
      await R.setPage(id);
      await new Promise(r => setTimeout(r, 150));
      const host = d.querySelector('#research-hub .research-page')
        || d.querySelector('#research-hub');
      const stub = host.querySelector('.research-stub');
      const failNote = [...host.querySelectorAll('.research-note.is-error, .research-stub-note')]
        .map(n => n.textContent).find(t => /failed to open/i.test(t));
      if (failNote) problems.push({ id, reason: failNote.slice(0, 80) });
      else if (stub && /not built/i.test(stub.textContent)) problems.push({ id, reason: 'not built' });
    } catch (e) {
      problems.push({ id, reason: 'threw: ' + (e && e.message || e) });
    }
  }
  return { total: ids.length, problems };
})()
"""


def wait_for_document(cdp: CDP, timeout: float = 30) -> None:
    """Hold until the navigation has produced a document to talk to.

    `Page.navigate` returns once the navigation has STARTED, not once the new
    document exists — so a sweep issued straight after it is evaluated against
    the context that is about to be torn down, and CDP answers
    "Inspected target navigated or closed". It is a race, which is the worst
    kind of thing to put in front of a CI check: it passed on this machine for
    months and then failed twice in a row with nothing in the site to blame.

    Polling readyState settles it, and the error is swallowed rather than
    retried blindly — during the swap it IS the expected answer.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if cdp.evaluate("document.readyState", await_promise=False,
                            timeout=5) == "complete":
                return
        except RuntimeError:
            pass          # the context is mid-swap; that is what we are waiting out
        time.sleep(0.2)
    raise RuntimeError("The page never reached readyState complete.")


def run_smoke() -> int:
    chrome = find_chrome()
    if not chrome:
        print("skip: no Chrome/Chromium found (set GEOID_CHROME to run the smoke test).")
        return 0

    httpd, http_port = start_server()
    profile = tempfile.mkdtemp(prefix="geoid-smoke-")
    dev_port = _free_port()
    proc = launch_chrome(chrome, dev_port, profile)
    ws = None
    try:
        ws_url = wait_for_page_target(dev_port)
        ws = WebSocket(ws_url)
        # The socket is opened with a 10 s read timeout, which is right for the
        # short control calls and far too short for the sweep: it mounts 64
        # pages and is ALLOWED minutes by its own CDP timeout, so the socket
        # gave up first and the failure arrived as a bare TimeoutError with
        # nothing to say. Sized to the longest call this makes.
        ws.sock.settimeout(READY_TIMEOUT + 120)
        cdp = CDP(ws)
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        url = f"http://127.0.0.1:{http_port}{PAGE_PATH}"
        print(f"Booting {url} in headless Chrome …")
        cdp.call("Page.navigate", {"url": url})
        wait_for_document(cdp)

        result = cdp.evaluate(SWEEP_JS, timeout=READY_TIMEOUT + 60)
        if not isinstance(result, dict) or result.get("error"):
            print(f"FAIL: {result.get('error') if isinstance(result, dict) else result}")
            return 1
        total = result.get("total", 0)
        problems = result.get("problems", [])
        if problems:
            print(f"\n{len(problems)} of {total} pages FAILED to mount:")
            for p in problems:
                print(f"  ✗ {p['id']} — {p['reason']}")
            return 1
        print(f"\nall {total} pages mounted cleanly, and Atlas is on the page.")
        return 0
    finally:
        if ws:
            ws.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        httpd.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


if __name__ == "__main__":
    sys.exit(run_smoke())
