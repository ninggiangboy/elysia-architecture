# Baseline for the reusable-kit plan

Measured 2026-10-18 on commit `bec8653` (tag `pre-kit`), Apple silicon, Bun 1.4.3, dev server stopped.

| Metric | Value |
|---|---|
| `bun run test` (api 283 tests + web 25) | api 0.48 s |
| `bun run test:e2e` (api) | 114 pass, 64 s wall. `web push > a notification is pushed to every subscribed browser` fails when the whole suite runs and passes when run alone (known flake, see plan §1.4) |
| `bun run typecheck` | 8.6 s wall for both apps |
| Web `tsc --extendedDiagnostics` | Types 173 906 · Instantiations 1 218 819 · Check time 2.61 s · Total 5.84 s |
| Web bundle (`vite build`, sum of `dist/assets/*.js`) | 5 052 755 bytes (before P0.4: the 9 redirect routes are removed afterwards) |
| `apps/api/src/bootstrap/container.ts` | 300 lines |
| `apps/api/src/app.ts` | 89 lines |
| `bun scripts/check-removal.ts billing` | 11 files outside the module |
| `bun scripts/check-removal.ts realtime` | 4 files outside the module |

Limits from the plan: web typecheck must stay within +30 % of the check time above; web bundle within +5 %.
