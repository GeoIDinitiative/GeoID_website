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
- **Do not send a whole-site `Content-Security-Policy` here.** The pages that
  should have one already carry it in a meta tag, measured page by page; a
  blanket header would apply it to the viewers too, and their `connect-src`
  is dozens of services.
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
curl -sSI https://geoidinitiative.com/ | grep -iE 'strict-transport|x-content-type|referrer-policy|frame'
curl -sSI https://geoidinitiative.com/sw.js | grep -i cache-control
```

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
# expect: HttpOnly; Secure; SameSite=Lax; Domain=.geoidinitiative.com
```

The fragment on the redirect must read `#claims=…` and **must not** contain
`token=`. If it does, the old Worker is still deployed.

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
