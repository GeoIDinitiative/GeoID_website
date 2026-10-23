# GeoID Network — the network service

A second Cloudflare Worker beside `geoid-auth`, at `social.geoidinitiative.com`.
The API it serves is in [CONTRACT.md](CONTRACT.md); the page that uses it is
`/social/`; the viewer's community layer, shared-scene links and "Share to
Social" button talk to it from `GeoID_GIS/viewer/gis/`.

**This one does hold members' content.** The membership service holds an
entitlement and nothing else; this holds what members chose to publish here —
profiles, posts, comments, messages, review drafts they upload, and project
manifests they publish. A manifest is the workspace BY REFERENCE (layers,
camera, parameters), never the datasets; those stay at their source or on the
member's own disk. The privacy notice says so.

## How sign-in reaches it

The session cookie belongs to `auth.geoidinitiative.com` and never reaches this
origin. The page asks the auth Worker for a one-hour `aud: "social"` token
(`POST /auth/social-token`) and sends it here as a Bearer. Both Workers hold
the same `SOCIAL_JWT_SECRET` -- a key of its own, so the site session key is
never shared or moved; the audience keeps a site session or a data pass from
being replayed here.

## Deploying it

All of these sign in to the Cloudflare account, so they are yours to run:

    cd GeoID_GIS/services/social-worker
    npx wrangler d1 create geoid-social            # paste database_id into wrangler.toml
    npx wrangler r2 bucket create geoid-social-media
    npx wrangler secret put SOCIAL_JWT_SECRET       # a new random key; the SAME value on geoid-auth
    npx wrangler d1 migrations apply geoid-social --remote
    npx wrangler deploy

Then redeploy `geoid-auth` (it gained `/auth/social-token`).

### v1.3 engagement: email, crons, live messages

    npx wrangler d1 migrations apply geoid-social --remote   # 0006_mail.sql (mail_prefs, mail_queue), BEFORE deploying
    npx wrangler secret put RESEND_API_KEY                   # the same Resend account geoid-auth uses
    npx wrangler deploy                                      # also creates the ChatRoom Durable Object and the crons

- **Email** goes through Resend from `MAIL_FROM` in wrangler.toml (a sender on
  the domain already verified there for geoid-auth). **Without
  `RESEND_API_KEY` (or with `MAIL_FROM` empty) nothing is sent:** important
  notifications are still queued in `mail_queue`, expire into the digest after
  a day, and digests are simply not composed. Settings tells members email is
  not switched on yet. Unsubscribe links are signed with `SOCIAL_JWT_SECRET`
  (plus a suffix of their own), so rotating that secret voids old links.
- **Crons** (wrangler.toml `[triggers]`): every 15 minutes for reminders, the
  immediate queue and digests (from `DIGEST_HOUR_UTC`); 03:17 UTC daily for
  pruning and badge refresh. Try one locally with
  `npx wrangler dev --test-scheduled` and `curl "http://localhost:8790/__scheduled?cron=*/15+*+*+*+*"`.
- **Live messages** need the `[[durable_objects.bindings]]` CHAT →
  `ChatRoom` and the `[[migrations]]` tag `v1-chatroom` (SQLite-backed,
  hibernating WebSockets, so it is available on the free plan). `wrangler
  deploy` applies the migration once; never edit or reuse the tag. The page
  falls back to its 10-second poll whenever the socket is unavailable, so the
  Worker can ship before or without it. The social page's CSP names
  `wss://social.geoidinitiative.com` (social/index.html). Locally, tickets
  are signed with the social secret, so give `wrangler dev` one
  (`--var SOCIAL_JWT_SECRET:dev-only-secret`) or the page simply polls.

### v1.3 identity: organisations, publication checks, ORCID

    npx wrangler d1 migrations apply geoid-social --remote   # 0004_orgs.sql, BEFORE deploying
    npx wrangler secret put ORCID_CLIENT_ID                  # optional: ORCID linking
    npx wrangler secret put ORCID_CLIENT_SECRET

- **ORCID linking** is off until both `ORCID_CLIENT_ID` and
  `ORCID_CLIENT_SECRET` are set: every `/v1/orcid/*` route but `status`
  answers 503 "ORCID linking is not set up yet" and Settings says so instead of
  offering the button. Register a public-API client at
  orcid.org/developer-tools with the redirect URI
  `https://social.geoidinitiative.com/v1/orcid/callback` (`SELF_ORIGIN` +
  `/v1/orcid/callback`). `ORCID_BASE` (a var, default `https://orcid.org`)
  can point at `https://sandbox.orcid.org` with a sandbox client. The OAuth
  `state` is signed with `SOCIAL_JWT_SECRET`, so that must be set too.
- **Publication checks** call `api.crossref.org` from the Worker (no page CSP
  change). Optional `CROSSREF_MAILTO` (a var) puts the calls in Crossref's
  "polite" pool.
- **Organisations** are verified by the `ADMINS` addresses at
  `/social/#/orgs?pending=1`. Verifying one makes every member whose sign-in
  address is at its domains a verified affiliate; check the domains first.

## Working on it locally

    node --test test/*.test.mjs                    # the whole API against node:sqlite
    npx wrangler d1 migrations apply geoid-social --local
    npx wrangler dev --var DEV_AUTH:1 --var SELF_ORIGIN:http://localhost:8790 \
        --local-upstream localhost:8790 --port 8790

(`--local-upstream` matters: the custom-domain route otherwise makes wrangler
rewrite the request host to social.geoidinitiative.com, and the dev sign-in
below is refused off localhost by design. 8790 because 8787 is the Atlas broker.)

With `DEV_AUTH=1`, a request **to localhost** may name its user in an
`X-Dev-User` header instead of carrying a token. In the browser, on
http://localhost:8125:

    localStorage['geoid:social-base'] = 'http://localhost:8790'
    localStorage['geoid:social-dev-user'] = 'you@example.com'

## Moderation

`ADMINS` in wrangler.toml lists the addresses that see every report
(`/social/#/mod`). Community moderators see reports about posts in their own
communities. Every action, and every workspace grant or revocation, is written
to the `audit` table.

## What is deliberately not here yet

- **Payments in the marketplace.** Paid datasets, services and consultancy are
  listed as opportunities (`meta.type: service`) with a link out; nothing is
  bought through GeoID.
