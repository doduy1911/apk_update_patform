# APK Update administration frontend

React and Vite administration console for the APK Update API. The interface is in Vietnamese.

## Local development

Install dependencies with `npm ci`, then run `npm run dev`. Configure `VITE_API_BASE_URL` for the API path (defaults to `/api/v1`). For local Vite proxying, set `VITE_API_PROXY_TARGET` to the API origin; see `.env.example`.

## Checks

- `npm test` runs component tests.
- `npm run typecheck` checks TypeScript.
- `npm run build` creates the production bundle in `dist/`.
- `npm run test:e2e` generates an ignored TubeLite APK fixture, starts the isolated Compose API against the PostgreSQL test database, and runs Playwright. Install the Chromium browser once with `npx playwright install chromium`.

The E2E flow uses the test-only seeded admin account and removes its API container afterward. Do not point E2E configuration at production data.
