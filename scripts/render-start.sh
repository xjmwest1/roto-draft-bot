#!/usr/bin/env sh
set -eu

mkdir -p /var/data

if [ -n "${GOOGLE_SERVICE_ACCOUNT_JSON:-}" ]; then
  printf "%s" "$GOOGLE_SERVICE_ACCOUNT_JSON" > /var/data/google-credentials.json
fi

exec node --loader ts-node/esm src/app.ts