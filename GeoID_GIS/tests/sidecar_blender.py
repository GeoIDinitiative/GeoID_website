#!/usr/bin/env python3
"""`POST /jobs/blender` — the Model Studio's second mesher, end to end.

gmsh is the studio's mesher; Blender is the other one. This guards both
halves of it without needing Blender installed:

- **The driver's pure steps** (`sidecar/blender_mesher.py`): a chamber is
  found inside its crust, the crust's faces take the studio's default flags
  (base 2, sides 5, top 3; the chamber wall 7), and the surface MSH carries one
  elementary surface per shell and flag.
- **The route's refusals**: a missing project or script is a 400, an unknown
  `via` a 400, a project outside the root a 403, and no Blender at all — no
  binary, no MCP socket — a 409 that says what to install, with nothing
  written into the project.
- **A real run, both ways.** A FAKE `blender` on PATH writes the two-cube JSON
  a box-minus-cube model would leave; a FAKE blender-mcp socket answers one
  `execute_code` the same way. Each run must end in `meshes/<name>.msh` with
  provenance beside it. Where the `gmsh` Python module is installed the volume
  fill is real (two cubes, a few dozen tetrahedra — nothing heavy); where it is
  not, the run is asked for the surface (dim 2) instead.

    python3 GeoID_GIS/tests/sidecar_blender.py

Exit 0 when green.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "sidecar"))

import blender_mesher as bm  # noqa: E402
from sidecar_gmsh import Client, check, free_port, start, stop  # noqa: E402
import sidecar_gmsh  # noqa: E402

HAS_GMSH = importlib.util.find_spec("gmsh") is not None
SCRIPT = "# a studio bpy script; the fakes below never read it\nimport bpy\n"


def cube(origin, size):
    """A closed, outward-wound cube as the bpy script's JSON part."""
    x, y, z = origin
    verts = [(x + i * size, y + j * size, z + k * size) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    at = lambda i, j, k: i * 4 + j * 2 + k  # noqa: E731
    quads = [(at(0, 0, 0), at(0, 1, 0), at(1, 1, 0), at(1, 0, 0)), (at(0, 0, 1), at(1, 0, 1), at(1, 1, 1), at(0, 1, 1)),
             (at(0, 0, 0), at(1, 0, 0), at(1, 0, 1), at(0, 0, 1)), (at(0, 1, 0), at(0, 1, 1), at(1, 1, 1), at(1, 1, 0)),
             (at(0, 0, 0), at(0, 0, 1), at(0, 1, 1), at(0, 1, 0)), (at(1, 0, 0), at(1, 1, 0), at(1, 1, 1), at(1, 0, 1))]
    tris = []
    for a, b, c, d in quads:
        tris += [a, b, c, a, c, d]
    return {"verts": [c for v in verts for c in v], "tris": tris}


PARTS = {"name": "t", "blender": "fake", "parts": [cube((0, 0, -10), 10), cube((4, 4, -6), 2)]}


def test_pure():
    parts = PARTS["parts"]
    parents = bm.nest_shells(parts)
    check("the chamber is found inside the crust", parents == [None, 0], str(parents))
    check("a lone shell has no parent", bm.nest_shells(parts[:1]) == [None])
    side_by_side = [cube((0, 0, 0), 1), cube((5, 0, 0), 1)]
    check("two shells side by side are both outer", bm.nest_shells(side_by_side) == [None, None])
    flags = bm.face_flags(parts[0], outer=True)
    check("a crust's faces are base 2, top 3 and sides 5",
          flags.count(2) == 2 and flags.count(3) == 2 and flags.count(5) == 8, str(flags))
    check("a chamber's wall is all 7", set(bm.face_flags(parts[1], outer=False)) == {7})
    check("no face is ever flag 1 (GALES's fluid–solid interface)", 1 not in flags)
    text, tags = bm.surface_msh(parts, parents)
    check("the surface MSH is 2.2", text.startswith("$MeshFormat\n2.2 0 8\n"))
    check("one elementary surface per shell and flag", tags == [[1, 2, 3], [4]], str(tags))
    check("every triangle is written", f"$Elements\n{12 + 12}\n" in text)


def write_fake_blender(shim: Path):
    shim.mkdir(parents=True, exist_ok=True)
    exe = shim / "blender"
    exe.write_text(
        f"#!{sys.executable}\n"
        "import json, sys\n"
        "print('[fake blender]', ' '.join(sys.argv[1:]))\n"
        "out = sys.argv[sys.argv.index('--') + 1]\n"
        f"json.dump({json.dumps(PARTS)}, open(out, 'w'))\n")
    exe.chmod(0o755)


class FakeMcp:
    """A blender-mcp addon socket: one execute_code at a time, answered by
    writing the parts to the GEOID_OUT the code defines."""

    def __init__(self):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(4)
        self.port = self.sock.getsockname()[1]
        self.requests = []
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                buf = b""
                conn.settimeout(2)
                try:
                    while True:
                        chunk = conn.recv(65536)
                        if not chunk:
                            break
                        buf += chunk
                        try:
                            req = json.loads(buf)
                            break
                        except ValueError:
                            continue
                    else:
                        continue
                except (OSError, socket.timeout):
                    continue
                if not buf:
                    continue  # a presence probe: connect, nothing sent
                self.requests.append(req)
                code = req.get("params", {}).get("code", "")
                first = code.splitlines()[0]
                out = first.split("=", 1)[1].strip().strip("'\"")
                Path(out).write_text(json.dumps(PARTS))
                conn.sendall(json.dumps({"status": "success", "result": {"executed": True}}).encode())

    def close(self):
        self.sock.close()


def run_route(root: Path, shim: Path):
    project = root / "earth" / "p"
    (project / "data").mkdir(parents=True, exist_ok=True)
    meshes = project / "meshes"
    dim = 3 if HAS_GMSH else 2
    dead_port = str(free_port())

    # ── no Blender anywhere: a 409 that names what to install ───────────────
    port = free_port()
    proc, base = start(root, port, env={"PATH": "/usr/bin:/bin", "GEOID_BLENDER": "",
                                        "BLENDER_PORT": dead_port})
    c = Client(base)
    try:
        status, health = c.call("/health")
        check("the sidecar advertises the blender route", "blender" in health.get("capabilities", []))
        status, caps = c.call("/capabilities")
        b = caps.get("blender", {}) if isinstance(caps, dict) else {}
        check("capabilities report Blender absent", b.get("binary") is False and b.get("mcp") is False, str(b))
        status, err = c.call("/jobs/blender", {"script": SCRIPT})
        check("no project is a 400", status == 400 and "project" in str(err.get("error")), str(err)[:70])
        status, err = c.call("/jobs/blender", {"project": "earth/p"})
        check("no script is a 400", status == 400 and "script" in str(err.get("error")), str(err)[:70])
        status, err = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT, "via": "ssh"})
        check("an unknown via is a 400", status == 400, f"HTTP {status}")
        status, err = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT, "dim": 1})
        check("dim 1 is a 400", status == 400, f"HTTP {status}")
        status, err = c.call("/jobs/blender", {"project": "../../x", "script": SCRIPT})
        check("a project outside the root is 403", status == 403, f"HTTP {status}")
        status, err = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT, "name": "../up"})
        check("a mesh name carrying a path is a 400", status == 400, f"HTTP {status}")
        status, err = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT})
        check("no Blender is a 409 that says to install it",
              status == 409 and "not installed" in str(err.get("error")) and "blender.org" in str(err.get("error")),
              str(err)[:90])
        status, err = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT, "via": "mcp"})
        check("via mcp with no socket is a 409 that names the addon",
              status == 409 and "blender-mcp" in str(err.get("error")), str(err)[:90])
        check("the refusals wrote nothing into the project", not meshes.exists() or not any(meshes.iterdir()))
    finally:
        stop(proc)

    # ── a headless run, against the fake blender binary ─────────────────────
    port = free_port()
    proc, base = start(root, port, env={"PATH": f"{shim}{os.pathsep}{os.environ['PATH']}",
                                        "BLENDER_PORT": dead_port})
    c = Client(base)
    try:
        status, caps = c.call("/capabilities")
        check("capabilities find the blender binary", caps.get("blender", {}).get("binary") is True, str(caps.get("blender")))
        status, out = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT, "name": "headless",
                                              "dim": dim, "via": "headless", "size": 4})
        check("a headless run starts", status == 200 and out.get("via") == "headless", str(out)[:90])
        snap = c.wait_job(out.get("job_id", ""))
        log = c.job_log(out.get("job_id", "")) if snap.get("status") != "timeout" else ""
        check("the headless run finishes cleanly", snap.get("status") == "done", f"{snap.get('status')} {log[-300:]}")
        mesh = meshes / "headless.msh"
        check("the mesh lands in meshes/", mesh.is_file())
        check("the script is filed beside it", any(meshes.glob("_blender_job_*.py")))
        prov = json.loads((meshes / "headless.msh.provenance.json").read_text()) if (meshes / "headless.msh.provenance.json").is_file() else {}
        check("provenance names Blender", prov.get("source") == "blender" and prov.get("exit") == 0, str(prov)[:90])
        if HAS_GMSH:
            check("gmsh filled two volumes (crust and chamber)", "filled 2 volume(s)" in log, log[-200:])
    finally:
        stop(proc)

    # ── a live run, into a fake blender-mcp socket ──────────────────────────
    fake = FakeMcp()
    port = free_port()
    proc, base = start(root, port, env={"PATH": "/usr/bin:/bin", "GEOID_BLENDER": "",
                                        "BLENDER_PORT": str(fake.port)})
    c = Client(base)
    try:
        status, caps = c.call("/capabilities")
        check("capabilities see the live Blender", caps.get("blender", {}).get("mcp") is True, str(caps.get("blender")))
        status, out = c.call("/jobs/blender", {"project": "earth/p", "script": SCRIPT, "name": "live", "dim": dim})
        check("auto picks the live Blender", status == 200 and out.get("via") == "mcp", str(out)[:90])
        snap = c.wait_job(out.get("job_id", ""))
        check("the live run finishes cleanly", snap.get("status") == "done", str(snap.get("tail")))
        check("one execute_code was sent", [r.get("type") for r in fake.requests] == ["execute_code"], str(fake.requests)[:90])
        check("it carried GEOID_OUT and the script", bool(fake.requests) and
              fake.requests[0]["params"]["code"].startswith("GEOID_OUT = ") and SCRIPT in fake.requests[0]["params"]["code"])
        check("the live mesh lands in meshes/", (meshes / "live.msh").is_file())
    finally:
        stop(proc)
        fake.close()


def main() -> int:
    test_pure()
    tmp = Path(tempfile.mkdtemp(prefix="geoid-blender-test-"))
    try:
        shim = tmp / "shim"
        write_fake_blender(shim)
        run_route(tmp / "geoid_projects", shim)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failures = sidecar_gmsh.failures
    print(f"\n{failures} FAILED" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
