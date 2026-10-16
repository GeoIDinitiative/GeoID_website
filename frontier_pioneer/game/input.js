/**
 * Keyboard, mouse, touch and the PS4 controller, reduced to one control
 * state the game reads each frame, and a set of named actions.
 *
 * THE CONTROLLER goes through the site's shared module, window.GeoIDPad
 * (/scripts/gamepad.js): this file never calls navigator.getGamepads itself.
 * While the player is driving the module is in its "flight" mode, which is
 * what makes the owner's desktop mapper let go of the sticks; in every menu
 * it is back in "app" mode, where the module's own D-pad / Cross / Circle
 * navigation walks the buttons. The game sets the mode (main.js, syncPadMode)
 * and this file only reads.
 *
 * THE DRIVING MAP
 *   Left stick X   steer                    R2  accelerate (analogue)
 *   Right stick    camera orbit / look      L2  brake, then reverse (analogue)
 *   R1  handbrake (hold)                    L1  low range: crawl with traction control (hold)
 *   Square   chase / mast camera            Triangle  controller map (the module's overlay)
 *   Circle   game menu, and back            Cross     interact / confirm
 *   Options  pause                          L3 right the rover     R3 recentre the camera
 *   D-pad    up headlights, right time warp, down show the objective
 *   Share    hide / show the whole interface (screenshots; F1 on the keyboard)
 *   PS and the touchpad are never read.
 *
 * Throttle is on the triggers and NOT on the left stick's Y: on rough ground
 * the steering thumb gets jolted, and a stick that also sets speed turns
 * every bump into a lurch. It also matches the site's flight map, where R2 is
 * "go" and L2 is "slower".
 * L1 is low range rather than a boost: what the terrain asks for is torque
 * and grip on a loose slope, not more speed than the suspension can carry.
 */

export const DRIVING_HELP = [
  { control: "ls", text: "Steer (left / right)" },
  { control: "r2", text: "Accelerate: squeeze for more" },
  { control: "l2", text: "Brake; held at a standstill, reverse" },
  { control: "r1", text: "Handbrake, while held" },
  { control: "l1", text: "Low range: slow, high torque, traction control, while held" },
  { control: "rs", text: "Orbit the camera (chase) or look around (mast)" },
  { control: "square", text: "Camera: chase / mast" },
  { control: "r3", text: "Recentre the camera" },
  { control: "l3", text: "Right the rover where it stands (when stopped, stuck or tipped)" },
  { control: "cross", text: "Interact / confirm" },
  { control: "l1 r1", text: "Both held at a standstill: step outside on foot" },
  { control: "options", text: "Pause / resume" },
  { heading: "Quick slots" },
  { control: "dpad-ud", text: "Up: headlights. Down: show the objective" },
  { control: "right", text: "Time warp" },
  { heading: "Menus" },
  { control: "circle", text: "Open the game menu; with anything open, back / close" },
  { control: "dpad", text: "In a menu: move to the nearest button in that direction" },
  { control: "triangle", text: "Show or hide this map" },
  { control: "share", text: "Hide / show the whole interface (for screenshots)" },
  { heading: "Not used" },
  { control: "ps", text: "Never read by the game", unused: true },
  { control: "touchpad", text: "Not read: it stays the pointer", unused: true },
];

export const KEYBOARD_HELP = [
  ["W / Up", "Accelerate"], ["S / Down", "Brake, then reverse"], ["A D / Left Right", "Steer"],
  ["Space", "Handbrake"], ["Shift", "Low range (crawl)"], ["Mouse drag", "Orbit the camera / look"], ["Wheel", "Zoom the chase camera"],
  ["C", "Camera: chase / mast"], ["V", "Recentre the camera"], ["R", "Right the rover"], ["E", "Interact; held at a standstill, step outside on foot"],
  ["L", "Headlights"], ["T", "Time warp"], ["O", "Show the objective"],
  ["P", "Pause"], ["Esc / M", "Game menu"], ["H", "This help"], ["K", "Hazard map overlay"], ["F1", "Hide / show the whole interface (screenshots)"],
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false, crawl: false };
    this.look = { x: 0, y: 0 };
    this.drag = { x: 0, y: 0 };
    this.zoom = 1;
    this.enabled = false;                 // driving input is read only while the game says so
    this.handlers = Object.create(null);
    this._steerKey = 0;
    this.lastDevice = "keyboard";
    this._wire();
  }

  on(action, fn) { this.handlers[action] = fn; }
  fire(action) { const f = this.handlers[action]; if (f) f(); }
  get pad() { return window.GeoIDPad || null; }
  get padConnected() { const P = this.pad; return !!(P && P.connected); }

  _wire() {
    const KEYMAP = { KeyC: "camera", KeyV: "recentre", KeyR: "recover", KeyE: "interact", KeyL: "lights",
      KeyT: "warp", KeyO: "objective", KeyP: "pause", Escape: "menu", KeyM: "menu", KeyH: "help", KeyK: "hazardmap", F1: "hidehud" };
    window.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys[e.code] = true;
      this.lastDevice = "keyboard";
      if (/^Arrow|Space/.test(e.code) && this.enabled) e.preventDefault();
      if (!e.repeat && KEYMAP[e.code]) { this.fire(KEYMAP[e.code]); if (e.code !== "Escape") e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    window.addEventListener("blur", () => { for (const k in this.keys) this.keys[k] = false; });

    // Mouse-look by drag only. Never pointer lock.
    const c = this.canvas;
    let dragging = null;
    c.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      this.drag.x += (e.clientX - dragging.x) * 0.005;
      this.drag.y += (e.clientY - dragging.y) * 0.004;
      dragging.x = e.clientX; dragging.y = e.clientY;
    });
    const end = (e) => { if (dragging && e.pointerId === dragging.id) dragging = null; };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("wheel", (e) => { this.zoom *= e.deltaY > 0 ? 1.1 : 0.9; e.preventDefault(); }, { passive: false });

    // Touch buttons: every one drives the same `keys` map the keyboard does.
    document.querySelectorAll("[data-key]").forEach((el) => {
      const code = el.dataset.key;
      const down = (e) => { this.keys[code] = true; el.classList.add("is-down"); this.lastDevice = "touch"; e.preventDefault(); };
      const up = () => { this.keys[code] = false; el.classList.remove("is-down"); };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up); el.addEventListener("pointerleave", up); el.addEventListener("pointercancel", up);
    });
    document.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", (e) => { e.preventDefault(); this.fire(el.dataset.action); el.blur?.(); });
    });

    // The controller's buttons, through the shared module. Edge-detected there.
    const P = this.pad;
    if (P) {
      const map = { square: "camera", l3: "recover", r3: "recentre", options: "pause", cross: "interact",
        up: "lights", right: "warp", down: "objective", share: "hidehud" };
      for (const b in map) P.on(b, () => { this.lastDevice = "pad"; this.fire("pad:" + map[b]); });
      P.on("connect", () => { this.lastDevice = "pad"; this.fire("device"); });
      P.on("disconnect", () => { this.lastDevice = "keyboard"; this.fire("device"); });
    }
  }

  /** Read everything into this.ctl / this.look. Call once a frame. */
  poll(dt) {
    const k = this.keys, c = this.ctl;
    if (!this.enabled) {
      c.throttle = 0; c.brake = 0; c.steer = 0; c.handbrake = false; c.crawl = false;
      this.look.x = 0; this.look.y = 0; this.drag.x = 0; this.drag.y = 0;
      return c;
    }
    let throttle = k.KeyW || k.ArrowUp ? 1 : 0, brake = k.KeyS || k.ArrowDown ? 1 : 0;
    const want = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    // Keys are binary: ramp the steering so a tap is a nudge and a hold is full lock.
    const rate = want === 0 ? 5 : 2.8;
    this._steerKey += Math.max(-rate * dt, Math.min(rate * dt, want - this._steerKey));
    let steer = this._steerKey;
    let handbrake = !!k.Space, crawl = !!(k.ShiftLeft || k.ShiftRight);
    let lx = 0, ly = 0;
    const P = this.pad;
    if (P && P.connected) {
      const a = P.axes();                      // zeros unless the module is in "flight" mode
      if (Math.abs(a.lx) > Math.abs(steer)) steer = a.lx;
      throttle = Math.max(throttle, a.r2); brake = Math.max(brake, a.l2);
      handbrake = handbrake || P.pressed("r1"); crawl = crawl || P.pressed("l1");
      lx = a.rx; ly = a.ry;
      if (a.r2 > 0.05 || a.l2 > 0.05 || Math.abs(a.lx) > 0.1) this.lastDevice = "pad";
    }
    c.throttle = throttle; c.brake = brake; c.steer = Math.max(-1, Math.min(1, steer)); c.handbrake = handbrake; c.crawl = crawl;
    this.look.x = lx; this.look.y = ly;
    return c;
  }

  /** Mouse drag accumulated since the last call (radians), then cleared. */
  takeDrag(out) { out.x = this.drag.x; out.y = this.drag.y; this.drag.x = 0; this.drag.y = 0; return out; }
  takeZoom() { const z = this.zoom; this.zoom = 1; return z; }
}
