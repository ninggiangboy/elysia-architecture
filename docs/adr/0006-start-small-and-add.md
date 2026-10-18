# 0006. A new project starts from a small starter and adds modules

**Status:** accepted · 2026-10-18

## Context

Two ways to begin: take the full reference app and strip what you do not need, or take a small app and add.

## Decision

`examples/starter` (identity and profile, running on the local disk and the log) is the template. `bun run kit:add <module>` wires an installed module into the catalog, the container, `app.ts` and `package.json` at `// <kit:…>` markers, deriving integrations from what is installed; `kit:remove` is the inverse. Each module's `kit.json` carries what the tool needs (requires, install snippet, integrations). `bun run gen:module` creates a module from `templates/module`.

A CI job (`add-matrix`) adds and removes modules in both orders and checks the starter ends unchanged.

## Consequences

- Subtracting from a full repo needs a stripper that knows every place; adding is the direction the "at most four places" property guarantees.
- The markers are part of the host files' contract; the matrix catches a drift between them and the tool.
- The starter has no web app: the reference app's `apps/web` is the one front-end, and a `create-*` command could wrap the starter later.

## Rejected

- *Template repository plus a stripper.* Fragile, and the project forks at birth.
