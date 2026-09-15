/**
 * THE MASTER KEY, FOR WORKING ON THE SITE WITH EVERY GATE ON.
 *
 * Membership's development unlock (`localStorage["geoid:unlock"] = "owner"`)
 * has existed since the gates did, and it was only ever set from a console:
 * the people building the site need the live member functions — the gated
 * risk maps, the billed Earth Engine service, the downloads — working in
 * their own browser without a sign-in service, and a key typed in devtools
 * is a key nobody remembers to keep or to clear. This card, in Settings,
 * is the door: enter the key and this browser is the master account until
 * "Lock again", and the credentials the wipe would otherwise clear (the
 * Earth Engine endpoint, the sidecar, the Atlas hub) stay stored.
 *
 * "Wipe everything before going live" is the other half, and it is why the
 * key has a card at all: a machine used for testing must leave with nothing
 * — the unlock, the endpoint, the sidecar token, the hub address — and a
 * button that does all of it is the only version that gets pressed.
 *
 * What this does NOT weaken: every browser-side gate is a courtesy (the
 * membership module's own header says so) and the gate that is enforced is
 * at the bucket, which never reads this key. The key is a fixed word, not a
 * secret: a browser cannot hold a secret, and this page is public.
 */

const KEY = "geoid:unlock";
const MASTER = "owner";

const byId = (id) => document.getElementById(id);

export function unlocked() {
  try { return window.localStorage.getItem(KEY) === MASTER; } catch (error) { return false; }
}

/** Tell the page membership changed, the way the membership module does. */
function announce() {
  try { document.dispatchEvent(new CustomEvent("geoid:membership", { detail: window.GeoIDMembership?.state?.() || null })); } catch (error) { /* no document */ }
}

export function unlock(key) {
  if (String(key || "").trim() !== MASTER) return { ok: false, text: "That is not the master key." };
  try { window.localStorage.setItem(KEY, MASTER); } catch (error) { return { ok: false, text: "This browser refuses storage: the unlock cannot be kept." }; }
  announce();
  return { ok: true, text: "Unlocked: this browser is the master account until it is locked again. The Earth Engine endpoint, the sidecar and the hub stay stored." };
}

export function lock() {
  try { window.localStorage.removeItem(KEY); } catch (error) { /* fine */ }
  announce();
  return { ok: true, text: "Locked: every gate stands as a visitor sees it." };
}

/** Everything a testing machine must leave with nothing of: the unlock and every stored credential. */
export function wipeForGoingLive() {
  const gone = window.GeoIDCredentials?.wipeCredentials?.({ everything: true }) || [];
  try { window.localStorage.removeItem(KEY); } catch (error) { /* fine */ }
  announce();
  return { ok: true, text: `Wiped: the master unlock${gone.length ? `, ${gone.join(", ")}` : ""}. This browser is a visitor's now.` };
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}

function render() {
  const host = byId("gis-master-key");
  if (!host) return;
  const on = unlocked();
  const service = Boolean(window.GeoIDMembership?.state?.()?.live);
  host.replaceChildren();
  const state = el("p", { class: "compact-copy", id: "gis-master-key-state" },
    on ? "This browser is the MASTER ACCOUNT: every member function is open, and stored credentials are kept."
      : service ? "Signed in through the membership service; the master key is not needed."
        : "Locked: this browser meets every gate as a visitor does.");
  host.append(state);
  const status = el("p", { class: "compact-copy", id: "gis-master-key-status", "aria-live": "polite" });
  if (!on) {
    const input = el("input", { id: "gis-master-key-input", class: "input", type: "password", autocomplete: "off", placeholder: "master key", "aria-label": "Master key" });
    const go = el("button", { type: "button", class: "button primary" }, "Unlock this browser");
    // render() replaces the status node, so the sentence is written after it.
    const act = () => { const r = unlock(input.value); if (r.ok) render(); const n = byId("gis-master-key-status"); if (n) n.textContent = r.text; };
    go.addEventListener("click", act);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") act(); e.stopPropagation(); });
    host.append(el("div", { class: "row" }, el("label", { for: "gis-master-key-input" }, "Master key"), input), el("div", { class: "gis-btn-row" }, go));
  } else {
    const off = el("button", { type: "button", class: "button secondary" }, "Lock again");
    off.addEventListener("click", () => { const r = lock(); render(); const n = byId("gis-master-key-status"); if (n) n.textContent = r.text; });
    const wipe = el("button", { type: "button", class: "button secondary" }, "Wipe everything before going live");
    wipe.title = "Removes the master unlock and every stored credential: the Earth Engine endpoint, the sidecar and its token, the Atlas hub, the Google Client ID.";
    wipe.addEventListener("click", () => { const r = wipeForGoingLive(); render(); const n = byId("gis-master-key-status"); if (n) n.textContent = r.text; });
    host.append(el("div", { class: "gis-btn-row" }, off, wipe));
  }
  host.append(status);
}

/**
 * The card mounts into the Settings group ahead of the Google credentials,
 * which the group already holds. The group is shared markup on every world,
 * so this runs wherever Settings does.
 */
function mount() {
  const keys = byId("gis-settings-keys");
  if (!keys || byId("gis-master-key")) return Boolean(byId("gis-master-key"));
  const section = el("details", { id: "gis-master-key-section", class: "gis-tool-section", open: "" },
    el("summary", {}, "Master key"),
    el("div", { class: "gis-tool-body", id: "gis-master-key" }));
  keys.parentElement.insertBefore(section, keys);
  render();
  return true;
}

try {
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    let tries = 0;
    const tick = () => { if (!mount() && tries++ < 120) setTimeout(tick, 500); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick); else tick();
    document.addEventListener("geoid:membership", render);
  }
  if (typeof window !== "undefined") window.GeoIDMasterKey = { unlock, lock, wipeForGoingLive, unlocked };
} catch (error) { /* no document: a test, or node */ }
