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

## 2026-10-15 — Frontend administration

- Frontend component tests: 8 passed, covering session loading/expiry, login errors, empty and create app states, upload progress/repeat prevention/failure, and withdrawal confirmation.
- Playwright end-to-end: 1 passed against the isolated PostgreSQL test database and API container. Logged in, created an app, uploaded a real 123 MB TubeLite debug APK fixture, copied its public URL, downloaded and checked APK bytes, withdrew the release, then confirmed the URL returned 404.
- `npm run typecheck`, `npm run build`, and `npm audit --omit=dev` passed; production dependency audit found 0 vulnerabilities.
- Screenshot of the management dashboard after publishing is available locally at ignored `frontend/test-results/admin-console.png`; it is excluded from Git with test artifacts.
- Playwright teardown removed the API E2E container; shared development API/PostgreSQL and isolated PostgreSQL test service remain running.

## 2026-10-15 — TubeLite update integration

- TubeLite commit: `359345e` (`feat: integrate APK update checks and installation`); changes are limited to update checking and installation and do not include the pending playback-latency work.
- TubeLite Jest suite: 9 suites and 37 tests passed. TypeScript `npx tsc --noEmit` passed. Android `:app:testDebugUnitTest :app:assembleRelease` passed.
- Release APK is ignored at `android/app/build/outputs/apk/release/app-release.apk`; Android metadata reports `com.tubelite`, versionCode `3`, versionName `2.1.0`. APK digest and signing certificate were checked against the published server release.
- Emulator flow installed version 2, downloaded the 56.3 MB version 3 APK with DownloadManager, verified its metadata/digest/signer, completed PackageInstaller after Android's user confirmation, and showed version 3 after reopening. App history/favorites remained available after the update. Current-version check returned `UP_TO_DATE`.
- The emulator requested Android's install-from-this-source permission and Google Play Protect scan; installation completed after user confirmation. E2E device testing used a local debug signing configuration and local API URL.
- Emulator did not cover a physical device, severe low-storage conditions or long network interruption during transfer. Validator mismatch cases and duplicate-action behavior are covered by unit/component tests; full transfer recovery under those device conditions remains unverified.

## 2026-10-15 — Final Plan 2 verification and operations handoff

- Backend: unit tests 9/9; PostgreSQL integration tests 25/25 using the isolated `postgres-test` service; `npm run typecheck` and `npm run build` passed.
- Frontend: component tests 8/8; Playwright 1/1 completed login → app creation → APK upload → public download → withdrawal and verified the withdrawn URL returns HTTP 404; `npm run typecheck` and `npm run build` passed.
- Updated the Playwright release expectation to TubeLite version 3 (`2.1.0`), matching the current generated APK fixture; the prior expectation for version 2 timed out, and the corrected run passed.
- Two-app isolation is covered by PostgreSQL integration tests with two packages and releases: a package check only returns the release registered to that app. Public download and withdrawn-release behavior are covered by integration tests and the browser E2E flow.
- Restarted the development PostgreSQL and API containers; API readiness returned `{"status":"ready","database":"ready"}` and the published release row remained present.
- Backed up the development database with `pg_dump` and APK volume with `tar`, restored both into isolated Docker volumes and a separate PostgreSQL 17.11 container, and compared the restored database file key/SHA-256 to the APK's computed SHA-256. Values matched. Temporary restore container, volumes and backup files were removed after verification.
- Added production HTTPS reverse-proxy example and documented environment setup, release publishing, client integration, backup/restore, and verification links. The proxy has not been configured with a real domain/certificate and no VPS deployment or external backup target was tested.
- TubeLite release artifact uses the project's local debug signing key for emulator verification. Production signing requires a dedicated stable keystore and HTTPS deployment configuration.

## 2026-10-15 — PostgreSQL restart resilience

- Reproduced the uncaught `pg.Pool` error when PostgreSQL terminated idle client connections with SQLSTATE `57P01` during restart. Added a pool error listener that logs only the error code and allows the process to continue.
- Regression test `src/db/pool.test.ts` failed before the listener was added and passed afterward.
- Rebuilt and recreated the Compose API image, restarted PostgreSQL, then verified API readiness returned `ready`, the API container remained running with restart count `0`, and the log recorded `Unexpected PostgreSQL pool client error { code: '57P01' }` without a stack trace or process exit.

### Limits

- Physical-device and failure-condition Android checks (severe low disk, long network interruption/process recovery) have not been verified.
- HTTPS reverse proxy, production domain/VPS, external backup target and production keystore have not been configured or verified.
