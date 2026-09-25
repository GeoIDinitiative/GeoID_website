#!/usr/bin/env bash
#
# Everything after `npx wrangler login`, in one go.
#
#     npx wrangler login          # once, opens a browser — only you can do it
#     ./setup.sh you@example.com
#
# WHY A SCRIPT AND NOT A LIST OF COMMANDS. The list is in the runbook and it
# is nine steps, four of which fail in ways that look like each other: a KV id
# not written back, a secret set against the wrong Worker, a deploy that is
# really a DNS problem. Run in order by one thing, each step either works or
# says which one did not.
#
# IT READS THE SECRETS FROM .dev.vars, which is gitignored and which you have
# already filled in for local testing. So nothing is typed twice, nothing goes
# through a clipboard, and nothing appears in a shell history.
#
# A DEPLOY THAT SUCCEEDS IS NOT A SERVICE THAT ANSWERS. `wrangler.toml` has a
# [[routes]] block, so deploy attaches auth.geoidinitiative.com/* and reports
# success -- and the hostname still does not resolve, because a ROUTE says
# "run this Worker for traffic that arrives here" and nothing makes traffic
# arrive. That needs a DNS record, which is what Cloudflare's "Custom Domain"
# button creates alongside the binding. So this checks at the end rather than
# letting a green deploy read as a working service.

set -euo pipefail
cd "$(dirname "$0")"

# THE ADDRESS IS THE ONE YOU WILL SIGN IN WITH, which is not necessarily the
# one your Cloudflare account uses -- membership is looked up by the address
# the PROVIDER reports. Sign in with Google and it is the Google account's
# address. Passing the wrong one leaves you an explorer with a member record
# nobody can reach, which is what happened the first time this was run.
EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: ./setup.sh you@example.com" >&2
  echo "       the address your SIGN-IN provider reports, not your Cloudflare login" >&2
  exit 2
fi
if [ ! -f .dev.vars ]; then
  echo ".dev.vars is missing. See docs/security-runbook.md section 4." >&2
  exit 2
fi
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "Not logged in to Cloudflare. Run:  npx wrangler login" >&2
  exit 2
fi

# A value out of .dev.vars. Never echoed, never in an argument list.
read_var() { sed -n "s/^$1=//p" .dev.vars | head -1; }

for key in JWT_SECRET GOOGLE_CLIENT_SECRET; do
  if [ -z "$(read_var "$key")" ]; then
    echo "$key is missing from .dev.vars" >&2
    exit 2
  fi
done

echo "==> KV namespace"
if grep -q 'id = "REPLACE-WITH-YOUR-KV-NAMESPACE-ID"' wrangler.toml; then
  out=$(npx wrangler kv namespace create MEMBERS 2>&1) || { echo "$out" >&2; exit 1; }
  id=$(printf '%s' "$out" | grep -oE '[0-9a-f]{32}' | head -1)
  if [ -z "$id" ]; then
    echo "Could not find the namespace id in wrangler's reply:" >&2
    echo "$out" >&2
    exit 1
  fi
  sed -i "s/REPLACE-WITH-YOUR-KV-NAMESPACE-ID/$id/" wrangler.toml
  echo "    created, and wrote the id into wrangler.toml"
else
  echo "    already set in wrangler.toml, leaving it alone"
fi

echo "==> secrets"
for key in JWT_SECRET GOOGLE_CLIENT_SECRET; do
  printf '%s' "$(read_var "$key")" | npx wrangler secret put "$key" >/dev/null
  echo "    $key set"
done

echo "==> deploy"
npx wrangler deploy

echo "==> membership for $EMAIL"
# Ten years. `plan: owner` opens every feature including ones added later, and
# worker.js refuses to lower an owner, so a Stripe test cannot downgrade it.
until_s=$(date -u -d "+10 years" +%s)
npx wrangler kv key put --remote --binding=MEMBERS \
  "member:$EMAIL" "{\"plan\":\"owner\",\"until\":$until_s,\"source\":\"founder\"}"

ORIGIN=$(sed -n 's/^SELF_ORIGIN = "\(.*\)"/\1/p' wrangler.toml | head -1)
echo "==> can it be reached?"
if curl -s -o /dev/null --max-time 12 "$ORIGIN/auth/me" 2>/dev/null; then
  echo "    $ORIGIN answers"
else
  echo "    $ORIGIN does NOT answer yet."
  echo "    The deploy worked; the hostname has no DNS record. In the dashboard:"
  echo "    Workers & Pages -> this worker -> Settings -> Domains & Routes"
  echo "      -> Add -> Custom Domain. That makes the record AND the binding."
fi

cat <<NOTE

Done. Read it back with:
  npx wrangler kv key get --remote --binding=MEMBERS "member:$EMAIL"

If it does not answer yet, that is DNS and nothing else -- the deploy and the
route are already done. Cloudflare dashboard:

  Workers & Pages -> this worker -> Settings -> Domains & Routes
    -> Add -> Custom Domain -> the hostname in SELF_ORIGIN

A ROUTE and a CUSTOM DOMAIN are not the same thing and you want both: the
route runs the Worker for traffic that arrives, the custom domain is what
makes traffic able to arrive.

Then, to make the SITE use it: uncomment the three geoid-auth meta tags
(docs/security-runbook.md section 4) and re-run scripts/csp.py.
NOTE
