# Earth Engine image service

Returns a rendered PNG and its bounds for a chosen Earth Engine collection, so
the static viewer can drape it on the globe without holding any credential.

The service account key stays in this deployment. It must never be given to the
page: anything the browser holds, anyone viewing source can read.

## What it answers

    GET ?list
      -> { datasets: [ { id, name, scale, attribution }, ... ] }

    GET ?dataset=<id>&bbox=<w,s,e,n>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
      -> { imageUrl, dataset, name, bounds, bands, scale, from, to, crs,
           attribution }

`imageUrl` is a short-lived Earth Engine thumbnail URL. The page fetches it
directly; this service never proxies the image itself.

Errors come back as `{ error }` with a 4xx or 5xx status, so a failure is
distinguishable from an empty result.

## Before deploying

This is set up against project `geoid-504623` and the service account
`geoid-ee@geoid-504623.iam.gserviceaccount.com`.

1. Register the Cloud project for Earth Engine at
   https://code.earthengine.google.com/register
2. Register the service account for Earth Engine as well -- registering the
   project alone is not enough, and the omission surfaces as a permission error
   on the first request rather than at deploy.
3. Grant it no more than it needs. Earth Engine access is the only requirement.
4. Enable billing on the project. Cloud Functions, Run, Build and Artifact
   Registry all require it, even for work that stays inside their free tiers.
   Nothing deploys until this is done; running locally does not need it.

## Running it locally first

Deploying needs billing enabled on the project -- Cloud Functions, Run, Build and
Artifact Registry all require it, even within their free tiers. Running it here
does not, and it talks to the same Earth Engine, so the whole thing can be
proved before deciding about that.

Sign in so the service picks up your own credentials. Your account is already
registered with Earth Engine, so no service account and no key file are needed:

    gcloud auth application-default login \
      --scopes=https://www.googleapis.com/auth/earthengine,https://www.googleapis.com/auth/cloud-platform

Then:

    npm install
    npm start

It listens on http://localhost:8130. Point the viewer's Modelled Data endpoint
at that and it behaves exactly as the deployed version would.

## Deploying

As a Cloud Function (2nd gen):

    gcloud functions deploy geeImage \
      --gen2 --runtime=nodejs20 --region=europe-west2 \
      --source=. --entry-point=geeImage \
      --trigger-http --allow-unauthenticated \
      --service-account=geoid-ee@geoid-504623.iam.gserviceaccount.com \
      --set-env-vars=^@^ALLOWED_ORIGINS=https://geoidinitiative.com,https://www.geoidinitiative.com,http://localhost:8125

The `^@^` prefix changes the separator gcloud uses between variables to `@`.
Without it gcloud splits the value on its commas and rejects the second origin
as a malformed variable, since a comma is how it separates one variable from the
next. Any character not in the value will do in its place.

With `--service-account`, application default credentials are used and no key
file is needed anywhere. That is the safest arrangement: there is no key to
leak. Only if you cannot attach the account directly, pass the JSON key as
`EE_SERVICE_ACCOUNT_KEY` through Secret Manager -- never as a plain env var and
never in this repository.

`--allow-unauthenticated` makes the endpoint public, which it must be for a
static site to call it. `ALLOWED_ORIGINS` is what stops other sites spending
your quota, so set it to your real origins rather than leaving it open.

An origin is a scheme, a host and a port -- `https://geoidinitiative.com` -- and
nothing else. No trailing slash and no path: the browser sends it in that exact
form, and a value that does not match character for character is simply not
recognised, which shows up as a CORS failure rather than as a wrong setting.
`www.` counts as a different host, so list it separately if the site answers on
both.

Omitting the variable altogether allows any origin. That is a reasonable way to
get something working, but it means any page anywhere can call the endpoint and
spend the project's Earth Engine quota, so it is worth setting before the URL is
in anything public.

## Cost and quota

Earth Engine bills the project this runs in. `DATASETS` is a fixed list rather
than anything the caller supplies, so a request cannot be pointed at an
arbitrary asset, and thumbnails are capped at 1024 px. Responses carry a 15
minute cache header.

## A note on authentication

The Earth Engine client offers OAuth, a popup, and a private key. It has **no**
entry point that reads application default credentials, despite that being the
recommended way to run on Cloud Functions. This service therefore fetches a
token itself through `google-auth-library` and hands it to the client with
`ee.data.setAuthToken`, refreshing it as it expires.

That is why `google-auth-library` is a dependency. It is not incidental.
