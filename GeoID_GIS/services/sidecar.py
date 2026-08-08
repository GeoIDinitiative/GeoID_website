#!/usr/bin/env python3
"""The execution half of the Research Hub.

The hub authors work — specs, scripts, datasets — but a browser tab has no
interpreter, no subprocess and no job to stop. This is the missing process: a
small local service that runs Python scripts, module functions and shell
commands on the user's own machine, with live logs and a Stop that works. The
buttons it powers are the ones `CANNOT_WIRE` used to list.

    python3 GeoID_GIS/services/sidecar.py
    python3 GeoID_GIS/services/sidecar.py --port 8126 --root ~/geoid_projects

Stdlib only, deliberately: the sidecar must start in any Python. The *jobs* use
whatever environment launched it, so a sidecar started in the env that has
pandas, pywt and Gmsh runs the real thesis scripts unchanged.

Security model, since this executes code over HTTP:
  - binds 127.0.0.1 only — never reachable off the machine;
  - every request except /health needs `Authorization: Bearer <token>`,
    printed at startup (or fixed with --token) and pasted once into the hub;
  - CORS answers only to localhost origins and geoidinitiative.com, with
    `Access-Control-Allow-Private-Network` for Chrome's PNA preflight, so a
    public page can reach a local service the user deliberately started.

The run kinds mirror the Qt app exactly:
  - script:    python <path> [args…]           (`run_external_script`, :11633)
  - function:  import <path>, fn(**kwargs)     (`run_external_function`, :11647)
  - command:   shell command                   (workflow steps)
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import secrets
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1.0"
MAX_LOG_LINES = 4000

ALLOWED_ORIGIN_HOSTS = {"localhost", "127.0.0.1",
                        "geoidinitiative.com", "www.geoidinitiative.com"}

# The shim for function runs — the same shape the Qt app builds with textwrap.
FUNCTION_SHIM = r"""
import importlib.util, json, sys
path, fn_name, kwargs_json = sys.argv[1], sys.argv[2], sys.argv[3]
spec = importlib.util.spec_from_file_location("geoid_external", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fn = getattr(module, fn_name)
result = fn(**json.loads(kwargs_json))
if result is not None:
    print("[sidecar] result:", repr(result)[:2000])
"""


class Job:
    def __init__(self, kind, label, argv, cwd, env, shell=False):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind
        self.label = label
        self.argv = argv
        self.cwd = str(cwd)
        self.env = env
        self.shell = shell
        self.status = "queued"
        self.exit = None
        self.started = time.time()
        self.ended = None
        self.lines: list[str] = []
        self.offset = 0          # lines dropped off the front of the ring
        self.proc = None
        self.lock = threading.Lock()

    def append(self, line):
        with self.lock:
            self.lines.append(line)
            if len(self.lines) > MAX_LOG_LINES:
                drop = len(self.lines) - MAX_LOG_LINES
                del self.lines[:drop]
                self.offset += drop

    def run(self):
        try:
            import os
            env = dict(os.environ)
            env.update(self.env or {})
            self.proc = subprocess.Popen(
                self.argv, cwd=self.cwd, env=env, shell=self.shell,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
            )
        except Exception as exc:
            self.status = "failed"
            self.exit = -1
            self.ended = time.time()
            self.append(f"[sidecar] could not start: {exc}")
            return
        self.status = "running"
        shown = self.argv if isinstance(self.argv, str) else " ".join(map(str, self.argv))
        self.append(f"[sidecar] {self.label}: {shown}")
        self.append(f"[sidecar] cwd: {self.cwd}")
        for line in self.proc.stdout:
            self.append(line.rstrip("\n"))
        self.proc.wait()
        self.exit = self.proc.returncode
        self.ended = time.time()
        if self.status != "stopped":
            self.status = "done" if self.exit == 0 else "failed"
        self.append(f"[sidecar] exit {self.exit}")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.status = "stopped"
            self.proc.terminate()

            def hard_kill():
                time.sleep(5)
                if self.proc.poll() is None:
                    self.proc.kill()
            threading.Thread(target=hard_kill, daemon=True).start()
            return True
        return False

    def summary(self):
        return {
            "id": self.id, "kind": self.kind, "label": self.label,
            "status": self.status, "exit": self.exit,
            "started": self.started, "ended": self.ended,
            "lines": self.offset + len(self.lines),
        }


class State:
    def __init__(self, root, token):
        self.root = Path(root).resolve()
        self.token = token
        self.jobs: dict[str, Job] = {}
        self.order: list[str] = []

    def spawn(self, job):
        self.jobs[job.id] = job
        self.order.insert(0, job.id)
        threading.Thread(target=job.run, daemon=True).start()
        return job.id


STATE: State = None  # set in main()


def capabilities():
    """What the launching environment can actually do — the hub shows this."""
    mods = {}
    for name in ("numpy", "pandas", "scipy", "pywt", "matplotlib", "sklearn"):
        mods[name] = importlib.util.find_spec(name) is not None
    tools = {name: shutil.which(name) is not None for name in ("gmsh", "gales")}
    return {**mods, **tools}


class Handler(BaseHTTPRequestHandler):
    server_version = "GeoIDSidecar/" + VERSION

    # ── plumbing ─────────────────────────────────────────────────────────────
    def log_message(self, fmt, *args):
        pass  # jobs have their own logs; request noise helps nobody

    def cors(self):
        origin = self.headers.get("Origin", "")
        try:
            host = origin.split("//", 1)[1].split(":", 1)[0].split("/", 1)[0]
        except IndexError:
            host = ""
        if host in ALLOWED_ORIGIN_HOSTS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            # Chrome's Private Network Access preflight: a public page asking to
            # talk to 127.0.0.1 needs this explicit yes.
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {STATE.token}"

    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length) or b"{}")

    # ── routes ───────────────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/health":
            # Tokenless on purpose: the hub distinguishes "not running" from
            # "wrong token" with it. It states nothing sensitive beyond the
            # root path on the user's own machine.
            self.reply(200, {
                "service": "geoid-sidecar", "version": VERSION,
                "python": sys.version.split()[0], "root": str(STATE.root),
                "authorized": self.authed(), "caps": capabilities(),
            })
            return
        if not self.authed():
            self.reply(401, {"error": "missing or wrong token"})
            return
        if path == "/jobs":
            self.reply(200, {"jobs": [STATE.jobs[i].summary() for i in STATE.order]})
            return
        if path.startswith("/jobs/"):
            job = STATE.jobs.get(path.split("/")[2])
            if not job:
                self.reply(404, {"error": "no such job"})
                return
            offset = 0
            for part in query.split("&"):
                if part.startswith("offset="):
                    offset = int(part[7:] or 0)
            with job.lock:
                start = max(0, offset - job.offset)
                lines = job.lines[start:]
                next_offset = job.offset + len(job.lines)
            self.reply(200, {**job.summary(), "log": lines, "next": next_offset})
            return
        self.reply(404, {"error": "unknown endpoint"})

    def do_POST(self):
        if not self.authed():
            self.reply(401, {"error": "missing or wrong token"})
            return
        path = self.path.partition("?")[0]

        if path.startswith("/jobs/") and path.endswith("/stop"):
            job = STATE.jobs.get(path.split("/")[2])
            if not job:
                self.reply(404, {"error": "no such job"})
                return
            self.reply(200, {"stopped": job.stop(), "status": job.status})
            return

        if path == "/jobs":
            try:
                req = self.body()
            except (ValueError, json.JSONDecodeError) as exc:
                self.reply(400, {"error": f"bad JSON: {exc}"})
                return
            kind = req.get("kind")
            cwd = Path(req.get("cwd") or STATE.root)
            if not cwd.is_dir():
                self.reply(400, {"error": f"cwd is not a directory: {cwd}"})
                return
            env = req.get("env") or {}
            try:
                if kind == "script":
                    script = Path(req["path"])
                    if not script.is_file() or script.suffix != ".py":
                        raise ValueError(f"not a Python file: {script}")
                    argv = [sys.executable, str(script), *map(str, req.get("args") or [])]
                    job = Job(kind, req.get("label") or f"script {script.name}",
                              argv, cwd, env)
                elif kind == "function":
                    script = Path(req["path"])
                    if not script.is_file() or script.suffix != ".py":
                        raise ValueError(f"not a Python file: {script}")
                    fn = req.get("function") or ""
                    if not fn.isidentifier():
                        raise ValueError(f"not a function name: {fn!r}")
                    kwargs = json.dumps(req.get("kwargs") or {})
                    argv = [sys.executable, "-c", FUNCTION_SHIM, str(script), fn, kwargs]
                    job = Job(kind, req.get("label") or f"{script.name}::{fn}",
                              argv, cwd, env)
                elif kind == "command":
                    command = str(req.get("command") or "").strip()
                    if not command:
                        raise ValueError("empty command")
                    job = Job(kind, req.get("label") or command[:60],
                              command, cwd, env, shell=True)
                else:
                    raise ValueError(f"unknown kind: {kind!r}")
            except (KeyError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})
                return
            self.reply(200, {"id": STATE.spawn(job)})
            return

        self.reply(404, {"error": "unknown endpoint"})


def main():
    global STATE
    parser = argparse.ArgumentParser(description=__doc__.split