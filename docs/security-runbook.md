# The security runbook

What this repository carries, and what has to be done outside it. Everything
under **In the repository** is live the moment `main` is deployed; everything
under **Not in the repository** needs a dashboard or a CLI and is the account
owner's to do. Nothing in the second list is done.

Every claim below was measured rather than assumed, and where a measurement
disagreed with a comment already in the tree, the measurement won.

---

## In the repository (ships with the push)

| | |
| --- | --- |
| Secrets cannot be committed | `.env`, `.dev.vars`, `*.pem`, service-account and client-secret patterns are in `.gitignore`. The history was swept and holds none. |
| Content pages carry a CSP | A `<meta http-equiv="Content-Security-Policy">` on 19 pages, measured clean — 0 refusals across all of them. |
| The referrer is bounded | `strict-origin-when-cross-origin`, beside the CSP. |
| No secret reaches a log | Swept across JS, TS and Python. The Stripe webhook's reply deliberately withholds the member's address. |
| Four XSS sinks closed | `escape-html.js`, with source pins that fail if a call site goes back to raw. |
| A zip bomb is refused | Bounded inflation in `import-manager.js`. Measured: a 697 KB archive inflating 1029:1 to 700 MB is refused in 294 ms on a 7 MB heap; a 1 MB member still reads. |
| The session is an httpOnly cookie | The signed JWT never reaches JavaScript. `localStorage` holds display claims only, which are worth nothing forged. |
| Earth Engine is gated | The Cloud Function verifies a membership pass and rate-limits; it used to take none at all. |
| Upstream errors are not echoed | Earth Engine's own messages name assets and project paths; the caller gets the fact, the operator gets the detail. |
| Dependencies | `npm audit` clean of everything fixable; the lockfile is tracked so a deploy is reproducible. One advisory remains and is argued below. |

### The one advisory left, and why it stands

`npm audit` reports `uuid < 11.1.1` through
`@google/earthengine → googleapis@92 → googleapis-common`. The advisory is
*"missing buffer bounds check in v3/v5/v6 when `buf` is provided"*.
`googleapis-common` calls `uuid.v4()` twice, for multipart boundaries, with
no `buf` argument — so the vulnerable path is not reachable. npm's only
offered fix downgrades `@google/earthengine` to 0.1.185, which is older and
breaking, and an `overrides` jump from uuid 8 to 11 changes the module's
shape under a dependency that asks for `^8.0.0`.

**Recheck it when `@google/earthengine` ships a `googleapis` bump.**

---

## Not in the repository (needs your dashboard or CLI)

### 1. Security headers — Cloudflare

**`_headers` in this repo does nothing.** The site is GitHub Pages behind
Cloudflare, and `_headers` is a Cloudflare *Pages* convention; measured on
the live site, `/styles/site-nav.css` and `/sw.js` both still answer
`cache-control: max-age=14400`, which is the very thing that file exists to
prevent. Four headers cannot be set from a meta tag at all.

**Cloudflare dashboard → Rules → Transform Rules → Modify Response Header →
Create rule.** Match `Hostname equals geoidinitiative.com`, and *set static*:

```
Strict-Transport-Security      max-age=31536000; includeSubDomains; preload
X-Content-Type-Options         nosniff
Referrer-Policy                strict-origin-when-cross-origin
X-Frame-Options                SAMEORIGIN
Content-Security-Policy        frame-ancestors 'self'
Permissions-Policy             camera=(), microphone=(), payment=(), usb=(), interest-cohort=()
Cross-Origin-Opener-Policy     same-origin-allow-popups
```

- `frame-ancestors` is the modern clickjacking control and `X-Frame-Options`
  is the fallback for older browsers. Both say same-origin, because the
  GeoHUB shell frames its own viewers.
- **`same-origin-allow-popups`, not `same-origin`**: the OAuth sign-in opens
  a provider in a popup, and the strict value breaks that handshake.
- **Do not send a whole-site `Content-Security-Policy` here.** All 35 pages
  carry their own in a meta tag now — 19 content pages on a tight profile and
  16 app pages on one whose `connect-src` is deliberately broad, because the
  WFS importer, the sidecar and the Atlas hub fetch from addresses the reader
  types. A blanket header would put one of those two profiles on the other's
  pages. `frame-ancestors` is the exception and belongs here: a meta tag
  cannot carry it.
- Add HSTS `preload` to the browser preload list only after the header has
  been live and correct for a few months. It is very hard to undo.

**Second rule, same place — the cache:** match
`URI Path equals /sw.js` and set `Cache-Control: no-cache`. A service worker
held for four hours is a released fix that cannot reach anybody for four
hours. Consider the same for `/styles/*` and `/scripts/*`
(`public, max-age=0, must-revalidate`), which is what `_headers` was asking
for and never got.

**Verify:**

```bash
python3 scripts/headers-verify.py
```

It scores all seven plus `/sw.js`, names what each one is for, and exits
non-zero while any is missing, so it can gate a deploy once the rules are in.
Measured on 2026-09-25, before the rules exist: **8 of 8 not set**, with
`/sw.js` on `max-age=14400` — a released fix that cannot reach anybody for
four hours, which is the thing `_headers` was asking for and never got.

It sends a browser-shaped `User-Agent` on purpose: Cloudflare's bot rules
answer `Python-urllib` with 403 on this zone, and a checker that read that as
a missing header would send you into the dashboard after a fault that is not
there.

### 2. Rate limiting at the edge — Cloudflare

The Workers count in KV and the Earth Engine function counts in memory; both
say so in their own comments. Neither is a defence against a distributed
flood, and the edge is.

**Security → WAF → Rate limiting rules.** A rule on
`auth.geoidinitiative.com/auth/*` of roughly 60 requests a minute per IP, and
one on `data.geoidinitiative.com` generous enough not to catch a member
loading a tile pyramid (several hundred a minute).

### 3. The Earth Engine function — `gcloud`

It now refuses a request that carries no membership pass. **Deploying it
without `JWT_SECRET` set makes it refuse everybody**, which is the correct
failure but not a surprise anybody wants.

```bash
cd GeoID_GIS/services/gee-tiles

gcloud functions deploy geeImage \
  --gen2 --runtime=nodejs22 --region=europe-west2 \
  --source=. --entry-point=geeImage --trigger-http --allow-unauthenticated \
  --max-instances=10 \
  --set-env-vars=ALLOWED_ORIGINS="https://geoidinitiative.com,https://www.geoidinitiative.com,http://localhost:8125" \
  --set-secrets=JWT_SECRET=geoid-jwt-secret:latest,EE_SERVICE_ACCOUNT_KEY=geoid-ee-key:latest
```

- **`JWT_SECRET` must be the same value the membership Worker signs with**
  and the data gate verifies. Three services, one secret.
- **`--max-instances` is the real ceiling on the bill.** The in-memory limit
  bounds one warm instance; instances scale out.
- `--allow-unauthenticated` is right: the function does its own authorisation
  now, and Google's IAM layer cannot see a membership.
- `REQUIRE_MEMBERSHIP=0` reopens it. There is no reason to set it.

**Verify — the refusal is the thing to check, not the success:**

```bash
# No pass: must be 402, not a picture.
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://europe-west2-geoid-504623.cloudfunctions.net/geeImage?dataset=CHIRPS&bbox=-1,50,0,51&from=2025-01-01&to=2025-01-02'

# The catalogue stays open: 200.
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://europe-west2-geoid-504623.cloudfunctions.net/geeImage?list'
```

### 4. The membership Worker — `wrangler`

**THE SMALLEST DEPLOY THAT WORKS IS THREE SECRETS, NOT SEVEN.** The full list
below covers every sign-in door; if the people who need accounts on day one
have Google addresses, Google alone is enough and Microsoft, GitHub and the
one-time-link mailer can all wait. Skipping them costs nothing later -- adding
a provider is a secret and a redeploy, with no migration.

```bash
cd GeoID_GIS/services/auth-worker
npx wrangler kv namespace create MEMBERS     # paste the id into wrangler.toml
npx wrangler secret put JWT_SECRET           # any long random string
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

`GOOGLE_CLIENT_ID` is a plain var in `wrangler.toml`, not a secret -- it
travels in the sign-in URL for anyone to read. Only the SECRET goes in with
`wrangler secret put`. In the Google console the redirect URI must be
`https://auth.geoidinitiative.com/auth/callback/google`, exactly.

**NOBODY PAYS TO BE ADDED.** The KV entry IS the membership; Stripe's webhook
writes one when somebody buys, and writing your own by hand is the same act
without the money. There are also no CREDENTIALS to store for a member: the
record is `{plan, until, source}` against an address, and the authentication
is Google's. The Worker never learns or keeps anything about HOW somebody
signs in -- it looks the address up after Google has vouched for it.

**The order matters, and four of these only you can do:**

| | who |
| --- | --- |
| 1. Google Cloud Console → OAuth client → id + secret | you |
| 2. DNS: a CUSTOM DOMAIN, not a route (see below) | either |
| 3. `npx wrangler login` (opens a browser) | you |
| 4. `npx wrangler kv namespace create MEMBERS`, id into wrangler.toml | either |
| 5. `wrangler secret put` JWT_SECRET, GOOGLE_CLIENT_SECRET | you (interactive) |
| 6. `GOOGLE_CLIENT_ID` into `[vars]` | either |
| 7. `npx wrangler deploy` | either |
| 8. the KV entry below, `plan: "owner"` | either |
| 9. uncomment the four `geoid-auth` meta tags | either |

**TO TEST THE FLOW WITHOUT DEPLOYING ANYTHING**, which is worth doing first
-- and worth doing first because this Worker had never once been STARTED
until 2026-09-25, and the moment it was it turned out it could not run at all
(see constants.js). A suite that imports a module proves the module parses.

`npx wrangler dev` runs it locally against a local KV. Everything it needs
goes in `.dev.vars` beside `wrangler.toml` -- gitignored, never committed:

```
JWT_SECRET=<openssl rand -base64 48>
GOOGLE_CLIENT_SECRET=<GOCSPX-..., from the Google console>
SELF_ORIGIN=http://localhost:8787
```

**`.dev.vars` OVERRIDES `[vars]`, which is the whole trick** -- measured:
with `SELF_ORIGIN` in it, `wrangler dev` reports that binding as "(hidden)"
rather than the production URL from `wrangler.toml`. So the production origin
is never edited and there is nothing to remember to undo, which is how a
localhost URL otherwise ends up deployed.

`JWT_SECRET` is one you invent -- it signs the Worker's own session tokens and
has nothing to do with Google. Changing it signs everybody out, and local and
production must use the SAME value or a session made against one is refused by
the other.

Register `http://localhost:8787/auth/callback/google` as a second redirect URI
in the Google console (Google allows plain http for localhost), point the
site's `geoid-auth` meta tag at `http://localhost:8787`, and the whole
sign-in -- the redirect, the cookie, the member lookup -- runs on your machine
against nothing live. Steps 2 and 7 are not needed for that.

**Then make yourself the master account.** One KV entry, and `plan: "owner"`
is the flag that opens every feature including ones added later:

```bash
npx wrangler kv key put --binding=MEMBERS \
  "member:YOU@example.com" \
  '{"plan":"owner","until":2105932207,"source":"founder"}'
```

`until` is unix seconds; 2105932207 is Sep 2036. An owner is a member too, so
nothing has to test for both -- and `grant()` and the cancellation path both
refuse to lower an owner (worker.js, "never lowering an owner"), so a Stripe
test purchase or a refund against your own address cannot downgrade you.

**Do not put a real address in a tracked file.** This repository is public and
serves from it; the command above is for a terminal, not a commit.

**Note there is NO PASSWORD to set, for anyone, ever.** Sign-in is Google,
Microsoft or GitHub, or a one-time link to an inbox. That is the answer to
"hash passwords securely": there are none to hash, so there is no reset flow
to abuse, no credential stuffing and no password breach to disclose.

**The full set, when the other doors are wanted:**


Not deployed today: the KV id in `wrangler.toml` is a placeholder and no page
carries the `geoid-auth` meta tag. That is why the cookie refactor could be
made without breaking a live user.

```bash
cd GeoID_GIS/services/auth-worker
npx wrangler kv namespace create MEMBERS        # put the id in wrangler.toml
npx wrangler secret put JWT_SECRET              # the same value as above
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put MS_CLIENT_SECRET
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # the whsec_… Stripe shows
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

Then, in each provider's console, register the redirect URI
`https://auth.geoidinitiative.com/auth/callback/<provider>` exactly, and in
Stripe → Developers → Webhooks add
`https://auth.geoidinitiative.com/stripe/webhook` for
`checkout.session.completed`, `invoice.paid`,
`customer.subscription.deleted` and `charge.refunded`.

**Verify the cookie, which is the whole point of the change:**

```bash
curl -sSI 'https://auth.geoidinitiative.com/auth/callback/email?token=…' | grep -i set-cookie
# expect: HttpOnly; Secure; SameSite=Lax — and NO Domain=
# A Domain would attach a week-long session to data.geoidinitiative.com,
# which is the bucket: the credential would reach its access logs.
```

The fragment on the redirect must read `#claims=…` and **must not** contain
`token=`. If it does, the old Worker is still deployed.

**A ROUTE IS NOT A DNS RECORD, and this is the step that looked done and was
not.** A `[[routes]]` block says "run this Worker for traffic that arrives at
this hostname" and makes nothing arrive: `wrangler deploy` is green, the
binding is real, and the hostname does not resolve. What creates the record as
well as the binding is a CUSTOM DOMAIN, which in `wrangler.toml` is

```toml
[[routes]]
pattern = "auth.geoidinitiative.com"   # a hostname, so no /*
custom_domain = true
```

and then `npx wrangler deploy`. One hostname cannot hold both, so the old
route is removed on the way past (wrangler asks). Cloudflare issues the
certificate; the record shows up within a minute or so. The dashboard's
Workers & Pages → the worker → Settings → Domains & Routes → Add → Custom
Domain is the same button.

**Then turn it on in the pages.** FOUR carry the tag commented out — the
runbook said three for a while and `account/index.html` is the fourth, which
is the page somebody LANDS ON after signing in, so without it a sign-in
completes and arrives at a page that says membership is not open:

```bash
grep -rln 'name="geoid-auth"' --include=index.html . | grep -v page_backups
# membership/, membership/welcome/, sign-in/, account/
sed -i 's|<!-- \(<meta name="geoid-auth"[^>]*>\) -->|\1|' \
  membership/index.html membership/welcome/index.html \
  sign-in/index.html account/index.html
python3 scripts/csp.py && node GeoID_GIS/tests/run.mjs
```

`scripts/csp.py` afterwards because those pages carry a policy whose
`connect-src` must name the Worker's origin, and the suite because
`csp.test.mjs` fails if it does not.

**The tag may go on before the service answers.** The sign-in page asks
`/auth/doors` which sign-ins the deployment has, so an unreachable service is
a sentence naming the host rather than four buttons that go nowhere, and a
service with only Google configured draws only Google. That is why the order
above is safe either way round.

### 5. The data gate Worker — `wrangler`

```bash
cd GeoID_GIS/services/data-gate
npx wrangler secret put JWT_SECRET              # the same value again
npx wrangler deploy
```

### 6. Supabase — decide, then act

`tools/supabase/` is **not used by this site.** Nothing under `scripts/` or
`GeoID_GIS/` imports a Supabase client; the membership frontend it describes
does not exist on this branch, and the live path is the Cloudflare Worker
above. Its `schema.sql` does enable row-level security correctly (read your
own row; only the service role may write).

Either delete that directory, or — if a project exists — check it in the
Supabase dashboard:

- **Database → Tables → `memberships` → RLS enabled**, with the read-own-row
  policy and no insert/update/delete policy for `anon`.
- **Settings → API**: the `service_role` key must appear in no client code.
  It is in none here.
- **Authentication → Providers → Email → Confirm email = ON.** The README
  suggests turning it off for development; a live project must not.

Until one of those is done, that directory reads as a live backend and is
not one.

---

## What was considered and deliberately not done

- **A strict `script-src` with nonces or hashes on the content pages.** There
  is no build step; a hash goes stale on the next hand edit and a nonce needs
  a server that generates one per response. GitHub Pages does neither. The
  policy shipped still refuses an attacker-hosted script, a `<base>` rewrite,
  an injected form's destination and plugin content.
- **A CSP over the viewers.** Their `connect-src` is dozens of services and a
  list that breaks the app the first time a dataset is added is worse than no
  list.
- **Forcing `uuid` to 11 with an `overrides` block.** Argued above.
- **Running a real GALES solve to test the services.** A 4-rank Etna solve
  rebooted this machine once already.
