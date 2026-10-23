#!/usr/bin/env python3
"""The Model Studio's Blender mesher, run by the sidecar's POST /jobs/blender.

gmsh is the studio's mesher; this is the other one. Blender builds the model's
geometry (primitives, EXACT booleans, a voxel remesh) from the bpy script the
studio emits (`viewer/gis/studio-blender.js`), and leaves its closed surfaces
as JSON. This driver then does what Blender cannot:

1. **Nests the shells.** A cut chamber comes out of Blender as a second loose
   surface inside the first. Each shell's parent is the smallest other shell
   whose box holds it and which holds one of its points (ray parity).
2. **Flags the faces** the way studio-gmsh.js's DEFAULT_FACE_FLAGS does: an
   outer shell's base 2, its vertical sides 5, everything else (the free
   surface) 3; a chamber's wall 7. Never 1 — GALES reads side flag 1 as the
   fluid–solid interface.
3. **Has gmsh fill the volume.** The flagged surfaces are written as MSH 2.2,
   merged into gmsh as discrete surfaces, closed into one volume per outer
   shell with its chambers as holes (and, unless the cut was flagged void, each
   chamber as a volume of its own), and tetrahedralised. Blender's surface
   triangles are kept as they are — this is a volume fill, not a remesh.

The mesh lands at `meshes/<name>.msh`, the same place and the same format the
gmsh route writes, so FEM Setup and the GALES prepare read it unchanged.

**Where Blender runs.** `via: "headless"` starts `blender --background
--factory-startup --python <script> -- <out.json>`. `via: "mcp"` sends the
script into a Blender you have open, through the blender-mcp addon's socket
(github.com/ahujasid/blender-mcp; it listens on localhost:9876, the same
socket its MCP server talks to): one `{"type": "execute_code", "params":
{"code": ...}}` request, the answer read until it parses as JSON. `auto` uses
a live Blender when one answers, else the binary.

Request: one JSON object on stdin —
  {script, out_json, mesh, dim, via, size, keep_cavities}
Progress goes to stdout; a failure ends with an "ERROR: <reason>" line and a
nonzero exit, like every sidecar tool.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

FLAGS = {"top": 3, "base": 2, "side": 5, "cavity": 7}
VOLUME_BASE = 10
MCP_HOST = os.environ.get("BLENDER_HOST", "127.0.0.1")
MCP_PORT = int(os.environ.get("BLENDER_PORT", "9876") or 9876)


# ── Where Blender is ─────────────────────────────────────────────────────────

def blender_binary() -> str | None:
    """`GEOID_BLENDER` if it names a file, else `blender` on PATH."""
    named = os.environ.get("GEOID_BLENDER", "").strip()
    if named and Path(named).is_file():
        return named
    return shutil.which("blender")


def mcp_listening(host: str = MCP_HOST, port: int = MCP_PORT, timeout: float = 0.3) -> bool:
    """Whether a blender-mcp addon socket answers. A connect, nothing sent."""
    if host not in ("127.0.0.1", "localhost", "::1"):
        return False  # a Blender on another machine is not this sidecar's to drive
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def mcp_execute(code: str, host: str = MCP_HOST, port: int = MCP_PORT, timeout: float = 600.0) -> dict:
    """One execute_code request to the blender-mcp addon; its parsed answer."""
    with socket.create_connection((host, port), timeout=5) as sock:
        sock.settimeout(timeout)
        sock.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode("utf-8"))
        buf = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
            try:
                return json.loads(buf.decode("utf-8"))
            except ValueError:
                continue  # not all of it yet
    raise RuntimeError("the Blender MCP socket closed before it answered")


# ── The surfaces: nesting and flags (pure) ──────────────────────────────────

def _bbox(verts: list[float]) -> tuple[list[float], list[float]]:
    xs, ys, zs = verts[0::3], verts[1::3], verts[2::3]
    return [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]


def _box_inside(inner, outer, eps=1e-9) -> bool:
    (a0, a1), (b0, b1) = inner, outer
    return all(b0[k] - eps <= a0[k] and a1[k] <= b1[k] + eps for k in range(3))


def _point_inside(point, part) -> bool:
    """Ray parity along a skewed +x ray: odd crossings is inside."""
    v, t = part["verts"], part["tris"]
    d = (1.0, 0.000123, 0.000457)
    hits = 0
    for i in range(0, len(t), 3):
        a = v[t[i] * 3:t[i] * 3 + 3]
        b = v[t[i + 1] * 3:t[i + 1] * 3 + 3]
        c = v[t[i + 2] * 3:t[i + 2] * 3 + 3]
        e1 = [b[k] - a[k] for k in range(3)]
        e2 = [c[k] - a[k] for k in range(3)]
        h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
        det = sum(e1[k] * h[k] for k in range(3))
        if abs(det) < 1e-15:
            continue
        s = [point[k] - a[k] for k in range(3)]
        u = sum(s[k] * h[k] for k in range(3)) / det
        if u < 0 or u > 1:
            continue
        q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
        w = sum(d[k] * q[k] for k in range(3)) / det
        if w < 0 or u + w > 1:
            continue
        if sum(e2[k] * q[k] for k in range(3)) / det > 1e-12:
            hits += 1
    return hits % 2 == 1


def nest_shells(parts: list[dict]) -> list[int | None]:
    """Each part's parent index (the smallest shell enclosing it) or None."""
    boxes = [_bbox(p["verts"]) for p in parts]
    size = [sum(b[1][k] - b[0][k] for k in range(3)) for b in boxes]
    parents: list[int | None] = []
    for i, part in enumerate(parts):
        probe = part["verts"][0:3]
        best = None
        for j, other in enumerate(parts):
            if j == i or not _box_inside(boxes[i], boxes[j]) or size[j] <= size[i]:
                continue
            if _point_inside(probe, other) and (best is None or size[j] < size[best]):
                best = j
        parents.append(best)
    return parents


def face_flags(part: dict, outer: bool, tol: float | None = None) -> list[int]:
    """One flag per triangle. A chamber's wall is all `cavity`; an outer
    shell's base is the downward faces at its lowest z, its sides the
    vertical faces on its box's x/y extremes, and the rest is the top."""
    v, t = part["verts"], part["tris"]
    n = len(t) // 3
    if not outer:
        return [FLAGS["cavity"]] * n
    lo, hi = _bbox(v)
    tol = tol if tol is not None else 1e-6 * max(hi[k] - lo[k] for k in range(3)) + 1e-9
    out = []
    for i in range(0, len(t), 3):
        a, b, c = (v[t[i + k] * 3:t[i + k] * 3 + 3] for k in range(3))
        e1 = [b[k] - a[k] for k in range(3)]
        e2 = [c[k] - a[k] for k in range(3)]
        nx = e1[1] * e2[2] - e1[2] * e2[1]
        ny = e1[2] * e2[0] - e1[0] * e2[2]
        nz = e1[0] * e2[1] - e1[1] * e2[0]
        ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        nz /= ln
        zs = (a[2], b[2], c[2])
        xs, ys = (a[0], b[0], c[0]), (a[1], b[1], c[1])
        if nz < -0.9 and max(zs) <= lo[2] + tol:
            out.append(FLAGS["base"])
        elif abs(nz) < 0.1 and (max(xs) <= lo[0] + tol or min(xs) >= hi[0] - tol
                                 or max(ys) <= lo[1] + tol or min(ys) >= hi[1] - tol):
            out.append(FLAGS["side"])
        else:
            out.append(FLAGS["top"])
    return out


def surface_msh(parts: list[dict], parents: list[int | None]) -> tuple[str, list[list[int]]]:
    """MSH 2.2 text of every shell's triangles, and each shell's elementary
    surface tags. A triangle's tags are (physical = its flag, elementary =
    one per shell and flag), so a shell is a handful of discrete surfaces gmsh
    can close into a loop, and every flag arrives as a physical group."""
    nodes, elems, shell_tags = [], [], []
    tag = 0
    for i, part in enumerate(parts):
        base = len(nodes)
        v = part["verts"]
        nodes.extend((v[k], v[k + 1], v[k + 2]) for k in range(0, len(v), 3))
        flags = face_flags(part, outer=parents[i] is None)
        by_flag: dict[int, int] = {}
        for f in sorted(set(flags)):
            tag += 1
            by_flag[f] = tag
        shell_tags.append(sorted(by_flag.values()))
        t = part["tris"]
        for k, f in enumerate(flags):
            elems.append((f, by_flag[f], base + t[3 * k] + 1, base + t[3 * k + 1] + 1, base + t[3 * k + 2] + 1))
    lines = ["$MeshFormat", "2.2 0 8", "$EndMeshFormat", "$Nodes", str(len(nodes))]
    lines += [f"{i + 1} {x!r} {y!r} {z!r}" for i, (x, y, z) in enumerate(nodes)]
    lines += ["$EndNodes", "$Elements", str(len(elems))]
    lines += [f"{i + 1} 2 2 {p} {e} {a} {b} {c}" for i, (p, e, a, b, c) in enumerate(elems)]
    lines += ["$EndElements"]
    return "\n".join(lines) + "\n", shell_tags


# ── The volume (gmsh) ────────────────────────────────────────────────────────

def fill_volume(surface_path: str, mesh_path: str, shell_tags, parents, keep_cavities: bool,
                size: float | None = None) -> dict:
    """Tetrahedralise the closed shells in `surface_path` into `mesh_path`."""
    import gmsh  # noqa: PLC0415 — only this step needs it, and its absence is reported upstream
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 1)
        gmsh.merge(surface_path)
        geo = gmsh.model.geo
        loops = [geo.addSurfaceLoop(tags) for tags in shell_tags]
        volumes = []
        outer = [i for i, p in enumerate(parents) if p is None]
        for i in outer:
            holes = [loops[j] for j, p in enumerate(parents) if p == i]
            volumes.append(("domain", geo.addVolume([loops[i]] + holes)))
        if keep_cavities:
            for j, p in enumerate(parents):
                if p is not None:
                    volumes.append(("cavity", geo.addVolume([loops[j]])))
        geo.synchronize()
        for k, (_, vol) in enumerate(volumes):
            gmsh.model.addPhysicalGroup(3, [vol], VOLUME_BASE + k)
        if size and size > 0:
            gmsh.option.setNumber("Mesh.MeshSizeMax", float(size))
        gmsh.model.mesh.generate(3)
        gmsh.write(mesh_path)
        _, tets, _ = gmsh.model.mesh.getElements(3)
        return {"volumes": len(volumes), "tets": int(sum(len(t) for t in tets))}
    finally:
        gmsh.finalize()


# ── The run ──────────────────────────────────────────────────────────────────

def run_blender(script: str, out_json: str, via: str) -> str:
    """Run the bpy script; returns which Blender ran it."""
    live = via in ("mcp", "auto") and mcp_listening()
    if via == "mcp" and not live:
        raise RuntimeError(f"no Blender MCP addon is listening on {MCP_HOST}:{MCP_PORT} — "
                           "open Blender, enable the blender-mcp addon and press Connect in its sidebar tab")
    if live:
        print(f"Blender: sending the model to the live Blender on {MCP_HOST}:{MCP_PORT} (blender-mcp)")
        answer = mcp_execute(f"GEOID_OUT = {out_json!r}\n" + Path(script).read_text(encoding="utf-8"))
        if answer.get("status") != "success":
            raise RuntimeError(f"Blender refused the script: {answer.get('message') or answer}")
        return "mcp"
    exe = blender_binary()
    if not exe:
        raise RuntimeError("Blender is not installed — put `blender` on PATH (blender.org, or "
                           "`sudo snap install blender --classic`) or set GEOID_BLENDER")
    argv = [exe, "--background", "--factory-startup", "--python-exit-code", "1",
            "--python", script, "--", out_json]
    print("Blender: " + " ".join(argv))
    proc = subprocess.run(argv, stdout=sys.stdout, stderr=subprocess.STDOUT, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Blender exited {proc.returncode}")
    return "headless"


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
        script, out_json, mesh = req["script"], req["out_json"], req["mesh"]
        dim = int(req.get("dim") or 3)
        ran = run_blender(script, out_json, str(req.get("via") or "auto"))
        data = json.loads(Path(out_json).read_text(encoding="utf-8"))
        parts = [p for p in data.get("parts", []) if p.get("tris")]
        if not parts:
            raise RuntimeError("Blender built no surface — is the model empty, or did a boolean remove it all?")
        parents = nest_shells(parts)
        print(f"Surfaces: {len(parts)} shell(s), {sum(p is not None for p in parents)} inside another; "
              f"{sum(len(p['tris']) // 3 for p in parts)} triangles from Blender {data.get('blender', '?')} ({ran})")
        text, shell_tags = surface_msh(parts, parents)
        if dim == 2:
            Path(mesh).write_text(text, encoding="utf-8")
            print(f"Wrote the surface mesh: {mesh}")
            return 0
        surface = str(Path(mesh).with_suffix("")) + "_surface.msh"
        Path(surface).write_text(text, encoding="utf-8")
        out = fill_volume(surface, mesh, shell_tags, parents, bool(req.get("keep_cavities", True)),
                          req.get("size"))
        print(f"gmsh filled {out['volumes']} volume(s) with {out['tets']} tetrahedra: {mesh}")
        return 0
    except Exception as exc:  # noqa: BLE001 — every failure ends as one readable line
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
