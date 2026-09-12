/**
 * The membership page: what it is, how to get one, and how to manage one.
 *
 * ONE PAGE FOR BOTH, chosen by who is reading it. Somebody who does not hold a
 * membership is shown the plan and the way to buy it; somebody who does is
 * shown how to change or cancel it instead. Two pages would be two places to
 * keep the price and the terms in step, and a member arriving at a page trying
 * to sell them what they already have reads as the site not knowing them.
 *
 * The payment link is Stripe's own hosted checkout. The card is entered on
 * Stripe's page and never on ours — nothing here, and nothing in the Worker,
 * ever sees a card number. What comes back to us is the email address it was
 * paid with, which is what the membership is attached to, and that is why the
 * page says to use the same one you sign in with.
 */
import * as membership from "/GeoID_GIS/viewer/gis/membership.js";

const byId = (id) => document.getElementById(id);

/**
 * The price on the page and the price in Stripe must be THE SAME NUMBER.
 *
 * Everything else here is recoverable: a wrong sentence can be rewritten, a
 * wrong gate can be unlocked. A page that advertises one figure and takes
 * another reaches somebody's bank, and no amount of apologising afterwards
 * undoes it.
 *
 * Nothing in a browser can ask Stripe what a payment link charges, so this
 * cannot be checked — only DECLARED. The link carries `data-price` and it has
 * to equal the figure printed beside it; until somebody has confirmed that in
 * the Stripe dashboard and written it on the link, the button does not take
 * anybody to a checkout.
 *
 * To turn it on: create or edit the payment link for the price shown, paste it
 * into the href, and set `data-price` to that price.
 */
function priceAgrees() {
  const buy = byId("plan-buy");
  const shown = byId("plan-card")?.querySelector(".plan-amount")?.textContent || "";
  const asked = shown.replace(/[^0-9.]/g, "");
  const declared = (buy?.dataset.price || "").replace(/[^0-9.]/g, "");
  return !!asked && asked === declared;
}

/** Stand the checkout down, and say why in the reader's terms rather than ours. */
function holdBackCheckout() {
  const buy = byId("plan-buy");
  if (!buy || buy.dataset.heldBack) return;
  buy.dataset.heldBack = "1";
  buy.textContent = "Memberships open soon";
  buy.href = "/contact/";
  buy.removeAttribute("target");
  const note = byId("plan-note");
  if (note) {
    note.textContent = "Memberships are not open for sign-up quite yet. Tell us "
      + "you would like one and we will let you know the moment they are.";
  }
}

function paint() {
  const state = membership.state();
  const plan = byId("plan-card");
  const manage = byId("manage-card");
  if (!plan || !manage) return;

  plan.hidden = state.member;
  manage.hidden = !state.member;

  // Before anything else about the plan is drawn: if the two prices have not
  // been declared equal, nobody is sent to a checkout.
  if (!state.member && !priceAgrees()) { holdBackCheckout(); return; }

  if (state.member) {
    const until = state.until
      ? new Date(state.until * 1000).toLocaleDateString(undefined,
          { year: "numeric", month: "long", day: "numeric" })
      : "";
    const says = byId("manage-state");
    if (says) {
      says.textContent = until
        ? `You are a member, until ${until}.`
        : "You are a member.";
    }
    return;
  }

  /**
   * A signed-in explorer is told which address the membership will attach to.
   *
   * Paying with a different address than you sign in with is the one way to end
   * up having paid and still be refused, and it is invisible until it happens.
   */
  const note = byId("plan-note");
  if (note && state.signedIn && state.email) {
    note.innerHTML = "Payment is handled by Stripe. We never see your card — "
      + "what reaches us is the email address you paid with, which is what the "
      + "membership is attached to. You are signed in as <strong>"
      + state.email.replace(/[<>&]/g, "") + "</strong>: pay with that address "
      + "and it attaches itself.";
  }
}

paint();
document.addEventListener("geoid:membership", paint);
