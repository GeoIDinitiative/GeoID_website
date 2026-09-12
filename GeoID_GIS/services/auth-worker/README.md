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

4. **The members list.**

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

5. **Deploy, and point the site at it.**

       npx wrangler deploy

   Then add to the pages that need it (the GIS viewer, the hub, the sign-in
   page — `stamp.py` leaves a meta tag alone):

       <meta name="geoid-auth" content="https://auth.geoidinitiative.com">

   **Until that tag exists, membership is off and every gate stands open.**
   That is deliberate: asking somebody to sign in to a service that does not
   exist would lock the app against everybody, including you.

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
