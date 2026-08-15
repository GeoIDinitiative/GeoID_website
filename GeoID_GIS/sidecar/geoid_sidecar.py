#!/usr/bin/env python3
"""GeoID sidecar — the second process the web hub authors work for.

The Research Hub is a static site: it has no Python interpreter, so its heavy
verbs (run a training script, run a thesis/GALES module, watch a folder, list
and stop jobs) had nowhere to execute. This is that somewhere. It is a small
HTTP service that runs beside a `geoid_projects` folder and lends the browser
exactly what a browser cannot have — a real subprocess, a real filesystem, and
a job that outlives one click.

Design, and why:

- **Stdlib only.** It must run with `python3 geoid_sidecar.py` and nothing else
  installed, because the person running it is a researcher, not a sysadmin. No
  Flask, no websockets package. `ThreadingHTTPServer` and Server-Sent Events
  (plain HTTP, one direction — server → browser — which is exactly what a log
  stream is) cover it.

- **Loopback only.** Binds `127.0.0.1`. It executes arbitrary Python by design
  (running *your* scripts is the whole feature), so it must never be reachable
  off the machine. CORS is limited to localhost origins for the same reason.

- **Path sandbox.** Every `/fs/*` call is resolved and confined under the
  projects root; `..` cannot escape it. Script execution is deliberately not
  sandboxed — that is the point — but it happens only on an explicit request.

- **A token.** Printed once at startup; the browser sends it as
  `Authorization: Bearer <token>`. It is the thing that stops another local
  process quietly driving your interpreter. Pass `--no-token` to drop it on a
  single-user machine.

The filesystem shape is the project layout `project-store.js` already speaks —
`geoid_projects/<body>/<name>/…`, `metadata/`, `data/`, `fem_runs/` — so when
the sidecar is connected the hub reads and writes the *same folder the desktop
app uses*, and the two apps stop being able to drift.

    python3 GeoID_GIS/sidecar/geoid_sidecar.py --root ~/geoid_projects
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import mimetypes
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import atlas_watch

VERSION = "1.0.0"

# Origins allowed to call in. Any localhost/loopback port, nothing else — the
# static site is served from one of these during development and from the same
# machine in use.
ALLOWED_ORIGIN_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "[::1]"}


class Job:
    """One running (or finished) subprocess, with its captured output.

    Output is kept as a growing list of lines and handed out by index, so an
    SSE stream that connects late still replays everything from the start and
    then follows — a job the user started, walked away from, and came back to
    still shows its whole log.
    """

    def __init__(self, job_id: str, kind: str, label: str, argv: list[str], cwd: Path, env: dict):
        self.id = job_id
        self.kind = kind
        self.label = label
        self.argv = argv
        self.cwd = str(cwd)
        self.env = env
        self.lines: list[str] = []
        self.status = "starting"          # starting → running → done|failed|stopped
        self.exit_code: int | None = None
        self.started_at = time.time()
        self.ended_at: float | None = None
        self.proc: subprocess.Popen | None = None
        # Called once with this job when it reaches a terminal state, whatever
        # that state is. A GALES run uses it to write its status.json.
        self.on_finish = None
        # Written to the child's stdin at start, then the pipe is closed. How
        # /jobs/tool delivers its one JSON object without touching argv or a
        # temp file.
        self.stdin_data: str | None = None
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)

    def append(self, line: str):
        with self._cond:
            self.lines.append(line)
            self._cond.notify_all()

    def finish(self, status: str, code: int | None):
        with self._cond:
            self.status = status
            self.exit_code = code
            self.ended_at = time.time()
            self._cond.notify_all()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "id": self.id, "kind": self.kind, "label": self.label,
                "status": self.status, "exit_code": self.exit_code,
                "argv": self.argv, "cwd": self.cwd,
                "started_at": self.started_at, "ended_at": self.ended_at,
                "lines": len(self.lines),
            }

    def wait_for(self, index: int, timeout: float):
        """Block until there is a line past `index` or the job ends."""
        deadline = time.time() + timeout
        with self._cond:
            while True:
                if index < len(self.lines):
                    return self.lines[index:], self.status, self.exit_code
                if self.status in ("done", "failed", "stopped"):
                    return [], self.status, self.exit_code
                remaining = deadline - time.time()
                if remaining <= 0:
                    return [], self.status, self.exit_code
                self._cond.wait(timeout=min(remaining, 15))


class Runner:
    """Owns the job table and starts subprocesses."""

    def __init__(self, root: Path):
        self.root = root
        self.jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def start(self, kind: str, label: str, argv: list[str], cwd: Path,
              env: dict | None = None, on_finish=None,
              stdin_data: str | None = None) -> Job:
        job = Job(uuid.uuid4().hex[:12], kind, label, argv, cwd, env or {})
        job.on_finish = on_finish
        job.stdin_data = stdin_data
        with self._lock:
            self.jobs[job.id] = job
        thread = threading.Thread(target=self._run, args=(job,), daemon=True)
        thread.start()
        return job

    @staticmethod
    def _fire_finish(job: Job):
        """Run a job's completion hook without letting it crash the thread."""
        if not job.on_finish:
            return
        try:
            job.on_finish(job)
        except Exception as exc:  # noqa: BLE001 — a hook error must not lose the job
            job.append(f"[sidecar] finish hook failed: {exc}")

    def _run(self, job: Job):
        merged = dict(os.environ)
        merged.update({str(k): str(v) for k, v in job.env.items()})
        # Unbuffered child, so its prints reach the log as they happen rather
        # than in a lump when it exits.
        merged.setdefault("PYTHONUNBUFFERED", "1")
        try:
            proc = subprocess.Popen(
                job.argv, cwd=job.cwd, env=merged,
                stdin=subprocess.PIPE if job.stdin_data is not None else None,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
                # Own process group, so a stop can take the child and anything
                # it spawned, not just the shell in front of them.
                start_new_session=True,
            )
        except Exception as exc:  # noqa: BLE001 — any launch failure is a job failure
            job.append(f"[sidecar] could not start: {exc}")
            job.finish("failed", None)
            self._fire_finish(job)
            return
        job.proc = proc
        job.status = "running"
        job.append(f"[sidecar] {job.label} — pid {proc.pid}")
        if job.stdin_data is not None and proc.stdin is not None:
            # Write-then-close, before the read loop below: the payloads this
            # carries are small JSON objects, far under a pipe buffer, so this
            # cannot deadlock against an already-printing child.
            try:
                proc.stdin.write(job.stdin_data)
                proc.stdin.close()
            except (BrokenPipeError, OSError) as exc:
                job.append(f"[sidecar] could not deliver stdin: {exc}")
        assert proc.stdout is not None
        for line in proc.stdout:
            job.append(line.rstrip("\n"))
        code = proc.wait()
        if job.status == "stopped":
            job.append(f"[sidecar] stopped (exit {code}).")
            job.finish("stopped", code)
        else:
            job.append(f"[sidecar] finished with exit code {code}.")
            job.finish("done" if code == 0 else "failed", code)
        self._fire_finish(job)

    def stop(self, job_id: str) -> bool:
        job = self.jobs.get(job_id)
        if not job or not job.proc or job.status not in ("running", "starting"):
            return False
        job.status = "stopped"
        try:
            os.killpg(os.getpgid(job.proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            return True
        # Escalate if it ignores the polite request.
        def _hard():
            time.sleep(4)
            if job.proc and job.proc.poll() is None:
                try:
                    os.killpg(os.getpgid(job.proc.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        threading.Thread(target=_hard, daemon=True).start()
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = f"GeoIDSidecar/{VERSION}"
    runner: Runner
    token: str | None
    curated: set  # resolved paths a function may be run from
    gales_dir: Path | None = None  # the GALES source tree, for deck templates

    # ── plumbing ────────────────────────────────────────────────────────────

    def log_message(self, *_args):  # quieter than the default access log
        pass

    def _origin_ok(self, origin: str) -> bool:
        if not origin:
            return True                     # curl / same-process
        try:
            host = urlparse(origin).hostname or ""
        except ValueError:
            return False
        return host in ALLOWED_ORIGIN_HOSTS

    def _cors(self, origin: str):
        if origin and self._origin_ok(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _authed(self) -> bool:
        if self.token is None:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {self.token}"

    def _send(self, code: int, payload, origin: str, content_type="application/json"):
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cors(origin)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def _safe(self, rel: str) -> Path:
        """A path confined under the projects root; raises if it escapes.

        The hub speaks `geoid_projects/<body>/<name>/…` because the browser's
        disk picker points at the *parent* of `geoid_projects`. When the sidecar
        is pointed straight at the projects folder (`--root ~/geoid_projects`),
        that leading segment is already the root, so it is stripped — the same
        folder resolves the same way from either app.
        """
        clean = rel.lstrip("/")
        if self.runner.root.name == "geoid_projects":
            if clean == "geoid_projects":
                clean = ""
            elif clean.startswith("geoid_projects/"):
                clean = clean[len("geoid_projects/"):]
        target = (self.runner.root / clean).resolve()
        root = self.runner.root.resolve()
        if target != root and root not in target.parents:
            raise PermissionError(f"path escapes the projects root: {rel}")
        return target

    # ── routing ─────────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self):
        origin = self.headers.get("Origin", "")
        url = urlparse(self.path)
        route = url.path
        query = parse_qs(url.query)

        # Health is the one unauthenticated route: the hub has to be able to ask
        # "are you there?" before it knows the token is accepted.
        if route == "/health":
            self._send(200, {
                "ok": True, "service": "geoid-sidecar", "version": VERSION,
                "root": str(self.runner.root),
                "needs_token": self.token is not None,
                "capabilities": ["fs", "jobs", "script", "function", "training", "gales",
                                 "compute", "atlas", "events", "capabilities",
                                 "gdal", "tools"]
                    + (["gales-prepare"] if self.gales_dir else []),
                "gales_dir": str(self.gales_dir) if self.gales_dir else None,
            }, origin)
            return

        if not self._origin_ok(origin):
            self._send(403, {"error": "origin not allowed"}, origin)
            return
        if not self._authed():
            self._send(401, {"error": "missing or bad token"}, origin)
            return

        try:
            if route == "/capabilities":
                self._capabilities(origin)
            elif route == "/fs/list":
                self._fs_list(query.get("path", [""])[0], origin)
            elif route == "/fs/read":
                self._fs_read(query.get("path", [""])[0], origin)
            elif route == "/fs/exists":
                self._fs_exists(query.get("path", [""])[0], origin)
            elif route == "/compute":
                self._compute_list(origin)
            elif route == "/atlas/keys":
                self._atlas_keys(origin)
            elif route == "/atlas/watch":
                self._send(200, atlas_watch.status(), origin)
            elif route == "/atlas/alerts":
                self._send(200, {"alerts": atlas_watch.drain(
                    int(query.get("since", ["0"])[0] or 0))}, origin)
            elif route == "/jobs":
                self._send(200, {"jobs": [j.snapshot() for j in self.runner.jobs.values()]}, origin)
            elif route.startswith("/jobs/") and route.endswith("/events"):
                self._job_events(route.split("/")[2], query, origin)
            elif route.startswith("/jobs/"):
                job = self.runner.jobs.get(route.split("/")[2])
                self._send(200 if job else 404,
                           job.snapshot() if job else {"error": "no such job"}, origin)
            else:
                self._send(404, {"error": "not found"}, origin)
        except PermissionError as exc:
            self._send(403, {"error": str(exc)}, origin)
        except FileNotFoundError:
            self._send(404, {"error": "no such path"}, origin)
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"error": str(exc)}, origin)

    def do_POST(self):
        origin = self.headers.get("Origin", "")
        if not self._origin_ok(origin):
            self._send(403, {"error": "origin not allowed"}, origin)
            return
        if not self._authed():
            self._send(401, {"error": "missing or bad token"}, origin)
            return
        route = urlparse(self.path).path
        try:
            body = self._body()
            if route == "/fs/write":
                self._fs_write(body, origin)
            elif route == "/fs/mkdir":
                self._safe(body.get("path", "")).mkdir(parents=True, exist_ok=True)
                self._send(200, {"ok": True}, origin)
            elif route == "/fs/delete":
                self._fs_delete(body, origin)
            elif route == "/jobs/script":
                self._start_script(body, origin)
            elif route == "/jobs/function":
                self._start_function(body, origin)
            elif route == "/jobs/training":
                self._start_training(body, origin)
            elif route == "/jobs/gales":
                self._start_gales(body, origin)
            elif route == "/jobs/gales/prepare":
                self._start_gales_prepare(body, origin)
            elif route == "/jobs/gales/postprocess":
                self._start_gales_postprocess(body, origin)
            elif route == "/jobs/gdal":
                self._start_gdal(body, origin)
            elif route == "/jobs/tool":
                self._start_tool(body, origin)
            elif route == "/compute/save":
                self._compute_save(body, origin)
            elif route == "/compute/delete":
                self._compute_delete(body, origin)
            elif route == "/atlas/keys/save":
                self._atlas_keys_save(body, origin)
            elif route == "/atlas/keys/delete":
                self._atlas_keys_delete(body, origin)
            elif route == "/atlas/chat":
                self._atlas_chat(body, origin)
            elif route == "/atlas/watch/start":
                self._send(200, atlas_watch.start(body, self.runner.root), origin)
            elif route == "/atlas/watch/stop":
                atlas_watch.stop()
                self._send(200, atlas_watch.status(), origin)
            elif route == "/compute/test":
                self._compute_test(body, origin)
            elif route.startswith("/jobs/") and route.endswith("/stop"):
                ok = self.runner.stop(route.split("/")[2])
                self._send(200 if ok else 404, {"ok": ok}, origin)
            else:
                self._send(404, {"error": "not found"}, origin)
        except PermissionError as exc:
            self._send(403, {"error": str(exc)}, origin)
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"error": str(exc)}, origin)

    # ── filesystem ──────────────────────────────────────────────────────────

    def _fs_list(self, rel: str, origin: str):
        target = self._safe(rel)
        if not target.exists():
            self._send(200, {"path": rel, "entries": []}, origin)
            return
        entries = []
        for child in sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
            stat = child.stat()
            entries.append({
                "name": child.name,
                "kind": "directory" if child.is_dir() else "file",
                "size": stat.st_size, "modified": stat.st_mtime,
            })
        self._send(200, {"path": rel, "entries": entries}, origin)

    def _fs_read(self, rel: str, origin: str):
        target = self._safe(rel)
        if not target.is_file():
            raise FileNotFoundError(rel)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), origin, content_type=ctype)

    def _fs_exists(self, rel: str, origin: str):
        target = self._safe(rel)
        self._send(200, {"path": rel, "exists": target.exists(),
                         "kind": "directory" if target.is_dir()
                         else "file" if target.is_file() else None}, origin)

    def _fs_write(self, body: dict, origin: str):
        target = self._safe(body.get("path", ""))
        target.parent.mkdir(parents=True, exist_ok=True)
        content = body.get("content", "")
        if body.get("encoding") == "base64":
            import base64
            target.write_bytes(base64.b64decode(content))
        else:
            target.write_text(content, encoding="utf-8")
        self._send(200, {"ok": True, "path": body.get("path", "")}, origin)

    def _fs_delete(self, body: dict, origin: str):
        target = self._safe(body.get("path", ""))
        if target.is_file():
            target.unlink()
        elif target.is_dir():
            import shutil
            shutil.rmtree(target)
        self._send(200, {"ok": True}, origin)

    # ── jobs ────────────────────────────────────────────────────────────────

    def _resolve_script(self, raw: str) -> Path:
        """A script path, whether given absolute or relative to the root."""
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = (self.runner.root / raw).resolve()
        if candidate.suffix != ".py":
            raise ValueError("a script must be a .py file")
        if not candidate.is_file():
            raise FileNotFoundError(str(candidate))
        return candidate

    def _start_script(self, body: dict, origin: str):
        script = self._resolve_script(body.get("script", ""))
        args = body.get("args") or []
        if isinstance(args, str):
            args = shlex.split(args)
        cwd = Path(body.get("cwd") or script.parent).expanduser()
        if not cwd.is_dir():
            cwd = script.parent
        argv = [sys.executable, str(script), *[str(a) for a in args]]
        job = self.runner.start("script", body.get("label") or script.name, argv, cwd, body.get("env"))
        self._send(200, {"job_id": job.id}, origin)

    def _start_function(self, body: dict, origin: str):
        """Call one function in a module, with JSON kwargs.

        A tiny launcher imports the module by file path and calls the named
        function — the same thing `run_external_function` does in the desktop
        app, without needing the module to be importable by name.
        """
        script = self._resolve_script(body.get("script", ""))
        func = str(body.get("function", "")).strip()
        if not func.isidentifier():
            raise ValueError("function name is not a valid identifier")
        kwargs = body.get("kwargs")
        if isinstance(kwargs, str):
            kwargs = json.loads(kwargs or "{}")
        cwd = Path(body.get("cwd") or script.parent).expanduser()
        if not cwd.is_dir():
            cwd = script.parent
        launcher = (
            "import json,importlib.util,sys\n"
            f"spec=importlib.util.spec_from_file_location('_geoid_mod', {str(script)!r})\n"
            "mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)\n"
            f"fn=getattr(mod, {func!r})\n"
            f"kw=json.loads({json.dumps(json.dumps(kwargs or {}))})\n"
            "res=fn(**kw)\n"
            "print('[result]', json.dumps(res, default=str)[:4000] if res is not None else '(no value)')\n"
        )
        argv = [sys.executable, "-c", launcher]
        job = self.runner.start("function", f"{script.name}::{func}", argv, cwd, body.get("env"))
        self._send(200, {"job_id": job.id}, origin)

    def _start_training(self, body: dict, origin: str):
        """`python <script> --dataset <d> --output <o> [extra…]`.

        The exact command `AITrainerPage.run_training` builds (app_qt.py:8585),
        so a spec authored in the hub trains through the real script.
        """
        script = self._resolve_script(body.get("script", ""))
        dataset = str(body.get("dataset", "")).strip()
        output = str(body.get("output", "")).strip()
        if not dataset or not output:
            raise ValueError("training needs a dataset and an output directory")
        out_path = self._safe(output) if not Path(output).is_absolute() else Path(output)
        out_path.mkdir(parents=True, exist_ok=True)
        extra = body.get("args") or []
        if isinstance(extra, str):
            extra = shlex.split(extra)
        argv = [sys.executable, str(script), "--dataset", dataset,
                "--output", str(out_path), *[str(a) for a in extra]]
        job = self.runner.start("training", f"train {script.name}", argv, script.parent, body.get("env"))
        self._send(200, {"job_id": job.id}, origin)

    # ── Capabilities, GDAL jobs, and the vetted tool scripts ──────────────────
    #
    # The GIS grows past what a browser can compute by borrowing this process —
    # but never as "run arbitrary code from a page". Three pieces:
    #
    # - GET /capabilities says what this machine actually has (probed, never
    #   assumed), so the hub can offer sidecar-backed tools only where they
    #   will work and explain the absence where they won't.
    # - POST /jobs/gdal runs one allowlisted GDAL/OGR binary. The browser names
    #   *what* to run but never *where*: every real path arrives via inputs/
    #   output and is resolved through the same sandbox as /fs; args may carry
    #   only flags, values and the $IN0…/$OUT placeholders.
    # - POST /jobs/tool runs one vetted script from sidecar/tools/, its request
    #   delivered as a single JSON object on stdin. The allowlist is the
    #   directory listing itself — a tool exists exactly when its file does.

    # gdal* and ogr2ogr only — gmsh and mpirun are probed below but are not
    # runnable through this route.
    GDAL_PROGRAMS = ("gdalwarp", "ogr2ogr", "gdaldem", "gdal_contour",
                     "gdal_viewshed", "gdal_rasterize", "gdal_translate")
    CAPABILITY_PYTHON = ("numpy", "scipy", "pywt", "matplotlib", "sklearn")
    CAPABILITY_GEO = ("osgeo", "rasterio", "pyproj", "shapely")
    CAPABILITY_BINS = GDAL_PROGRAMS + ("gmsh", "mpirun")
    TOOLS_DIR = Path(__file__).resolve().parent / "tools"
    _PLACEHOLDER = re.compile(r"^\$(?:IN(\d+)|OUT)$")

    @staticmethod
    def _module_present(name: str) -> bool:
        """Whether a module is importable, without importing it and without a
        subprocess: find_spec touches only the import machinery. Guarded,
        because a broken package can make even the probe raise."""
        try:
            return importlib.util.find_spec(name) is not None
        except Exception:  # noqa: BLE001 — an unprobeable module is an absent one
            return False

    def _capabilities(self, origin: str):
        self._send(200, {
            "version": VERSION,
            "python": {n: self._module_present(n) for n in self.CAPABILITY_PYTHON},
            "geo": {n: self._module_present(n) for n in self.CAPABILITY_GEO},
            "bins": {n: bool(shutil.which(n)) for n in self.CAPABILITY_BINS},
        }, origin)

    def _start_gdal(self, body: dict, origin: str):
        """{program, args, inputs, output} → one streamed GDAL/OGR job.

        args is the raw GDAL argument list with $IN0, $IN1, … and $OUT where
        the paths belong; the paths themselves come only from inputs/output,
        sandbox-resolved. Any non-placeholder arg that looks like a path is
        refused outright — the placeholder mechanism IS the path policy, and
        a browser must not be able to smuggle one past it.
        """
        program = str(body.get("program", "")).strip()
        if program not in self.GDAL_PROGRAMS:
            raise ValueError(
                f"program must be one of: {', '.join(self.GDAL_PROGRAMS)}")
        inputs = body.get("inputs") or []
        if not isinstance(inputs, list):
            raise ValueError("inputs must be a list of project-relative paths")
        in_paths = [self._safe(str(p)) for p in inputs]
        for rel, path in zip(inputs, in_paths):
            if not path.exists():
                raise FileNotFoundError(f"no such input: {rel}")
        out_path = None
        output = str(body.get("output") or "").strip()
        if output:
            out_path = self._safe(output)
        args = body.get("args")
        if not isinstance(args, list):
            raise ValueError("args must be a list")
        argv = [program]
        for raw in args:
            arg = str(raw)
            m = self._PLACEHOLDER.match(arg)
            if m:
                if m.group(1) is not None:
                    i = int(m.group(1))
                    if i >= len(in_paths):
                        raise ValueError(
                            f"{arg} named, but only {len(in_paths)} input(s) given")
                    argv.append(str(in_paths[i]))
                elif out_path is None:
                    raise ValueError("$OUT named, but no output given")
                else:
                    argv.append(str(out_path))
            else:
                if "/" in arg or "\\" in arg or ".." in arg or arg.startswith("~"):
                    raise ValueError(
                        f"argument {arg!r} looks like a path — real paths go in "
                        "inputs/output and appear in args as $IN0…, $OUT")
                argv.append(arg)
        # Shape first, presence second: a malformed request is a 400 even on a
        # machine with no GDAL, and a 409 means exactly "install the binary".
        if not shutil.which(program):
            self._send(409, {"error": f"{program} is not installed on this "
                                      "machine — install GDAL/OGR to run this "
                                      "tool"}, origin)
            return
        if out_path is not None:
            out_path.parent.mkdir(parents=True, exist_ok=True)
        job = self.runner.start("gdal", body.get("label") or program, argv,
                                self.runner.root, body.get("env"))
        # argv goes back so the caller can see exactly what was substituted.
        self._send(200, {"job_id": job.id, "program": program, "argv": argv},
                   origin)

    def _start_tool(self, body: dict, origin: str):
        """{tool, params, inputs, output} → one streamed run of a vetted
        script from sidecar/tools/.

        The script receives ONE JSON object on stdin — {params, inputs,
        output}, its paths already absolute and sandbox-resolved — prints
        progress to stdout (streamed into the job log), writes its result
        file(s) to output, and exits 0 on success / nonzero with a final
        "ERROR: <reason>" line. sidecar/tools/smooth.py is the reference.
        """
        tool = str(body.get("tool", "")).strip()
        # A bare name only: the tool names a file in tools/, never a path.
        if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_\-]*", tool or " "):
            raise ValueError("tool must be a bare name (letters, digits, _ and -)")
        available = sorted(p.stem for p in self.TOOLS_DIR.glob("*.py")) \
            if self.TOOLS_DIR.is_dir() else []
        if tool not in available:
            raise ValueError(f"no such tool {tool!r} — available: "
                             f"{', '.join(available) or '(none installed)'}")
        inputs = body.get("inputs") or []
        if not isinstance(inputs, list):
            raise ValueError("inputs must be a list of project-relative paths")
        in_paths = [str(self._safe(str(p))) for p in inputs]
        out_abs = ""
        output = str(body.get("output") or "").strip()
        if output:
            out_path = self._safe(output)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_abs = str(out_path)
        params = body.get("params") or {}
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        payload = json.dumps({"params": params, "inputs": in_paths,
                              "output": out_abs})
        argv = [sys.executable, str(self.TOOLS_DIR / f"{tool}.py")]
        job = self.runner.start("tool", body.get("label") or f"tool {tool}",
                                argv, self.runner.root, body.get("env"),
                                stdin_data=payload)
        self._send(200, {"job_id": job.id, "tool": tool}, origin)

    # ── Compute targets: this machine, or a server over SSH ───────────────────
    #
    # A solve outgrows a laptop quickly, so where it runs is a choice rather than
    # an assumption. A target is either `local` (mpirun here) or `ssh` (a box you
    # already have — a Hetzner VPS, a lab workstation, a cluster login node).
    #
    # **Keys only, never passwords.** Every ssh/rsync call carries
    # `BatchMode=yes`, so if key-based auth is not set up the command fails
    # immediately instead of sitting on a password prompt — and this service
    # never asks for, stores, or forwards a password. Set the key up with
    # `ssh-copy-id` once and the agent does the rest.

    COMPUTE_FILE = ".compute_targets.json"

    def _compute_path(self) -> Path:
        return self.runner.root / self.COMPUTE_FILE

    def _load_targets(self) -> dict:
        try:
            data = json.loads(self._compute_path().read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_targets(self, targets: dict):
        self._compute_path().write_text(json.dumps(targets, indent=2))

    @staticmethod
    def _ssh_prefix(target: dict) -> str:
        """The ssh command for a target, batch-mode so it can never prompt."""
        parts = ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"]
        if target.get("port"):
            parts += ["-p", str(int(target["port"]))]
        if target.get("key"):
            parts += ["-i", shlex.quote(str(target["key"]))]
        return " ".join(parts)

    @staticmethod
    def _ssh_dest(target: dict) -> str:
        user = str(target.get("user") or "").strip()
        host = str(target.get("host") or "").strip()
        if not host:
            raise ValueError("that compute target has no host")
        return f"{user}@{host}" if user else host

    def _compute_list(self, origin: str):
        targets = self._load_targets()
        self._send(200, {
            "targets": targets,
            "local": {"mpirun": bool(shutil.which("mpirun")),
                      "gales": bool(shutil.which("gales"))},
        }, origin)

    def _compute_save(self, body: dict, origin: str):
        name = str(body.get("name", "")).strip()
        if not name:
            raise ValueError("a target needs a name")
        kind = str(body.get("kind") or "ssh").strip()
        if kind not in ("local", "ssh"):
            raise ValueError("a target is either 'local' or 'ssh'")
        # A password must never reach this service; keys are the only way in.
        if body.get("password"):
            raise ValueError(
                "Passwords are not accepted. Set up key-based access "
                "(ssh-copy-id) and this will use your key.")
        target = {
            "kind": kind,
            "host": str(body.get("host") or "").strip(),
            "user": str(body.get("user") or "").strip(),
            "port": int(body.get("port") or 0) or None,
            "key": str(body.get("key") or "").strip() or None,
            "remote_root": str(body.get("remote_root") or "~/geoid_runs").strip(),
            # The GALES checkout on the server. With it, the deck is compiled
            # there — which is the only way it can run there, since a binary
            # built here is tied to this machine's MPI and Trilinos.
            "gales_dir": str(body.get("gales_dir") or "").strip(),
            "ranks": int(body.get("ranks") or 4),
            "mpirun": str(body.get("mpirun") or "mpirun").strip(),
            "gales_bin": str(body.get("gales_bin") or "gales").strip(),
            # Anything the remote needs before the solver: `module load openmpi`,
            # sourcing an env, activating a spack view.
            "preamble": str(body.get("preamble") or "").strip(),
        }
        if kind == "ssh" and not target["host"]:
            raise ValueError("an ssh target needs a host")
        targets = self._load_targets()
        targets[name] = target
        self._save_targets(targets)
        self._send(200, {"ok": True, "name": name, "target": target}, origin)

    def _compute_delete(self, body: dict, origin: str):
        name = str(body.get("name", "")).strip()
        targets = self._load_targets()
        targets.pop(name, None)
        self._save_targets(targets)
        self._send(200, {"ok": True}, origin)

    def _compute_test(self, body: dict, origin: str):
        """Prove a target actually works: reachable, keys accepted, and the
        solver and mpirun present on the far side. Streamed like any job."""
        name = str(body.get("name", "")).strip()
        target = self._load_targets().get(name)
        if not target:
            raise ValueError(f"no compute target named {name!r}")
        mpirun_bin = target.get("mpirun") or "mpirun"
        gales_bin = target.get("gales_bin") or "gales"
        if target.get("kind") == "local":
            script = (
                'echo "[check] this machine"; '
                f'command -v {shlex.quote(mpirun_bin)} && {shlex.quote(mpirun_bin)} --version | head -1; '
                f'command -v {shlex.quote(gales_bin)} || echo "gales not on PATH"; '
                'echo "cores: $(nproc)"')
        else:
            dest = self._ssh_dest(target)
            pre = target.get("preamble") or "true"
            remote = (
                f'{pre}; echo "host: $(hostname)"; '
                f'command -v {shlex.quote(mpirun_bin)} || echo "NO mpirun"; '
                f'command -v {shlex.quote(gales_bin)} || echo "NO gales"; '
                'echo "cores: $(nproc)"')
            script = (f'echo "[check] {dest}"; '
                      f'{self._ssh_prefix(target)} {shlex.quote(dest)} {shlex.quote(remote)}')
        job = self.runner.start("compute-test", f"test {name}",
                                ["bash", "-lc", script], self.runner.root)
        self._send(200, {"job_id": job.id}, origin)

    def _start_gales(self, body: dict, origin: str):
        """Run a prepared GALES sim under a run folder and file its status.json.

        This is the FEM stage's execute step. The browser writes the run spec
        and the deck; the sidecar, which is the process that actually has the
        solver, runs it — `mpirun -n N gales <deck>`, exactly as the desktop app
        does (app_qt.py `atlas_run_gales`) — as a streamed job the Jobs drawer
        and the Run page already follow.

        First cut: the deck (a GALES `.in` file) is expected to be present in the
        run folder already. Generating the deck (mesh_Ncore.txt, setup.txt,
        props.txt, the `.in`) from spec.json is a later, larger step.

        The run folder is confined under the projects root like every other path;
        a `status.json` is written beside the deck so the hub can show queued →
        running → done|failed without tailing the log.
        """
        rel = str(body.get("dir", "")).strip()
        if not rel:
            raise ValueError("a run directory is required")
        run_dir = self._safe(rel)
        if not run_dir.is_dir():
            raise FileNotFoundError(f"no such run directory: {rel}")

        cores = int(body.get("cores") or 4)
        if cores < 1:
            cores = 1
        gales_bin = str(body.get("gales_bin") or "gales")
        mpirun_bin = str(body.get("mpirun") or "mpirun")

        # Two ways in. An explicit command (the Run page's Command box) is run as
        # given. Otherwise it is built from what the run folder actually holds.
        #
        # A GALES sim is **a built executable, not a deck file**: every reference
        # sim under sim/ is `cmake && make` → `executable`, run as
        # `mpirun -n N ./executable`, with setup.txt and props.txt read from the
        # working directory. There is not one `.in` file in the whole tree — that
        # form comes from the desktop app's example text and matches nothing, so
        # it is only a last-resort fallback here.
        explicit = str(body.get("cmd") or "").strip()
        deck = str(body.get("deck", "")).strip()
        if explicit:
            argv = shlex.split(explicit)
            if not argv:
                raise ValueError("empty command")
        elif deck:
            if not (run_dir / deck).is_file():
                raise FileNotFoundError(f"deck not found in run: {deck}")
            argv = [mpirun_bin, "-n", str(cores), gales_bin, deck]
        elif (run_dir / "executable").is_file():
            deck = "executable"
            argv = [mpirun_bin, "-n", str(cores), "./executable"]
        elif (run_dir / "run.sh").is_file():
            deck = "run.sh"
            argv = ["bash", "./run.sh"]
        else:
            decks = sorted(p.name for p in run_dir.glob("*.in"))
            if not decks:
                raise ValueError(
                    "nothing to run here: no built `executable`, no run.sh. "
                    "Press 'Generate & build deck' first, or type a command.")
            if len(decks) > 1:
                raise ValueError(
                    f"several decks ({', '.join(decks)}) — name one with 'deck'")
            deck = decks[0]
            argv = [mpirun_bin, "-n", str(cores), gales_bin, deck]
        cmd_str = " ".join(argv)
        label = body.get("label") or f"GALES {Path(rel).name}/{deck}"

        # Where it runs. No target, or "local", means this machine and the argv
        # above. An ssh target instead pushes the run folder to the server,
        # solves there, and brings the results back — the same streamed job and
        # the same status.json either way, so nothing downstream has to care.
        target_name = str(body.get("target") or "").strip()
        target = self._load_targets().get(target_name) if target_name else None
        if target and target.get("kind") == "ssh":
            ranks = int(body.get("cores") or target.get("ranks") or 4)
            remote_mpirun = target.get("mpirun") or "mpirun"
            # Rebuild the command for the far side unless one was typed: the
            # local box's paths and rank count rarely suit the server.
            remote_cmd = explicit or f"{remote_mpirun} -n {ranks} ./executable"
            # Where GALES lives on the server, so the deck can be built there.
            remote_gales_dir = (target.get("gales_dir") or "").strip()
            dest = self._ssh_dest(target)
            ssh = self._ssh_prefix(target)
            root = (target.get("remote_root") or "~/geoid_runs").rstrip("/")
            remote_dir = f"{root}/{Path(rel).name}"
            pre = target.get("preamble") or "true"
            script = run_dir / "_remote_run.sh"
            script.write_text(
                "#!/usr/bin/env bash\nset -e\n"
                f'echo "[remote] {dest}:{remote_dir}"\n'
                f'{ssh} {shlex.quote(dest)} {shlex.quote(f"mkdir -p {remote_dir}")}\n'
                'echo "[remote] sending the sources…"\n'
                # Sources only. The results come back separately, and the local
                # build artefacts must NOT travel: an executable compiled here
                # against this machine's MPI and Trilinos will not run there, so
                # the server builds its own from the same sources.
                f'rsync -az --delete -e {shlex.quote(ssh)} '
                '--exclude results/ --exclude executable --exclude GALES_SRC '
                '--exclude CMakeFiles/ --exclude CMakeCache.txt --exclude Makefile '
                '--exclude cmake_install.cmake --exclude make/ '
                f'./ {shlex.quote(f"{dest}:{remote_dir}/")}\n'
                # Build on the server when it has a GALES tree; otherwise assume
                # the executable is already there and say so rather than guess.
                + (
                    f'echo "[remote] building against {remote_gales_dir}…"\n'
                    f'{ssh} {shlex.quote(dest)} {shlex.quote(f"cd {remote_dir} && {pre} && ln -sfn {remote_gales_dir} GALES_SRC && cmake . >/dev/null && make")}\n'
                    if remote_gales_dir else
                    'echo "[remote] no GALES tree configured for this server — '
                    'expecting ./executable to be there already."\n'
                )
                + f'echo "[remote] solving: {remote_cmd}"\n'
                f'{ssh} {shlex.quote(dest)} '
                f'{shlex.quote(f"cd {remote_dir} && {pre} && {remote_cmd}")}\n'
                'echo "[remote] fetching results…"\n'
                'mkdir -p results\n'
                f'rsync -az -e {shlex.quote(ssh)} '
                f'{shlex.quote(f"{dest}:{remote_dir}/results/")} ./results/\n'
                'echo "[remote] done — results are in this run folder."\n')
            script.chmod(0o755)
            argv = ["bash", str(script)]
            cmd_str = f"{dest}: {remote_cmd}"
            label = f"GALES {Path(rel).name} @ {target_name}"

        status_path = run_dir / "status.json"
        started = time.time()

        def write_status(state: str, extra: dict | None = None):
            payload = {"status": state, "cmd": cmd_str, "deck": deck,
                       "cores": cores, "where": target_name or "local",
                       "updated_at": time.time()}
            if extra:
                payload.update(extra)
            try:
                status_path.write_text(json.dumps(payload, indent=2))
            except OSError:
                pass

        def on_finish(job: Job):
            secs = int((job.ended_at or time.time()) - started)
            produced = sorted(
                str(p.relative_to(run_dir)) for p in run_dir.rglob("*")
                if p.is_file() and p.name != "status.json")
            write_status(job.status, {
                "exit_code": job.exit_code, "run_id": job.id,
                "started_at": started, "ended_at": job.ended_at, "seconds": secs,
                "message": f"exit {job.exit_code} in {secs}s"
                           if job.status != "stopped" else f"stopped after {secs}s",
                "files": produced,
            })

        write_status("running", {"started_at": started, "message": "solver started"})
        job = self.runner.start("gales", label, argv, run_dir, body.get("env"),
                                on_finish=on_finish)
        self._send(200, {"job_id": job.id, "deck": deck, "cmd": cmd_str,
                         "where": target_name or "local"}, origin)

    # ── GALES deck generation ─────────────────────────────────────────────────
    #
    # spec.json (what the FEM pages write) → a runnable GALES sim. Rather than
    # invent each family's config, this clones the reference sim for the physics
    # (setup.txt with its stabilisation parameters, props.txt, the IC/BC, main.cpp,
    # CMakeLists, and any extras like fluid's mueluOptions.xml) and patches in the
    # values the spec actually provides — mesh, time step, and materials. That way
    # the fluid deck's thirty tuning parameters come from a real, working sim, not
    # from a guess, and only what the user set is overwritten.

    # spec.physics → (family, reference sim under sim/, the setup key that names
    # the mesh). Volcano deformation is the domain, so anything not fluid or
    # thermal generates a solid (elastostatic) deck.
    GALES_FAMILIES = {
        "fluid":   ("fluid_sc", "fluid_sc/fixed_cylinder_2d", "fluid_mesh_file"),
        "thermal": ("heat_equation", "heat_equation/test_3d", "heat_eq_mesh_file"),
        "heat":    ("heat_equation", "heat_equation/test_3d", "heat_eq_mesh_file"),
        "solid":   ("solid_es", "solid_es/mogi_test_3d", "solid_mesh_file"),
    }

    @staticmethod
    def _patch_lines(text: str, patches: dict) -> str:
        """Rewrite `key   value` lines whose first token is a patch key, keeping
        each line's indentation. Used for both setup.txt and props.txt."""
        out = []
        for line in text.splitlines():
            token = line.strip().split()[0] if line.strip() else ""
            if token in patches and patches[token] not in (None, ""):
                indent = line[: len(line) - len(line.lstrip())]
                out.append(f"{indent}{token}{' ' * max(1, 16 - len(token))}{patches[token]}")
            else:
                out.append(line)
        return "\n".join(out) + "\n"

    def _start_gales_prepare(self, body: dict, origin: str):
        """Turn a run's spec.json into a runnable GALES sim by cloning the
        reference for its physics and patching in the spec's values, then convert
        the mesh for N ranks and build — one streamed job, so the run folder comes
        out ready for the Run step."""
        if not self.gales_dir or not self.gales_dir.exists():
            raise ValueError(
                "No GALES source tree configured. Start the sidecar with "
                "--gales <path to the gales checkout>.")
        rel = str(body.get("dir", "")).strip()
        if not rel:
            raise ValueError("a run directory is required")
        run_dir = self._safe(rel)
        run_dir.mkdir(parents=True, exist_ok=True)
        spec_path = run_dir / "spec.json"
        if not spec_path.is_file():
            raise FileNotFoundError("no spec.json in this run — configure it in FEM ▸ Setup first")
        try:
            spec = json.loads(spec_path.read_text())
        except json.JSONDecodeError as exc:
            raise ValueError(f"spec.json is not valid JSON: {exc}")

        cores = int(body.get("cores") or 4)
        if cores < 1:
            cores = 1
        # Two spec shapes exist: the FEM pages write `physics` as a family string
        # ("solid"/"fluid"/…), the Build New wizard writes it as a properties
        # object. A string names the family; anything else defaults to solid,
        # the volcano-deformation case.
        physics_raw = spec.get("physics")
        physics = physics_raw.lower() if isinstance(physics_raw, str) else "solid"
        family, ref_rel, mesh_key = self.GALES_FAMILIES.get(
            physics, self.GALES_FAMILIES["solid"])
        ref_dir = self.gales_dir / "sim" / ref_rel
        if not ref_dir.is_dir():
            raise FileNotFoundError(f"reference sim not found: sim/{ref_rel}")

        import shutil
        # Clone the reference's config, leaving its input/, results/ and build
        # artefacts behind — only the deck files.
        keep = {"setup.txt", "props.txt", "main.cpp", "CMakeLists.txt", "mueluOptions.xml"}
        for item in ref_dir.iterdir():
            if item.is_file() and (item.name in keep or item.name.endswith("_ic_bc.hpp")):
                shutil.copy(item, run_dir / item.name)

        # The reference includes the engine as ../../../src; from the run folder
        # that path is wrong, so point every include at the GALES_SRC symlink.
        for name in ["main.cpp"] + [p.name for p in run_dir.glob("*_ic_bc.hpp")]:
            f = run_dir / name
            if f.exists():
                f.write_text(f.read_text().replace("../../../src/", "GALES_SRC/src/"))
        link = run_dir / "GALES_SRC"
        try:
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(self.gales_dir)
        except OSError:
            pass

        # Time stepping lives at spec.time (FEM pages) or spec.setup (Build New).
        time = spec.get("time") or {}
        setup = spec.get("setup") or {}
        step = time.get("step") if time.get("step") not in (None, "") else setup.get("timestep")
        end = time.get("end") if time.get("end") not in (None, "") else setup.get("end_time")

        # Patch setup.txt: the mesh gales_mesh.py will write, the time stepping,
        # and the dimension.
        setup_path = run_dir / "setup.txt"
        if setup_path.exists():
            setup_path.write_text(self._patch_lines(setup_path.read_text(), {
                mesh_key: f"mesh_{cores}core.txt",
                "delta_t": step,
                "final_time": end,
                "end_time": end,
                "dim": spec.get("dim"),
            }))

        # Patch props.txt with the materials the spec carries for this family.
        # The wizard's `physics` object carries reference_density/viscosity/
        # temperature; the FEM pages carry properties.{solid,fluid}. Read both.
        props_path = run_dir / "props.txt"
        if props_path.exists():
            props = spec.get("properties") or {}
            solid = props.get("solid") or {}
            fluid = props.get("fluid") or {}
            init = spec.get("initial") or {}
            wiz = physics_raw if isinstance(physics_raw, dict) else {}
            def pick(*vals):
                for v in vals:
                    if v not in (None, ""):
                        return v
                return None
            patches = {}
            if family == "solid_es":
                patches = {"rho": pick(solid.get("density"), wiz.get("reference_density")),
                           "E": solid.get("young"), "nu": solid.get("poisson"),
                           "plane_strain": "T" if spec.get("plane_strain") else "F"}
            elif family == "fluid_sc":
                patches = {"rho": pick(fluid.get("density"), wiz.get("reference_density")),
                           "mu": pick(fluid.get("viscosity"), wiz.get("reference_viscosity")),
                           "Isothermal_T": pick(init.get("temperature"),
                                                wiz.get("reference_temperature"))}
            # heat_equation's rho/cp/kappa are not in the web spec, so its props
            # keep the reference defaults, which the user edits.
            props_path.write_text(self._patch_lines(props_path.read_text(), patches))

        # The mesh, then convert + build as one streamed job.
        input_dir = run_dir / "input"
        input_dir.mkdir(exist_ok=True)
        mesh_msh = self._locate_run_mesh(run_dir, input_dir)
        mesh_tool = self.gales_dir / "tpl" / "gales_mesh_preprocessing"
        script = run_dir / "_prepare.sh"
        script.write_text(
            "#!/usr/bin/env bash\nset -e\n"
            f'echo "[prepare] {family}: converting mesh for {cores} rank(s)…"\n'
            f'cd "{input_dir}"\n'
            f'python3 "{mesh_tool}/gales_mesh.py" {cores} "{mesh_msh.name}"\n'
            f'cd "{run_dir}"\n'
            'echo "[prepare] building (cmake + make)…"\n'
            # Not fatal. The mesh conversion above is portable and is what a
            # remote solve needs; the build is machine-specific and only matters
            # for running here. Failing the whole prepare because this box has no
            # Trilinos would block preparing a run destined for a server.
            'if cmake . >/dev/null 2>&1 && make; then\n'
            '  echo "[prepare] built — Run will solve it here."\n'
            'else\n'
            '  echo "[prepare] local build failed (no Trilinos here?). The deck and"\n'
            '  echo "[prepare] converted mesh are ready — a server with GALES can build"\n'
            '  echo "[prepare] and run it; set that server\'s GALES path in Where it runs."\n'
            'fi\n'
            'echo "[prepare] done."\n')
        script.chmod(0o755)
        job = self.runner.start("gales-prepare", f"prepare {Path(rel).name}",
                                ["bash", str(script)], run_dir, dict(body.get("env") or {}))
        self._send(200, {"job_id": job.id, "family": family, "physics": physics,
                         "cores": cores, "mesh": mesh_msh.name}, origin)

    def _start_gales_postprocess(self, body: dict, origin: str):
        """Extract probe time series from a GALES run's results into CSVs the
        Signal and Spectral pages read.

        The results are flat binary: results/<field>/<timestep> is 3·N float64,
        node i's displacement at u[3i:3i+3], N the mesh node count. For each probe
        this finds the nearest mesh node and reads its displacement across the
        timesteps, writing post_processing/extracted_dofs/<probe>.csv
        (t, ux, uy, uz, magnitude) — the long-format the extraction page and the
        analysis pages already consume. Runs as a streamed job because a large
        mesh is a lot of nodes to scan.
        """
        rel = str(body.get("dir", "")).strip()
        if not rel:
            raise ValueError("a run directory is required")
        run_dir = self._safe(rel)
        if not run_dir.is_dir():
            raise FileNotFoundError(f"no such run directory: {rel}")
        field = str(body.get("field") or "solid/u").strip("/")
        results = run_dir / "results" / field
        if not results.is_dir():
            raise FileNotFoundError(
                f"no results/{field} in this run — solve it with Run first")
        meshes = sorted((run_dir / "input").glob("*core.txt"))
        if not meshes:
            raise FileNotFoundError(
                "no converted mesh (input/mesh_Ncore.txt) — prepare the run first")
        stations = body.get("stations") or []
        if not stations:
            raise ValueError("give at least one probe point (name, x, y, z in mesh coordinates)")

        script = run_dir / "_postprocess.py"
        script.write_text(self._gales_postprocess_py(
            str(run_dir), str(meshes[0]), field, stations))
        job = self.runner.start("gales-postprocess", f"extract {Path(rel).name}",
                                [sys.executable, str(script)], run_dir, dict(body.get("env") or {}))
        self._send(200, {"job_id": job.id, "field": field, "probes": len(stations)}, origin)

    @staticmethod
    def _gales_postprocess_py(run_dir: str, mesh_path: str, field: str, stations: list) -> str:
        return (
            "#!/usr/bin/env python3\n"
            "import os, struct, math, json\n"
            f"RUN={run_dir!r}\nMESH={mesh_path!r}\nFIELD={field!r}\n"
            f"STATIONS={json.dumps(stations)}\n"
            "coords={}\n"
            "with open(MESH) as f:\n"
            "    for line in f:\n"
            "        if line.startswith('Node'):\n"
            "            p=line.split()\n"
            "            coords[int(p[1])]=(float(p[2]),float(p[3]),float(p[4]))\n"
            "N=len(coords)\n"
            "print(f'[postprocess] {N} mesh nodes')\n"
            "def nearest(sx,sy,sz):\n"
            "    best=-1; bd=None\n"
            "    for i,(x,y,z) in coords.items():\n"
            "        d=(x-sx)**2+(y-sy)**2+(z-sz)**2\n"
            "        if bd is None or d<bd: bd=d; best=i\n"
            "    return best, math.sqrt(bd)\n"
            "picks=[]\n"
            "for st in STATIONS:\n"
            "    i,dist=nearest(float(st['x']),float(st['y']),float(st['z']))\n"
            "    picks.append((st['name'], i)); print(f\"[postprocess] {st['name']}: node {i} at {dist:.1f} m\")\n"
            # The station->node mapping in GALES's own stations_info.txt shape
            # (count, then `name node x y z`) — what find_stations.py produces,
            # and what the extract scripts read.
            "info=os.path.join(RUN,'stations_info.txt')\n"
            "with open(info,'w') as fh:\n"
            "    fh.write(f'{len(picks)}\\n')\n"
            "    for (name,i),st in zip(picks,STATIONS):\n"
            "        x,y,z=coords[i]\n"
            "        fh.write(f'{name} {i} {x} {y} {z}\\n')\n"
            "print(f'[postprocess] wrote {info}')\n"
            "udir=os.path.join(RUN,'results',FIELD)\n"
            "steps=sorted([s for s in os.listdir(udir) if s.isdigit()], key=int)\n"
            "print(f'[postprocess] {len(steps)} timestep(s)')\n"
            "out=os.path.join(RUN,'..','..','post_processing','extracted_dofs')\n"
            "os.makedirs(out, exist_ok=True)\n"
            "series={name:[] for name,_ in picks}\n"
            "for t in steps:\n"
            "    data=open(os.path.join(udir,t),'rb').read()\n"
            "    for name,i in picks:\n"
            "        ux,uy,uz=struct.unpack('<3d', data[i*24:i*24+24])\n"
            "        series[name].append((int(t),ux,uy,uz,math.sqrt(ux*ux+uy*uy+uz*uz)))\n"
            "for name,i in picks:\n"
            "    path=os.path.join(out, ''.join(c if c.isalnum() or c in '-_.' else '_' for c in name)+'.csv')\n"
            "    with open(path,'w') as f:\n"
            "        f.write('t,ux,uy,uz,magnitude\\n')\n"
            "        for row in series[name]: f.write(','.join(str(v) for v in row)+'\\n')\n"
            "    print(f'[postprocess] wrote {path} ({len(series[name])} rows)')\n"
            "print('[postprocess] done — open Signal Processing to analyse the series.')\n")

    def _locate_run_mesh(self, run_dir: Path, input_dir: Path) -> Path:
        """A .msh for this run: one already in the run, else the project mesh."""
        for folder in (input_dir, run_dir):
            found = sorted(folder.glob("*.msh"))
            if found:
                return found[0]
        # The project's meshes/ live two levels up from fem_runs/<run>/.
        meshes = run_dir.parent.parent / "meshes"
        found = sorted(meshes.glob("*.msh")) if meshes.exists() else []
        if not found:
            raise FileNotFoundError(
                "no .msh mesh found in the run or the project's meshes/ — "
                "build or import a mesh first")
        import shutil
        dest = input_dir / found[0].name
        shutil.copy(found[0], dest)
        return dest

    # ── Atlas: your own model keys, and the chat that uses them ──────────────
    #
    # The key lives here, in this local process, and never goes to the browser:
    # a page cannot hold a secret, so the call that needs one is made on this
    # side. Status is masked the way Atlas AI masks it — last four characters,
    # never the value.

    def _atlas_keys(self, origin: str):
        self._send(200, atlas_watch.key_status(), origin)

    def _atlas_keys_save(self, body: dict, origin: str):
        name = str(body.get("name", "")).strip()
        value = str(body.get("value", "")).strip()
        atlas_watch.save_secret(name, value)
        # The masked status, never the key that was just set.
        self._send(200, atlas_watch.key_status(), origin)

    def _atlas_keys_delete(self, body: dict, origin: str):
        atlas_watch.save_secret(str(body.get("name", "")).strip(), "")
        self._send(200, atlas_watch.key_status(), origin)

    def _atlas_chat(self, body: dict, origin: str):
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("messages must be a non-empty list")
        result = atlas_watch.chat(
            messages, str(body.get("context") or ""),
            str(body.get("provider") or ""), str(body.get("model") or ""))
        self._send(200, result, origin)

    def _job_events(self, job_id: str, query: dict, origin: str):
        """Server-Sent Events: replay the log from `from`, then follow live."""
        job = self.runner.jobs.get(job_id)
        if not job:
            self._send(404, {"error": "no such job"}, origin)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self._cors(origin)
        self.end_headers()

        index = int(query.get("from", ["0"])[0] or "0")

        def emit(event: str, data: dict) -> bool:
            try:
                self.wfile.write(f"event: {event}\ndata: {json.dumps(data)}\n\n".encode())
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError):
                return False

        while True:
            new_lines, status, code = job.wait_for(index, timeout=20)
            for line in new_lines:
                if not emit("line", {"i": index, "text": line}):
                    return
                index += 1
            if status in ("done", "failed", "stopped"):
                emit("status", {"status": status, "exit_code": code, "lines": index})
                return
            # A heartbeat keeps the connection (and any proxy in front of it)
            # from timing the stream out during a quiet stretch of a long run.
            if not emit("ping", {"at": time.time()}):
                return


def main() -> int:
    parser = argparse.ArgumentParser(description="GeoID sidecar — runs the hub's Python work.")
    parser.add_argument("--root", default=str(Path.home() / "geoid_projects"),
                        help="the geoid_projects folder to serve (created if absent)")
    parser.add_argument("--port", type=int, default=8137)
    parser.add_argument("--host", default="127.0.0.1",
                        help="loopback only by default; changing this exposes an interpreter")
    parser.add_argument("--no-token", action="store_true",
                        help="skip the auth token (single-user machine only)")
    parser.add_argument("--gales", default=os.environ.get("GALES_DIR", ""),
                        help="the GALES source tree, so the FEM stage can generate "
                             "and build a deck ($GALES_DIR, or auto-detected)")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    token = None if args.no_token else secrets.token_urlsafe(18)

    # The GALES tree: the flag, else the copy that ships beside this sidecar
    # (GeoID_GIS/gales), else nothing (deck generation stays disabled).
    gales_dir = None
    for candidate in (args.gales, Path(__file__).resolve().parents[1] / "gales"):
        if candidate and Path(candidate).expanduser().exists():
            gales_dir = Path(candidate).expanduser().resolve()
            break

    runner = Runner(root)
    Handler.runner = runner
    Handler.token = token
    Handler.gales_dir = gales_dir
    # Keys and watcher state live beside the projects, at 0600.
    atlas_watch.configure_root(root)

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"⚠  Binding {args.host} exposes a Python interpreter beyond this "
              "machine. Only do this on a trusted, isolated network.", file=sys.stderr)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    base = f"http://{args.host}:{args.port}"
    print("─" * 68)
    print(f"  GeoID sidecar {VERSION}")
    print(f"  serving   {root}")
    print(f"  listening {base}")
    if token:
        print()
        print("  Paste this into the hub — Settings ▸ Sidecar:")
        print(f"     {base}?token={token}")
    else:
        print(f"  no token (--no-token): any local process can call {base}")
    print("─" * 68)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping…")
        for job in runner.jobs.values():
            runner.stop(job.id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
