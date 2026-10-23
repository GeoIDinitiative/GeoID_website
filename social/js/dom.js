/**
 * DOM helpers for GeoID Network.
 *
 * EVERY PIECE OF USER CONTENT GOES IN AS TEXT. `h()` turns string children
 * into text nodes and never touches innerHTML, so a post body, a name or a
 * comment can hold `<img onerror=...>` and it is drawn as those characters.
 * Links are passed through `safeHref()`, which only admits http(s) and
 * same-page hash routes -- a `javascript:` link in a profile is the classic
 * hole in a social page and this is the one place it is closed.
 */

/** Only http(s) URLs, or "" -- for anything a member typed or the API echoed. */
export function safeHref(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, location.href);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch (error) { /* not a URL */ }
  return "";
}

/**
 * Build an element. attrs: class, text, href (checked), on<Event>, aria-*,
 * data-*, hidden, and any plain attribute. Children: nodes, strings (as
 * text), arrays, or null/false (skipped).
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = String(value);
    else if (key === "href") {
      // Internal routes and site paths are ours; anything else must be http(s).
      const v = String(value);
      if (v.startsWith("#/") || (v.startsWith("/") && !v.startsWith("//"))) el.setAttribute("href", v);
      else {
        const ok = safeHref(v);
        if (ok) el.setAttribute("href", ok);
      }
    } else if (key === "src") {
      const ok = String(value).startsWith("/") && !String(value).startsWith("//")
        ? String(value) : (String(value).startsWith("blob:") ? String(value) : safeHref(value));
      if (ok) el.setAttribute("src", ok);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value") el.value = value;
    else if (key === "checked" || key === "selected" || key === "disabled" || key === "required"
      || key === "multiple" || key === "open") el[key] = !!value;
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === "") continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** el.append(...kids), but null/false/"" children are skipped instead of becoming the text "null". */
export function put(el, ...children) {
  return append(el, children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** An external link: new tab, no opener, no referrer leak beyond the policy. */
export function extLink(url, label) {
  const href = safeHref(url);
  if (!href) return h("span", { class: "s-muted", text: label || "" });
  return h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, label || href);
}

// ── Time ───────────────────────────────────────────────────────────────────

export function ago(seconds) {
  const t = Number(seconds);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = Math.floor(Date.now() / 1000) - t;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
  return dateText(t);
}

export function dateText(seconds, withTime = false) {
  const t = Number(seconds);
  if (!Number.isFinite(t) || t <= 0) return "";
  const opts = { year: "numeric", month: "short", day: "numeric" };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return new Date(t * 1000).toLocaleString(undefined, opts);
}

export function timeEl(seconds, withTime = false) {
  const t = Number(seconds);
  if (!Number.isFinite(t) || t <= 0) return null;
  return h("time", { datetime: new Date(t * 1000).toISOString(), title: dateText(t, true) },
    withTime ? dateText(t, true) : ago(t));
}

/** "2026-10-23" from an <input type=date> to epoch seconds (end of that day for deadlines). */
export function dateToEpoch(value, endOfDay = false) {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : null;
}
export function epochToDate(seconds) {
  const t = Number(seconds);
  if (!Number.isFinite(t) || t <= 0) return "";
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Feedback ───────────────────────────────────────────────────────────────

let toastHost = null;
/** A polite status message. Errors are announced assertively. */
export function toast(message, kind = "info") {
  if (!toastHost) {
    toastHost = h("div", { class: "s-toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const node = h("div", { class: `s-toast s-toast-${kind}`, role: kind === "error" ? "alert" : null }, message);
  toastHost.append(node);
  setTimeout(() => node.remove(), kind === "error" ? 7000 : 3800);
}

/** A panel that says nothing is here, and what would put something here. */
export function empty(title, detail, action) {
  return h("div", { class: "s-empty" },
    h("p", { class: "s-empty-title", text: title }),
    detail ? h("p", { class: "s-muted", text: detail }) : null,
    action || null);
}

/** A panel that says what went wrong, in the API's own sentence when it sent one. */
export function errorBox(error, retry) {
  const status = error && error.status;
  let lead = "Something went wrong.";
  if (status === 0) lead = "Could not reach GeoID Network.";
  else if (status === 401) lead = "You need to sign in for this.";
  else if (status === 403) lead = "You don't have access to this.";
  else if (status === 404) lead = "Not found — it may have been removed, or it isn't shared with you.";
  else if (status === 429) lead = "Too many requests in a short time.";
  return h("div", { class: "s-error", role: "alert" },
    h("p", { class: "s-error-title", text: lead }),
    error && error.message && error.message !== lead ? h("p", { class: "s-muted", text: error.message }) : null,
    retry ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: retry }, "Try again") : null);
}

export function loading(label = "Loading…") {
  return h("div", { class: "s-loading", role: "status", "aria-live": "polite" }, label);
}

// ── Dialogs ────────────────────────────────────────────────────────────────

/**
 * A modal built on <dialog>, which gives focus trapping and Escape for free.
 * `build(close)` returns the body; resolves with whatever close() is given.
 */
export function modal(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = h("dialog", { class: `s-dialog${wide ? " s-dialog-wide" : ""}`, "aria-labelledby": titleId });
    let result;
    const close = (value) => { result = value; dialog.close(); };
    const head = h("div", { class: "s-dialog-head" },
      h("h2", { id: titleId, text: title }),
      h("button", { type: "button", class: "s-icon-btn", "aria-label": "Close", onClick: () => close(undefined) }, "×"));
    dialog.append(head, h("div", { class: "s-dialog-body" }, build(close)));
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); });
    document.body.append(dialog);
    dialog.showModal();
    const first = dialog.querySelector("input, textarea, select, button:not(.s-icon-btn)");
    if (first) first.focus();
  });
}

export function confirmDialog(title, text, okLabel = "Confirm") {
  return modal(title, (close) => h("div", {},
    h("p", { text }),
    h("div", { class: "s-actions" },
      h("button", { type: "button", class: "btn-primary", onClick: () => close(true) }, okLabel),
      h("button", { type: "button", class: "btn-ghost", onClick: () => close(false) }, "Cancel"))));
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
    return true;
  } catch (error) {
    toast("Could not copy — select the text and copy it yourself.", "error");
    return false;
  }
}

// ── Forms ──────────────────────────────────────────────────────────────────

let fieldSeq = 0;
/** A labelled field. `control` is an input/select/textarea element. */
export function field(label, control, hint) {
  const id = control.id || `f${++fieldSeq}`;
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute("aria-describedby", hintId);
  return h("div", { class: "s-field" },
    h("label", { for: id, text: label }),
    control,
    hint ? h("p", { class: "s-hint", id: hintId, text: hint }) : null);
}

export function select(name, options, value) {
  return h("select", { name },
    options.map(([v, label]) => h("option", { value: v, selected: String(v) === String(value ?? "") }, label)));
}

export function input(name, attrs = {}) {
  return h("input", { name, type: "text", ...attrs });
}

export function textarea(name, attrs = {}) {
  const el = h("textarea", { name, rows: attrs.rows || 4, ...attrs });
  if (attrs.value != null) el.value = attrs.value;
  return el;
}

export function checkbox(name, label, checked, hint) {
  const box = h("input", { type: "checkbox", name, checked });
  return h("label", { class: "s-check" }, box, h("span", {}, label, hint ? h("small", { class: "s-hint", text: hint }) : null));
}

/** "a, b, c" -> ["a","b","c"] */
export function splitList(text) {
  return String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Disable a form's controls while a request runs; returns a restore function. */
export function busy(form) {
  const controls = [...form.querySelectorAll("button, input, select, textarea")];
  const was = controls.map((c) => c.disabled);
  controls.forEach((c) => { c.disabled = true; });
  form.setAttribute("aria-busy", "true");
  return () => { controls.forEach((c, i) => { c.disabled = was[i]; }); form.removeAttribute("aria-busy"); };
}

/** Run fn on an interval only while the tab is visible; returns a stop function. */
export function pollWhileVisible(fn, ms) {
  let timer = null;
  const start = () => { if (!timer) timer = setInterval(() => { if (!document.hidden) fn(); }, ms); };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const onVis = () => { if (document.hidden) stop(); else { fn(); start(); } };
  document.addEventListener("visibilitychange", onVis);
  if (!document.hidden) start();
  return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
}
