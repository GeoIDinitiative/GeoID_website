/**
 * Who is here: the /v1/me answer, shared by every view, and the unread
 * counts the header draws.
 */
import * as api from "./api.js?v=20261023-5845e91";

const listeners = new Set();
export const store = { me: null, loaded: false, error: null };

export function onMe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce() { listeners.forEach((fn) => { try { fn(store); } catch (e) { /* listener's own */ } }); }

export async function refreshMe() {
  if (!api.maybeSignedIn()) {
    store.me = null; store.loaded = true; store.error = null;
    announce();
    return null;
  }
  try {
    store.me = await api.get("/v1/me");
    store.error = null;
  } catch (error) {
    store.me = null;
    store.error = error.status === 401 ? null : error;
  }
  store.loaded = true;
  announce();
  return store.me;
}

export const me = () => store.me;
export const myHandle = () => store.me?.user?.handle || "";
export const isAdmin = () => !!store.me?.admin;

export function setUnread(unread) {
  if (!store.me) return;
  store.me.unread = { ...(store.me.unread || {}), ...unread };
  announce();
}
