#!/usr/bin/env python3
"""`POST /jobs/gmsh` — the Model Studio's mesher, exercised end to end.

The studio could always write a gmsh Python script; what it could not do was
run one. That route now does, and this is its guard. Three properties, and
each of them fails silently if it breaks:

- **It is token-gated**, like everything but /health. A route that runs a
  process on this machine must never be the one that forgot.
- **A missing gmsh is a 409 that names it**, in the same shape /jobs/gdal
  answers with — proven on an instance whose PATH is stripped, because gmsh is
  installed on some machines and hoping it is absent is not a test. Nothing may
  be written into the project before that refusal.
- **A real run lands where the rest of the pipeline looks.** With a FAKE gmsh
  on PATH — a shell script for the batch form, a stand-in module for the Python
  form — the job runs, the mesh appears under `meshes/`, and the provenance
  sidecar sits beside it. The Python case also pins the *patch*: the studio's
  `gmsh.write("geoid.msh")` must be rewritten to the mesh path, so a mesh named
  `geoid.msh` appearing in the run folder is a failure, not a success.

No gmsh, no network and no project layout needed: the shim writes the bytes
this file planted in it, so every expected value here is a construction rather
than a recollection.

    python3 GeoID_GIS/tests/sidecar_gmsh.py

Exit 0 when green.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SIDECAR = REPO / "GeoID_GIS" / "sidecar" / "geoid_sidecar.py"

failures = 0

# What the fake gmsh writes. Only the first line is ever asserted on — this is
# a stand-in for a mesher, not a mesher.
FAKE_MSH = ("$MeshFormat\n2.2 0 8\n$EndMeshFormat\n"
            "$Nodes\n1\n1 0.0 0.0 0.0\n$EndNodes\n"
            "$Elements\n0\n$EndElements\n")

# The shape model-studio.js's buildGmshScript() emits: an OCC body, then
# synchronize / generate / write / finalize.
STUDIO_SCRIPT = "\n".join([
    "import gmsh",
    "gmsh.initialize()",
    'gmsh.model.add("geoid")',
    "occ = gmsh.model.occ",
    "",
    "occ.addBox(0.000000, 0.000000, 0.000000, 1.000000, 1.000000, 1.000000)  # add",
    "",
    "occ.synchronize()",
    'gmsh.option.setNumber("Mesh.MeshSizeMax", 1)',
    "gmsh.model.mesh.generate(3)",
    'gmsh.write("geoid.msh")',
    "gmsh.finalize()",
])

# The same, with the write line removed: the route must add one, and add it
# BEFORE finalize() — after it the API is closed and nothing can be written.
NO_WRITE_SCRIPT = "\n".join(
    line for line in STUDIO_SCRIPT.splitlines() if "gmsh.write" not in line)


def check(name: str, ok: bool, detail: str = ""):
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Client:
    def __init__(self, base: str, token: str | None = None):
        self.base = base
        self.token = token

    def call(self, path: str, payload=None, method=None, token=...):
        url = self.base + path
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data,
                                     method=method or ("POST" if data else "GET"))
        if data:
            req.add_header("Content-Type", "application/json")
        use = self.token if token is ... else token
        if use:
            req.add_header("Authorization", f"Bearer {use}")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read()
                try:
                    return resp.status, json.loads(body)
                except json.JSONDecodeError:
                    return resp.status, body
        except urllib.error.HTTPError as exc:
            body = exc.read()
            try:
                return exc.code, json.loads(body)
            except json.JSONDecodeError:
                return exc.code, body

    def wait_job(self, job_id: str, timeout: float = 60) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            _, snap = self.call(f"/jobs/{job_id}")
            if isinstance(snap, dict) and snap.get("status") in ("done", "failed", "stopped"):
                return snap
            time.sleep(0.3)
        return {"status": "timeout"}

    def job_log(self, job_id: str) -> str:
        """A finished job's whole log over the same SSE endpoint the hub uses.

        The stream ends with a `status` EVENT rather than EOF — the server keeps
        the socket for a next request — so this stops at that marker instead of
        reading to EOF and hanging until the timeout.
        """
        req = urllib.request.Request(self.base + f"/jobs/{job_id}/events?from=0")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        lines, event = [], ""
        with urllib.request.urlopen(req, timeout=15) as resp:
            for raw in resp:
                row = raw.decode().rstrip("\n")
                if row.startswith("event: "):
                    event = row[len("event: "):]
                elif row.startswith("data: ") and event == "line":
                    try:
                        payload = json.loads(row[len("data: "):])
                    except json.JSONDecodeError:
                        continue
                    lines.append(str(payload.get("text", "")))
                elif row.startswith("data: ") and event == "status":
                    break
        return "\n".join(lines)


def start(root: Path, port: int, env: dict | None = None):
    """A throwaway sidecar with no token, discarding its banner."""
    argv = [sys.executable, str(SIDECAR), "--root", str(root),
            "--port", str(port), "--no-token"]
    proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            env={**os.environ, **env} if env else None)
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            urllib.request.urlopen(base + "/health", timeout=2).read()
            return proc, base
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError("sidecar exited before answering /health")
            time.sleep(0.3)
    raise RuntimeError("sidecar did not come up")


def stop(proc: subprocess.Popen):
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def write_shim(shim: Path) -> None:
    """A gmsh that is exactly as real as this test needs.

    Two halves, because the route has two branches. The shell script answers
    `shutil.which("gmsh")` and, in gmsh's batch form, writes the file named by
    `-o`. The module stands in for `import gmsh`, accepting every call the
    studio's script makes and giving `write()` the one observable effect —
    which is what lets the test see WHERE the route pointed the output.
    """
    shim.mkdir(parents=True, exist_ok=True)
    binary = shim / "gmsh"
    binary.write_text(
        "#!/bin/sh\n"
        'echo "[fake gmsh] $*"\n'
        "out=\n"
        "while [ $# -gt 0 ]; do\n"
        '  if [ "$1" = "-o" ]; then out="$2"; shift; fi\n'
        "  shift\n"
        "done\n"
        'if [ -z "$out" ]; then echo "[fake gmsh] no -o given"; exit 2; fi\n'
        'cat > "$out" <<\'MSHEOF\'\n' + FAKE_MSH + "MSHEOF\n"
        'echo "[fake gmsh] wrote $out"\n')
    binary.chmod(0o755)
    (shim / "gmsh.py").write_text(
        "# Stand-in for the gmsh Python module (see tests/sidecar_gmsh.py).\n"
        f"MSH = {FAKE_MSH!r}\n"
        "\n"
        "class _Any:\n"
        "    def __getattr__(self, name):\n"
        "        return _Any()\n"
        "    def __call__(self, *a, **k):\n"
        "        return _Any()\n"
        "\n"
        "def write(path):\n"
        "    with open(path, 'w') as fh:\n"
        "        fh.write(MSH)\n"
        "    print('[fake gmsh] wrote', path)\n"
        "\n"
        "def __getattr__(name):\n"
        "    return _Any()\n")


def run_tests(root: Path, shim: Path) -> None:
    project = root / "earth" / "p"
    (project / "data").mkdir(parents=True, exist_ok=True)
    meshes = project / "meshes"

    # ── the runs, against the fake gmsh ──────────────────────────────────────
    port = free_port()
    proc, base = start(root, port, env={"PATH": f"{shim}{os.pathsep}{os.environ['PATH']}"})
    c = Client(base)
    try:
        status, health = c.call("/health")
        check("the sidecar advertises the gmsh route",
              status == 200 and "gmsh" in health.get("capabilities", []),
              str(health.get("capabilities"))[:80])

        # Shape refusals first: each is a 400/403 on any machine, gmsh or not.
        status, err = c.call("/jobs/gmsh", {"script": STUDIO_SCRIPT})
        check("a request with no project is refused",
              status == 400 and "project" in str(err.get("error", "")), str(err)[:70])
        status, err = c.call("/jobs/gmsh", {"project": "earth/p"})
        check("a request with neither script nor scriptPath is refused",
              status == 400 and "script" in str(err.get("error", "")), str(err)[:70])
        status, err = c.call("/jobs/gmsh", {"project": "../../elsewhere",
                                            "script": STUDIO_SCRIPT})
        check("a project outside the projects root is 403", status == 403,
              f"HTTP {status}")
        status, err = c.call("/jobs/gmsh", {"project": "earth/p",
                                            "scriptPath": "../../outside.py"})
        check("a scriptPath outside the projects root is 403", status == 403,
              f"HTTP {status}")
        status, err = c.call("/jobs/gmsh", {"project": "earth/p",
                                            "script": STUDIO_SCRIPT,
                                            "name": "../escape"})
        check("a mesh name carrying a path is refused", status == 400,
              str(err)[:70])
        status, err = c.call("/jobs/gmsh", {"project": "earth/p",
                                            "script": STUDIO_SCRIPT, "dim": 4})
        check("a dim outside 1–3 is refused", status == 400, str(err)[:70])
        status, err = c.call("/jobs/gmsh", {"project": "earth/nope",
                                            "script": STUDIO_SCRIPT})
        check("a project that does not exist is refused by name",
              status in (400, 404) and "earth/nope" in str(err.get("error", "")),
              f"HTTP {status} {str(err)[:50]}")

        # ── the Python branch: the studio's own script text ──────────────────
        status, out = c.call("/jobs/gmsh", {
            "project": "earth/p", "script": STUDIO_SCRIPT, "name": "studio_box",
            "dim": 3, "env": {"PYTHONPATH": str(shim)}})
        check("the studio's script starts a job", status == 200 and out.get("job_id"),
              str(out)[:90])
        if status == 200:
            check("the mesh is promised under the project's meshes/",
                  out.get("mesh") == str(Path("earth/p/meshes/studio_box.msh")),
                  str(out.get("mesh")))
            check("the script is filed beside it as _gmsh_job_<ts>.py",
                  str(out.get("script", "")).startswith(
                      str(Path("earth/p/meshes/_gmsh_job_")))
                  and str(out.get("script", "")).endswith(".py"),
                  str(out.get("script")))
            snap = c.wait_job(out["job_id"])
            log = c.job_log(out["job_id"])
            check("the job runs to done", snap.get("status") == "done",
                  f"status={snap.get('status')} log={log[-160:]}")
            mesh = root / out["mesh"]
            check("the mesh appears under meshes/", mesh.is_file(), str(mesh))
            if mesh.is_file():
                check("the mesh is what gmsh wrote",
                      mesh.read_text().startswith("$MeshFormat"),
                      mesh.read_text()[:20])
            # The patch is the whole point: an unpatched script writes
            # "geoid.msh" into the job's cwd, which is this very folder.
            check("the script's own output name is rewritten, not honoured",
                  not (meshes / "geoid.msh").exists(),
                  str(sorted(p.name for p in meshes.glob("*.msh"))))
            filed = root / out["script"]
            check("the script that ran is filed beside the mesh", filed.is_file(),
                  str(filed))
            if filed.is_file():
                text = filed.read_text()
                check("the write line points at the mesh path",
                      f'gmsh.write({str(mesh)!r})' in text,
                      [l for l in text.splitlines() if "gmsh.write" in l][:1])
                check("only the write line changed",
                      text.count("gmsh.write") == 1 and "occ.addBox" in text
                      and "geoid.msh" not in text,
                      f"writes={text.count('gmsh.write')}")
            prov = Path(f"{mesh}.provenance.json")
            check("a provenance sidecar sits beside the mesh", prov.is_file(),
                  str(prov))
            if prov.is_file():
                rec = json.loads(prov.read_text())
                check("provenance names gmsh as the source",
                      rec.get("source") == "gmsh", str(rec)[:70])
                check("provenance points at the script that ran",
                      rec.get("script") == out["script"], str(rec.get("script")))
                check("provenance records the exit code and the duration",
                      rec.get("exit") == 0 and isinstance(rec.get("seconds"), (int, float))
                      and rec["seconds"] >= 0 and rec.get("started", 0) > 0,
                      f"exit={rec.get('exit')} seconds={rec.get('seconds')}")

        # ── the batch branch: a file already in the project ──────────────────
        (project / "data" / "box.geo").write_text(
            'SetFactory("OpenCASCADE");\nBox(1) = {0,0,0, 1,1,1};\n')
        status, out2 = c.call("/jobs/gmsh", {
            "project": "earth/p", "scriptPath": "earth/p/data/box.geo",
            "name": "geo_box", "params": {"dim": 2}})
        check("a .geo in the project starts a job", status == 200, str(out2)[:90])
        if status == 200:
            argv = out2.get("argv", [])
            check("a non-Python input is handed to the gmsh binary in batch form",
                  len(argv) == 5 and argv[0] == "gmsh" and argv[1].endswith(".geo")
                  and argv[2] == "-2" and argv[3] == "-o"
                  and argv[4].endswith("geo_box.msh"),
                  str(argv))
            check("dim is read from params as well as from the top level",
                  "-2" in argv, str(argv))
            snap = c.wait_job(out2["job_id"])
            check("the batch job runs to done", snap.get("status") == "done",
                  f"status={snap.get('status')} log={c.job_log(out2['job_id'])[-160:]}")
            mesh2 = root / out2["mesh"]
            check("the batch mesh appears under meshes/", mesh2.is_file(), str(mesh2))
            prov2 = Path(f"{mesh2}.provenance.json")
            check("the batch run leaves its provenance too",
                  prov2.is_file()
                  and json.loads(prov2.read_text()).get("dim") == 2,
                  str(prov2))
            copy = root / out2["script"]
            check("the .geo is copied into meshes/ with its own extension",
                  copy.is_file() and copy.suffix == ".geo"
                  and "OpenCASCADE" in copy.read_text(), str(copy))

        # ── a script with no write line gets one, before finalize ────────────
        status, out3 = c.call("/jobs/gmsh", {
            "project": "earth/p", "script": NO_WRITE_SCRIPT, "name": "appended",
            "env": {"PYTHONPATH": str(shim)}})
        check("a script with no write line still starts", status == 200, str(out3)[:80])
        if status == 200:
            snap = c.wait_job(out3["job_id"])
            filed = root / out3["script"]
            lines = filed.read_text().splitlines() if filed.is_file() else []
            wrote = [i for i, l in enumerate(lines) if l.startswith("gmsh.write(")]
            fin = [i for i, l in enumerate(lines) if l.startswith("gmsh.finalize(")]
            check("the write is inserted before finalize(), which closes the API",
                  len(wrote) == 1 and len(fin) == 1 and wrote[0] < fin[0],
                  f"write at {wrote}, finalize at {fin}")
            check("and the appended write actually produces the mesh",
                  snap.get("status") == "done" and (root / out3["mesh"]).is_file(),
                  f"status={snap.get('status')} mesh={out3.get('mesh')}")

        # Two Python jobs back to back land in the same second, and the stamp
        # alone would then give them one script file — the first job's
        # provenance would point at the second job's text.
        back = [c.call("/jobs/gmsh", {"project": "earth/p", "script": STUDIO_SCRIPT,
                                      "name": f"rapid{n}",
                                      "env": {"PYTHONPATH": str(shim)}})[1]
                for n in (1, 2)]
        check("two jobs in one second do not share a script file",
              back[0].get("script") and back[0]["script"] != back[1].get("script"),
              f"{back[0].get('script')} vs {back[1].get('script')}")
        for job in back:
            if job.get("job_id"):
                c.wait_job(job["job_id"])
        scripts = sorted(p.name for p in meshes.glob("_gmsh_job_*"))
        check("every job filed its own script",
              len(scripts) == len(set(scripts)) and len(scripts) >= 5,
              str(scripts))
    finally:
        stop(proc)

    # ── token gate, on a second instance ─────────────────────────────────────
    port2 = free_port()
    # `-u`: the banner carrying the token is printed and the process then blocks
    # in serve_forever, so a block-buffered pipe would never deliver that line.
    proc2 = subprocess.Popen(
        [sys.executable, "-u", str(SIDECAR), "--root", str(root), "--port", str(port2)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={**os.environ, "PATH": f"{shim}{os.pathsep}{os.environ['PATH']}"})
    try:
        base2 = f"http://127.0.0.1:{port2}"
        token = None
        deadline = time.time() + 15
        while time.time() < deadline and token is None:
            line = proc2.stdout.readline()
            if "?token=" in line:
                token = line.strip().split("?token=")[1]
            if proc2.poll() is not None:
                break
        check("the instance prints a token", bool(token))
        if token:
            anon = Client(base2, None)
            status, _ = anon.call("/jobs/gmsh", {"project": "earth/p",
                                                 "script": STUDIO_SCRIPT})
            check("/jobs/gmsh refuses an unauthenticated call", status == 401,
                  f"HTTP {status}")
            authed = Client(base2, token)
            status, out = authed.call("/jobs/gmsh", {
                "project": "earth/p", "script": STUDIO_SCRIPT, "name": "authed",
                "env": {"PYTHONPATH": str(shim)}})
            check("/jobs/gmsh accepts the token", status == 200, f"HTTP {status}")
            if status == 200:
                snap = authed.wait_job(out["job_id"])
                check("the authenticated job meshes as well",
                      snap.get("status") == "done"
                      and (root / out["mesh"]).is_file(),
                      f"status={snap.get('status')}")
    finally:
        stop(proc2)

    # ── missing gmsh is a 409, on a PATH-stripped third instance ─────────────
    # gmsh is installed on some machines, so the refusal is proven by hiding
    # PATH from a dedicated instance rather than by hoping it is absent.
    (root / "earth" / "nogmsh").mkdir(parents=True, exist_ok=True)
    port3 = free_port()
    proc3, base3 = start(root, port3, env={"PATH": "/nonexistent"})
    try:
        c3 = Client(base3)
        status, err = c3.call("/jobs/gmsh", {
            "project": "earth/nogmsh", "script": STUDIO_SCRIPT, "name": "never"})
        check("a missing gmsh is a 409 that names it",
              status == 409 and "gmsh" in str(err.get("error", "")),
              f"HTTP {status} {str(err)[:80]}")
        check("the refusal names installing it, as /jobs/gdal's does",
              "not installed" in str(err.get("error", "")), str(err)[:80])
        # Shape is validated before presence, so a bad request is still a 400.
        status, err = c3.call("/jobs/gmsh", {"script": STUDIO_SCRIPT})
        check("a malformed request is still a 400 where gmsh is absent",
              status == 400, f"HTTP {status}")
        # And nothing may be written into the project on the way to a 409.
        left = sorted(p.name for p in (root / "earth" / "nogmsh" / "meshes").glob("*")) \
            if (root / "earth" / "nogmsh" / "meshes").is_dir() else []
        check("the refused request left nothing behind", left == [], str(left))
    finally:
        stop(proc3)


def main() -> int:
    if not SIDECAR.exists():
        print(f"no sidecar at {SIDECAR}")
        return 1
    tmp = Path(tempfile.mkdtemp(prefix="geoid-gmsh-test-"))
    try:
        shim = tmp / "shim"
        write_shim(shim)
        run_tests(tmp / "geoid_projects", shim)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{failures} FAILED" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
