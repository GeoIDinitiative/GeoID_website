#!/usr/bin/env python3
"""Sidecar tests — the component that runs real processes deserves a guard.

The sidecar executes subprocesses, hands out a filesystem and now generates and
runs GALES decks. It was verified by hand at every step and by nothing
afterwards, which is exactly the shape that rots. This exercises it end to end
against a throwaway projects root: the filesystem contract, the **path sandbox**,
token auth, compute targets (including the refusal to accept a password), deck
generation for each physics family, which command a run resolves to, and the
binary results reader — the last checked against a synthetic mesh and result
file whose answers are known exactly.

No network, no Trilinos, no GALES binary needed: everything here is either pure
translation or reads bytes this script wrote itself. The deck-generation cases
skip cleanly when no GALES tree is present.

    python3 GeoID_GIS/tests/sidecar.py

Exit 0 when green.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SIDECAR = REPO / "GeoID_GIS" / "sidecar" / "geoid_sidecar.py"
GALES = REPO / "GeoID_GIS" / "gales"

failures = 0
skipped = 0


def check(name: str, ok: bool, detail: str = ""):
    global failures
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")


def skip(name: str, why: str):
    global skipped
    skipped += 1
    print(f"SKIP  {name}  — {why}")


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
        req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
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

    def wait_job(self, job_id: str, timeout: float = 90) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            _, snap = self.call(f"/jobs/{job_id}")
            if isinstance(snap, dict) and snap.get("status") in ("done", "failed", "stopped"):
                return snap
            time.sleep(0.4)
        return {"status": "timeout"}


def start(root: Path, port: int, token: bool = False, gales: bool = False):
    argv = [sys.executable, str(SIDECAR), "--root", str(root), "--port", str(port)]
    if not token:
        argv.append("--no-token")
    if gales:
        argv += ["--gales", str(GALES)]
    # Its banner is not read here, so discard it rather than let a full pipe
    # buffer block the service.
    proc = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            urllib.request.urlopen(base + "/health", timeout=2).read()
            return proc, base
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError(f"sidecar exited: {proc.stdout.read()[:400]}")
            time.sleep(0.3)
    raise RuntimeError("sidecar did not come up")


def run_tests(root: Path) -> None:
    port = free_port()
    proc, base = start(root, port, gales=GALES.exists())
    c = Client(base)
    try:
        # ── health ───────────────────────────────────────────────────────────
        status, health = c.call("/health")
        check("health answers", status == 200 and health.get("ok") is True)
        caps = health.get("capabilities", [])
        check("advertises its capabilities",
              {"fs", "jobs", "gales", "compute"} <= set(caps), str(caps))

        # ── filesystem ───────────────────────────────────────────────────────
        c.call("/fs/write", {"path": "earth/p/notes/hello.txt", "content": "hi"})
        status, got = c.call("/fs/read?path=earth/p/notes/hello.txt")
        check("writes and reads a file back", got == b"hi" or got == "hi", repr(got)[:40])
        _, listing = c.call("/fs/list?path=earth/p/notes")
        check("lists a directory",
              any(e["name"] == "hello.txt" for e in listing.get("entries", [])))
        _, exists = c.call("/fs/exists?path=earth/p/notes/hello.txt")
        check("reports existence", exists.get("exists") is True)

        # The security property that matters most: nothing may escape the root.
        status, escaped = c.call("/fs/read?path=../../../../etc/passwd")
        check("refuses to read outside the projects root",
              status == 403, f"HTTP {status}")
        status, _ = c.call("/fs/write", {"path": "../escape.txt", "content": "no"})
        check("refuses to write outside the projects root", status == 403, f"HTTP {status}")

        # ── compute targets ──────────────────────────────────────────────────
        _, listed = c.call("/compute")
        check("compute starts with no targets and probes this machine",
              listed.get("targets") == {} and "mpirun" in listed.get("local", {}))
        status, saved = c.call("/compute/save", {
            "name": "srv", "kind": "ssh", "host": "h.example", "user": "u",
            "ranks": 8, "remote_root": "~/runs", "gales_dir": "~/gales"})
        check("saves an ssh target", status == 200 and saved["target"]["ranks"] == 8)
        # Passwords must never be accepted — keys are the only supported path.
        status, refused = c.call("/compute/save", {
            "name": "bad", "kind": "ssh", "host": "h", "password": "hunter2"})
        check("refuses a password outright",
              status == 400 and "assword" in str(refused.get("error", "")),
              str(refused)[:60])
        _, listed = c.call("/compute")
        check("lists the saved target and not the refused one",
              list(listed["targets"]) == ["srv"], str(list(listed["targets"])))
        c.call("/compute/delete", {"name": "srv"})
        _, listed = c.call("/compute")
        check("deletes a target", listed["targets"] == {})

        # ── which command a run resolves to ──────────────────────────────────
        # A GALES sim is a built executable, not a deck file. A stand-in
        # executable proves the resolution and that it is actually run.
        run = root / "earth" / "p" / "fem_runs" / "built"
        run.mkdir(parents=True, exist_ok=True)
        (run / "setup.txt").write_text("solid_mesh_file mesh_2core.txt\n")
        exe = run / "executable"
        exe.write_text("#!/bin/sh\nmkdir -p results/solid/u\necho ok > results/solid/u/0\n")
        exe.chmod(0o755)
        status, started = c.call("/jobs/gales", {"dir": "earth/p/fem_runs/built", "cores": 2})
        check("a built run resolves to mpirun ./executable",
              status == 200 and started.get("cmd", "").endswith("./executable"),
              started.get("cmd", str(started)[:60]))
        if status == 200:
            snap = c.wait_job(started["job_id"])
            check("the run executes and reports done", snap.get("status") == "done",
                  f"status={snap.get('status')} exit={snap.get('exit_code')}")
            st = json.loads((run / "status.json").read_text())
            check("status.json records the outcome and where it ran",
                  st.get("status") == "done" and st.get("where") == "local", str(st)[:80])

        bare = root / "earth" / "p" / "fem_runs" / "bare"
        bare.mkdir(parents=True, exist_ok=True)
        status, err = c.call("/jobs/gales", {"dir": "earth/p/fem_runs/bare"})
        check("a run with nothing built names the fix",
              status == 400 and "Generate & build deck" in str(err.get("error", "")),
              str(err)[:70])

        # ── the binary results reader ────────────────────────────────────────
        # A synthetic mesh and result file, so the expected numbers are exact.
        pp = root / "earth" / "p" / "fem_runs" / "pp"
        (pp / "input").mkdir(parents=True, exist_ok=True)
        (pp / "results" / "solid" / "u").mkdir(parents=True, exist_ok=True)
        # Three nodes; the probe sits nearest node 1.
        (pp / "input" / "mesh_1core.txt").write_text(
            "MESH! 3D\nnodes 3\n"
            "Node 0 0.0 0.0 0.0 5\n"
            "Node 1 10.0 0.0 0.0 5\n"
            "Node 2 100.0 0.0 0.0 5\n")
        # u = 3 doubles per node; node 1 gets a value we can assert on.
        for step, uz in ((0, 0.0), (1, -2.5)):
            payload = b"".join(struct.pack("<3d", *v) for v in
                               [(0, 0, 0), (1.0, 2.0, uz), (0, 0, 0)])
            (pp / "results" / "solid" / "u" / str(step)).write_bytes(payload)
        status, job = c.call("/jobs/gales/postprocess", {
            "dir": "earth/p/fem_runs/pp",
            "stations": [{"name": "P1", "x": 9.0, "y": 0.0, "z": 0.0}]})
        check("postprocess starts", status == 200, str(job)[:60])
        if status == 200:
            snap = c.wait_job(job["job_id"])
            check("postprocess completes", snap.get("status") == "done",
                  str(snap.get("status")))
            csv = root / "earth" / "p" / "post_processing" / "extracted_dofs" / "P1.csv"
            check("writes the probe CSV", csv.is_file(), str(csv))
            if csv.is_file():
                rows = [r.split(",") for r in csv.read_text().strip().splitlines()]
                check("CSV header is the analysis pages' format",
                      rows[0] == ["t", "ux", "uy", "uz", "magnitude"], str(rows[0]))
                check("reads the nearest node's displacement exactly",
                      len(rows) == 3 and float(rows[2][3]) == -2.5
                      and float(rows[2][1]) == 1.0,
                      str(rows[2] if len(rows) > 2 else rows))
            info = pp / "stations_info.txt"
            check("writes stations_info.txt with the node mapping",
                  info.is_file() and info.read_text().split()[0] == "1"
                  and info.read_text().split()[2] == "1",
                  info.read_text().strip().replace("\n", " | ") if info.is_file() else "missing")

        # ── deck generation, one per physics family ──────────────────────────
        if not GALES.exists():
            skip("deck generation", "no GALES tree at GeoID_GIS/gales")
        else:
            families = [("solid", "solid_mesh_file", {"rho": "2700"}),
                        ("fluid", "fluid_mesh_file", {"mu": "0.001"}),
                        ("thermal", "heat_eq_mesh_file", {})]
            for physics, mesh_key, props_expect in families:
                d = root / "earth" / "p" / "fem_runs" / physics
                (d / "input").mkdir(parents=True, exist_ok=True)
                (d / "input" / "mesh.msh").write_text("$MeshFormat\n2.2 0 8\n$EndMeshFormat\n")
                (d / "spec.json").write_text(json.dumps({
                    "physics": physics, "dim": 3, "time": {"end": 7, "step": 0.25},
                    "properties": {"solid": {"density": 2700, "young": 5e10, "poisson": 0.25},
                                   "fluid": {"density": 1000, "viscosity": 0.001}}}))
                status, out = c.call("/jobs/gales/prepare",
                                     {"dir": f"earth/p/fem_runs/{physics}", "cores": 3})
                check(f"prepare({physics}) picks its family",
                      status == 200 and out.get("family") in
                      {"solid": "solid_es", "fluid": "fluid_sc", "thermal": "heat_equation"}[physics],
                      str(out)[:70])
                if status != 200:
                    continue
                # The build may fail (no Trilinos here) — generation is the point,
                # and it happens before the job even starts.
                c.wait_job(out["job_id"], timeout=25)
                setup = (d / "setup.txt").read_text() if (d / "setup.txt").exists() else ""
                check(f"prepare({physics}) patches the mesh key and time",
                      f"{mesh_key}" in setup and "mesh_3core.txt" in setup
                      and "0.25" in setup and "7" in setup,
                      " ".join(setup.split()[:6]))
                props = (d / "props.txt").read_text() if (d / "props.txt").exists() else ""
                for key, val in props_expect.items():
                    check(f"prepare({physics}) patches {key}",
                          any(line.split()[:2] == [key, val]
                              for line in props.splitlines() if line.split()),
                          " ".join(props.split()[:8]))
        # ── Atlas: keys are masked, never returned ───────────────────────────
        status, keys = c.call("/atlas/keys")
        check("atlas reports its supported keys",
              status == 200 and set(keys.get("keys", {})) ==
              {"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"},
              str(list(keys.get("keys", {}))))
        check("no provider before a key is set", keys.get("providers") == [])
        # A throwaway value, never a real credential.
        probe_value = "sk-test-DONOTUSE-abcd1234tail"
        status, after = c.call("/atlas/keys/save",
                               {"name": "ANTHROPIC_API_KEY", "value": probe_value})
        entry = after.get("keys", {}).get("ANTHROPIC_API_KEY", {})
        check("saving a key reports it configured", entry.get("configured") is True)
        check("the key is masked to its last four", entry.get("hint") == "••••••tail",
              str(entry.get("hint")))
        # The property that matters most: the value must never come back out.
        check("the key itself is never returned", probe_value not in json.dumps(after))
        check("the provider becomes available", after.get("providers") == ["anthropic"])
        secrets_file = root / ".atlas_secrets.json"
        check("secrets are owner-only on disk",
              secrets_file.exists() and (secrets_file.stat().st_mode & 0o777) == 0o600,
              oct(secrets_file.stat().st_mode & 0o777) if secrets_file.exists() else "missing")
        status, refused = c.call("/atlas/keys/save", {"name": "AWS_SECRET", "value": "x"})
        check("an unsupported key name is refused", status == 400, str(refused)[:60])
        c.call("/atlas/keys/delete", {"name": "ANTHROPIC_API_KEY"})
        _, cleared = c.call("/atlas/keys")
        check("a key can be removed",
              cleared["keys"]["ANTHROPIC_API_KEY"]["configured"] is False)

        # ── the watcher's rules, and its geography ───────────────────────────
        sys.path.insert(0, str(SIDECAR.parent))
        import atlas_watch as aw

        seen = set()
        items = [{"key": "a", "text": "big", "significant": True},
                 {"key": "b", "text": "small", "significant": False}]
        check("a baseline sweep announces nothing", aw.triage(items, seen, True) == [])
        check("a baseline sweep still records", seen == {"a", "b"}, str(seen))
        check("known events never announce again", aw.triage(items, seen, False) == [])
        seen2 = set()
        alerts = aw.triage(items, seen2, False)
        check("only significant new events announce",
              len(alerts) == 1 and alerts[0]["text"] == "big", str(alerts))

        sicily = [13, 36, 16, 39]
        check("a point inside the study area is kept", aw._in_bbox(15.0, 37.5, sicily))
        check("a point outside it is dropped", not aw._in_bbox(-121.0, 38.0, sicily))
        check("no study area means the whole world", aw._in_bbox(-121.0, 38.0, None))
        check("a polygon is placed by its first vertex",
              aw._first_point({"type": "Polygon",
                               "coordinates": [[[15.0, 37.5], [15.1, 37.5]]]}) == (15.0, 37.5))
        check("a geometry-less alert cannot be placed", aw._first_point(None) is None)

        # Chat with no key must fail honestly rather than hang or pretend. (A
        # real call needs a real subscription, so that path is not tested here —
        # this pins the refusal, which is the part that must never regress.)
        status, chat = c.call("/atlas/chat", {"messages": [{"role": "user", "content": "hi"}]})
        check("chat without a key refuses and says why",
              status == 400 and "key" in str(chat.get("error", "")).lower(),
              str(chat)[:80])
        status, chat = c.call("/atlas/chat", {"messages": []})
        check("chat rejects an empty conversation", status == 400, f"HTTP {status}")

        status, watch = c.call("/atlas/watch")
        check("the watcher reports itself idle before it starts",
              status == 200 and watch.get("running") is False, str(watch)[:60])
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    # ── token auth, on a second instance ─────────────────────────────────────
    port2 = free_port()
    # `-u`: the banner carrying the token is printed then the process blocks in
    # serve_forever, so a block-buffered pipe would never deliver that line and
    # the read below would hang forever.
    proc2 = subprocess.Popen(
        [sys.executable, "-u", str(SIDECAR), "--root", str(root), "--port", str(port2)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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
        check("prints a token when one is required", bool(token))
        if token:
            anon = Client(base2, None)
            status, _ = anon.call("/jobs")
            check("refuses an unauthenticated call", status == 401, f"HTTP {status}")
            authed = Client(base2, token)
            status, _ = authed.call("/jobs")
            check("accepts the token", status == 200, f"HTTP {status}")
            status, _ = Client(base2, "wrong-token").call("/jobs")
            check("refuses a wrong token", status == 401, f"HTTP {status}")
    finally:
        proc2.terminate()
        try:
            proc2.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc2.kill()


def main() -> int:
    if not SIDECAR.exists():
        print(f"no sidecar at {SIDECAR}")
        return 1
    root = Path(tempfile.mkdtemp(prefix="geoid-sidecar-test-"))
    try:
        run_tests(root / "geoid_projects")
    finally:
        shutil.rmtree(root, ignore_errors=True)
    print(f"\n{failures} FAILED" if failures
          else f"\nall checks passed{f' ({skipped} skipped)' if skipped else ''}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
