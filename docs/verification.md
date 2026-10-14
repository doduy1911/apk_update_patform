# Verification Record

## 2026-10-15 — Project foundation and PostgreSQL migrations

Environment: macOS, Node.js 26.7.0, npm 11.19.0, Docker 29.7.2, Docker Compose 5.4.0, PostgreSQL 17.11 Alpine container, Node.js 22.23.3 runtime image.

### Project foundation

- Backend unit tests: `npm test` — 5 passed.
- Backend TypeScript: `npm run typecheck` — passed.
- Backend build: `npm run build` — passed.
- Frontend tests: `npm test` — 1 passed.
- Frontend TypeScript: `npm run typecheck` — passed.
- Frontend build: `npm run build` — passed.
- Dependency audits: `npm audit` in backend and frontend — 0 vulnerabilities.

### Database and Compose

- PostgreSQL integration tests: 5 passed. Covered empty database, idempotent migration, missing migration version readiness, unique package/version, foreign key and rollback/reapply.
- `docker compose up --build -d` — built the backend runtime image and started PostgreSQL, migration job and API.
- `GET /health/ready` — HTTP 200 with `{"status":"ready","database":"ready"}`.
- Re-ran migration service — reported no pending migrations.
- Restarted PostgreSQL and confirmed a temporary marker row survived; removed the marker after the check.
- Failure-path Compose check: a temporary isolated project made the migration job exit 42. Compose left its API container `Created` and did not start it. The temporary stack and its volumes were removed.
- PostgreSQL is not published on the host in the application stack. The test database binds only to `127.0.0.1:5433` and uses tmpfs.

## 2026-10-15 — Admin authentication and app registry

- Integration tests: 12 passed. Covered invalid/unauthenticated login, PostgreSQL session creation/expiry/logout, CSRF, origin/session cookie behavior, 10-attempt login limit, app validation/uniqueness, password hashing, and revoked API tokens.
- Backend unit tests: 5 passed; typecheck and build passed.
- Dependency audit: 0 vulnerabilities.
- Rebuilt the production Docker image with the native Argon2 dependency; Compose API remained healthy and database readiness returned 200.
- Interactive admin password prompt and token command were documented but not entered manually in the production container.

## 2026-10-15 — APK validation and release publishing

- Backend unit tests: 7 passed; TypeScript check and build passed; `npm audit --audit-level=moderate` reported 0 vulnerabilities.
- PostgreSQL integration tests: 19 passed. Release coverage includes bearer and cookie/CSRF authentication, revoked token, invalid APK, upload size limit, package and signing-certificate mismatch, duplicate version, concurrent first signer setup, stable file/URL metadata, database rollback cleanup, and stale artifact cleanup that preserves active and published files.
- `backend/tests/fixtures/generate.sh` successfully built and copied an ignored TubeLite debug APK fixture; no APK or signing key was added to Git.
- Built the production Docker image with pinned Android command-line tools revision `15859902` (SHA-256 checked), Android platform 35 and Build Tools 35.0.0. `apkanalyzer` and `apksigner` ran in the ARM64 container.
- Real APK inspection returned package `com.tubelite`, versionCode `2`, versionName `2.0`, minSdk `26`, four ABI entries and a 64-character signing certificate SHA-256.
- Uploaded the real 59,048,932-byte TubeLite release through the running Compose API using a temporary admin token. API returned HTTP 201 with matching package/version, checksum and stable download URL; test app, token, release and stored file were removed afterward.
- Compose API readiness returned HTTP 200 after rebuild. Docker Compose printed a warning that the local buildx plugin is absent; its classic builder completed the image build.

## 2026-10-15 — Compatible updates, release withdrawal and public downloads

- Backend unit tests: 9 passed; typecheck and TypeScript build passed; dependency audit reported 0 vulnerabilities.
- PostgreSQL integration tests: 25 passed across five files. Covered version selection, two-app isolation, current/newer client versions, SDK/ABI mismatch, unknown app, release history, CSRF-protected withdrawal, full download, closed/suffix/out-of-range HTTP Range requests and missing files.
- `docs/openapi.yaml` parsed successfully with Ruby YAML.
- Rebuilt the Compose backend image and verified `/health/ready` returned `ready`.
- End-to-end Compose smoke test uploaded the real TubeLite APK (versionCode 2), checked an update from version 1, verified the SHA-256, downloaded bytes 0–63 with HTTP 206, confirmed version 2 is current, then withdrew the release and confirmed subsequent download returned 404. Temporary app, admin, token, release and APK file were removed.

### Limits

- Administration frontend and Android installation/update flow are not implemented yet.
- HTTPS reverse proxy, production VPS, external backup and restore have not been configured or verified.
