#!/usr/bin/env bash
#
# One-shot Netlify setup + deploy.
#
# Prerequisite (only you can do this — it needs a browser):
#   netlify login
#
# Then:
#   ./scripts/deploy.sh
#
# Reads DATABASE_URL / CRON_SECRET / SPORTSGAMEODDS_API_KEY out of .env.local
# and pushes them to Netlify as environment variables. Secrets never enter git.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "error: .env.local not found" >&2
  exit 1
fi

# Netlify's exit codes here are unreliable — `netlify status` exits 1 when run
# directly but 0 with its output redirected, and `api getCurrentUser` exits 0
# even when logged out. Checking the human-readable output is what actually
# works.
if netlify status 2>&1 | grep -qi "not logged in\|Authentication required"; then
  echo "error: not logged into Netlify." >&2
  echo "       Run:  netlify login" >&2
  exit 1
fi

read_env() {
  grep "^$1=" .env.local | head -1 | cut -d'"' -f2
}

DATABASE_URL="$(read_env DATABASE_URL)"
CRON_SECRET="$(read_env CRON_SECRET)"
SGO_KEY="$(read_env SPORTSGAMEODDS_API_KEY || true)"

if [ -z "$DATABASE_URL" ] || [ -z "$CRON_SECRET" ]; then
  echo "error: DATABASE_URL and CRON_SECRET must be set in .env.local" >&2
  exit 1
fi

# --- link or create the site ------------------------------------------------
if [ ! -f .netlify/state.json ]; then
  echo "▸ Linking site (choose 'Create & configure a new project' if prompted)"
  netlify init
else
  echo "▸ Already linked:"
  netlify status | head -6
fi

# --- environment variables --------------------------------------------------
echo "▸ Setting environment variables"
netlify env:set DATABASE_URL "$DATABASE_URL" --force >/dev/null
netlify env:set CRON_SECRET "$CRON_SECRET" --force >/dev/null
if [ -n "$SGO_KEY" ]; then
  netlify env:set SPORTSGAMEODDS_API_KEY "$SGO_KEY" --force >/dev/null
  echo "  DATABASE_URL, CRON_SECRET, SPORTSGAMEODDS_API_KEY"
else
  echo "  DATABASE_URL, CRON_SECRET  (no props key — layers 1 and 2 only)"
fi

# --- deploy -----------------------------------------------------------------
echo "▸ Building and deploying to production"
netlify deploy --build --prod

SITE_URL="$(netlify status --json 2>/dev/null | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try{const j=JSON.parse(s);console.log(j.siteData?.ssl_url||j.siteData?.url||'')}catch{console.log('')}
  })
")"

echo
echo "────────────────────────────────────────────────────────"
if [ -n "$SITE_URL" ]; then
  echo "Live at: $SITE_URL"
  echo
  echo "Setting SITE_URL as a GitHub Actions secret for the gameday cron..."
  printf '%s' "$SITE_URL" | gh secret set SITE_URL --repo jonsosidka/footballcheatsheet
  echo "  done"
  echo
  echo "Verify the cron endpoint:"
  echo "  curl -H \"Authorization: Bearer \$CRON_SECRET\" $SITE_URL/api/cron/hourly"
else
  echo "Deployed. Could not read the site URL automatically —"
  echo "grab it from 'netlify status' and set it as the SITE_URL repo secret:"
  echo "  gh secret set SITE_URL --repo jonsosidka/footballcheatsheet"
fi
echo "────────────────────────────────────────────────────────"
echo
echo "Note: scheduled functions only run on PUBLISHED deploys, never on"
echo "previews. Confirm they registered under Project configuration >"
echo "Functions after this first production deploy."
