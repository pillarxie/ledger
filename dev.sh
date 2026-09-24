#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Starting Docker services (postgres, redis)..."
docker compose up -d postgres redis

echo "Waiting for postgres and redis to be ready..."
ready=false
for ((attempt = 1; attempt <= 60; attempt++)); do
  if docker compose exec -T postgres pg_isready -U postgres -q 2>/dev/null &&
     [[ "$(docker compose exec -T redis redis-cli ping 2>/dev/null)" == "PONG" ]]; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  echo "Postgres or Redis is not ready. Check: docker compose logs postgres redis" >&2
  exit 1
fi

echo "Starting NestJS in watch mode..."
exec pnpm dev:watch
