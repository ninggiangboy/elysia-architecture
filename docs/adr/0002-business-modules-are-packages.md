# 0002. Business modules are packages

**Status:** accepted · 2026-10-18

## Context

Modules lived in `apps/api/src/modules`, with boundaries kept by a dependency-cruiser rule. The rule can be bent; a package boundary cannot.

## Decision

Each business module is a package in `modules/<name>` (`@mod/<name>`): domain, application, infrastructure, presentation, contracts, its migrations, a manifest and `install(host)`.

The package `exports` field blocks deep imports at the resolver (`import '@mod/billing/src/domain/…'` does not resolve), migrations travel with the module, and a module that needs another declares it in its `package.json`.

## Consequences

- The app shrinks to a composition root: `main.ts`, `app.ts` and `bootstrap/`.
- The rule `modules-talk-only-through-contracts` stays as a second layer.
- Static data a host needs without building the module (folder, migrations, schema, outbox table, config slice) is exported as a `ModuleManifest`, so scripts and drizzle-kit read it without the container.
- `tests` that reach for a module's internals go through the module's `./testing` export, which is explicitly outside the supported API.

## Rejected

- *Keep modules in `apps/api/src/modules`.* Incompatible with ADR 0001.
