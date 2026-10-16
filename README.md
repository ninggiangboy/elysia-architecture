# Elysia Architecture

A sample monorepo: **Elysia + Bun + Drizzle + Postgres + SeaweedFS (S3) + Mailpit** with Clean Architecture,
Modular Monolith, DDD-lite and the Transactional Outbox — designed to scale horizontally and to split into services at any time.
The React frontend (Vite + TanStack Router/Query + Tailwind) uses a client whose types are inferred directly from the backend (Eden Treaty).

```
apps/api            backend (identity · profile · notification)
apps/web            React SPA
packages/shared-types   constants shared by web ↔ api
docs/architecture.md    architecture, distributed-ready principles, module-splitting checklist
```

## Quick start

Requirements: Bun ≥ 1.4, Docker.

```bash
bun run setup        # .env + install + generate JWT keys + start Postgres/Mailpit/SeaweedFS + migrate
bun run dev          # api :3000 + web :5173
```

| URL | What it is |
| --- | --- |
| http://localhost:5173 | Web |
| http://localhost:5173/docs | API docs (Scalar) inside the web app, reads the spec from `/api/openapi/json`; dev builds only |
| http://localhost:3000/api/openapi | API docs (OpenAPI, enabled only when `NODE_ENV=development`, which `bun run dev` already sets) |
| http://localhost:8025 | Mailpit — view the magic link, welcome and email-confirmation mails |
| http://localhost:8333 | SeaweedFS S3 (key `app-access-key` / `app-secret-key`, bucket `avatars`) |
| localhost:5433 | Postgres (`app`/`app`, db `app`) — port 5433 so it does not clash with an existing Postgres on 5432 (change with `POSTGRES_PORT`) |

Realtime check: open http://localhost:5173/realtime — a live SSE stream; send a test event, or sign in on a second browser and sign it out from the profile page.

Sign in: enter any email at `/login` → open Mailpit → click the link in the mail.

## Built-in use cases

| Use case | Endpoint (`/api` prefix) |
| --- | --- |
| Sign in with a magic link | `POST /auth/magic-link`, `POST /auth/magic-link/verify` |
| Refresh the session (rotation, reuse detection) | `POST /auth/refresh` |
| Sign out | `POST /auth/logout` |
| List signed-in devices, remote logout (one / all others) | `GET /account/sessions`, `DELETE /account/sessions/{id}`, `DELETE /account/sessions` |
| View account + profile | `GET /me` |
| Update profile (optimistic lock via `If-Match`) | `PATCH /me/profile` |
| Upload avatar (presigned URL to SeaweedFS) | `POST /me/avatar/upload-url`, `PUT /me/avatar` |
| Live events over SSE (`session.revoked`, `realtime.test`) | `GET /realtime/events`, `POST /realtime/test` |
| Welcome mail + profile creation (via outbox) | event `identity.user_registered.v1` |
| Change email (confirmed from the new inbox) | `POST /account/email-change`, `POST /account/email-change/confirm` |
| JWKS so other services can verify tokens | `GET /.well-known/jwks.json` |
| Health | `GET /health/live`, `GET /health/ready` |

## Testing

```bash
bun run test                 # unit (domain + use cases with in-memory fakes)
bun run check:arch           # architecture boundary rules (dependency-cruiser)
bun run typecheck && bun run lint
bun run test:e2e             # needs infra: API (real buildApp + real Postgres/S3/Mailpit), then Playwright
```

Try multiple instances (2 API replicas behind nginx, both running the outbox relay):

```bash
bun run keys:generate        # if you do not have keys yet
docker compose --profile app up -d --build
open http://localhost:8080
```

## Common commands

| Command | What it does |
| --- | --- |
| `bun run --filter @app/api db:generate` | Generate migrations per module (after editing `schema.ts`) |
| `bun run --filter @app/api db:migrate` | Run migrations per module (each module has its own history table `drizzle_<module>`) |
| `bun run --filter @app/api outbox:list` / `outbox:requeue` | List / requeue events that ended up in the dead-letter queue |
| `bun run infra:down` | Stop the containers (add `-v` to `docker compose down` to delete data) |

Architecture details and design decisions: [docs/architecture.md](docs/architecture.md).
