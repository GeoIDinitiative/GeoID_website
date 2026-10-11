/**
 * GEOID CONTROLLER SUPPORT — one shared module, loaded as a plain script.
 *
 *   <script src="/scripts/gamepad.js?v=…" defer></script>
 *
 * It exposes `window.GeoIDPad` and does nothing at all until a controller is
 * connected: no polling, no DOM, no stylesheet. Written for the DualShock 4,
 * and anything else the browser reports with the "standard" mapping works the
 * same way.
 *
 * ONE ENGINE PER PAGE, HOWEVER MANY DOCUMENTS IT IS MADE OF. GeoHUB frames a
 * transit page which frames the viewer, all same-origin. Every one of them
 * may include this file, but only the OUTERMOST same-origin window that has
 * it becomes the engine: it polls the pad, owns the focus ring and the help
 * overlay, reaches into the frames below it for things to focus, and is the
 * only one that talks to the host. A document further in gets a thin proxy
 * with the same API that forwards to that engine. So `GeoIDPad.setMode(…)`
 * from the flight sim inside two iframes and the D-pad walking the site
 * header are the same system with one ring and one announcement.
 *   (The host page must therefore run this file BEFORE its iframes load:
 *   index.html includes it in <head> without `defer`.)
 *
 * WHAT THE PAGE DOES WITH THE PAD
 *   everywhere  D-pad   move the focus ring to the nearest tab in that
 *                       direction (geometry, not DOM order; one press, one
 *                       move; repeat after 350 ms then every 120 ms)
 *               Cross   activate the focused control / open that panel
 *               Circle  back: close help, dialog or popup, step out of a
 *                       panel to its tab, then whatever the page registered
 *               Triangle  the controller map for the current screen
 *   "app" mode  (exploring) NOTHING ELSE. The sticks, the triggers and
 *               L1 / R1 are not read at all: in the Atlas app a desktop
 *               mapper turns them into the pointer, the scroll wheel and
 *               window switching, so the viewer is navigated exactly as
 *               with a mouse. If the page read them too, every movement
 *               would do two things. `axes()` and `value()` return zeros in
 *               this mode, so no consumer can read them by accident either.
 *               Options opens Settings.
 *   "flight"    sticks, triggers and shoulders belong to the sim, which
 *               reads them through `axes()`, `value()` and `pressed()`
 * The touchpad is never read: the operating system delivers it as an
 * ordinary pointer, and the page treats it as one.
 *
 * CONTRACT WITH THE HOST (Atlas). All of it is `window.top.postMessage` with
 * `source: "geoid"`, each mirrored as a CustomEvent on `window`:
 *   {type: "controller-mode", mode: "flight" | "app" | "none"}
 *       on load, on pad connect / disconnect, on every mode change, and
 *       "none" when the page is hidden or unloaded.
 *   {type: "controller-focus-exit", direction, rect: {x, y, w, h}}
 *       a D-pad press found nothing further that way; the ring is released
 *       and D-pad / Cross / Circle go quiet until focus is handed back.
 *   {type: "controller-focus", has: true | false}
 *       whenever ownership of controller focus changes.
 * and the host hands focus back with
 *   {source: "atlas", type: "controller-focus-enter", direction, from}
 * With no host (window.top is this page) the focus simply stops at an edge.
 *
 * TESTS: scripts/gamepad.test.html drives all of the above with a fake
 * `navigator.getGamepads` and a hand-stepped clock (`GeoIDPad._step`).
 */
(function (root) {
  "use strict";
  if (!root || !root.document || root.GeoIDPad) return;

  // ── constants ───────────────────────────────────────────────────────────
  var NAMES = ["cross", "circle", "square", "triangle", "l1", "r1", "l2", "r2",
    "share", "options", "l3", "r3", "up", "down", "left", "right", "ps"];
  var INDEX = {};
  for (var n = 0; n < NAMES.length; n += 1) INDEX[NAMES[n]] = n;
  var DIRS = ["up", "down", "left", "right"];
  var DEAD_ZONE = 0.12;      // radial, per stick
  var EXPO = 1.8;            // response curve: small movements stay small
  var TRIGGER_DEAD = 0.04;
  var REPEAT_FIRST = 350;    // ms before a held D-pad direction repeats
  var REPEAT_NEXT = 120;     // ms between repeats after that
  var INVERT_KEY = "geoid:pad-invert-y";
  var HINT_MS = 6000;

  // ── pure helpers (exported for the tests) ───────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** Scalar dead zone, rescaled so the output still spans 0..1. */
  function deadzone(v, dz) {
    var a = Math.abs(v);
    if (!(a > dz)) return 0;
    return (v < 0 ? -1 : 1) * Math.min(1, (a - dz) / (1 - dz));
  }

  /** Signed power curve. */
  function curve(v, expo) {
    return (v < 0 ? -1 : 1) * Math.pow(Math.min(1, Math.abs(v)), expo);
  }

  /**
   * A stick as a whole: RADIAL dead zone (a per-axis one makes diagonals
   * sticky along the axes), then the curve on the magnitude so direction is
   * preserved exactly.
   */
  function shapeStick(x, y, dz, expo) {
    var m = Math.sqrt(x * x + y * y);
    if (!(m > dz)) return { x: 0, y: 0 };
    var out = Math.pow(Math.min(1, (Math.min(1, m) - dz) / (1 - dz)), expo);
    return { x: (x / m) * out, y: (y / m) * out };
  }

  /**
   * One pad, whatever the browser calls its buttons, as the standard layout:
   * 17 values 0..1 in NAMES order and four stick axes.
   *
   * "standard" is what Chromium reports for a DS4 on Linux, Windows and
   * macOS, and what Firefox reports for the pads it remaps. Anything else
   * with six or more axes is read as the Linux kernel's own DS4 layout
   * (hid-sony / hid-playstation, which is what a browser passes through
   * unmapped on Linux):
   *   buttons 0 Cross 1 Circle 2 Triangle 3 Square 4 L1 5 R1 6 L2 7 R2
   *           8 Share 9 Options 10 PS 11 L3 12 R3
   *   axes    0 LX 1 LY 2 L2 (-1..1) 3 RX 4 RY 5 R2 (-1..1) 6 D-pad X 7 D-pad Y
   * The trigger AXES read 0, i.e. half pressed, until first touched, so they
   * are only believed while the matching trigger BUTTON is down.
   */
  function normalise(gp) {
    var out = { buttons: [], axes: [0, 0, 0, 0] };
    var i;
    for (i = 0; i < NAMES.length; i += 1) out.buttons.push(0);
    if (!gp) return out;
    var b = gp.buttons || [], a = gp.axes || [];
    function val(k) {
      var x = b[k];
      if (x === undefined || x === null) return 0;
      if (typeof x === "number") return x;
      return x.pressed ? Math.max(Number(x.value) || 0, 1) : (Number(x.value) || 0);
    }
    if (gp.mapping !== "standard" && a.length >= 6) {
      var raw = [0, 1, 3, 2, 4, 5, 6, 7, 8, 9, 11, 12];   // standard i <- raw
      for (i = 0; i < raw.length; i += 1) out.buttons[i] = val(raw[i]);
      out.buttons[INDEX.ps] = val(10);
      if (out.buttons[INDEX.l2] > 0) out.buttons[INDEX.l2] = clamp((Number(a[2]) + 1) / 2, 0.05, 1);
      if (out.buttons[INDEX.r2] > 0) out.buttons[INDEX.r2] = clamp((Number(a[5]) + 1) / 2, 0.05, 1);
      var hx = Number(a[6]) || 0, hy = Number(a[7]) || 0;
      out.buttons[INDEX.left] = hx < -0.5 ? 1 : 0;
      out.buttons[INDEX.right] = hx > 0.5 ? 1 : 0;
      out.buttons[INDEX.up] = hy < -0.5 ? 1 : 0;
      out.buttons[INDEX.down] = hy > 0.5 ? 1 : 0;
      out.axes = [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[3]) || 0, Number(a[4]) || 0];
      return out;
    }
    // Index 17 (the touchpad click) is deliberately never read.
    for (i = 0; i < NAMES.length; i += 1) out.buttons[i] = val(i);
    for (i = 0; i < 4; i += 1) out.axes[i] = Number(a[i]) || 0;
    return out;
  }

  function rectGap(a0, a1, b0, b1) {            // distance between two spans
    if (b0 > a1) return b0 - a1;
    if (a0 > b1) return a0 - b1;
    return 0;
  }

  /**
   * The nearest box in a direction. `cur` and each candidate are {x,y,w,h}.
   * A candidate has to lie beyond the current box's centre on the pressed
   * axis, and inside a cone opening from it: something that is mostly
   * SIDEWAYS is not "below", and picking it would feel like a skipped tab.
   * Score is the gap along the axis plus the sideways offset weighted up,
   * so an aligned neighbour always beats a nearer diagonal one.
   */
  function nearest(cur, cands, dir) {
    var horiz = dir === "left" || dir === "right";
    var sign = (dir === "right" || dir === "down") ? 1 : -1;
    var best = null, bestScore = Infinity;
    var ccx = cur.x + cur.w / 2, ccy = cur.y + cur.h / 2;
    for (var i = 0; i < cands.length; i += 1) {
      var c = cands[i];
      var cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      var along = horiz ? (cx - ccx) * sign : (cy - ccy) * sign;
      if (!(along > 0.5)) continue;
      var main, orth;
      if (horiz) {
        main = sign > 0 ? c.x - (cur.x + cur.w) : cur.x - (c.x + c.w);
        orth = rectGap(cur.y, cur.y + cur.h, c.y, c.y + c.h);
      } else {
        main = sign > 0 ? c.y - (cur.y + cur.h) : cur.y - (c.y + c.h);
        orth = rectGap(cur.x, cur.x + cur.w, c.x, c.x + c.w);
      }
      if (main < 0) main = 0;
      if (main === 0 && orth > 0) continue;        // beside it, not beyond it
      if (orth > 0.6 * main + 30) continue;        // outside the cone (about 30° a side)
      var score = main + 2.5 * orth + 0.001 * (Math.abs(cx - ccx) + Math.abs(cy - ccy));
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  var util = {
    NAMES: NAMES, deadzone: deadzone, curve: curve, shapeStick: shapeStick,
    normalise: normalise, nearest: nearest,
    DEAD_ZONE: DEAD_ZONE, EXPO: EXPO, REPEAT_FIRST: REPEAT_FIRST, REPEAT_NEXT: REPEAT_NEXT
  };

  // ── is there an engine above us? ────────────────────────────────────────
  function findHostEngine() {
    var found = null, w = root;
    try {
      while (w.parent && w.parent !== w) {
        w = w.parent;
        try { if (w.GeoIDPad && w.GeoIDPad._engine) found = w.GeoIDPad._engine; } catch (_e) { break; }
      }
    } catch (_e2) { /* cross-origin parent: we are the outermost we can see */ }
    return found;
  }

  var host = findHostEngine();
  if (host) { root.GeoIDPad = makeProxy(host); return; }
  root.GeoIDPad = makeEngine();

  // ════════════════════════════════════════════════════════════════════════
  // PROXY — a framed document's view of the engine above it
  // ════════════════════════════════════════════════════════════════════════
  function makeProxy(E) {
    E.addChild(root);
    var api = {
      _util: util,
      axes: function () { return E.axes(); },
      pressed: function (name) { return E.pressed(name); },
      value: function (name) { return E.value(name); },
      on: function (name, fn) { return E.on(name, fn, root); },
      setMode: function (m) { E.setMode(m, root); },
      onBack: function (fn) { return E.onBack(fn, root); },
      setHelp: function (entries, title) { E.setHelp(entries, title, root); },
      showHelp: function (entries, title) { E.showHelp(entries, title); },
      hideHelp: function () { E.hideHelp(); },
      glyph: function (name) { return E.glyph(name); },
      focus: E.focusApi,
      scan: function () { E.scan(); }
    };
    Object.defineProperty(api, "connected", { get: function () { return E.isConnected(); } });
    Object.defineProperty(api, "mode", { get: function () { return E.modeOf(root); } });
    Object.defineProperty(api, "hasFocus", { get: function () { return E.ownsFocus(); } });
    Object.defineProperty(api, "invertY", {
      get: function () { return E.getInvertY(); },
      set: function (v) { E.setInvertY(v); }
    });
    root.addEventListener("pagehide", function () { E.dropChild(root); });
    return api;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ENGINE
  // ════════════════════════════════════════════════════════════════════════
  function makeEngine() {
    var doc = root.document;
    var nav = root.navigator;

    var connected = false;
    var padIndex = -1;
    var sample = normalise(null);          // last polled state
    var down = [];                         // bool per button, last poll
    var listeners = {};                    // event -> [{fn, owner}]
    var backHandlers = [];                 // [{fn, owner}]
    var modes = [{ win: root, mode: "app", help: null, title: null }];
    var lastAnnounced = null;
    var unloading = false;
    var rafId = 0;
    var lastT = 0;
    var clock = null;                      // set by _step() in tests
    var held = null;                       // {dir, next} for D-pad repeat
    var invertY = false;
    try { invertY = root.localStorage.getItem(INVERT_KEY) === "1"; } catch (_e) { /* private window */ }

    // focus
    var cur = null;                        // focused element (any same-origin document)
    var adjusting = false;                 // Cross on a slider / select: D-pad edits it
    var owns = true;                       // controller focus is ours (vs the host's)
    var hosted = false;                    // is there a host to hand focus to?
    try { hosted = root.top !== root; } catch (_e3) { hosted = true; }
    // Inside the Atlas app the page is a true webview, so window.top IS this
    // window. Atlas's bridge sets __ATLAS_HOST instead, possibly after this
    // file has run, so it is read at the moment it matters, never cached.
    function isHosted() { return hosted || root.__ATLAS_HOST === true; }
    if (isHosted() && root.__ATLAS_HOST_FOCUS === "host") owns = false;
    var padActive = false;                 // ring + hints showing
    var ui = null;                         // {ring, hint, help…} built on first use
    var hintTimer = 0;
    var lastPointer = null;
    var watched = [];                      // windows we listen to for pointer movement

    function now() { return clock !== null ? clock : (root.performance ? root.performance.now() : Date.now()); }

    // ── events ────────────────────────────────────────────────────────────
    function on(name, fn, owner) {
      if (typeof fn !== "function") return function () {};
      var key = String(name);
      var entry = { fn: fn, owner: owner || root };
      (listeners[key] = listeners[key] || []).push(entry);
      return function () {
        var l = listeners[key] || [], i = l.indexOf(entry);
        if (i >= 0) l.splice(i, 1);
      };
    }
    function emit(name, detail) {
      var l = listeners[name];
      if (!l) return;
      l = l.slice();
      for (var i = 0; i < l.length; i += 1) {
        try { l[i].fn(detail); } catch (err) { if (root.console) root.console.error("GeoIDPad listener", err); }
      }
    }
    function onBack(fn, owner) {
      var entry = { fn: fn, owner: owner || root };
      backHandlers.push(entry);
      return function () { var i = backHandlers.indexOf(entry); if (i >= 0) backHandlers.splice(i, 1); };
    }

    // ── mode, and telling the host about it ───────────────────────────────
    function recordFor(win) {
      for (var i = 0; i < modes.length; i += 1) if (modes[i].win === win) return modes[i];
      var r = { win: win, mode: "app", help: null, title: null };
      modes.push(r);
      return r;
    }
    function logicalMode() {
      for (var i = 0; i < modes.length; i += 1) if (modes[i].mode === "flight") return "flight";
      return "app";
    }
    function effectiveMode() {
      if (!connected || unloading || doc.hidden) return "none";
      return logicalMode();
    }
    function post(msg) {
      msg.source = "geoid";
      try { root.top.postMessage(msg, "*"); } catch (_e) { /* detached or blocked */ }
    }
    function mirror(type, detail) {
      for (var i = 0; i < modes.length; i += 1) {
        try { modes[i].win.dispatchEvent(new modes[i].win.CustomEvent(type, { detail: detail })); } catch (_e) { /* frame gone */ }
      }
    }
    function announce(force) {
      var m = effectiveMode();
      if (!force && m === lastAnnounced) return;
      lastAnnounced = m;
      post({ type: "controller-mode", mode: m });
      mirror("geoid:controller-mode", { mode: m });
    }
    function setMode(m, win) {
      if (m !== "flight" && m !== "app") return;
      var r = recordFor(win || root);
      if (r.mode === m) return;
      var before = logicalMode();
      r.mode = m;
      var after = logicalMode();
      // The host hears FIRST: this message is what makes the desktop mapper
      // let go of the sticks (flight) or take them back (app).
      announce(false);
      if (after !== before) {
        if (ui) ui.rootEl.classList.toggle("is-flight", after === "flight");
        if (helpOpen()) openHelp();
        emit("mode", after);
        if (padActive) showHint();
      }
    }
    function addChild(win) { recordFor(win); watch(win); flagDocs(); }
    function dropChild(win) {
      var i, before = logicalMode();
      for (i = modes.length - 1; i >= 0; i -= 1) if (modes[i].win === win && win !== root) modes.splice(i, 1);
      for (var key in listeners) {
        if (!Object.prototype.hasOwnProperty.call(listeners, key)) continue;
        listeners[key] = listeners[key].filter(function (e) { return e.owner !== win; });
      }
      backHandlers = backHandlers.filter(function (e) { return e.owner !== win; });
      if (cur && cur.ownerDocument && cur.ownerDocument.defaultView === win) setCur(null);
      if (logicalMode() !== before) {
        if (ui) ui.rootEl.classList.toggle("is-flight", logicalMode() === "flight");
        emit("mode", logicalMode());
      }
      announce(false);
    }
    function setOwns(v) {
      v = Boolean(v);
      if (owns === v) return;
      owns = v;
      post({ type: "controller-focus", has: owns });
      mirror("geoid:controller-focus", { has: owns });
    }

    // ── the pad ───────────────────────────────────────────────────────────
    function pads() {
      try { return (nav.getGamepads && nav.getGamepads()) || []; } catch (_e) { return []; }
    }
    function usable(gp) {
      return gp && gp.connected !== false && gp.buttons && gp.buttons.length >= 10 && gp.axes && gp.axes.length >= 4;
    }
    function pick() {
      var list = pads(), first = -1;
      if (padIndex >= 0 && usable(list[padIndex])) return list[padIndex];
      padIndex = -1;
      for (var i = 0; i < list.length; i += 1) {
        if (!usable(list[i])) continue;
        if (list[i].mapping === "standard") { padIndex = i; return list[i]; }
        if (first < 0) first = i;
      }
      padIndex = first;
      return first >= 0 ? list[first] : null;
    }
    function scan() {
      var gp = pick();
      if (gp && !connected) {
        connected = true;
        sample = normalise(gp);
        down = sample.buttons.map(function (v) { return v > 0.5; });
        flagDocs();
        emit("connect", { id: gp.id, mapping: gp.mapping });
        if (isHosted()) post({ type: "controller-focus", has: owns });
        announce(true);
        start();
      } else if (!gp && connected) {
        connected = false;
        padIndex = -1;
        sample = normalise(null);
        down = [];
        held = null;
        setActive(false);
        hideHelp();
        flagDocs();
        emit("disconnect");
        announce(true);
        stop();
      }
      return connected;
    }
    function flagDocs() {
      for (var i = 0; i < modes.length; i += 1) {
        try { modes[i].win.document.documentElement.classList.toggle("geoid-pad-on", connected); } catch (_e) { /* gone */ }
      }
    }
    function start() {
      if (rafId || clock !== null) return;
      lastT = 0;
      rafId = root.requestAnimationFrame(frame);
    }
    function stop() {
      if (rafId) root.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    function frame(t) {
      rafId = 0;
      poll(t);
      if (connected && clock === null) rafId = root.requestAnimationFrame(frame);
    }

    /** One tick: read the pad, fire edges, run the built-in behaviour. */
    function poll(t) {
      var gp = pick();
      if (!gp) { scan(); return; }
      if (!connected) { scan(); if (!connected) return; }
      lastT = t;
      var s = normalise(gp);
      sample = s;
      var anyEdge = false, i;
      for (i = 0; i < NAMES.length; i += 1) {
        var isDown = s.buttons[i] > 0.5;
        if (isDown === Boolean(down[i])) continue;
        down[i] = isDown;
        var name = NAMES[i];
        if (isDown) {
          anyEdge = true;
          // While the help overlay is up it owns the buttons: Square there is
          // "invert vertical", and must not also flip the sim's camera.
          if (!helpOpen()) {
            emit(name, { name: name, value: s.buttons[i] });
            emit(name + ":repeat", { name: name, repeat: false });
          }
          builtin(name, t);
        } else {
          emit(name + ":release", { name: name });
          if (held && held.dir === name) held = null;
        }
      }
      // D-pad auto-repeat: one direction at a time, the latest pressed.
      if (held && down[INDEX[held.dir]] && t >= held.next) {
        held.next = t + REPEAT_NEXT;
        emit(held.dir + ":repeat", { name: held.dir, repeat: true });
        dpad(held.dir);
      }
      if (anyEdge && !padActive && owns) setActive(true);
      if (padActive) placeRing();
      if (hintTimer && t >= hintTimer) { hintTimer = 0; if (ui) ui.hint.classList.remove("is-on"); }
    }

    function shaped() {
      var l = shapeStick(sample.axes[0], sample.axes[1], DEAD_ZONE, EXPO);
      var r = shapeStick(sample.axes[2], sample.axes[3], DEAD_ZONE, EXPO);
      return {
        lx: l.x, ly: l.y, rx: r.x, ry: r.y,
        l2: deadzone(sample.buttons[INDEX.l2], TRIGGER_DEAD),
        r2: deadzone(sample.buttons[INDEX.r2], TRIGGER_DEAD)
      };
    }
    var ZERO_AXES = { lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 };
    /**
     * Fresh values for a consumer's own frame loop (the flight sim).
     * FLIGHT ONLY. Outside flight the sticks and triggers are the desktop's
     * pointer and scroll wheel, and this returns zeros the instant the mode
     * leaves "flight": nothing can coast on a last reading.
     */
    function axes() {
      if (!connected || logicalMode() !== "flight") return ZERO_AXES;
      if (clock === null) { var gp = pick(); if (gp) sample = normalise(gp); }
      return shaped();
    }
    function value(name) {
      var i = INDEX[name];
      if (i === undefined || !connected) return 0;
      if (name === "l2" || name === "r2") {
        return logicalMode() === "flight" ? deadzone(sample.buttons[i], TRIGGER_DEAD) : 0;
      }
      return sample.buttons[i];
    }
    function pressed(name) {
      var i = INDEX[name];
      return i !== undefined && connected && sample.buttons[i] > 0.5;
    }

    // ── built-in button behaviour ─────────────────────────────────────────
    function builtin(name, t) {
      if (DIRS.indexOf(name) >= 0) {
        held = { dir: name, next: t + REPEAT_FIRST };
        dpad(name);
        return;
      }
      // While the host owns controller focus the page acts on none of its
      // menu buttons. (PS, button 16, is never acted on in any mode: there is
      // no branch for it here. Atlas uses it for hold-to-talk.)
      if (!owns && (name === "triangle" || name === "options")) return;
      if (name === "triangle") { if (helpOpen()) hideHelp(); else openHelp(); return; }
      if (helpOpen()) {
        if (name === "circle" || name === "cross") hideHelp();
        else if (name === "square") { setInvertY(!invertY); }
        return;
      }
      if (name === "cross") { if (owns) activate(); return; }
      if (name === "circle") { if (owns) back(); return; }
      // Exploring: Options is the only other button the page acts on. L1 / R1,
      // the triggers and the sticks are the host's (window switching, pointer
      // speed, pointer, scroll) and are deliberately not touched.
      if (name === "options" && logicalMode() === "app") clickFirst('[data-pad-options], [data-modebar="settings"]');
    }

    function dpad(dir) {
      if (helpOpen()) { if (dir === "up" || dir === "down") ui.helpBody.scrollTop += dir === "down" ? 80 : -80; return; }
      if (!owns) return;
      setActive(true);
      if (adjusting && cur && cur.isConnected) { adjust(dir); return; }
      move(dir);
    }

    // ── focus: what can be focused ────────────────────────────────────────
    var FOCUSABLE = 'a[href], button, summary, select, textarea, input:not([type="hidden"]), ' +
      '[role="tab"], [role="button"], [role="menuitem"], [role="slider"], [role="switch"], ' +
      '[tabindex]:not([tabindex="-1"]), [data-pad-focus], [data-pad-tab]';
    var SKIP = '[data-pad-skip], [inert], [aria-hidden="true"], .geoid-pad-ui';
    // A panel: its controls are only on offer once its tab is the focus.
    var CONTAINER = 'details, #layer-dock, [data-pad-panel]';
    // The site's own top navigation. Not a side tab: never a target while
    // flying, and otherwise entered only by going UP from the top row.
    var HEADER = 'nav.site-nav, .site-nav, [data-pad-header]';

    function headerOf(c) {
      if (!c) return null;
      if (c.tagName === "DETAILS") {
        for (var k = c.firstElementChild; k; k = k.nextElementSibling) if (k.tagName === "SUMMARY") return k;
        return null;
      }
      if (c.id === "layer-dock") return c.querySelector(".layer-dock-head");
      return c.querySelector("[data-pad-tab]");
    }
    function shown(el) {
      if (el.checkVisibility) {
        return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
      }
      if (!el.getClientRects().length) return false;
      var d = el.closest("details:not([open])");
      return !d || (el.tagName === "SUMMARY" && el.parentElement === d);
    }
    function hits(d, el, x, y) {
      var hit = d.elementFromPoint(x, y);
      if (!hit) return false;
      if (hit === el || el.contains(hit)) return true;
      var label = hit.closest ? hit.closest("label") : null;
      if (label && (label.contains(el) || (el.id && label.htmlFor === el.id))) return true;
      // A control drawn by a sibling (a styled checkbox, a slider thumb).
      return Boolean(el.parentElement && hit.parentElement === el.parentElement &&
        /^(INPUT|SELECT)$/.test(el.tagName));
    }
    function scrollerShows(el, w) {
      for (var p = el.parentElement; p; p = p.parentElement) {
        if (p.scrollHeight <= p.clientHeight + 2 && p.scrollWidth <= p.clientWidth + 2) continue;
        var cs = w.getComputedStyle(p);
        if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) continue;
        var r = p.getBoundingClientRect();
        return r.bottom > 0 && r.right > 0 && r.top < w.innerHeight && r.left < w.innerWidth && r.width > 2 && r.height > 2;
      }
      return false;
    }
    /** Can the user actually get at it: on screen and not under something. */
    function reachable(el, r, d, w, chain) {
      var inView = r.bottom > 1 && r.right > 1 && r.top < w.innerHeight - 1 && r.left < w.innerWidth - 1;
      if (!inView) return scrollerShows(el, w);
      var x0 = Math.max(r.left, 0), x1 = Math.min(r.right, w.innerWidth);
      var y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, w.innerHeight);
      var cy = (y0 + y1) / 2;
      var xs = [(x0 + x1) / 2, x0 + (x1 - x0) * 0.2, x0 + (x1 - x0) * 0.8];
      var ok = -1;
      for (var i = 0; i < xs.length; i += 1) if (hits(d, el, xs[i], cy)) { ok = xs[i]; break; }
      if (ok < 0) return false;
      // …and the frame it lives in must itself be uncovered at that point.
      var px = ok, py = cy;
      for (var c = chain; c; c = c.parent) {
        var fr = c.el.getBoundingClientRect();
        px += fr.left + c.el.clientLeft; py += fr.top + c.el.clientTop;
        var pw = c.doc.defaultView;
        if (px < 0 || py < 0 || px > pw.innerWidth || py > pw.innerHeight) return false;
        if (c.doc.elementFromPoint(px, py) !== c.el) return false;
      }
      return true;
    }
    function walk(d, ox, oy, chain, out) {
      var w = d.defaultView;
      if (!w || !d.body) return;
      watch(w);
      var nodes = d.querySelectorAll(FOCUSABLE + ", iframe");
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i];
        if (el.tagName === "IFRAME") {
          var cd = null;
          try { cd = el.contentDocument; } catch (_e) { cd = null; }
          if (!cd || !cd.body || !shown(el)) continue;
          var fr = el.getBoundingClientRect();
          if (fr.width < 4 || fr.height < 4) continue;
          walk(cd, ox + fr.left + el.clientLeft, oy + fr.top + el.clientTop,
            { el: el, doc: d, parent: chain }, out);
          continue;
        }
        if (el.disabled || el.closest(SKIP) || !shown(el)) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        if (!reachable(el, r, d, w, chain)) continue;
        out.push({ el: el, x: ox + r.left, y: oy + r.top, w: r.width, h: r.height });
      }
    }
    /**
     * Everything focusable, sorted into TABS (primary) and the controls of a
     * panel (secondary). A control inside a <details>, the workspace dock or a
     * [data-pad-panel] belongs to that panel and is only a candidate while the
     * focus is on that panel's tab or already inside it.
     */
    function collect() {
      var items = [];
      walk(doc, 0, 0, null, items);
      var present = [];
      var i;
      for (i = 0; i < items.length; i += 1) present.push(items[i].el);
      for (i = 0; i < items.length; i += 1) {
        var it = items[i], el = it.el;
        it.primary = true; it.scope = null; it.panel = null;
        it.header = Boolean(el.closest(HEADER));
        if (el.tagName === "SUMMARY" && el.parentElement && el.parentElement.tagName === "DETAILS") {
          it.panel = el.parentElement;
          continue;
        }
        var c = el.closest(CONTAINER);
        var h = headerOf(c);
        if (c && h === el) { it.panel = c; continue; }
        if (el.matches('[role="tab"], [data-pad-tab]')) continue;
        if (c && h && present.indexOf(h) >= 0) { it.primary = false; it.scope = c; }
      }
      return items;
    }
    function find(items, el) {
      for (var i = 0; i < items.length; i += 1) if (items[i].el === el) return items[i];
      return null;
    }
    function topRect(el) {
      var r = el.getBoundingClientRect();
      var x = r.left, y = r.top;
      try {
        var w = el.ownerDocument.defaultView;
        while (w && w !== root && w.frameElement) {
          var fr = w.frameElement.getBoundingClientRect();
          x += fr.left + w.frameElement.clientLeft; y += fr.top + w.frameElement.clientTop;
          w = w.parent;
        }
      } catch (_e) { /* detached */ }
      return { x: x, y: y, w: r.width, h: r.height };
    }

    // ── focus: moving it ──────────────────────────────────────────────────
    /**
     * LEFT / RIGHT is between tabs: the candidates are the tabs, plus the
     * controls of the panel the focus is already in (a row of them is still a
     * row). UP / DOWN also walks the controls of whatever panels are open, so
     * an open panel reads top to bottom the way it is laid out. A closed
     * panel's controls are not on the page, so they are never candidates.
     */
    function candidatesFor(items, me, dir) {
      var flying = logicalMode() === "flight";
      var vertical = dir === "up" || dir === "down";
      var scope = me.primary ? me.panel : me.scope;
      return items.filter(function (it) {
        if (it === me) return false;
        if (it.header) {
          // The site header: never while flying; otherwise only UP into it,
          // or along it once the focus is already there.
          if (flying) return false;
          if (!me.header && dir !== "up") return false;
        }
        if (vertical) return true;
        return it.primary || (scope && it.scope === scope);
      });
    }
    var TABLIKE = 'summary, [role="tab"], [data-pad-tab], .layer-dock-head, .tool-rail-btn';
    function tabsFirst(items) {
      var body = items.filter(function (it) { return !it.header; });
      if (body.length || logicalMode() === "flight") items = body;
      var tabs = items.filter(function (it) { return it.primary && it.el.matches(TABLIKE); });
      if (tabs.length) return tabs;
      var prim = items.filter(function (it) { return it.primary; });
      return prim.length ? prim : items;
    }
    /** The innermost document's first tab: the viewer, not the site header. */
    function initial(items) {
      var pool = tabsFirst(items);
      var best = null, depth = -1;
      for (var i = 0; i < pool.length; i += 1) {
        if (pool[i].el.matches("[data-pad-start]")) return pool[i];
        var d = 0, w = pool[i].el.ownerDocument.defaultView;
        try { while (w && w !== root && w.parent !== w) { d += 1; w = w.parent; } } catch (_e) { /* ignore */ }
        if (d > depth) { depth = d; best = pool[i]; }
      }
      return best;
    }
    function move(dir) {
      var items = collect();
      var me = cur ? find(items, cur) : null;
      if (!me) {
        // Nothing focused (first press, or the old target has gone): land.
        var first = initial(items);
        if (first) setCur(first.el);
        return Boolean(first);
      }
      var target = nearest(me, candidatesFor(items, me, dir), dir);
      if (target) { setCur(target.el); return true; }
      if (isHosted()) {
        // The edge of the page: the host's tabs are next.
        var r = me;
        post({ type: "controller-focus-exit", direction: dir,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } });
        mirror("geoid:controller-focus-exit", { direction: dir });
        releaseFocus();
        return false;
      }
      bump();
      return false;
    }
    /** Controller focus goes to the host: no ring, no hints, no overlay. */
    function releaseFocus() {
      held = null;
      setCur(null);
      setActive(false);
      hideHelp();
      setOwns(false);
    }
    /** The host gives focus back: land on the tab nearest where it came from. */
    function enter(direction, from) {
      var items = collect().filter(function (it) { return it.primary; });
      var W = root.innerWidth, H = root.innerHeight;
      var best = null, bestScore = Infinity;
      var f = (from && isFinite(from.x) && isFinite(from.y))
        ? { x: Number(from.x), y: Number(from.y), w: Number(from.w) || 0, h: Number(from.h) || 0 } : null;
      for (var i = 0; i < items.length; i += 1) {
        var it = items[i], score;
        if (it.y + it.h < 0 || it.x + it.w < 0 || it.y > H || it.x > W) continue;
        if (it.header && (logicalMode() === "flight" || direction !== "down")) continue;
        if (f) {
          var gx = rectGap(f.x, f.x + f.w, it.x, it.x + it.w), gy = rectGap(f.y, f.y + f.h, it.y, it.y + it.h);
          score = Math.sqrt(gx * gx + gy * gy);
        } else if (direction === "right") score = it.x + 0.25 * Math.abs(it.y + it.h / 2 - H / 2);
        else if (direction === "left") score = (W - it.x - it.w) + 0.25 * Math.abs(it.y + it.h / 2 - H / 2);
        else if (direction === "down") score = it.y + 0.25 * Math.abs(it.x + it.w / 2 - W / 2);
        else score = (H - it.y - it.h) + 0.25 * Math.abs(it.x + it.w / 2 - W / 2);
        if (score < bestScore) { bestScore = score; best = it; }
      }
      setOwns(true);
      setActive(true);
      if (best) setCur(best.el);
      return best ? best.el : null;
    }

    function setCur(el) {
      if (adjusting) { adjusting = false; }
      cur = el || null;
      if (cur) {
        try { cur.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_e) { /* old engine */ }
      }
      if (ui) {
        ui.ring.classList.remove("is-adjust");
        placeRing();
      }
      emit("focus", cur);
    }
    function activate() {
      if (!cur || !cur.isConnected) { move("down"); return; }
      setActive(true);
      var tag = cur.tagName;
      var type = (cur.getAttribute("type") || "").toLowerCase();
      if (tag === "SELECT" || (tag === "INPUT" && type === "range") || cur.getAttribute("role") === "slider") {
        adjusting = !adjusting;
        if (ui) ui.ring.classList.toggle("is-adjust", adjusting);
        showHint();
        return;
      }
      pulse();
      if (tag === "TEXTAREA" || (tag === "INPUT" && !/^(checkbox|radio|button|submit|reset|file|color)$/.test(type))) {
        try { cur.focus({ preventScroll: true }); } catch (_e) { /* ignore */ }
        return;
      }
      var el = cur;
      var wasClosed = tag === "SUMMARY" && el.parentElement && !el.parentElement.open;
      el.click();
      if (wasClosed) {
        // Cross on a closed tab opens it AND steps inside.
        root.setTimeout(function () {
          if (cur !== el || !el.parentElement || !el.parentElement.open) return;
          var items = collect(), me = find(items, el);
          if (!me) return;
          var inside = items.filter(function (it) { return it.scope === me.panel && !el.contains(it.el); });
          var first = nearest(me, inside, "down") || inside[0];
          if (first) setCur(first.el);
        }, 90);
      }
    }
    function adjust(dir) {
      var el = cur, w = el.ownerDocument.defaultView;
      var fire = function () {
        el.dispatchEvent(new w.Event("input", { bubbles: true }));
        el.dispatchEvent(new w.Event("change", { bubbles: true }));
      };
      if (el.tagName === "SELECT") {
        var step = (dir === "down" || dir === "right") ? 1 : -1;
        var i = el.selectedIndex + step;
        while (i >= 0 && i < el.options.length && el.options[i].disabled) i += step;
        if (i < 0 || i >= el.options.length) { bump(); return; }
        el.selectedIndex = i;
        fire();
        return;
      }
      if (el.tagName === "INPUT") {
        var min = el.min === "" ? 0 : Number(el.min), max = el.max === "" ? 100 : Number(el.max);
        var st = Number(el.step);
        if (!(st > 0)) st = (max - min) / 20 || 1;
        var before = Number(el.value);
        var v = clamp(before + ((dir === "right" || dir === "up") ? st : -st), min, max);
        if (v === before) { bump(); return; }
        el.value = String(v);
        fire();
        return;
      }
      // role="slider": it already answers the arrow keys.
      var key = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[dir];
      el.dispatchEvent(new w.KeyboardEvent("keydown", { key: key, code: key, bubbles: true }));
    }

    // ── Circle ────────────────────────────────────────────────────────────
    var CLOSABLE = 'dialog[open], [role="dialog"], [role="menu"], .profile-modal, .metadata-modal, ' +
      '.scene-popup, .geo-popup, .gis-side-panel, [data-pad-closable]';
    var CLOSER = '[data-pad-close], [aria-label="Close" i], [aria-label^="Close " i], [title="Close" i], ' +
      'button[id$="-close"], button[class*="close"]';
    function eachDoc(d, fn) {
      if (!d || !d.body) return;
      fn(d);
      var frames = d.querySelectorAll("iframe");
      for (var i = 0; i < frames.length; i += 1) {
        var cd = null;
        try { cd = frames[i].contentDocument; } catch (_e) { cd = null; }
        if (cd) eachDoc(cd, fn);
      }
    }
    function closeTopmost() {
      var open = [];
      eachDoc(doc, function (d) {
        var list = d.querySelectorAll(CLOSABLE);
        for (var i = 0; i < list.length; i += 1) {
          var box = list[i];
          if (box.closest(".geoid-pad-ui") || !shown(box)) continue;
          var r = box.getBoundingClientRect();
          if (r.width < 3 || r.height < 3) continue;
          var btns = box.querySelectorAll(CLOSER), btn = null;
          for (var k = 0; k < btns.length; k += 1) if (shown(btns[k]) && !btns[k].disabled) { btn = btns[k]; break; }
          if (!btn && box.tagName !== "DIALOG") continue;
          open.push({ box: box, btn: btn });
        }
      });
      if (!open.length) return false;
      // The one the focus is in; failing that, the last opened (document order).
      var found = open[open.length - 1];
      for (var j = open.length - 1; j >= 0; j -= 1) if (cur && open[j].box.contains(cur)) { found = open[j]; break; }
      if (found.btn) found.btn.click(); else found.box.close();
      if (cur && found.box.contains(cur)) setCur(null);
      return true;
    }
    function back() {
      if (adjusting) { adjusting = false; if (ui) ui.ring.classList.remove("is-adjust"); showHint(); return; }
      if (closeTopmost()) return;
      var items = null, me = null;
      if (cur && cur.isConnected) { items = collect(); me = find(items, cur); }
      if (me && !me.primary && me.scope) {
        // Inside a panel: step back out to its tab.
        var h = headerOf(me.scope);
        if (h) { setActive(true); setCur(h); return; }
      }
      var list = backHandlers.slice();
      for (var i = list.length - 1; i >= 0; i -= 1) {
        try { if (list[i].fn() === true) return; } catch (err) { if (root.console) root.console.error("GeoIDPad back", err); }
      }
      // On the tab of an open panel: close it.
      if (me && me.panel && me.panel.tagName === "DETAILS" && me.panel.open && !me.panel.hasAttribute("data-pad-noclose")) {
        me.panel.open = false;
        return;
      }
      if (cur) bump();
    }

    // ── exploring: Options ────────────────────────────────────────────────
    function clickFirst(selector) {
      var done = false;
      eachDoc(doc, function (d) {
        if (done) return;
        var list = d.querySelectorAll(selector);
        for (var i = 0; i < list.length; i += 1) {
          if (!shown(list[i]) || list[i].disabled) continue;
          list[i].click(); done = true; return;
        }
      });
      return done;
    }
    // ── the ring, the hints and the help overlay ──────────────────────────
    var SHAPES = {
      cross: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
      circle: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.6"/></svg>',
      square: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="3.6" width="8.8" height="8.8"/></svg>',
      triangle: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2l5 9.2H3z"/></svg>',
      dpad: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z"/></svg>',
      "dpad-lr": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z"/><path class="f" d="M2.6 6.6h3v2.8h-3zM10.4 6.6h3v2.8h-3z"/></svg>',
      "dpad-ud": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4v4h4v4h-4v4H6v-4H2V6h4z"/><path class="f" d="M6.6 2.6h2.8v3H6.6zM6.6 10.4h2.8v3H6.6z"/></svg>'
    };
    var WORDS = { l1: "L1", r1: "R1", l2: "L2", r2: "R2", l3: "L3", r3: "R3", ls: "L", rs: "R",
      options: "Options", share: "Share", ps: "PS", touchpad: "Touchpad" };
    var SPOKEN = { cross: "Cross", circle: "Circle", square: "Square", triangle: "Triangle",
      dpad: "D-pad", "dpad-lr": "D-pad left / right", "dpad-ud": "D-pad up / down",
      ls: "Left stick", rs: "Right stick" };
    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; });
    }
    /** Markup for one control, e.g. glyph("cross") or glyph("l1"). */
    function glyph(name) {
      var key = String(name);
      var say = SPOKEN[key] || WORDS[key] || key;
      if (SHAPES[key]) return '<span class="geoid-pad-glyph is-shape" role="img" aria-label="' + esc(say) + '">' + SHAPES[key] + "</span>";
      var stick = key === "ls" || key === "rs";
      return '<span class="geoid-pad-glyph' + (stick ? " is-stick" : "") + '"' +
        (stick ? ' role="img" aria-label="' + esc(say) + '"' : "") + ">" + esc(WORDS[key] || key) + "</span>";
    }
    function glyphs(control) {
      return String(control).split(/\s+/).filter(Boolean).map(function (part) {
        return part === "+" || part === "/" ? '<span class="geoid-pad-join">' + part + "</span>" : glyph(part);
      }).join("");
    }

    function build() {
      if (ui || !doc.body) return ui;
      // The stylesheet rides on this script's own URL, stamp included, so it
      // can never be a deploy behind the code that needs it.
      if (!doc.getElementById("geoid-pad-css")) {
        var src = "";
        var tags = doc.getElementsByTagName("script");
        for (var i = 0; i < tags.length; i += 1) if (/\/scripts\/gamepad\.js(\?|$)/.test(tags[i].src)) src = tags[i].src;
        var link = doc.createElement("link");
        link.id = "geoid-pad-css";
        link.rel = "stylesheet";
        link.href = src ? src.replace(/\/scripts\/gamepad\.js/, "/styles/gamepad.css") : "/styles/gamepad.css";
        // Nothing is drawn until the rules have arrived: an unstyled ring is
        // a stray box at the foot of the page.
        var styled = function () { if (ui) { ui.rootEl.hidden = false; placeRing(); } };
        link.addEventListener("load", styled);
        link.addEventListener("error", styled);
        doc.head.appendChild(link);
      }
      var rootEl = doc.createElement("div");
      rootEl.hidden = !doc.getElementById("geoid-pad-css").sheet;
      rootEl.className = "geoid-pad-ui";
      rootEl.setAttribute("data-pad-skip", "");
      rootEl.innerHTML =
        '<div class="geoid-pad-ring" aria-hidden="true" hidden><i></i><i></i><i></i><i></i></div>' +
        '<div class="geoid-pad-hint" aria-hidden="true"></div>' +
        '<div class="geoid-pad-help" role="dialog" aria-modal="true" aria-labelledby="geoid-pad-help-title" hidden>' +
          '<div class="geoid-pad-help-card">' +
            '<header class="geoid-pad-help-head">' +
              '<div><p class="geoid-pad-help-eyebrow">Controller</p>' +
              '<h2 id="geoid-pad-help-title"></h2></div>' +
              '<button type="button" class="geoid-pad-help-close" aria-label="Close controller help">' + glyph("circle") + "<span>Close</span></button>" +
            "</header>" +
            '<div class="geoid-pad-help-body"></div>' +
            '<footer class="geoid-pad-help-foot">' +
              '<button type="button" class="geoid-pad-help-invert">' + glyph("square") + '<span></span></button>' +
              '<span class="geoid-pad-help-note">The touchpad is the pointer, as usual.</span>' +
            "</footer>" +
          "</div>" +
        "</div>";
      doc.body.appendChild(rootEl);
      ui = {
        rootEl: rootEl,
        ring: rootEl.querySelector(".geoid-pad-ring"),
        hint: rootEl.querySelector(".geoid-pad-hint"),
        help: rootEl.querySelector(".geoid-pad-help"),
        helpTitle: rootEl.querySelector("#geoid-pad-help-title"),
        helpBody: rootEl.querySelector(".geoid-pad-help-body"),
        invert: rootEl.querySelector(".geoid-pad-help-invert")
      };
      rootEl.classList.toggle("is-flight", logicalMode() === "flight");
      rootEl.querySelector(".geoid-pad-help-close").addEventListener("click", hideHelp);
      ui.invert.addEventListener("click", function () { setInvertY(!invertY); });
      ui.help.addEventListener("click", function (e) { if (e.target === ui.help) hideHelp(); });
      doc.addEventListener("keydown", function (e) { if (e.key === "Escape" && helpOpen()) { e.stopPropagation(); hideHelp(); } }, true);
      return ui;
    }
    function placeRing() {
      if (!ui) return;
      if (!padActive || !cur || !cur.isConnected || !owns) { ui.ring.hidden = true; return; }
      var r = topRect(cur);
      if (r.w < 1 && r.h < 1) { ui.ring.hidden = true; return; }
      var pad = 4;
      var st = ui.ring.style;
      ui.ring.hidden = false;
      st.transform = "translate(" + Math.round(r.x - pad) + "px," + Math.round(r.y - pad) + "px)";
      st.width = Math.round(r.w + pad * 2) + "px";
      st.height = Math.round(r.h + pad * 2) + "px";
      var rad = 0;
      try { rad = parseFloat(cur.ownerDocument.defaultView.getComputedStyle(cur).borderTopLeftRadius) || 0; } catch (_e) { rad = 0; }
      st.borderRadius = Math.min(rad + pad, (r.h + pad * 2) / 2) + "px";
    }
    function restart(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth;                  // restart the keyframes
      el.classList.add(cls);
    }
    function pulse() { if (ui && !ui.ring.hidden) restart(ui.ring, "is-pulse"); }
    function bump() { if (ui && !ui.ring.hidden) restart(ui.ring, "is-bump"); }
    function showHint() {
      if (!build()) return;
      var flight = logicalMode() === "flight";
      var parts = adjusting
        ? [["dpad", "Adjust"], ["cross", "Done"]]
        : [["dpad", "Tabs"], ["cross", "Select"], ["circle", flight ? "Control Centre / back" : "Back"],
          ["triangle", flight ? "Flying controls" : "Exploring controls"]];
      ui.hint.innerHTML = parts.map(function (p) { return "<span>" + glyph(p[0]) + "<b>" + esc(p[1]) + "</b></span>"; }).join("");
      ui.hint.classList.add("is-on");
      hintTimer = now() + HINT_MS;
    }
    /** The ring and hints appear with the first pad input, go with the mouse. */
    function setActive(v) {
      v = Boolean(v) && connected;
      if (v === padActive) { if (v) showHint(); return; }
      padActive = v;
      if (v) { build(); showHint(); }
      if (ui) {
        ui.rootEl.classList.toggle("is-active", v);
        if (!v) { ui.hint.classList.remove("is-on"); hintTimer = 0; }
        placeRing();
      }
    }
    function pointerSeen(e) {
      if (!padActive) return;
      if (e.type === "pointermove" || e.type === "mousemove") {
        var p = { x: e.screenX, y: e.screenY };
        var last = lastPointer;
        lastPointer = p;
        if (!last || (Math.abs(p.x - last.x) < 4 && Math.abs(p.y - last.y) < 4)) return;
      }
      // In flight the pointer is the pad's own touchpad as often as not, and
      // it must not cost the pilot the ring.
      if (logicalMode() === "flight") return;
      setActive(false);
    }
    function watch(w) {
      if (!w || watched.indexOf(w) >= 0) return;
      watched.push(w);
      try {
        w.addEventListener("pointermove", pointerSeen, { passive: true });
        w.addEventListener("pointerdown", pointerSeen, { passive: true });
        w.addEventListener("pagehide", function () {
          var i = watched.indexOf(w);
          if (i >= 0) watched.splice(i, 1);
        });
      } catch (_e) { /* frame gone */ }
    }

    // help
    // Two modes, two maps, and the overlay always says which one is live.
    var EXPLORE_HELP = [
      { control: "dpad", text: "Jump to the nearest side tab in that direction" },
      { control: "cross", text: "Select, or open the focused panel and step inside" },
      { control: "circle", text: "Back: close the dialog, step out of the panel, close the tab" },
      { control: "options", text: "Settings" },
      { control: "triangle", text: "Show or hide this map" },
      { heading: "Not read by the page" },
      { control: "ls", text: "The pointer, when a controller mapper is running (Atlas)", unused: true },
      { control: "rs", text: "Scrolls and zooms like the mouse wheel, with a mapper", unused: true },
      { control: "l2 / r2", text: "Slow / fast pointer, with a mapper", unused: true },
      { control: "l1 / r1", text: "Previous / next window in Atlas", unused: true },
      { control: "touchpad", text: "The pointer, as on any desktop", unused: true }
    ];
    function helpOpen() { return Boolean(ui && !ui.help.hidden); }
    /** A page that can fly registers its FLYING map here (the sim does). */
    function setHelp(entries, title, win) {
      var r = recordFor(win || root);
      r.help = entries || null;
      r.title = title || null;
    }
    function rowsHtml(entries) {
      return entries.map(function (e) {
        if (e.heading) return '<h4 class="geoid-pad-help-group">' + esc(e.heading) + "</h4>";
        return '<div class="geoid-pad-help-row' + (e.unused ? " is-unused" : "") + '"><span class="geoid-pad-help-keys">' +
          glyphs(e.control) + '</span><span class="geoid-pad-help-text">' + esc(e.text) + "</span></div>";
      }).join("");
    }
    function sectionHtml(name, note, entries, live) {
      return '<section class="geoid-pad-help-map' + (live ? " is-live" : "") + '">' +
        '<h3 class="geoid-pad-help-mode"><span>' + esc(name) + "</span>" +
        '<em>' + esc(live ? "Active now" : note) + "</em></h3>" + rowsHtml(entries) + "</section>";
    }
    function openHelp() {
      if (!build()) return;
      var flightRec = null, i;
      for (i = 0; i < modes.length; i += 1) {
        if (!modes[i].help) continue;
        if (!flightRec || modes[i].mode === "flight") flightRec = modes[i];
      }
      var flying = flightRec ? (typeof flightRec.help === "function" ? flightRec.help() : flightRec.help) : null;
      var inFlight = logicalMode() === "flight";
      var html = "";
      var explore = sectionHtml("Exploring", "When you are not flying", EXPLORE_HELP, !inFlight);
      var fly = flying ? sectionHtml("Flying", "In the flight simulator", flying, inFlight) : "";
      html = inFlight ? fly + explore : explore + fly;
      present(inFlight ? "Flying" : "Exploring", html);
    }
    /** Show a map of your own: entries are {control, text} or {heading}. */
    function showHelp(entries, title) {
      if (!build()) return;
      present(title || "Controls", '<section class="geoid-pad-help-map is-live">' + rowsHtml(entries || EXPLORE_HELP) + "</section>");
    }
    function present(title, html) {
      ui.helpTitle.textContent = title;
      ui.helpBody.innerHTML = html;
      syncInvert();
      ui.help.hidden = false;
      ui.helpBody.scrollTop = 0;          // after it is shown: a hidden box cannot scroll
      emit("help", true);
    }
    function hideHelp() {
      if (!helpOpen()) return;
      ui.help.hidden = true;
      emit("help", false);
    }
    function syncInvert() {
      if (ui) ui.invert.lastChild.textContent = "Invert vertical: " + (invertY ? "on" : "off");
    }
    function setInvertY(v) {
      invertY = Boolean(v);
      try { root.localStorage.setItem(INVERT_KEY, invertY ? "1" : "0"); } catch (_e) { /* private window */ }
      syncInvert();
      emit("invert", invertY);
    }

    // ── lifecycle ─────────────────────────────────────────────────────────
    root.addEventListener("gamepadconnected", function () { scan(); });
    root.addEventListener("gamepaddisconnected", function () { padIndex = -1; scan(); });
    doc.addEventListener("visibilitychange", function () {
      announce(false);
      if (!doc.hidden && connected) { lastT = 0; start(); }
    });
    root.addEventListener("pagehide", function () { unloading = true; announce(false); });
    root.addEventListener("pageshow", function () { if (unloading) { unloading = false; announce(false); } });
    root.addEventListener("message", function (e) {
      var m = e.data;
      if (!m || m.source !== "atlas") return;
      if (m.type !== "controller-focus-enter" && m.type !== "controller-hello" && m.type !== "controller-focus-leave") return;
      var from = null;
      try { from = e.source; } catch (_e) { from = null; }
      var okSource = false;
      try { okSource = from === root.top || from === root.parent || from === root; } catch (_e2) { okSource = false; }
      if (!okSource) return;
      hosted = true;                       // a host that speaks the contract is a host
      if (m.type === "controller-focus-leave") {
        // The host took focus back unasked. Quiet, and say so; no focus-exit.
        releaseFocus();
        return;
      }
      if (m.type === "controller-hello") {
        // Sent when the tile is ready and after each navigation. Whatever we
        // announced before may have gone to nobody, so say it all again.
        if (m.owner === "atlas") releaseFocus();
        else if (m.owner === "page") setOwns(true);
        announce(true);
        post({ type: "controller-focus", has: owns });
        mirror("geoid:controller-focus", { has: owns });
        return;
      }
      if (!connected) scan();
      enter(m.direction, m.from || null);
    });
    watch(root);

    function init() {
      scan();
      if (!connected) announce(true);      // "none": the host hears from every page load
    }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
    else init();

    // ── public face ───────────────────────────────────────────────────────
    var focusApi = {
      current: function () { return cur; },
      to: function (el) { if (typeof el === "string") el = doc.querySelector(el); if (el) { setActive(true); setCur(el); } return el || null; },
      /** Focus the first tab inside `scope` (an element in any framed document). */
      first: function (scope) {
        var items = collect().filter(function (it) { return !scope || scope.contains(it.el); });
        var pickIt = tabsFirst(items)[0];
        if (pickIt) { setActive(true); setCur(pickIt.el); }
        return pickIt ? pickIt.el : null;
      },
      move: function (dir) { return move(dir); },
      clear: function () { setCur(null); },
      list: function () { return collect(); }
    };

    var engine = {
      addChild: addChild, dropChild: dropChild,
      axes: axes, pressed: pressed, value: value, on: on, onBack: onBack,
      setMode: setMode, setHelp: setHelp, showHelp: showHelp, hideHelp: hideHelp, glyph: glyph,
      focusApi: focusApi, scan: scan,
      isConnected: function () { return connected; },
      modeOf: function () { return logicalMode(); },
      ownsFocus: function () { return owns; },
      getInvertY: function () { return invertY; },
      setInvertY: setInvertY
    };

    var api = {
      _engine: engine,
      _util: util,
      axes: axes, pressed: pressed, value: value,
      on: function (name, fn) { return on(name, fn, root); },
      setMode: function (m) { setMode(m, root); },
      onBack: function (fn) { return onBack(fn, root); },
      setHelp: function (entries, title) { setHelp(entries, title, root); },
      showHelp: showHelp, hideHelp: hideHelp, glyph: glyph,
      focus: focusApi,
      scan: scan,
      /** Tests: advance the engine to time `t` (ms) with no real clock. */
      _step: function (t) { stop(); clock = t; if (!connected) scan(); poll(t); },
      _realtime: function () { clock = null; lastT = 0; if (connected) start(); },
      _state: function () {
        return { connected: connected, mode: logicalMode(), announced: lastAnnounced, owns: owns,
          hosted: isHosted(), active: padActive, adjusting: adjusting, help: helpOpen(), polling: Boolean(rafId) };
      },
      _setHosted: function (v) { hosted = Boolean(v); }
    };
    Object.defineProperty(api, "connected", { get: function () { return connected; } });
    Object.defineProperty(api, "mode", { get: logicalMode });
    Object.defineProperty(api, "hasFocus", { get: function () { return owns; } });
    Object.defineProperty(api, "invertY", { get: function () { return invertY; }, set: setInvertY });
    return api;
  }
})(typeof window !== "undefined" ? window : null);
