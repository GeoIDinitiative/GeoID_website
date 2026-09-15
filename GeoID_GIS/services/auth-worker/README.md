# The membership service

A Cloudflare Worker on the account that already serves `data.geoidinitiative.com`.
It adds no vendor and, at this scale, no bill.

**It holds no work.** A project is a folder on the member's own disk, their own
browser storage, or their own machine through the sidecar. What is stored here
is an entitlement — a verified email address and until when — and that is the
whole of what a privacy notice for this has to cover.

**There are no passwords.** Sign-in is Google's or GitHub's, so there is no
password of ours to hold, to leak, or to reset.

## Deploying it

Everything below is yours to run: none of it can be done from here, because
each step signs in to an account only you hold.

1. **A signing key.** Any long random string; both Workers must have the same one.

       openssl rand -base64 48
       npx wrangler secret put JWT_SECRET

2. **Google.** In the Google Cloud console, APIs & Services → Credentials → an
   OAuth 2.0 Client ID, type *Web application*. Authorised redirect URI:

       https://auth.geoidinitiative.com/auth/callback/google

   Then `npx wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

3. **GitHub.** Settings → Developer settings → OAuth Apps → New. Callback URL:

       https://auth.geoidinitiative.com/auth/callback/github

   Then `npx wrangler secret put GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

4. **Microsoft** — for an Outlook, Hotmail or Live address, and for work and
   school accounts. In the Azure portal (Microsoft Entra ID) → App
   registrations → New registration. Supported account types must be
   *Accounts in any organizational directory and personal Microsoft accounts*,
   or a personal address is refused by Microsoft before it reaches us.
   Redirect URI, type *Web*:

       https://auth.geoidinitiative.com/auth/callback/microsoft

   Under Certificates & secrets make a client secret (note its expiry —
   Microsoft caps it at two years). Then `npx wrangler secret put
   MS_CLIENT_ID` (the *Application (client) ID*) and `MS_CLIENT_SECRET` (the
   secret's *Value*, not its id).

5. **The one-time link by email** — the door for every other address: an
   iCloud, a university's, anything without a Google, GitHub or Microsoft
   account behind it. A member types the address on their receipt, the
   Worker mails a signed link that works once for fifteen minutes, and
   following it signs them in. It is sent only where the address holds a
   membership, and the form answers the same sentence either way, so it
   cannot be used to find out who is a member or to mail strangers.

   Sending needs a mail service the Worker can call; Resend is the one wired
   (free tier, an HTTP API, no SMTP). At resend.com: add the domain
   `geoidinitiative.com` and put the DNS records it gives (SPF, DKIM) into
   Cloudflare — the sender in `wrangler.toml`'s `MAIL_FROM` has to be on a
   verified domain or the mail is refused — then make an API key:

       npx wrangler secret put RESEND_API_KEY

   Without the key the form says email sign-in is not set up and the three
   providers remain.

6. **The members list.**

       npx wrangler kv namespace create MEMBERS

   Put its id into `wrangler.toml`, then add a member:

       npx wrangler kv key put --binding=MEMBERS \
         "member:someone@example.org" '{"until": 1790000000, "plan": "member"}'

   `until` is epoch seconds. An address that is not in the list signs in as an
   explorer, which is a real state rather than a failure.

   **The master account.** Give an entry `"plan": "owner"` and it opens every
   feature — including ones added after it was made, which is the whole reason
   it is a flag rather than a list:

       npx wrangler kv key put --binding=MEMBERS \
         "member:you@geoidinitiative.com" '{"until": 4102444800, "plan": "owner"}'

   Make one for each person who works on this. It is what lets the site be used
   with every gate ON — exactly as a visitor sees it — rather than only with
   membership switched off, which is the state everything is tested in
   otherwise. It still expires: `until` is far out here, not absent, because a
   credential that never runs out is one nobody ever revokes.

7. **Deploy, and point the site at it.**

       npx wrangler deploy

   Then add to the pages that need it (the GIS viewer, the hub, the sign-in
   page — `stamp.py` leaves a meta tag alone):

       <meta name="geoid-auth" content="https://auth.geoidinitiative.com">

   **Until that tag exists, membership is off and every gate stands open.**
   That is deliberate: asking somebody to sign in to a service that does not
   exist would lock the app against everybody, including you.

## Stripe writes the members list

`POST /stripe/webhook` takes Stripe's signed events and writes the same KV
entries step 4 writes by hand, so a payment becomes a membership with nobody
at a keyboard. In the Stripe dashboard, Developers → Webhooks → Add endpoint:

    https://auth.geoidinitiative.com/stripe/webhook

with these events selected:

- `checkout.session.completed` — the purchase: a year of membership at once
- `invoice.paid` — the first payment and every renewal: until the period's
  end plus a week of grace (Stripe's own retry window for a bounced card)
- `customer.subscription.deleted` — a cancellation: the paid period keeps
  running and the renewal does not
- `charge.refunded` — the 14-day refund the refund page promises: it ends
  the membership

Stripe shows a signing secret (`whsec_…`) when the endpoint is created; put it
into the Worker and nowhere else:

    npx wrangler secret put STRIPE_WEBHOOK_SECRET

Every delivery is verified against that secret, refused if older than five
minutes, and applied once (a retried delivery is a no-op). The address the
membership attaches to is the one Stripe was given at checkout, which is why
the membership page says to pay with the address you sign in with. An entry
with `"plan": "owner"` is never shortened or downgraded by anything Stripe
sends, so a test purchase against a master account costs it nothing.

To try it before going live: `stripe listen --forward-to
https://auth.geoidinitiative.com/stripe/webhook` with the Stripe CLI, or
`stripe trigger checkout.session.completed`, and read the KV entry back with
`npx wrangler kv key get --binding=MEMBERS "member:<address>"`.

## What it issues

A session token, HS256, audience `site`, carrying the email, the name and
whether they are a member. It comes back to the page **in the URL fragment**,
which is never sent to a server, never reaches an access log, and never travels
in a `Referer` — all three of which a query string does.

A session never outlives the membership behind it and never runs more than a
week, so a lapsed member's own copy stops working without anybody reaching into
their browser. `/auth/me` re-reads the entitlement rather than trusting the
token's own copy, because a membership granted or lapsed since was decided here.

`/auth/data-token` issues a **separate, fifteen-minute** token with audience
`data`, for the bucket gate. It is separate because that one travels in a query
string — the bucket is read by three.js's texture loader and by geotiff's range
requests as well as by `fetch`, and only a query string reaches all three. A
query string is logged, so what is logged has to be worth little.

## Revoking

Delete the member's KV entry. `/auth/me` and `/auth/data-token` refuse within
the minute; their session token keeps working for whatever is left of its week
for the things only it gates, which are the courtesy gates (saving and
exporting) rather than the enforced one. To cut that too, rotate `JWT_SECRET` —
which signs everybody out.
