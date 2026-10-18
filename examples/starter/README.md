# Starter

An API with two modules, `@mod/identity` and `@mod/profile`, that needs **only Postgres**: files go to the local disk and mail goes to the log. It is the template for a new project and the proof that the kit's modules are optional.

```bash
cp .env.example .env
bun run keys:generate        # JWT keys and secrets, written into .env
docker compose up -d postgres    # from the repo root, or any Postgres: set DATABASE_URL
bun run db:migrate
bun run dev                  # http://localhost:3000/api/health/ready
```

Sign in: `POST /api/auth/magic-link {"email":"you@example.com"}`. The starter installs no mail module, so a small app-level handler (`src/bootstrap/mailbox.ts`) prints the link; open it, or `POST /api/auth/magic-link/verify {"token": "…"}`. Then `GET /api/me` with the access token.

## Add what you need

From the repository root:

```bash
bun run kit:add notification billing --app examples/starter
bun run --filter @example/starter db:migrate
```

`kit:add` edits `src/bootstrap/module-catalog.ts`, `src/bootstrap/container.ts`, `src/app.ts` and `package.json` at the `// <kit:…>` markers, and wires the integrations of everything that is installed. `kit:remove` takes a module out again. `bun run check:add-matrix` proves both work in any order.

The `workspace:*` dependencies mean this folder lives in the monorepo until the packages are on a registry; then `bun add @mod/identity …` replaces them.

See [Adopt the kit in a new project](../../docs/guides/adopt-in-new-project.md).
