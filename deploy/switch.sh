#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${1:-}"
if [[ "$TARGET" != "blue" && "$TARGET" != "green" ]]; then
  echo "Usage: $0 <blue|green>"
  exit 1
fi

OTHER="blue"
if [[ "$TARGET" == "blue" ]]; then
  OTHER="green"
fi

COMPOSE="docker compose"

echo "==> Building and starting api-trans-$TARGET"
$COMPOSE up -d --build api-trans-$TARGET

echo "==> Waiting for health on $TARGET"
for i in {1..60}; do
  if docker exec api-trans-$TARGET wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "Healthy: $TARGET"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "Health check failed for $TARGET"
    exit 1
  fi
  sleep 1
done

echo "==> Switching nginx upstream to $TARGET"
sed "s/api-trans-blue/api-trans-$TARGET/g" deploy/nginx/nginx.conf > deploy/nginx/nginx.active.conf
$COMPOSE up -d gateway

echo "==> Reloading gateway"
docker exec api-trans-gateway nginx -s reload

echo "==> Current active: $TARGET"
echo "$TARGET" > state/active_color

echo "==> Optionally stop old container: api-trans-$OTHER"
echo "Done"
