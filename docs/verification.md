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

### Limits

- APK upload/download routes and Android installation/update flow are not implemented yet.
- HTTPS reverse proxy, production VPS, external backup and restore have not been configured or verified.
