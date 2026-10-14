# APK Update Platform

Standalone service for publishing APK releases and checking Android app updates.

## Project layout

- `backend/`: Express API, PostgreSQL migrations and APK storage.
- `frontend/`: React administration console.
- `docs/spec.md`: product and technical specification.
- `docs/plan.md`: implementation plan and acceptance checks.

Backend and frontend use separate Node projects and lockfiles. See `backend/.env.example` and `frontend/.env.example` for configuration names. Never commit real secrets, APKs or database volumes.

## Run the backend locally

1. Copy `backend/.env.example` to `backend/.env`.
2. Set a random PostgreSQL password and use the same value in `POSTGRES_PASSWORD` and `DATABASE_URL`. Use URL-safe characters for this password. Set `SESSION_SECRET` to at least 32 random characters.
3. From `backend/`, run `docker compose up --build -d`.
4. Check `http://localhost:3000/health/ready`; the response should be `{"status":"ready","database":"ready"}`.

PostgreSQL data and APK storage use named Docker volumes and survive container restarts. Run `docker compose down` to stop the local services; avoid `down -v` if you want to keep their data.

The isolated integration-test database runs on loopback port 5433:

```sh
cd backend
docker compose --profile test up -d --wait postgres-test
TEST_DATABASE_URL=postgres://apk_update_test:local_test_only@127.0.0.1:5433/apk_update_test npm run test:integration
```

The test database uses a temporary filesystem and is separate from the application database.
