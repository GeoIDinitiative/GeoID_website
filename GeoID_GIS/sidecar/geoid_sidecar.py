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
import json
import mimetypes
import os
import secrets
import shlex
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

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
              env: dict | None = None, on_finish=None) -> Job:
        job = Job(uuid.uuid4().hex[:12], kind, label, argv, cwd, env or {})
        job.on_finish = on_finish
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
                "capabilities": ["fs", "jobs", "script", "function", "training", "gales", "events"]
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
            if route == "/fs/list":
                self._fs_list(query.get("path", [""])[0], origin)
            elif route == "/fs/read":
                self._fs_read(query.get("path", [""])[0], origin)
            elif route == "/fs/exists":
                self._fs_exists(query.get("path", [""])[0], origin)
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
        # given — it is already the whole `mpirun … gales …` line, and needs no
        # deck. Otherwise the command is built from the deck: named, or the sole
        # `.in` in the run folder.
        explicit = str(body.get("cmd") or "").strip()
        deck = str(body.get("deck", "")).strip()
        if explicit:
            argv = shlex.split(explicit)
            if not argv:
                raise ValueError("empty command")
        else:
            if deck:
                if not (run_dir / deck).is_file():
                    raise FileNotFoundError(f"deck not found in run: {deck}")
            else:
                decks = sorted(p.name for p in run_dir.glob("*.in"))
                if not decks:
                    raise ValueError(
                        "no command and no .in deck in this run — give a command "
                        "or place a prepared GALES deck in the run folder")
                if len(decks) > 1:
                    raise ValueError(
                        f"several decks ({', '.join(decks)}) — name one with 'deck'")
                deck = decks[0]
            argv = [mpirun_bin, "-n", str(cores), gales_bin, deck]
        cmd_str = " ".join(argv)
        label = body.get("label") or f"GALES {Path(rel).name}/{deck}"

        status_path = run_dir / "status.json"
        started = time.time()

        def write_status(state: str, extra: dict | None = None):
            payload = {"status": state, "cmd": cmd_str, "deck": deck,
                       "cores": cores, "updated_at": time.time()}
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
        self._send(200, {"job_id": job.id, "deck": deck, "cmd": cmd_str}, origin)

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
            'cmake . && make\n'
            'echo "[prepare] done — the run is ready. Use Run to solve it."\n')
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
