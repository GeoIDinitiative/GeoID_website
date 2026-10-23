/**
 * Who is here: the /v1/me answer, shared by every view, and the unread
 * counts the header draws.
 */
import { play } from "./sounds.js?v=20261023-d375b8c";
import * as api from "./api.js?v=20261023-d375b8c";

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
  const before = (store.me.unread?.messages || 0) + (store.me.unread?.notifications || 0);
  store.me.unread = { ...(store.me.unread || {}), ...unread };
  // Something new came in (not merely read): the arrival chime, if sounds are on.
  if ((store.me.unread.messages || 0) + (store.me.unread.notifications || 0) > before) play("arrive");
  announce();
}
