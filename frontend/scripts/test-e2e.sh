#!/usr/bin/env sh

../backend/tests/fixtures/generate.sh
fixture_status=$?
if [ "$fixture_status" -ne 0 ]; then exit "$fixture_status"; fi

npx playwright test
test_status=$?

(cd ../backend && docker compose --profile test stop api-e2e >/dev/null 2>&1)
(cd ../backend && docker compose --profile test rm -f api-e2e >/dev/null 2>&1)
exit "$test_status"
