"""Atlas in the sidecar: your own model keys, and a watcher that outlives the tab.

Two things the browser cannot do, both belonging to the process that already
outlives a click.

**Keys.** The procedure is Atlas AI's own (`hub/secrets_config.py`), deliberately
mirrored so the two agree: an allowlist of supported names, a JSON file outside
git at mode 0600, and a status that is **masked** — `••••••` plus the last four
characters, never the value. A key entered here goes to this local process and
stops; it is never written into the static site, never returned to the browser,
and never logged. That is the whole reason the chat call happens here rather
than in the page: a browser cannot hold a secret, and pretending otherwise is
how keys end up in someone's devtools.

Bring your own subscription: Anthropic (Claude), OpenAI (ChatGPT) or Google
(Gemini). Whichever key is present is used; if several are, the caller's
preference wins, else the order below.

**The watcher.** The same three rules the browser watcher proved out, moved
where they can run with every tab closed: the first pass records a baseline and
never announces, only genuinely new events announce, and new is not the same as
significant. `triage` is pure and identical in spirit to `atlas-watch.js`'s — the
pair must change together, which is the cost of the browser being able to watch
too.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# ── Secrets, the Atlas AI way ────────────────────────────────────────────────

SUPPORTED_KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY")
SECRETS_FILE = ".atlas_secrets.json"
_root: Path | None = None


def _secrets_path() -> Path:
    return (_root or Path.home()) / SECRETS_FILE


def _mask(value: str) -> str:
    trimmed = (value or "").strip()
    if not trimmed:
        return ""
    return "••••" if len(trimmed) <= 4 else f"••••••{trimmed[-4:]}"


def load_secrets() -> dict:
    path = _secrets_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_secret(name: str, value: str) -> None:
    if name not in SUPPORTED_KEYS:
        raise ValueError(f"{name} is not a key this service holds. "
                         f"Supported: {', '.join(SUPPORTED_KEYS)}")
    data = load_secrets()
    if value:
        data[name] = value
    else:
        data.pop(name, None)
    path = _secrets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    # Owner-only: this file holds live credentials.
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def effective_secret(name: str) -> str:
    """The stored key, or one already in the environment."""
    return (load_secrets().get(name) or os.environ.get(name, "")).strip()


def key_status() -> dict:
    """What is configured, masked. The value never leaves this process."""
    stored = load_secrets()
    out = {}
    for name in SUPPORTED_KEYS:
        value = (stored.get(name) or os.environ.get(name, "")).strip()
        out[name] = {
            "configured": bool(value),
            "hint": _mask(value),
            "source": "stored" if stored.get(name) else ("environment" if value else ""),
        }
    return {"keys": out, "providers": [p for p, k in PROVIDER_KEY.items()
                                       if effective_secret(k)]}


# ── Providers: bring your own subscription ───────────────────────────────────

PROVIDER_KEY = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
}
DEFAULT_MODEL = {
    "anthropic": "claude-haiku-4-5-20251001",
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.0-flash",
}

SYSTEM = (
    "You are Atlas, the assistant inside the GeoID workspace — a browser GIS "
    "globe, a meshing studio, and a research hub that configures and runs GALES "
    "finite-element simulations. Help the user do geospatial and modelling work: "
    "finding data, defining a study area, meshing, setting up and running a "
    "simulation, extracting probe series and analysing them. Be concise and "
    "concrete. The app state is given as context; rely on it and say when you "
    "are unsure rather than inventing a page or a control."
)


def _post_json(url: str, payload: dict, headers: dict, timeout: float = 60) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        # Never echo the key back, even if a provider quotes the request.
        raise RuntimeError(f"provider returned HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"could not reach the provider: {exc.reason}") from None


def chat(messages: list, context: str = "", provider: str = "", model: str = "") -> dict:
    """One turn against whichever subscription the user has wired in."""
    chosen = provider.strip().lower()
    if chosen and not effective_secret(PROVIDER_KEY.get(chosen, "")):
        raise RuntimeError(f"no key configured for {chosen}")
    if not chosen:
        chosen = next((p for p in PROVIDER_KEY if effective_secret(PROVIDER_KEY[p])), "")
    if not chosen:
        raise RuntimeError(
            "No model key configured. Add one for Claude, ChatGPT or Gemini and "
            "I'll use it — it stays in this local service.")
    key = effective_secret(PROVIDER_KEY[chosen])
    model = model or DEFAULT_MODEL[chosen]
    system = SYSTEM + (f"\n\nCurrent app state:\n{context}" if context else "")
    turns = [m for m in messages if m.get("role") in ("user", "assistant")]

    if chosen == "anthropic":
        data = _post_json(
            "https://api.anthropic.com/v1/messages",
            {"model": model, "max_tokens": 800, "system": system, "messages": turns},
            {"x-api-key": key, "anthropic-version": "2023-06-01"})
        text = "".join(b.get("text", "") for b in data.get("content", []))
    elif chosen == "openai":
        data = _post_json(
            "https://api.openai.com/v1/chat/completions",
            {"model": model, "max_tokens": 800,
             "messages": [{"role": "system", "content": system}, *turns]},
            {"Authorization": f"Bearer {key}"})
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    else:
        contents = [{"role": "model" if m["role"] == "assistant" else "user",
                     "parts": [{"text": m.get("content", "")}]} for m in turns]
        data = _post_json(
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={urllib.parse.quote(key)}",
            {"contents": contents,
             "systemInstruction": {"parts": [{"text": system}]}},
            {})
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)
    return {"text": (text or "").strip(), "provider": chosen, "model": model}


# ── The watcher ──────────────────────────────────────────────────────────────

DEFAULTS = {"intervalMin": 10, "minMagnitude": 4.0,
            "severities": ["Severe", "Extreme"]}


def _get_json(url: str, timeout: float = 25) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                               "User-Agent": "GeoID-Atlas/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _days_ago(days: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() - days * 86400))


def _usgs(bbox, cfg):
    params = {"format": "geojson", "orderby": "time", "limit": "500",
              "starttime": _days_ago(7), "minmagnitude": str(cfg["minMagnitude"])}
    if bbox:
        params.update({"minlatitude": bbox[1], "maxlatitude": bbox[3],
                       "minlongitude": bbox[0], "maxlongitude": bbox[2]})
    url = ("https://earthquake.usgs.gov/fdsnws/event/1/query?"
           + urllib.parse.urlencode({k: str(v) for k, v in params.items()}))
    return [
        {"key": f.get("properties", {}).get("url") or str(f.get("id")),
         "text": f"M{(f.get('properties', {}).get('mag') or 0):.1f} — "
                 f"{f.get('properties', {}).get('place') or 'unknown'}",
         "significant": (f.get("properties", {}).get("mag") or 0) >= cfg["minMagnitude"]}
        for f in _get_json(url).get("features", [])]


def _in_bbox(lon, lat, bbox) -> bool:
    """Whether a point is inside [minLon, minLat, maxLon, maxLat]. No bbox is
    the whole world, which is the honest reading of "no study area set"."""
    if not bbox:
        return True
    try:
        return (bbox[0] <= float(lon) <= bbox[2]
                and bbox[1] <= float(lat) <= bbox[3])
    except (TypeError, ValueError):
        return False


def _first_point(geometry) -> tuple | None:
    """A representative [lon, lat] for any GeoJSON geometry, so a polygon alert
    can be placed as well as a point one."""
    if not isinstance(geometry, dict):
        return None
    coords = geometry.get("coordinates")
    while isinstance(coords, list) and coords and isinstance(coords[0], list):
        coords = coords[0]
    if isinstance(coords, list) and len(coords) >= 2:
        return coords[0], coords[1]
    return None


def _nws(bbox, cfg):
    # NWS has no bbox parameter, so the filter is applied here — otherwise
    # "watching your study area" would announce a flood warning three states
    # away, which is worse than not watching.
    data = _get_json("https://api.weather.gov/alerts/active"
                     "?status=actual&message_type=alert")
    out = []
    for f in data.get("features", []):
        p = f.get("properties", {})
        point = _first_point(f.get("geometry"))
        # An alert with no geometry references zones rather than a shape; it
        # cannot be placed, so it cannot be claimed to be nearby.
        if bbox and (not point or not _in_bbox(point[0], point[1], bbox)):
            continue
        out.append({
            "key": f"{p.get('event')}|{p.get('areaDesc')}|{p.get('effective')}",
            "text": f"{p.get('event')} ({p.get('severity')}) — {p.get('areaDesc') or ''}".strip(),
            "significant": p.get("severity") in cfg["severities"]})
    return out


def _eonet(category):
    def fetch(bbox, cfg):
        url = ("https://eonet.gsfc.nasa.gov/api/v3/events?"
               + urllib.parse.urlencode({"days": "60", "limit": "300",
                                         "status": "open", "category": category}))
        out = []
        for e in _get_json(url).get("events", []):
            # Same reason as NWS: EONET is global, so the study area is applied
            # here, against the event's most recent position.
            geometries = e.get("geometry") or []
            point = _first_point(geometries[-1]) if geometries else None
            if bbox and (not point or not _in_bbox(point[0], point[1], bbox)):
                continue
            out.append({"key": e.get("id") or e.get("title"),
                        "text": e.get("title") or category,
                        "significant": True})
        return out
    return fetch


SOURCES = [("earthquake", _usgs), ("weather alert", _nws),
           ("volcanic event", _eonet("volcanoes")), ("wildfire", _eonet("wildfires"))]


def triage(items: list, seen: set, baseline: bool) -> list:
    """The three rules, pure — the same shape as atlas-watch.js's triage.

    1. a baseline pass records and never announces
    2. an event already seen never announces again
    3. a new event that is not significant never announces
    """
    alerts = []
    for item in items or []:
        key = str(item.get("key") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        if baseline or not item.get("significant"):
            continue
        alerts.append({"text": item["text"], "key": key})
    return alerts


_state = {"running": False, "config": dict(DEFAULTS), "baseline": True,
          "seen": {}, "alerts": [], "last_run": None, "last_error": None,
          "bbox": None}
_thread = None
_stop = threading.Event()


def _state_path() -> Path:
    return (_root or Path.home()) / ".atlas_watch.json"


def _persist():
    try:
        _state_path().write_text(json.dumps({
            "config": _state["config"], "baseline": _state["baseline"],
            "bbox": _state["bbox"],
            "seen": {k: list(v)[-500:] for k, v in _state["seen"].items()},
            "alerts": _state["alerts"][-200:],
        }, indent=2))
    except OSError:
        pass


def _restore():
    try:
        saved = json.loads(_state_path().read_text())
    except (OSError, json.JSONDecodeError):
        return
    _state["config"] = {**DEFAULTS, **(saved.get("config") or {})}
    _state["baseline"] = saved.get("baseline", True)
    _state["bbox"] = saved.get("bbox")
    _state["seen"] = {k: set(v) for k, v in (saved.get("seen") or {}).items()}
    _state["alerts"] = saved.get("alerts") or []


def sweep() -> list:
    cfg = _state["config"]
    bbox = _state["bbox"]
    raised, reachable = [], 0
    for label, fetch in SOURCES:
        seen = _state["seen"].setdefault(label, set())
        try:
            items = fetch(bbox, cfg)
            reachable += 1
        except Exception as exc:   # noqa: BLE001 — one dead feed is not a failure
            _state["last_error"] = f"{label}: {exc}"
            continue
        for alert in triage(items, seen, _state["baseline"]):
            raised.append({"label": label, "text": alert["text"],
                           "at": time.time()})
    if reachable:
        _state["baseline"] = False
    _state["last_run"] = time.time()
    _state["alerts"].extend(raised)
    _persist()
    return raised


def _loop():
    while not _stop.is_set():
        try:
            sweep()
        except Exception as exc:   # noqa: BLE001 — the loop must survive anything
            _state["last_error"] = str(exc)
        _stop.wait(max(1, _state["config"]["intervalMin"]) * 60)


def start(body: dict, root: Path) -> dict:
    global _thread, _root
    _root = root
    _restore()
    for key in ("intervalMin", "minMagnitude", "severities"):
        if body.get(key) not in (None, ""):
            _state["config"][key] = body[key]
    if body.get("bbox"):
        b = body["bbox"]
        _state["bbox"] = [b["minLon"], b["minLat"], b["maxLon"], b["maxLat"]] \
            if isinstance(b, dict) else b
    stop()
    _stop.clear()
    _state["running"] = True
    _thread = threading.Thread(target=_loop, daemon=True)
    _thread.start()
    return status()


def stop() -> None:
    global _thread
    _stop.set()
    _state["running"] = False
    _thread = None


def drain(since: int = 0) -> list:
    """Alerts raised since an index — how a browser that was closed catches up."""
    return _state["alerts"][since:]


def status() -> dict:
    return {
        "running": _state["running"],
        "config": _state["config"],
        "baseline": _state["baseline"],
        "bbox": _state["bbox"],
        "known": sum(len(v) for v in _state["seen"].values()),
        "alerts": len(_state["alerts"]),
        "last_run": _state["last_run"],
        "last_error": _state["last_error"],
        "sources": [label for label, _ in SOURCES],
    }


def configure_root(root: Path) -> None:
    global _root
    _root = root
    _restore()
