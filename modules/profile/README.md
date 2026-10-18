# @mod/profile

## Purpose

The display name, bio, avatar and cover of an account, with optimistic locking and presigned uploads that are verified before they are applied.

## Install

```bash
bun add @mod/profile
bun run kit:add profile        # wires it into the app: catalog, container, routes and the integrations of what is installed
bun run db:migrate
```

Requires: `@mod/identity`.

## Ports

The factory takes the host's building blocks (`ModuleHost`: database, clock, ids, storage, mailer, config) and the modules it depends on; `install(host)` is the one entry the app calls. Cross-module calls go through `@mod/profile/contracts` only.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

Schema `profile`: profiles, plus the outbox and inbox.

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/profile/manifest`).

## Events

`profile.avatar_changed.v1`, `profile.cover_changed.v1` and the privacy answers.

## Wiring

```ts
const profile = use(installProfile({ ...host, modules: { identity } }))
```

## Extension points

Adapters (storage, image resizer), integrations of other modules for the events it emits, and app handlers on its events. `@mod/profile/public` holds the limits web clients check (`AVATAR_MAX_BYTES`, `BIO_MAX`…).

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/profile`, rename it `@app/profile`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

An upload is only applied after the object is checked (size, type); replaced files are deleted by a handler.

## Limits

Images only, three formats.

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)
