# APK Update Platform

Standalone service for publishing APK releases and checking Android app updates.

## Project layout

- `backend/`: Express API, PostgreSQL migrations and APK storage.
- `frontend/`: React administration console.
- `docs/spec.md`: product and technical specification.
- `docs/plan.md`: implementation plan and acceptance checks.

Backend and frontend use separate Node projects and lockfiles. See `backend/.env.example` and `frontend/.env.example` for configuration names. Never commit real secrets, APKs or database volumes.
