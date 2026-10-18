# Changesets

Every change to a package in `packages/kit-*` or `modules/*` that a user of the package could notice comes with a changeset:

```bash
bun run changeset        # pick the packages, the bump (patch / minor / major) and describe the change
```

What counts as breaking (**major**): a type change at an exported entry point, a removed or reworded message key, a changed event
payload (a new shape is a new event version instead), a changed extension point, or a migration that is not purely additive.
A **minor** version may only add migrations that are safe on a live table (a nullable column, an index created concurrently);
anything else is a major with an upgrade note. If an outbox or inbox column changed, the entry must say
"run `bun run db:generate` in every module".

`bun run version-packages` applies the changesets (bumps versions, writes the CHANGELOGs). The packages are still `"private": true`:
flip that, choose a registry and enable `.github/workflows/release.yml` when you publish.
