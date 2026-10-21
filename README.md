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

After the API is running, create the first administrator with `docker compose exec api node dist/cli/admin-create.js admin`; the password is entered with terminal echo disabled. Create a build upload token with `docker compose exec api node dist/cli/token-create.js admin "CI upload"`. Save the token when it is shown because it is displayed only once. Revoke it with `docker compose exec api node dist/cli/token-revoke.js <token-id>`.

## Publish an app release

Create an app in the administration console with its Android package name. Create an upload token, then upload a signed, full APK through the console or the authenticated upload API. The first valid APK pins the app's signing certificate; later releases must use the same signer and a higher, unused `versionCode`. Keep the upload token in your CI secret store. Never put it in an Android app. The public URL and release metadata are returned after the APK has been inspected and published.

Android clients call `POST /api/v1/updates/check` with `packageName`, `currentVersionCode`, `sdkInt`, and `supportedAbis`. They can fetch the public APK URL from the response without an admin token. Verify the returned size, SHA-256, package, version and signing certificate on device before handing the APK to Android's installer. Android may require the user to approve installation.

## Production HTTPS reverse proxy

Terminate TLS at a maintained reverse proxy and serve the built frontend on the same origin as the API. Route `/api/` and `/health/` to the API, and route `/downloads/` to the API with HTTP Range support enabled. Set `PUBLIC_BASE_URL` to the public HTTPS origin, `ADMIN_ORIGIN` to the frontend origin, and `NODE_ENV=production`; use a long random `SESSION_SECRET` and unique database credentials. Keep PostgreSQL and port 3000 private; Compose binds the API to loopback by default. Configure the proxy's request body limit to match `MAX_APK_BYTES` (default 512 MiB) and its read/send timeouts for large APK transfers. An illustrative Nginx server block is in [`deploy/nginx.conf.example`](deploy/nginx.conf.example); add your certificate paths and domain before use.

Do not expose the development Vite server or the PostgreSQL port publicly. Use a firewall and HTTPS certificate renewal for the chosen VPS. The example proxy assumes the frontend static files are served by Nginx and the API is reachable at `127.0.0.1:3000` on the same host.

## Run the API with systemd

The example unit at [`deploy/apk-update-api.service.example`](deploy/apk-update-api.service.example) runs the built backend as the `ubuntu` user from `/home/ubuntu/apk_update_patform/backend`. Adjust `User`, `Group`, and `WorkingDirectory` if your server uses a different account or install path. Ensure `backend/.env` is configured and `APK_STORAGE_DIR` is writable by that user. Then install and start the unit:

```sh
cd ~/apk_update_patform/backend
npm ci
npm run build
mkdir -p data/apks
sudo cp ../deploy/apk-update-api.service.example /etc/systemd/system/apk-update-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now apk-update-api
sudo systemctl status apk-update-api
```

View logs with `sudo journalctl -u apk-update-api -f`. After deploying new code, rebuild and restart with `npm run build` and `sudo systemctl restart apk-update-api`. The service reads `backend/.env` at startup; it will exit if required settings are missing or PostgreSQL is unavailable.

## Run the frontend with systemd

The frontend unit at [`deploy/apk-update-frontend.service.example`](deploy/apk-update-frontend.service.example) serves the production build on `127.0.0.1:5173`. Build it and install the unit:

```sh
cd ~/apk_update_patform/frontend
npm ci
npm run build
sudo cp ../deploy/apk-update-frontend.service.example /etc/systemd/system/apk-update-frontend.service
sudo systemctl daemon-reload
sudo systemctl enable --now apk-update-frontend
sudo systemctl status apk-update-frontend
```

The Nginx example proxies frontend requests to this service and continues to route API and download requests to the backend. Install it with your TLS certificate and domain configured. View frontend logs with `sudo journalctl -u apk-update-frontend -f`. After deploying new frontend code, run `npm run build` and `sudo systemctl restart apk-update-frontend`.

## Backup and restore

Back up PostgreSQL and the APK volume together. Quiesce uploads during the backup so their snapshots describe the same point in time. From `backend/`, save the database dump and archive the named APK volume (the default Compose volume is `backend_apk_files`):

```sh
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/apk-update.dump
docker run --rm -v backend_apk_files:/data:ro -v "$PWD/backups:/backup" alpine:3.22 \
  tar -czf /backup/apk-files.tar.gz -C /data .
```

Keep both files encrypted and access-controlled outside the VPS. To restore, stop the API, restore the APK archive to the APK volume, restore the dump into the matching PostgreSQL database, then start the stack and check readiness. For example, after creating an empty target database and volume:

```sh
docker compose stop api
docker run --rm -v backend_apk_files:/data alpine:3.22 sh -c 'find /data -mindepth 1 -delete'
docker run --rm -v backend_apk_files:/data -v "$PWD/backups:/backup:ro" alpine:3.22 \
  sh -c 'tar -xzf /backup/apk-files.tar.gz -C /data'
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/apk-update.dump
docker compose up -d
curl --fail http://127.0.0.1:3000/health/ready
```

Test restores in a separate environment before relying on them. Keep database and APK backups from the same maintenance window; a database reference without its APK makes that release unavailable.

## Project records

The reviewed requirements are in [`docs/spec.md`](docs/spec.md), implementation checklist in [`docs/plan.md`](docs/plan.md), and test/build/manual verification evidence in [`docs/verification.md`](docs/verification.md). This repository does not deploy to a public VPS; provide the domain, host and production secrets through your deployment environment when you are ready.
