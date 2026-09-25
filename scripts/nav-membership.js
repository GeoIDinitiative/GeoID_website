/**
 * The sign-in button in the nav, beside Donate.
 *
 * Two states, and the SAME element carries both so the nav does not reflow
 * when somebody signs in:
 *
 *   signed out   "Sign in"    → /sign-in/, coming back to this page
 *   signed in    "Sign out"   → signs out here, in place, no navigation
 *
 * SIGNED IN, A SECOND ITEM APPEARS BESIDE IT: the person's first name,
 * linking to /account/. It is built here rather than put in the markup
 * because that markup is copied into twenty pages, and a nav item that is
 * only ever visible to a signed-in reader is not worth twenty edits and the
 * drift they invite. It is removed again on sign-out.
 *
 * WHY NOT "MEMBERSHIP". This button said Membership whenever no auth service
 * was configured, on the reasoning that it is how anybody FINDS OUT that
 * membership exists and so must not offer a door that does not open. That was
 * right about the risk and wrong about where to fix it: /sign-in/ already
 * handles the case in words -- "Memberships are not open quite yet, and there
 * is nothing here you need" -- so the door explains itself, and the header
 * gets to say one thing consistently instead of changing its label based on a
 * deployment detail no reader can see. Membership is still a page, still in
 * the footer, and still where /sign-in/ sends anybody who has not got one.
 *
 * SIGNING OUT IS A LOCAL ACT FIRST. `membership.signOut()` clears the claims
 * and the pass before it tells the service, so a network that is down cannot
 * leave somebody unable to sign out of the machine in front of them. Nothing
 * here navigates: the page repaints through the `geoid:membership` event that
 * signOut() announces, which is the same path a sign-in takes.
 *
 * `.nav-act-signin` and `.nav-act-member` are the site's own classes, still in
 * shared.css from when there was an account system.
 */
import * as membership from "/GeoID_GIS/viewer/gis/membership.js";

const FIRST_NAME = /^[^\s@]+/;
const ACCOUNT_ID = "nav-account";

/**
 * A first name, never an email: a nav button is read over somebody's
 * shoulder, and "Account" is a better answer than an address.
 */
function shortName(state) {
  const name = (state.name || state.email || "Account").trim();
  if (!name) return "Account";
  return name.includes("@")
    ? (FIRST_NAME.exec(name) || ["Account"])[0]
    : name.split(/\s+/)[0];
}

/** The account link, created beside the button on sign-in and removed after. */
function accountLink(state, button) {
  let node = document.getElementById(ACCOUNT_ID);
  if (!state.signedIn) {
    node?.remove();
    return;
  }
  if (!node) {
    node = document.createElement("a");
    node.id = ACCOUNT_ID;
    node.className = "nav-act nav-act-member";
    node.setAttribute("href", "/account/");
    // Before the button, so the row reads "Ada · Sign out" rather than the
    // other way about, and Donate stays last.
    button.parentNode?.insertBefore(node, button);
  }
  node.textContent = shortName(state);
  node.title = state.email ? `Signed in as ${state.email}` : "Your account";
}

function paint() {
  const button = document.getElementById("nav-membership");
  if (!button) return;
  const state = membership.state();

  button.textContent = state.signedIn ? "Sign out" : "Sign in";
  button.classList.toggle("nav-act-signin", !state.signedIn);
  button.classList.toggle("nav-act-member", false);

  if (state.signedIn) {
    // A button, not a link: signing out happens here and goes nowhere.
    button.removeAttribute("href");
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.title = state.email ? `Sign out of ${state.email}` : "Sign out";
  } else {
    button.setAttribute(
      "href", `/sign-in/?next=${encodeURIComponent(location.pathname)}`);
    button.removeAttribute("role");
    button.removeAttribute("tabindex");
    button.title = "";
  }

  accountLink(state, button);
}

function onActivate(event) {
  const button = document.getElementById("nav-membership");
  if (!button || event.target !== button) return;
  if (!membership.state().signedIn) return;      // a link, and it may follow
  // Keyboard: a role=button answers Enter and Space, and Space would scroll.
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  membership.signOut();                          // announces; paint() follows
}

paint();
document.addEventListener("geoid:membership", paint);
document.addEventListener("click", onActivate);
document.addEventListener("keydown", onActivate);
