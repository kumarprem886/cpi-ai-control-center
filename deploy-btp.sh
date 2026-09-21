#!/usr/bin/env bash
#
# Build and deploy the SAP CPI AI Control Center to BTP Cloud Foundry.
#
# Run from SAP Business Application Studio (or any bash shell with the cf CLI):
#   chmod +x deploy-btp.sh
#   ./deploy-btp.sh
#
# The frontend is built and copied into BackEnd/public, which the backend
# serves as static files, so the whole thing deploys as ONE CF app.

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
APP_NAME="cpi-ai-control-center"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
say "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm  >/dev/null 2>&1 || die "npm is not installed"
command -v cf   >/dev/null 2>&1 || die "the Cloud Foundry CLI (cf) is not installed"

echo "node $(node --version)  npm $(npm --version)"
echo "cf   $(cf version | head -1)"

if ! cf target >/dev/null 2>&1; then
  die "Not logged in to Cloud Foundry.

Log in first, then re-run this script:
  cf login -a <your-api-endpoint> --sso
For a trial account the endpoint looks like:
  https://api.cf.us10-001.hana.ondemand.com"
fi

say "Deploy target"
cf target

# ---------------------------------------------------------------------------
say "Installing frontend dependencies"
cd "$ROOT/FrontEnd"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

say "Building frontend"
npm run build
[ -d dist ] || die "frontend build produced no dist/ directory"

# ---------------------------------------------------------------------------
say "Copying build into BackEnd/public"
cd "$ROOT"
rm -rf BackEnd/public
mkdir -p BackEnd/public
cp -r FrontEnd/dist/. BackEnd/public/
echo "$(find BackEnd/public -type f | wc -l) files staged for static serving"

# ---------------------------------------------------------------------------
# Push stopped first: without its secrets the app would boot, fail to reach
# CPI, and crash-loop before we get a chance to set them.
say "Pushing to Cloud Foundry (stopped)"
cd "$ROOT/BackEnd"
cf push "$APP_NAME" -f manifest.yml --no-start

# ---------------------------------------------------------------------------
say "Configuring secrets"

# Reuse local .env when present so an existing setup needs no retyping.
# .env is gitignored and is never uploaded to CF (see .cfignore).
ENV_FILE="$ROOT/BackEnd/.env"
SECRETS="CPI_BASE_URL CPI_OAUTH_TOKEN_URL CPI_OAUTH_CLIENT_ID CPI_OAUTH_CLIENT_SECRET GROQ_API_KEY BACKEND_API_KEY"

read_from_env_file() {
  # Prints the value for $1 from .env, without logging it.
  [ -f "$ENV_FILE" ] || return 1
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -1 || true)"
  [ -n "$line" ] || return 1
  printf '%s' "${line#*=}"
}

if [ -f "$ENV_FILE" ]; then
  echo "Found BackEnd/.env - using the values in it."
else
  echo "No BackEnd/.env found - you will be prompted for each value."
  echo "Input is hidden and is not written to disk or echoed anywhere."
fi

for key in $SECRETS; do
  value=""
  if value="$(read_from_env_file "$key")" && [ -n "$value" ]; then
    echo "  $key: from .env"
  else
    printf '  %s: ' "$key"
    read -rs value
    echo
    if [ -z "$value" ]; then
      warn "$key left empty - skipping. Set it later with: cf set-env $APP_NAME $key <value>"
      continue
    fi
  fi
  cf set-env "$APP_NAME" "$key" "$value" >/dev/null
done

unset value

# ---------------------------------------------------------------------------
say "Starting the app"
cf start "$APP_NAME"

say "Deployed"
ROUTE="$(cf app "$APP_NAME" | grep -Eo 'routes:[[:space:]]*.*' | awk '{print $2}' || true)"
if [ -n "$ROUTE" ]; then
  echo "URL:    https://$ROUTE"
  echo "Health: https://$ROUTE/api/health"
else
  echo "Run 'cf app $APP_NAME' to see the route."
fi
echo
echo "Logs:    cf logs $APP_NAME --recent"
echo "Restart: cf restart $APP_NAME"
