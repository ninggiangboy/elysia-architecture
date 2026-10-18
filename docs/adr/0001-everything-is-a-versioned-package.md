# 0001. Everything is a versioned package

**Status:** accepted · 2026-10-18

## Context

The repository started as a reference app. To reuse the outbox, the auth plumbing or mail throttling in another project you had to copy files, fix the `#/` alias and strip what came along. Copies drift: a fix in the sample never reaches them.

## Decision

Infrastructure (`@kit/*`) and business modules (`@mod/*`) are packages with an `exports` map, tests and a version. A project installs the modules it wants and receives fixes by bumping versions. Customisation goes through a small, fixed set of **extension points**:

1. adapters (ports passed to the factory),
2. the module's config slice,
3. integrations (which ones the app installs, and its own),
4. wording (`messageOverrides`, the web catalog),
5. reacting to the module's contract events with an app-level handler.

Anything else (hooks inside a use case, changing a domain rule or a table) changes the module's invariants and is an **eject**: copy the package into the app, rename it, keep the schema and migrations.

Inside the monorepo the packages export TypeScript source (the `bun` condition); published, they export `dist/` (JavaScript and declarations).

## Consequences

- A fix reaches every adopter through a version bump; breaking changes are defined (types at an entry point, message keys, event payloads, extension points, non-additive migrations) and versioned with changesets.
- The list of extension points is closed. "Just one more hook" is answered by eject, and a new extension point needs an ADR.
- The cost is discipline at the boundaries: each package must be liftable, which is what the dependency-cruiser configs enforce.

## Rejected

- *Copy business modules, share only infrastructure.* Cheaper, but every adopting project forks at birth.
