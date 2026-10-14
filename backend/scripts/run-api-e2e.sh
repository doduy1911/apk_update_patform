#!/usr/bin/env sh
set -eu

stop_api() {
  if [ -n "${LOG_PID:-}" ]; then kill "$LOG_PID" 2>/dev/null || true; fi
  docker compose --profile test stop api-e2e >/dev/null 2>&1 || true
  docker compose --profile test rm -f api-e2e >/dev/null 2>&1 || true
}

trap stop_api EXIT INT TERM
docker compose --profile test up --build -d api-e2e
docker compose --profile test logs --follow api-e2e &
LOG_PID=$!
wait "$LOG_PID"
