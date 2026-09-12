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

function paint() {
  const state = membership.state();
  const plan = byId("plan-card");
  const manage = byId("manage-card");
  if (!plan || !manage) return;

  plan.hidden = state.member;
  manage.hidden = !state.member;

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
