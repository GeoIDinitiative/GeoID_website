# GeoHUB Social — the network service

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

- **Real-time chat.** Messages poll (10 s while the conversation is open).
  Durable Objects + WebSockets are the upgrade when usage asks for it.
- **ORCID sign-in.** `orcid_verified` exists and the Verified Researcher badge
  reads it; the OAuth round trip needs an ORCID client id first.
- **Payments in the marketplace.** Paid datasets, services and consultancy are
  listed as opportunities (`meta.type: service`) with a link out; nothing is
  bought through GeoID.
