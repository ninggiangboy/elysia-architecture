# 0005. Configuration is sliced, one slice per owner

**Status:** accepted · 2026-10-18

## Context

One zod schema of about a hundred variables held every module's settings, and the container converted units and defaults for each module.

## Decision

Every package and module that reads the environment owns a **slice** (`defineSlice` in `@kit/config`). `loadConfig` parses every slice against the same environment and fails once, listing every problem. The result is namespaced (`config.core`, `config.billing`…), environment variable names are unchanged, and each module converts its own slice (seconds to milliseconds, defaults that depend on another variable). `.env.example` is generated from the slices, from the `.describe()` of each variable, and a test compares it with the file.

## Consequences

- A module that moves into a package takes its variables and their validation with it.
- Slices stay plain zod objects (one `superRefine` for cross-field rules): a transform on the whole slice would hide its shape from the example generator and the README tables.
- A variable two slices read (`WEB_APP_URL`) is declared in each and listed once in the sample file.

## Rejected

- *A flat config.* Loses each slice's own validation and lets names collide.
