/**
 * TOASTS: what just happened, said where the eye is.
 *
 * The studio writes its log into a tab, the Results panel its status into a
 * readout inside a fold, the Study panel its own into a third place — so a
 * mesh finishing, a run opening, a study written or a solve refused were
 * announced somewhere the reader was usually not looking. Each of those
 * writers now also dispatches `geoid-studio:notice`, and this module shows
 * the last few as a short stack at the foot of the viewport: one toast per
 * SOURCE (a progress line replaces the one before it rather than stacking
 * forty "Reading — 41%" cards), a few seconds for news, longer for an error,
 * a click to dismiss. The log, the readouts and the fold are unchanged —
 * this is a second face of them, never their replacement.
 */

const byId = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) { if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v); }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
};

const LIFE = { "": 3800, warning: 6000, error: 9000 };
const T = { host: null, bySource: new Map() };

/** Lines that are furniture, not news: a readout that repeats state rather than reporting a change. */
export function worthAToast(text, level) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (level === "error" || level === "warning") return true;
  if (/^(Loading|Reading|Tracing|Applying|Writing|Meshing|Preparing|Solving|Summaris|Sampling)/i.test(t)) return true;
  if (/\b(added|adopted|opened|written|filed|saved|meshed|solved|removed|deleted|cleared|exported|read|traced|selected|prepared)\b/i.test(t)) return true;
  if (/\d/.test(t) && t.length < 140) return true;
  return false;
}

export function notice({ text, level = "", source = "studio" } = {}) {
  if (!T.host || !worthAToast(text, level)) return null;
  let toast = T.bySource.get(source);
  if (!toast) {
    toast = el("div", { class: "studio-toast", role: "status" });
    toast.addEventListener("click", () => dismiss(source));
    T.host.append(toast);
    T.bySource.set(source, toast);
  }
  toast.textContent = text;
  toast.className = `studio-toast${level ? ` is-${level}` : ""}`;
  // In on the next frame: a transition, because a keyframe rule cannot carry the page's scope.
  requestAnimationFrame(() => toast.classList.add("is-in"));
  toast.title = "Click to dismiss";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dismiss(source), LIFE[level] ?? LIFE[""]);
  // Never more than four on screen: the oldest goes.
  while (T.host.children.length > 4) { const first = T.host.firstElementChild; for (const [k, v] of T.bySource) if (v === first) T.bySource.delete(k); first.remove(); }
  return toast;
}

function dismiss(source) {
  const toast = T.bySource.get(source);
  if (!toast) return;
  clearTimeout(toast.timer);
  toast.classList.add("is-leaving");
  setTimeout(() => toast.remove(), 220);
  T.bySource.delete(source);
}

function install() {
  const root = byId("model-studio");
  if (!root) { setTimeout(install, 500); return; }
  T.host = el("div", { id: "studio-toasts", class: "studio-toasts", "aria-live": "polite" });
  root.append(T.host);
  document.addEventListener("geoid-studio:notice", (e) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    notice(e.detail || {});
  });
  window.GeoIDStudioToast = { notice, worthAToast, dismiss };
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
}
