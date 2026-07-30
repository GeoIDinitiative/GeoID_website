# GeoID Membership Backend Setup

The frontend (`/sign-in/`, `/account/`, `/membership/`, the transit paywall) is
already wired up. To make it real, you need three things:

1. A Supabase project (free tier is fine).
2. A Stripe subscription Payment Link.
3. A Stripe webhook pointed at this repo's Edge Function.

The four placeholders in `/scripts/membership-config.js` are what tie everything
together. The site detects whether they've been filled in and falls back to
a "preview mode" if not, so you can deploy partially.

---

## 1. Supabase project

1. **Create a project** at <https://supabase.com>. Choose a region close to
   your users. Pick a strong DB password and save it somewhere — you won't
   need it for this setup.
2. **Project Settings → API** — copy these two values:
   - **Project URL** → goes into `SUPABASE_URL` in `membership-config.js`.
   - **anon public key** → goes into `SUPABASE_ANON_KEY` in `membership-config.js`.
3. **Authentication → URL Configuration:**
   - **Site URL:** `https://geoidinitiative.com`
   - **Redirect URLs:** add `https://geoidinitiative.com/account/` and
     `https://geoidinitiative.com/sign-in/`.
4. **Authentication → Providers → Email:** confirm Email is enabled. For dev,
   you can disable "Confirm email" so signups go through immediately.
5. **SQL Editor → New Query** → paste the contents of `schema.sql`, run.

That creates the `memberships` table, the row-level-security policy that lets
each user read only their own row, and the trigger that auto-creates a
placeholder row whenever a new user signs up.

---

## 2. Stripe

1. **Create a Subscription Product** (Stripe Dashboard → Products → Add):
   - Name: `GeoID Explorer Annual`
   - Recurring price: £19.99 / year
2. **Create a Payment Link** for that product (Dashboard → Payment Links).
   - Set **"After payment"** to redirect to
     `https://geoidinitiative.com/membership/welcome/`
   - Copy the link URL → `CHECKOUT_URL` in `membership-config.js`.
3. **Customer Portal** (Dashboard → Settings → Billing → Customer portal):
   - Enable cancel-at-period-end, update payment method, and invoice history.
   - Copy the "Login link" URL → `PORTAL_URL` in `membership-config.js`.

---

## 3. Edge Function (Stripe webhook)

The function in `functions/stripe-webhook/index.ts` keeps the `memberships`
table in sync with Stripe whenever a subscription is created, updated,
cancelled, paid, or fails to pay.

```bash
# Install the Supabase CLI (one-off):
brew install supabase/tap/supabase    # or your platform's equivalent

cd tools/supabase
supabase login
supabase link --project-ref <your-project-ref>     # from the dashboard URL

# Set secrets the function will read at runtime:
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...     # see step below
supabase secrets set SUPABASE_URL=https://<your-project>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...    # API → service_role key

# Deploy. --no-verify-jwt is required because Stripe signs the request, not Supabase auth.
supabase functions deploy stripe-webhook --no-verify-jwt

# Account deletion. Reuses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from above,
# so there are no new secrets to set. Deploy WITHOUT --no-verify-jwt: every call
# must carry the signed-in user's JWT, and the function deletes only that user.
supabase functions deploy delete-account
```

**Until `delete-account` is deployed**, the "Delete my account" button on
`/account/` fails with a clear message asking the user to email us instead —
it does not fail silently, but no account is removed. Deploy it before
advertising self-service deletion.

Then in **Stripe Dashboard → Developers → Webhooks → Add endpoint**:

- **Endpoint URL:** `https://<your-project>.supabase.co/functions/v1/stripe-webhook`
- **Events to send:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

After saving, Stripe shows the **Signing secret** (`whsec_…`). Put that into
the `STRIPE_WEBHOOK_SECRET` Supabase secret (above).

---

## 4. Linking a checkout back to a user

The webhook matches a Stripe customer to a Supabase user **by email**. As long
as the email the user enters at Stripe checkout matches the email they used to
sign up, everything will work.

For belt-and-braces, you can also pass the Supabase user id explicitly. After a
user signs in on `/sign-in/`, you can append their id to the Payment Link URL
when subscribing:

```js
// In scripts/membership.js → GeoIDMembership.subscribe(), enhance with:
const user = await window.GeoIDAuth.getUser();
const sep = url.includes("?") ? "&" : "?";
window.location.href = `${url}${sep}client_reference_id=${encodeURIComponent(user.id)}&prefilled_email=${encodeURIComponent(user.email)}`;
```

The webhook reads `client_reference_id` as a fallback when email lookup fails.

---

## 5. What the frontend now does

| Page                    | Behaviour                                                                                     |
|-------------------------|-----------------------------------------------------------------------------------------------|
| `/sign-in/`             | Email/password sign-in, signup, and magic-link. Redirects to `?return=…` on success.          |
| `/account/`             | Shows email, subscription status, renewal date, "Manage in Stripe" + Sign Out. Auth-gated.    |
| `/membership/`          | Plan/price card. Subscribe button → Stripe Checkout. "Already a member?" → `/sign-in/`.       |
| `/membership/welcome/`  | Post-checkout landing page (configure the same URL in your Stripe Payment Link).              |
| `/transit/?destination=…` | If destination is in `FREE_DESTINATIONS`, loads normally. Otherwise requires an active member. |
| Nav **Sign In** button  | Goes to `/sign-in/?return=<current-page>`.                                                    |

---

## 6. Testing checklist

- [ ] Sign up with a new email on `/sign-in/`. Confirm a row appears in
      `memberships` with `active = false`.
- [ ] From `/membership/`, click Subscribe and complete a Stripe test
      checkout (use `4242 4242 4242 4242`).
- [ ] Check the webhook log in Stripe Dashboard → Developers → Webhooks →
      your endpoint. Verify `checkout.session.completed` was 200.
- [ ] Open `/account/` — status should now read "Active" with a renewal date.
- [ ] Try to navigate to `/transit/?destination=mars` while signed out — you
      should be redirected to `/sign-in/?return=/transit/?destination=mars`.
- [ ] Sign in, retry — the transit should load.
- [ ] From `/account/`, click "Manage in Stripe" and cancel the subscription.
      The webhook fires `customer.subscription.deleted`, `active` becomes
      false, and the next paid-viewer load should bounce back to sign-in.
