/**
 * This device: what the Network does differently on the browser in front of
 * the member.
 *
 *   lite mode     no background photographs, no image previews in lists, no
 *                 glow: for slow or metered connections (on by itself when the
 *                 browser says Save-Data)
 *   install       the Network as an app (the site's one service worker, /sw.js)
 *   push          notifications on this device (social-worker/push.js; the push
 *                 carries nothing, the worker fetches what is new)
 *   translate     a post into the reader's language ON THE DEVICE, with the
 *                 browser's built-in translator where there is one
 */
import * as api from "./api.js?v=20261026-cbf1b2a";

const LITE_KEY = "geoid:social-lite";
const ls = (k) => { try { return localStorage.getItem(k); } catch (error) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (error) { /* fine */ } };

// ── Lite mode ──────────────────────────────────────────────────────────────

/** "on" | "off" | "" (follow the browser's Save-Data). */
export const litePreference = () => ls(LITE_KEY) || "";
export const saveDataOn = () => !!navigator.connection?.saveData;
export function isLite() {
  const pref = litePreference();
  return pref === "on" || (pref !== "off" && saveDataOn());
}
export function setLite(pref) {
  lsSet(LITE_KEY, pref || null);
  document.documentElement.classList.toggle("s-lite", isLite());
}

// ── The app ────────────────────────────────────────────────────────────────

let installEvent = null;
const installListeners = new Set();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  installListeners.forEach((fn) => fn(true));
});
window.addEventListener("appinstalled", () => { installEvent = null; installListeners.forEach((fn) => fn(false)); });

export const canInstall = () => !!installEvent;
export const onInstallable = (fn) => { installListeners.add(fn); return () => installListeners.delete(fn); };
export const isInstalled = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
export async function install() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === "accepted";
}

/** The site's ONE service worker (see /sw.js): the viewers register the same file. */
export function registerWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register("/sw.js").catch(() => null);
}

// ── Push ───────────────────────────────────────────────────────────────────

const b64ToBytes = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** {supported, configured, permission, on} */
export async function pushState() {
  if (!pushSupported()) return { supported: false };
  let configured = false;
  try { configured = !!(await api.get("/v1/push/key")).configured; } catch (error) { configured = false; }
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, configured, permission: Notification.permission, on: !!sub };
}

export async function enablePush() {
  const { key } = await api.get("/v1/push/key");
  if (!key) throw new Error("Notifications on this device aren't switched on for GeoID Network yet.");
  if (await Notification.requestPermission() !== "granted") throw new Error("The browser didn't allow notifications. You can change that in its site settings.");
  const reg = (await registerWorker()) || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api.post("/v1/push/subscribe", { endpoint: sub.endpoint });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  try { await api.del("/v1/push/subscribe", { endpoint: sub.endpoint }); } catch (error) { /* unsubscribing locally is what matters */ }
  await sub.unsubscribe();
}

// ── Translation, on the device ─────────────────────────────────────────────

/** The language posts are translated into: the member's choice, else the browser's. */
export const readerLanguage = () => (ls("geoid:social-lang") || navigator.language || "en").slice(0, 2).toLowerCase();
export const setReaderLanguage = (code) => lsSet("geoid:social-lang", code || null);

export const builtInTranslator = () => typeof self.Translator !== "undefined" && typeof self.LanguageDetector !== "undefined";

/** The language a text is in ("" when unsure), on the device. */
export async function detectLanguage(text) {
  if (typeof self.LanguageDetector === "undefined") return "";
  try {
    const d = await self.LanguageDetector.create();
    const [best] = await d.detect(String(text).slice(0, 2000));
    return best && best.confidence > 0.6 ? best.detectedLanguage : "";
  } catch (error) { return ""; }
}

/**
 * Translate on the device. Returns the translation, or null when this browser
 * has no translator for the pair -- the caller then offers a link out.
 */
export async function translate(text, from, to = readerLanguage()) {
  if (typeof self.Translator === "undefined" || !from || from === to) return null;
  try {
    const avail = await self.Translator.availability({ sourceLanguage: from, targetLanguage: to });
    if (avail === "unavailable") return null;
    const t = await self.Translator.create({ sourceLanguage: from, targetLanguage: to });
    const parts = String(text).split(/\n{2,}/);
    const out = [];
    for (const p of parts) out.push(p.trim() ? await t.translate(p) : "");
    return out.join("\n\n");
  } catch (error) { return null; }
}

/** A translation service the READER chooses to send the text to (public posts only). */
export const translateOutLink = (text, to = readerLanguage()) =>
  `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(to)}&text=${encodeURIComponent(String(text).slice(0, 4500))}&op=translate`;
