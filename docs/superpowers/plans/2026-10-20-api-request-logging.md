# API Request Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, structured request logs and a startup event so local development makes API activity visible in the terminal.

**Architecture:** Add a small Express middleware that creates a UUID, sets `X-Request-ID`, and emits one JSON access event when the response finishes or closes. Install it before all routes and include the request ID in the existing server error log; emit a structured startup event after initialization succeeds.

**Tech Stack:** Node.js, Express 5, TypeScript, built-in `crypto.randomUUID`, Vitest and Supertest.

**Spec:** [docs/api-logging-spec.md](../../api-logging-spec.md)

## Global Constraints

- Log JSON Lines to stdout; do not add a logging dependency.
- Log request ID, method, pathname without query, response status, and duration in milliseconds.
- Return the generated UUID in `X-Request-ID`; do not trust an incoming request ID.
- Never log request/response bodies, headers, cookies, credentials, tokens, query strings, or database connection details.
- Keep current API response bodies and error behavior unchanged.
- The workflow must work with `npm run dev` on the host and must not require Docker or an external logging service.

## Review Focus

- Query strings may contain sensitive values; assert that the logged path excludes them.
- Errors and unknown routes must still generate one access event with the final status.
- A client disconnect can trigger both `finish` and `close`; assert that only one event is written.
- Requests to health routes must be logged even though they do not use database routers.
- Client supplied `X-Request-ID` values must not replace the generated UUID.

## File Map

- Create `backend/src/request-logging.ts`: request ID and access-log middleware.
- Modify `backend/src/app.ts`: install middleware before all routes and attach request ID to existing server error log.
- Modify `backend/src/server.ts`: emit the structured startup event after initialization and listen succeeds.
- Modify `backend/src/app.test.ts` or create `backend/src/request-logging.test.ts`: cover logging and response header behavior.

## Task 1 — Request and startup logging

**Files:**
- Create: `backend/src/request-logging.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/src/request-logging.test.ts`

**Interfaces:**
- Middleware export: `requestLoggingMiddleware(request, response, next)` using Express `RequestHandler`.
- Middleware stores the generated ID on `response.locals.requestId`, sets `X-Request-ID`, and writes one JSON line to `console.info` after response finish/close.
- Access event properties: `event`, `requestId`, `method`, `path`, `statusCode`, `durationMs`.
- Startup helper: `logApiStarted(port: number, environment: string): void`.
- Startup event properties: `event`, `port`, `environment`.

- [x] **Step 1: Add focused failing tests**

Cover a health request, a 404, a 500 error response, and a close before headers. Assert the response includes an `X-Request-ID` UUID and exactly one corresponding JSON log with the expected method, pathname, status, and non-negative numeric duration. Add a query string and assert it is absent from the log. Send a client-provided `X-Request-ID` and assert the server returns a newly generated ID. Cover the exact `api_started` JSON event.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run from `backend/`:

```sh
npx vitest run src/request-logging.test.ts
```

Expected: tests fail because request logging middleware/startup helper is not implemented yet. Observed: the first request-log tests failed due to the missing response header; the startup test later failed because `logApiStarted` was not implemented.

- [x] **Step 3: Implement the middleware**

In `backend/src/request-logging.ts`, generate the ID with `randomUUID`, set the response header, and register guarded `finish` and `close` handlers. Serialize only the allowed fields as one JSON object per line. Ensure the handlers share a one-time guard.

- [x] **Step 4: Install middleware and correlate errors**

In `backend/src/app.ts`, use the logger immediately after creating the Express app and before Helmet, CORS, health routes, and all routers. Include `requestId` in the existing unhandled-error event without logging request data. For a close before headers are sent, log `statusCode: null`. In `backend/src/server.ts`, write `api_started` with the configured port and environment after cleanup completes and the server begins listening.

- [x] **Step 5: Run focused checks**

Run from `backend/`:

```sh
npx vitest run src/request-logging.test.ts src/app.test.ts
npm run typecheck
```

Expected: focused tests pass and TypeScript reports no errors. Observed: 7 focused tests passed and typecheck passed. A synthetic close-before-headers case confirmed null status and one-time logging even when `finish` follows `close`.

- [x] **Step 6: Review privacy and output**

Inspected captured log objects and middleware fields: only event, UUID, method, pathname, status and duration are serialized. Confirmed query credentials and error details are absent, health/404/500 routes are logged once, disconnect before headers logs null status once, and startup emits only event, port and environment. Full backend unit suite passed (16 tests).

## Execution Record

- Ruling: Added a focused test and helper for the `api_started` event because the spec requires startup visibility while the initial plan only named request-log tests. This keeps startup output regression-tested; cost if wrong is one small helper that could have remained inline.
- Review follow-up: Independent review found no implementation defect and asked for direct 500/disconnect test coverage; added both and verified them in the focused suite.
- Final review: Independent read-only review completed; no remaining issues.

## Handoff

Implementation completed after user approval. Backend unit suite and typecheck passed; no Docker was used.
