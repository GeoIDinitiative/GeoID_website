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
# IT DEPLOYS TO workers.dev FIRST, deliberately. A Workers route on
# auth.geoidinitiative.com needs a DNS record on that zone, and a deploy that
# fails for want of one looks exactly like a deploy that failed on code. Prove
# the service runs on the subdomain Cloudflare gives you free, then attach the
# domain. That is also why SELF_ORIGIN is left alone here: it is the one value
# that must match wherever the Worker actually answers.

set -euo pipefail
cd "$(dirname "$0")"

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: ./setup.sh you@example.com" >&2
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

cat <<NOTE

Done. Read it back with:
  npx wrangler kv key get --remote --binding=MEMBERS "member:$EMAIL"

Still yours, when you want the service on auth.geoidinitiative.com rather
than the workers.dev subdomain:
  1. a DNS record for auth.geoidinitiative.com on the zone, proxied
  2. SELF_ORIGIN in wrangler.toml set to that origin, then redeploy
  3. the same origin registered as a redirect URI in the Google console
  4. uncomment the three geoid-auth meta tags (runbook section 4)
NOTE
