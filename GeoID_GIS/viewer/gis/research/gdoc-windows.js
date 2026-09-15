/**
 * Floating Google Docs and Sheets windows for the Research Hub.
 *
 * The Docs & Sheets page had one frame, and it lived inside that page: a
 * reader writing up a result on the Signal page could not see the paper, and
 * a sheet could not sit beside the doc it feeds. These are WINDOWS instead —
 * several at once, dragged, resized, snapped to a half of the screen,
 * minimised to a dock, maximised — and they belong to the hub, not to a page,
 * so they survive every page change and come back after a reload.
 *
 * WHY AN IFRAME WORKS. docs.google.com sends no X-Frame-Options and no
 * frame-ancestors (measured; pages/docs.js records it), so /edit renders in a
 * cross-origin frame with the whole editor, editable whenever this browser is
 * signed in to Google, read-only otherwise.
 *
 * A FRAME EATS THE POINTER. Dragging a window across another window's frame
 * loses the drag the moment the pointer enters it, because the frame is a
 * different document. Every frame goes inert for the length of a gesture
 * (`body.gdoc-busy`), and the gesture holds pointer capture on the handle.
 *
 * STATE IS THE WINDOWS, NOT THE DOM. What is open, where, how big and in which
 * mode is one array, written to localStorage on change; the DOM is drawn from
 * it. A storage that throws only costs the restore.
 */
import { frameUrl } from "./google-credentials.js?v=20260915-1b203d8";
import * as store from "./project-store.js?v=20260915-1b203d8";

const STORAGE_KEY = "geoid-research:gdoc-windows";
const RECENT_KEY = "geoid-research:gdoc-recent";
const MIN_W = 320;
const MIN_H = 220;
const TOP_GAP = 56;   // below the shell row

// ── The pure half ──────────────────────────────────────────────────────────

/** Which kind of Google file a URL is, or null when it is not one. */
export function classifyGoogleUrl(url) {
  const text = String(url || "").trim();
  if (/^https:\/\/drive\.google\.com\/file\/d\//.test(text)) return "drive";
  if (!/^https:\/\/docs\.google\.com\//.test(text)) return null;
  if (text.includes("/spreadsheets/")) return "sheets";
  if (text.includes("/document/")) return "docs";
  if (text.includes("/presentation/")) return "slides";
  if (text.includes("/forms/")) return "forms";
  return null;
}

export const KIND_LABEL = { docs: "Doc", sheets: "Sheet", slides: "Slides", forms: "Form", drive: "Drive file" };

/** A window rect kept on screen: at least a grab-able strip of title bar stays visible. */
export function clampRect(rect, vw, vh, top = TOP_GAP) {
  const w = Math.max(MIN_W, Math.min(rect.w, vw - 16));
  const h = Math.max(MIN_H, Math.min(rect.h, vh - top - 8));
  const x = Math.min(Math.max(rect.x, 8 - w + 120), vw - 120);
  const y = Math.min(Math.max(rect.y, top), vh - 40);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Where the n-th new window opens: cascaded, so none lands exactly on another. */
export function cascadeRect(n, vw, vh, top = TOP_GAP) {
  const w = Math.min(760, Math.max(MIN_W, vw * 0.46));
  const h = Math.min(640, Math.max(MIN_H, (vh - top) * 0.78));
  const step = 28 * (n % 8);
  return clampRect({ x: vw - w - 40 - step, y: top + 16 + step, w, h }, vw, vh, top);
}

/** Half of the screen below the shell row, for side-by-side reading. */
export function snapRect(side, vw, vh, top = TOP_GAP) {
  const h = vh - top - 8;
  const half = Math.floor((vw - 24) / 2);
  if (side === "left") return { x: 8, y: top, w: half, h };
  if (side === "right") return { x: vw - half - 8, y: top, w: half, h };
  return { x: 8, y: top, w: vw - 16, h };
}

/** A title for a URL nobody named: the kind and the id's head, never the whole URL. */
export function titleFor(url) {
  const kind = classifyGoogleUrl(url);
  const id = String(url).match(/\/d\/([^/?#]+)/)?.[1] || "";
  return `${KIND_LABEL[kind] || "Document"}${id ? ` ${id.slice(0, 6)}…` : ""}`;
}

// ── State ──────────────────────────────────────────────────────────────────

let windows = [];
let layer = null;
let dock = null;
let launcher = null;
let zTop = 40;
let seq = 0;

const read = (key, fallback) => {
  try { return JSON.parse(window.localStorage.getItem(key)) ?? fallback; } catch (error) { return fallback; }
};
const write = (key, value) => {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage unavailable */ }
};

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => write(STORAGE_KEY, windows.map(({ node, frame, modeBtn, ...rest }) => rest)), 150);
}

function remember(url, title) {
  const recent = read(RECENT_KEY, []).filter((r) => r.url !== url);
  recent.unshift({ url, title });
  write(RECENT_KEY, recent.slice(0, 8));
}

// ── Windows ────────────────────────────────────────────────────────────────

/**
 * The top edge a window may reach: under the shell row, MEASURED. The row
 * wraps to two lines at ordinary widths (79 px measured at 1400), and a
 * constant put snapped windows over its second line — over the very Docs
 * button that opens them.
 */
function topGap() {
  const shell = document.querySelector("#research-hub .workspace-shell");
  const bottom = shell?.getBoundingClientRect().bottom;
  return Number.isFinite(bottom) && bottom > 0 ? Math.round(bottom) + 6 : TOP_GAP;
}

function hubVisible() {
  const hub = document.getElementById("research-hub");
  return hub && !hub.hidden;
}

function ensureLayer() {
  if (layer?.isConnected) return layer;
  const hub = document.getElementById("research-hub");
  if (!hub) return null;
  layer = document.createElement("div");
  layer.className = "gdoc-layer";
  dock = document.createElement("div");
  dock.className = "gdoc-dock";
  dock.setAttribute("aria-label", "Minimised documents");
  hub.append(layer, dock);
  window.addEventListener("resize", () => windows.forEach((w) => { if (!w.max) place(w); }));
  return layer;
}

function glyph(kind) {
  const span = document.createElement("span");
  span.className = `gdoc-glyph gdoc-glyph-${kind || "docs"}`;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function iconButton(label, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "gdoc-btn";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return b;
}

function raise(win) {
  win.z = ++zTop;
  win.node.style.zIndex = String(win.z);
  windows.forEach((w) => w.node.classList.toggle("is-front", w === win));
}

function place(win) {
  const r = win.max
    ? snapRect("full", window.innerWidth, window.innerHeight, topGap())
    : clampRect(win, window.innerWidth, window.innerHeight, topGap());
  if (!win.max) Object.assign(win, r);
  Object.assign(win.node.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  win.node.classList.toggle("is-max", Boolean(win.max));
}

function setSrc(win) {
  const src = frameUrl(win.url, { mode: win.mode });
  if (win.frame.src !== src) win.frame.src = src;
  win.modeBtn.textContent = win.mode === "preview" ? "Preview" : "Edit";
  win.modeBtn.title = win.mode === "preview"
    ? "Read-only preview — switch to the editor"
    : "The editor — switch to a read-only preview";
}

function drag(win, handle, onMove) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".gdoc-btn")) return;
    event.preventDefault();
    raise(win);
    const start = { px: event.clientX, py: event.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("gdoc-busy");
    const move = (e) => onMove(start, e.clientX - start.px, e.clientY - start.py);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("gdoc-busy");
      save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function renderDock() {
  if (!dock) return;
  dock.textContent = "";
  const minimised = windows.filter((w) => w.min);
  dock.hidden = !minimised.length;
  for (const win of minimised) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "gdoc-dock-chip";
    chip.append(glyph(win.kind), document.createTextNode(win.title));
    chip.title = `Restore ${win.title}`;
    chip.addEventListener("click", () => restore(win.id));
    dock.append(chip);
  }
  document.dispatchEvent(new CustomEvent("geoid:gdoc-windows"));
}

function build(win) {
  const node = document.createElement("section");
  node.className = "gdoc-win";
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", win.title);

  const bar = document.createElement("header");
  bar.className = "gdoc-bar";
  const name = document.createElement("span");
  name.className = "gdoc-title";
  name.textContent = win.title;
  name.title = win.url;

  const modeBtn = iconButton("Edit", "", () => {
    win.mode = win.mode === "preview" ? "edit" : "preview";
    setSrc(win);
    save();
  });
  modeBtn.classList.add("gdoc-mode");
  win.modeBtn = modeBtn;

  bar.append(glyph(win.kind), name, modeBtn,
    iconButton("◧", "Snap to the left half", () => snap(win, "left")),
    iconButton("◨", "Snap to the right half", () => snap(win, "right")),
    iconButton("↻", "Reload", () => { win.frame.src = frameUrl(win.url, { mode: win.mode }); }),
    iconButton("↗", "Open in a new tab (sign in to Google there once)", () => window.open(win.url, "_blank", "noopener,noreferrer")),
    iconButton("–", "Minimise to the dock", () => minimise(win.id)),
    iconButton("□", "Maximise or restore", () => toggleMax(win)),
    iconButton("✕", "Close this window", () => close(win.id)));
  bar.addEventListener("dblclick", (event) => { if (!event.target.closest(".gdoc-btn")) toggleMax(win); });

  const frame = document.createElement("iframe");
  frame.className = "gdoc-win-frame";
  frame.title = win.title;
  // Google is another origin: no referrer beyond the origin, clipboard for the
  // editor's own copy/paste, nothing else.
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "clipboard-read; clipboard-write";

  const grip = document.createElement("span");
  grip.className = "gdoc-grip";
  grip.title = "Resize";

  node.append(bar, frame, grip);
  node.addEventListener("pointerdown", () => raise(win), true);

  drag(win, bar, (start, dx, dy) => {
    if (win.max) return;
    win.x = start.x + dx; win.y = start.y + dy;
    place(win);
  });
  drag(win, grip, (start, dx, dy) => {
    if (win.max) return;
    win.w = start.w + dx; win.h = start.h + dy;
    place(win);
  });

  win.node = node;
  win.frame = frame;
  layer.append(node);
  node.hidden = Boolean(win.min);
  setSrc(win);
  place(win);
  raise(win);
}

function snap(win, side) {
  win.max = false;
  Object.assign(win, snapRect(side, window.innerWidth, window.innerHeight, topGap()));
  place(win);
  save();
}

function toggleMax(win) {
  win.max = !win.max;
  place(win);
  save();
}

// ── The seam ───────────────────────────────────────────────────────────────

/** Open a Google file in a window, or bring its window forward if it is open. */
export function open(url, { title, mode = "edit" } = {}) {
  const text = String(url || "").trim();
  const kind = classifyGoogleUrl(text);
  if (!kind) return { ok: false, error: "That is not a Google Docs, Sheets, Slides, Forms or Drive file URL." };
  if (!ensureLayer()) return { ok: false, error: "The Research Hub is not on this page." };
  const existing = windows.find((w) => w.url === text);
  if (existing) {
    if (existing.min) restore(existing.id);
    raise(existing);
    return { ok: true, id: existing.id, existed: true };
  }
  const rect = cascadeRect(windows.length, window.innerWidth, window.innerHeight, topGap());
  const win = { id: `gdoc-${Date.now().toString(36)}-${seq++}`, url: text, kind,
    title: String(title || "").trim() || titleFor(text), mode, min: false, max: false, ...rect };
  windows.push(win);
  build(win);
  remember(text, win.title);
  save();
  renderDock();
  return { ok: true, id: win.id };
}

export function close(id) {
  const win = windows.find((w) => w.id === id);
  if (!win) return false;
  win.node.remove();
  windows = windows.filter((w) => w !== win);
  save();
  renderDock();
  return true;
}

export function minimise(id) {
  const win = windows.find((w) => w.id === id);
  if (!win) return;
  win.min = true;
  win.node.hidden = true;
  save();
  renderDock();
}

export function restore(id) {
  const win = windows.find((w) => w.id === id);
  if (!win) return;
  win.min = false;
  win.node.hidden = false;
  place(win);
  raise(win);
  save();
  renderDock();
}

/** Every open window side by side, in columns that fit the screen. */
export function tile() {
  const open = windows.filter((w) => !w.min);
  if (!open.length) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cols = Math.min(open.length, Math.max(1, Math.floor((vw - 16) / MIN_W)));
  const rows = Math.ceil(open.length / cols);
  const cw = Math.floor((vw - 16 - (cols - 1) * 8) / cols);
  const top = topGap();
  const rh = Math.floor((vh - top - 8 - (rows - 1) * 8) / rows);
  open.forEach((win, i) => {
    win.max = false;
    Object.assign(win, { x: 8 + (i % cols) * (cw + 8), y: top + Math.floor(i / cols) * (rh + 8), w: cw, h: rh });
    place(win);
  });
  save();
}

export const list = () => windows.map(({ node, frame, modeBtn, ...rest }) => ({ ...rest }));

// ── The launcher on the shell row ─────────────────────────────────────────

async function projectLinks() {
  if (!store.getActive?.()) return [];
  try {
    const saved = await store.readJson("metadata/links.json", null);
    return [...(saved?.docs || []), ...(saved?.sheets || [])];
  } catch (error) {
    return [];
  }
}

function closeLauncher() {
  launcher?.remove();
  launcher = null;
  document.getElementById("research-act-docs")?.setAttribute("aria-pressed", "false");
  document.getElementById("research-act-docs")?.classList.remove("is-active");
}

async function openLauncher(anchor) {
  if (launcher) { closeLauncher(); return; }
  launcher = document.createElement("div");
  launcher.className = "gdoc-launcher";
  launcher.setAttribute("role", "dialog");
  launcher.setAttribute("aria-label", "Open a Google document");
  anchor.setAttribute("aria-pressed", "true");
  anchor.classList.add("is-active");

  const say = document.createElement("p");
  say.className = "gdoc-launcher-status";
  say.setAttribute("role", "status");

  const url = document.createElement("input");
  url.type = "url";
  url.className = "input";
  url.placeholder = "Paste a Google Docs or Sheets link";
  url.setAttribute("aria-label", "Google document link");
  const go = () => {
    const result = open(url.value, {});
    if (!result.ok) { say.textContent = result.error; return; }
    closeLauncher();
  };
  url.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });

  const heading = (text) => { const h = document.createElement("h4"); h.textContent = text; return h; };
  const button = (text, fn, secondary = true) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `button${secondary ? " secondary" : ""}`;
    b.textContent = text;
    b.addEventListener("click", fn);
    return b;
  };
  const listOf = (items, empty) => {
    const ul = document.createElement("ul");
    ul.className = "gdoc-launcher-list";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "gdoc-launcher-empty";
      li.textContent = empty;
      ul.append(li);
    }
    for (const item of items) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.append(glyph(classifyGoogleUrl(item.url)), document.createTextNode(item.title || titleFor(item.url)));
      b.title = item.url;
      b.addEventListener("click", () => { open(item.url, { title: item.title }); closeLauncher(); });
      li.append(b);
      ul.append(li);
    }
    return ul;
  };

  const row = document.createElement("div");
  row.className = "gdoc-launcher-row";
  row.append(url, button("Open", go, false));

  const make = document.createElement("div");
  make.className = "gdoc-launcher-row";
  make.append(
    button("New Doc", () => { window.open("https://docs.new", "_blank", "noopener,noreferrer"); say.textContent = "A blank Doc opened in a new tab — paste its link above to open it here."; }),
    button("New Sheet", () => { window.open("https://sheets.new", "_blank", "noopener,noreferrer"); say.textContent = "A blank Sheet opened in a new tab — paste its link above to open it here."; }),
    button("Tile open windows", () => { tile(); closeLauncher(); }));

  const linked = document.createElement("div");
  linked.append(heading("In this project"), listOf([], "Loading…"));
  launcher.append(heading("Open a document"), row, make, linked,
    heading("Recently opened"), listOf(read(RECENT_KEY, []), "Nothing opened yet."), say);

  const box = anchor.getBoundingClientRect();
  launcher.style.top = `${Math.round(box.bottom + 6)}px`;
  launcher.style.right = `${Math.max(8, Math.round(window.innerWidth - box.right))}px`;
  document.getElementById("research-hub").append(launcher);
  url.focus();

  const links = await projectLinks();
  if (!launcher) return;
  linked.replaceChildren(heading("In this project"), listOf(links,
    store.getActive?.() ? "No documents attached — attach them on the Docs & Sheets page." : "No project open."));
}

function restoreSaved() {
  const saved = read(STORAGE_KEY, []);
  if (!Array.isArray(saved) || !saved.length || !ensureLayer()) return;
  for (const s of saved) {
    const kind = classifyGoogleUrl(s.url);
    if (!kind) continue;
    const { node, frame, modeBtn, ...plain } = s;
    const win = { mode: "edit", min: false, max: false, ...plain, kind,
      ...clampRect(s, window.innerWidth, window.innerHeight, topGap()) };
    windows.push(win);
    build(win);
  }
  renderDock();
}

export function install() {
  if (typeof document === "undefined") return;
  const anchor = document.getElementById("research-act-docs");
  if (!anchor || anchor.dataset.wired) return;
  anchor.dataset.wired = "1";
  anchor.addEventListener("click", () => openLauncher(anchor));
  document.addEventListener("pointerdown", (event) => {
    if (launcher && !launcher.contains(event.target) && event.target !== anchor) closeLauncher();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && launcher) closeLauncher(); });
  restoreSaved();
  window.GeoIDDocWindows = { open, close, minimise, restore, tile, list, hubVisible };
}
