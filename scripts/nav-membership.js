/**
 * The membership button in the nav, beside Donate.
 *
 * Three states, and the button is the same element in all of them so the nav
 * does not reflow when somebody signs in:
 *
 *   signed out          "Sign in"      → /sign-in/, coming back here
 *   signed in, explorer "Membership"   → /membership/, which is what they want
 *   a member            their name     → /account/
 *
 * WITH NO SERVICE CONFIGURED IT STILL SAYS "MEMBERSHIP" and goes to the page
 * describing it. The button is not only a door to a sign-in — it is how anybody
 * finds out that membership exists — so it must not vanish on a deployment that
 * has not switched sign-in on yet. That was the fault in the first version of
 * this: a nav item that appears only once the thing it advertises is running.
 *
 * `.nav-act-signin` and `.nav-act-member` are the site's own classes, still in
 * shared.css from when there was an account system. This is putting a button
 * back rather than inventing one.
 */
import * as membership from "/GeoID_GIS/viewer/gis/membership.js";

const FIRST_NAME = /^[^\s@]+/;

function label(state) {
  if (!state.signedIn) {
    return membership.enforcing()
      ? { text: "Sign in", href: `/sign-in/?next=${encodeURIComponent(location.pathname)}`, member: false }
      : { text: "Membership", href: "/membership/", member: false };
  }
  if (!state.member) return { text: "Membership", href: "/membership/", member: false };
  // A first name, because a nav button is not the place for an email address --
  // and somebody else can be looking over their shoulder.
  const name = (state.name || state.email || "Account").trim();
  const short = name.includes("@") ? (FIRST_NAME.exec(name) || ["Account"])[0] : name.split(/\s+/)[0];
  return { text: short, href: "/account/", member: true };
}

function paint() {
  const node = document.getElementById("nav-membership");
  if (!node) return;
  const state = membership.state();
  const it = label(state);
  node.textContent = it.text;
  node.setAttribute("href", it.href);
  node.classList.toggle("nav-act-member", it.member);
  node.classList.toggle("nav-act-signin", !it.member);
  node.title = state.signedIn && state.member
    ? `Signed in as ${state.email || it.text}` : "";
}

paint();
document.addEventListener("geoid:membership", paint);
