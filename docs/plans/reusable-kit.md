# Plan: turn the reference app into a reusable module kit

> Status: **decided**. Drafted 2026-10-18; decisions settled 2026-10-18 in [§2](#2-decisions). The repo is a sample with no production users, so every decision takes the architecturally best option, not the cheapest one; rewrites are acceptable.

## 0. Goal and definition of done

**Today**: a reference app. To reuse the outbox, auth, mail throttling… in another project you copy files, fix the `#/` alias, and strip out whatever came along with them.

**Target**: a monorepo made of

1. **Infrastructure packages** (`@kit/*`): no business logic, versioned, installable into another project.
2. **Business modules** (`@mod/*`: identity, profile, notification, privacy, billing, realtime): versioned packages too. A new project installs the modules it wants and receives their fixes through version bumps. Customisation goes through a small, fixed set of extension points (D1); anything beyond that is an explicit eject.
3. **Reference app** (`apps/api`, `apps/web`): the first consumer of 1 and 2, and the integration test bed for both.
4. **Tooling**: a module generator, a minimal starter, an adoption guide.

**Definition of done** (checkable with commands, not by feel):

| # | Criterion | How to check |
|---|---|---|
| T1 | Removing an optional module (billing, privacy, realtime) touches **≤ 3 files** outside its own folder: `module-catalog.ts`, `container.ts` (factory + integration list entries), `app.ts` (plus the dependency line in `package.json` after P7) | Try it on a scratch branch, `git diff --stat` |
| T2 | `notification` and `realtime` **import no other module** (outside their own `integrations/` folder) | dependency-cruiser rule `generic-modules-are-leaves` |
| T2b | No participant module (identity, profile, billing) imports the `privacy` module; they speak the participation protocol from `@kit/privacy-participant` | dependency-cruiser rule `participants-do-not-know-privacy` |
| T3 | `apps/api/src/shared/` no longer exists: everything shared lives in `packages/kit-*` | `test ! -d apps/api/src/shared` |
| T4 | The starter with only `identity` + `profile` runs without S3, SMTP, Stripe or VAPID | CI job `starter`: boot, `/health/ready`, sign in with a magic link |
| T5 | Every package has a README, its own tests and a clear `exports` map; importing something that is not exported is an error | `knip`, `tsc`, review |
| T6 | `bun run gen:module <name>` generates a module that works out of the box: it migrates, has a module health route, tests are green | CI job creates a scratch module and runs the checks |
| T7 | Every phase ends with lint, typecheck, check:arch, unit, e2e and build all green | CI |

**Out of scope** for this plan:
- Changing the stack. It stays Bun, Elysia, Drizzle, postgres.js, React and TanStack. Infrastructure packages may depend on Drizzle; only `kit-http` may know Elysia.
- Splitting into microservices.
- Rewriting business logic. Every phase is a behaviour-preserving refactor, and the existing e2e suite is the safety net.

---

## 1. Current state (measured on the code at commit `bec8653`)

### 1.1 Places that hardcode the module list

Adding or removing a module currently means editing:

| Place | What is in it |
|---|---|
| `apps/api/src/bootstrap/container.ts` | `createXModule(...)` ×6; the `handlers` array; the array of `OutboxRelay` sources (5 modules, realtime has no outbox); `pauseWorker`/`resumeWorker`/`startWorker` calling `startJobs`/`stopJobs` of privacy, billing, notification; `close()`; privacy's `exportParticipants`/`deletionParticipants` |
| `apps/api/src/app.ts` | 6 lines of `.use(container.modules.X.routes)` |
| `apps/api/scripts/db.ts` | `const MODULES = [...]` |
| `apps/api/scripts/outbox.ts` | direct imports of the outbox table from the `schema.ts` of 5 modules, plus the usage string |
| `apps/api/drizzle.config.ts` | error message listing the modules |
| `apps/api/src/shared/infrastructure/config.ts` | every module's env in one schema; `TOPUP_CURRENCY_CODES` taken from shared-types |
| `packages/shared-types/src/*` | billing, profile and i18n constants mixed together |
| `apps/web/src/routes/_authed/settings.tsx` | the `TABS` array |
| `apps/web/src/i18n/locales/{en,vi}.ts` | one ~570-line catalog for every feature |

### 1.2 Dependency matrix between modules (through `contracts` only)

```
identity     → privacy
profile      → identity, privacy
privacy      → identity
billing      → identity, profile, privacy
notification → identity, privacy, billing      ← consumer knows producers
realtime     → identity, privacy, billing, notification   ← consumer knows producers
```

The problem is in the last two rows. `notification` and `realtime` are **shared** modules (they deliver things), yet they import the contracts of every module that emits events, because the mapping "event X → notification / realtime event Y" lives inside them:
- `notification.module.ts` imports `BillingEvents` and `TopUpSucceededPayload`, plus the identity and privacy events.
- `notification/application/messages/{en,vi}.ts` holds the billing and privacy wording.
- `realtime.module.ts` maps the events of 4 modules.

As a result, removing billing means editing notification and realtime as well.

Every module that takes part in privacy (imports `privacy/contracts`) repeats about 25 near-identical lines to build `ExportUserDataHandler` and `EraseUserDataHandler`. Those participants (identity, profile, billing) import `privacy/contracts` for exactly two events, `PrivacyEvents.DataExportRequested` and `PrivacyEvents.AccountErasureRequested`: the participation protocol, not privacy's business. That is why the `identity → privacy` edge exists, and why privacy cannot be removed today.

### 1.3 How much each module uses `shared` (import counts)

```
65 application/ports        39 application/errors      22 infrastructure/db/database
19 messaging/envelope       15 application/privacy     14 domain/errors
11 http/auth                10 testing/fakes           10 application/step-up-policy
 6 http/openapi              6 domain/domain-event      6 domain/aggregate-root
 5 ×4 infrastructure/outbox/*   3 i18n   3 application/mail-errors   2 crypto   2 http/client-info
 1 infrastructure/config (identity receives the whole Config)
```

Things in `shared` that are in the wrong place:
- `application/step-up-policy.ts` is an auth concept.
- `application/mail-errors.ts` is a mail concept.
- `application/privacy.ts` is the protocol for taking part in privacy jobs.
- `http/auth.plugin.ts` defines `AuthSession.authTime`.

All four belong in packages of their own, not in "core".

### 1.4 Technical constraints to keep

- **Eden Treaty**: `App = ReturnType<typeof buildApp>` needs a **static** `.use()` chain to infer types. A loop `for (m of modules) app.use(m.routes)` would make the web client lose its types. So `app.ts` keeps one `.use()` line per module. This is a deliberate exception, guarded by a test (see P1.6).
- **The `#/` alias in `apps/web/tsconfig.json`** (`"#/*": ["../api/src/*"]`) exists because when the web's tsc reads the `App` type it follows the `#/...` imports inside the api source. The alias can only be removed once the shared code no longer imports through `#/` (after P5 and P7).
- **One Elysia instance and one Drizzle instance**: a package that uses Elysia or Drizzle plugins or types must declare them as `peerDependencies`. Otherwise Bun may install two copies, the types stop matching and the `auth` macro stops working.
- **Per-module migrations**: each module has its own Postgres schema, its own `drizzle_<module>.__migrations` table and its own `migrations/` folder. When a module moves, the paths in `drizzle.config.ts` and `db.ts` must move with it.
- **Tailwind v4** only scans classes in `apps/web/src`. When the UI moves into a package, an `@source` entry is required.
- **E2E sharing a DB with `bun run dev`** fails randomly (web-push, mail-throttling, tracing). Stop the dev server before running e2e in every phase.

---

## 2. Decisions

Settled 2026-10-18. The criterion is the best long-term architecture for a reusable kit; cost of the rewrite is not a factor, since the repo is a sample.

| ID | Question | Decision | Why | Rejected option |
|---|---|---|---|---|
| D1 | How is it distributed? | **Everything is a versioned package**: `@kit/*` (infrastructure) and `@mod/*` (business modules). A project installs modules and receives fixes by bumping versions. Customisation only through the **extension points** of P7.4 (factory deps/ports, config slice, integration definitions, message overrides). Anything beyond them is an explicit **eject** (`gen:module --from <m>`), after which the project owns the copy | Copying modules makes every project drift: a fix in the sample never reaches the copies. Once D4–D6 are in place, a module already receives everything through its factory, so the extension points cost little. A small fixed set of extension points avoids option hell, and eject is the honest answer for the rest | Copy business modules (mixed model): cheaper, but every adopting project forks |
| D2 | Scope names | `@kit/*` and `@mod/*` (placeholders) | One find/replace to rename before the first real publish | — |
| D3 | Ship TS source or a build? | **Source inside the repo, build when published**: `exports` uses the condition `"bun"` → `./src/index.ts`, and `"types"`/`"default"` → `dist/` (added in P10.2) | Inside the workspace there is no build step and debugging maps to source; outside it consumers get a normal package | Build from day one: d.ts drift risk with no consumer to benefit yet |
| D4 | Make business modules packages (P7)? | **Yes** | A package's `exports` field blocks deep imports at the resolver level, migrations travel with the module, and D1 needs it | Keep them in `apps/api/src/modules`: incompatible with D1 |
| D5 | Where does the mapping "producer event → notification/realtime" live? | **In the producer, under an isolated subpath**: `modules/<producer>/integrations/{notification,realtime}.ts`, exported as `@mod/<producer>/integrations/notification` etc. These files import only the producer's own contracts and the **definition types** from the consumer's contracts (`import type`). The consumer is an **optional peer dependency**. The module's core never imports its `integrations/` folder; the composition root decides which integrations to install | The wording and mapping of a billing notification are billing knowledge, so they ship and get versioned with billing; a project installing billing + notification gets them for free. Billing still runs without notification, because nothing loads that subpath unless the app imports it. Notification and realtime stay leaves | Glue in the app's composition root (`apps/api/src/integrations/`): every adopting project would rewrite the mapping and the wording. Producer declares inside its core (`contributes.notifications`): billing could not run without notification |
| D5b | Who owns the privacy participation protocol? | **`@kit/privacy-participant`** owns the two request events (`DataExportRequested`, `AccountErasureRequested`), their payloads, the answer convention and the handler helper (P1.5). The `privacy` module is one orchestrator implementing that protocol and re-exports the events. Event type strings stay identical | Participants then depend on a stable protocol, not on a business module: privacy becomes truly optional and identity has no module dependency left (T2b) | Leave the events in `privacy/contracts`: identity, profile and billing keep a hard edge to privacy |
| D6 | Config: flat or namespaced? | **Namespaced** (`config.core.PORT`, `config.identity.JWT_KID`…), env names unchanged; **each module converts its own slice** (units, defaults) instead of the container | Each module receives exactly its own config and carries its reading of it into its package | Flat: lose each slice's `superRefine`, names can collide |
| D7 | Old redirect routes in the web (`/topup`, `/wallet/*`, `/transactions`, `/privacy`, `/security`, `/notifications/settings`) | **Delete, no data migration**. Old `link` values in dev databases are fixed with `db:reset` | Migrations are permanent; a migration for dev-only data is debt that every adopting project inherits | Data migration rewriting `link`, or keep the redirects for 90 days |
| D8 | Where does a new project start? | **Additive, from a minimal starter**: `examples/starter` (identity + profile, api + web) is the template. A project adds a module with `bun add @mod/<m>` followed by `bun run kit:add <m>`, which inserts the wiring at the `// <kit:…>` markers and the integrations whose consumers are installed | Starting small and adding is the direction T1 guarantees (≤ 3 places). Subtracting from a full repo needs a stripper that knows every place, and the result cannot follow upstream | Template repo + `kit:strip`: fragile, and the project forks at birth. A `create-*` CLI can wrap the starter later if wanted |
| D9 | Language of package docs | English, like the current `docs/` | Consistent with the repo | — |

**Still open (deliberately)**: whether web features also ship as packages (`@mod/<m>/web`). P8 keeps them in the app behind a feature registry; revisit after P9 once the api side has proven the model.

---

## 3. Roadmap overview

```
P0 Preparation, baseline          ─┐
P1 Module registry (AppModule)     │  in-place refactors, no folder restructuring
P2 Invert consumer dependencies    │  → reaches T1, T2, T2b
P3 Per-module config              ─┘
P4 Re-arrange shared into "folder = future package" + split shared-types
P5 Extract infrastructure packages packages/kit-*      → reaches T3
P6 Light adapters + contract test suite                → paves the way for T4
P7 Business modules become packages + extension points (D1, D4)
P8 Web: kit-ui, kit-web-core, feature registry, per-feature i18n
P9 Tooling: gen:module, starter, kit:add               → reaches T4, T6
P10 Versioning, publishing of @kit and @mod, docs      → reaches T5
```

The order is not arbitrary:
- **P1–P3 come before any file move**: untangling while the paths are untouched keeps diffs easy to review, and e2e catches mistakes immediately.
- **P4 before P5**: re-arrange the folders inside the app, enforce the dependency graph with depcruise, and only then "lift" each folder into a package. Each lift is then little more than a change of import paths.
- **P8** can run in parallel with P6–P7 once P5 is done.

Rough estimate for one person: P0 0.5 days · P1 2 · P2 2.5–3 · P3 1.5 · P4 1.5 · P5 3–4 · P6 2–3 · P7 3–4 · P8 3–4 · P9 2.5 · P10 2.5 ≈ **24–29 working days**.

Commit convention: every sub-step (P1.1, P1.2…) is one commit on `main`, and every commit is green. No pushing unless asked.

---

## P0 — Preparation and baseline

**Purpose**: have numbers to compare against, and clean out what should not be carried along.

| Step | Work | Files |
|---|---|---|
| P0.1 | ~~Settle D1–D9~~ done 2026-10-18 | `docs/plans/reusable-kit.md` |
| P0.2 | Record the baseline: time of `bun run test`, `test:e2e`, the web `typecheck` (`tsc --extendedDiagnostics`: type instantiations, check time); web bundle size; line count of `container.ts` | `docs/plans/reusable-kit-baseline.md` |
| P0.3 | Tag `pre-kit` as a rollback point | git |
| P0.4 | (D7) Delete the 9 old redirect routes in `apps/web/src/routes/` (`topup.*`, `wallet.*`, `transactions.tsx`, `privacy.tsx`, `security.tsx`, `notifications.settings.tsx`) and regenerate `routeTree.gen.ts`. No data migration; reset dev databases with `db:reset` | web routes |
| P0.5 | Add `scripts/check-removal.ts` (reused in P1, P2, P9): in a temporary git worktree, delete one module, fix the known places, run typecheck and check:arch, and print `git diff --stat`. The first run should report about 10 files | `scripts/check-removal.ts` |

**Acceptance**: baseline recorded; check-removal runs and prints the number of files that must be edited (the figure measured before the refactor).

---

## P1 — Module registry: one `AppModule` interface, every place loops over one list

**Purpose**: adding or removing a module no longer means editing the container in 6 places and two scripts.

### P1.1 Define `AppModule`

New file `apps/api/src/shared/module/app-module.ts`. The `module` folder may import types from `shared/http` and `shared/messaging`; after P5 it moves into `kit-runtime`.

```ts
export interface ModuleJobs {
  /** Start the timers. Called when the process has the worker role and is not in maintenance. */
  start(): void
  /** Stop the timers and wait for the running pass to finish. Idempotent. */
  stop(): Promise<void>
}

export interface PrivacyParticipation {
  exporter?: DataExporter          // takes part in data export
  eraser?: DataEraser              // takes part in account erasure
}

export interface AppModule<Name extends string = string, Routes = unknown> {
  readonly name: Name
  /** An Elysia instance; app.ts mounts it statically so Eden can infer the types. */
  readonly routes?: Routes
  readonly handlers?: readonly IntegrationEventHandler[]
  readonly outbox?: OutboxSource
  readonly jobs?: ModuleJobs
  readonly privacy?: PrivacyParticipation
  /** Release live resources (SSE, LISTEN). Called BEFORE the HTTP server is stopped. */
  close?(): Promise<void>
}
```

### P1.2 Every factory returns `AppModule & { …its own api }`

| Module | Change |
|---|---|
| billing | `startJobs`/`stopJobs` → `jobs: { start, stop }`; keep `reconcile` |
| notification | same; keep `prune` |
| privacy | same; keep `runJobs`, `resumeDeletion` |
| realtime | `stop()` → `close()`; the prune timer moves into `jobs` (today it runs `setInterval` right inside the factory, even when the role is only `api`; fix that too: pruning is the worker's job) |
| identity, profile | just add `satisfies AppModule` |

Update the e2e tests that call `modules.X.startJobs` (by grep: `billing.reconcile`, `notification.prune`, `privacy.runJobs`/`resumeDeletion` and `realtime.prune` all keep their names, so they need no change).

### P1.3 The container loops over the list

`bootstrap/container.ts`:

```ts
const modules = { identity, profile, notification, privacy, billing, realtime } as const
const list: AppModule[] = Object.values(modules)

for (const h of list.flatMap((m) => m.handlers ?? [])) bus.subscribe(h)
const relay = new OutboxRelay(database, list.flatMap((m) => (m.outbox ? [m.outbox] : [])), bus, logger, …)

const jobs = list.flatMap((m) => (m.jobs ? [m.jobs] : []))
const pauseWorker = async () => { await relay.pause(); for (const j of jobs) await j.stop() }
const resumeWorker = () => { relay.resume(); for (const j of jobs) j.start() }
// close(): maintenance.stop → jobs.stop (reverse order) → relay.stop → m.close?.() → database.close
```

Keep `modules` as a typed record so e2e and `main.ts` can still call `container.modules.privacy.runJobs()`.

### P1.4 One module catalog for the scripts

New file `apps/api/src/bootstrap/module-catalog.ts`: **static data only**, builds nothing, so scripts can import it without pulling in the whole container.

```ts
export const MODULE_CATALOG = [
  { name: 'identity',     migrations: 'src/modules/identity/migrations',     outbox: identityOutbox },
  { name: 'profile',      … },
  …
  { name: 'realtime',     migrations: 'src/modules/realtime/migrations',     outbox: null },
] as const
```

- `scripts/db.ts`: replace `MODULES` with `MODULE_CATALOG`.
- `scripts/outbox.ts`: replace the 5 imports and the `SOURCES` array; the usage string is generated from the catalog.
- `drizzle.config.ts`: validate `MODULE` against the catalog, read `schema`/`out` from it (add a `schemaFile` field).
- Test `module-catalog.test.ts`: the names in the catalog match the keys of `container.modules` and the folders in `src/modules/*`, and every `migrations` path exists.

### P1.5 Privacy participants are derived from the module list

- Each module declares `privacy: { exporter, eraser }` instead of building `ExportUserDataHandler` and `EraseUserDataHandler` itself.
- The container uses a new helper `privacyParticipantHandlers(module, deps)` (in `shared/privacy-participant/`, see P4.3). The helper builds the two handlers named `${module}.export-user-data` and `${module}.erase-user-data`, keeping the current name strings so existing inbox rows still match.
- `exportParticipants = list.filter(m => m.privacy?.exporter).map(m => m.name)`; `deletionParticipants` likewise.
- **(D5b) The protocol leaves the privacy module**: `DataExportRequested`, `AccountErasureRequested`, their payload types and the answer convention move to `shared/privacy-participant/protocol.ts` (later `@kit/privacy-participant`). `privacy/contracts` re-exports them so privacy's own code is untouched. The event type strings do not change, so outbox rows and inbox keys stay valid. Identity, profile and billing then import nothing from `privacy`. New depcruise rule `participants-do-not-know-privacy`: from `^src/modules/(?!privacy/)` to `^src/modules/privacy/` is forbidden, except from `integrations/` folders (P2).
- **Compatibility notes**:
  - The handler name is the key in the `inbox` table. Renaming it makes in-flight messages run again. A test comparing handler names before and after must be in the same commit.
  - `answerType` (for example `ProfileEvents.DataExported`) is still declared by the module in `privacy.answers`, because the event name is that module's contract.

### P1.6 `app.ts` keeps the static chain, now guarded by a test

- Keep one `.use(modules.X.routes)` line per module, with a comment explaining the Eden constraint.
- Test `app.test.ts`: build the app with a container using fake adapters, list the mounted routes (Elysia exposes `app.routes`), and assert that every module with `routes` has at least one route under its prefix. Forgetting to mount a module turns the test red.

### P1.7 Maintenance and `startWorker` use `jobs`

Replace the 3 hand-written blocks calling `privacy.startJobs()…` with the loop from P1.3. Keep the `transition` chain (it serialises on/off).

**Acceptance P1**
- All checks green, and the e2e for maintenance and privacy green.
- `check-removal.ts realtime` yields: the realtime folder, `container.ts` (1 line), `app.ts` (1 line), `module-catalog.ts` (1 line), plus the places that still depend on it, which P2 will remove.
- `container.ts` is clearly shorter (record the line count against the baseline).

---

## P2 — Invert dependencies: notification, realtime and privacy do not know the producers

**Purpose**: reach T2 and complete T1. Following D5, the mapping moves into an isolated `integrations/` folder of each **producer**.

### P2.1 Glue layout

```
src/modules/identity/integrations/
  notification.ts       // magic link/welcome/email change → mail; security alert → in-app; session revoked → drop push subs
  realtime.ts           // session revoked → realtime
  messages/{en,vi}.ts   // the mail.* and inApp.* wording of identity
src/modules/privacy/integrations/
  notification.ts       // export ready/failed, deletion scheduled/cancelled/deleted → mail + in-app
  realtime.ts           // export progressed/ready/failed, erasure progressed, deletion … → realtime
  messages/{en,vi}.ts
src/modules/billing/integrations/
  notification.ts       // top-up succeeded/failed → in-app
  realtime.ts
  messages/{en,vi}.ts
src/modules/notification/integrations/
  realtime.ts           // notification created/read/seen → realtime (notification is a producer for realtime)
```

Each file exports plain data built with `satisfies` against the consumer's definition types, so its import of the consumer is `import type` only:

```ts
// modules/billing/integrations/notification.ts
import type { NotificationIntegration } from '#/modules/notification/contracts'
import { BillingEvents, type TopUpSucceededPayload } from '../contracts'
import en from './messages/en'
import vi from './messages/vi'

export const billingNotifications = {
  inApp: [{ name: 'notification.inapp-topup-succeeded', eventType: BillingEvents.TopUpSucceeded, build: (p: TopUpSucceededPayload) => … }],
  mails: [],
  messages: { en, vi },
} satisfies NotificationIntegration
```

The composition root chooses what to install:

```ts
// bootstrap/container.ts
const notificationIntegrations = [identityNotifications, privacyNotifications, billingNotifications]   // <kit:notification-integrations>
const realtimeIntegrations     = [identityRealtime, privacyRealtime, billingRealtime, notificationRealtime] // <kit:realtime-integrations>
```

Rules for the folder (depcruise, see P2.4):
- `modules/<p>/integrations/` may import `modules/<p>/contracts` and the `contracts` of `notification` / `realtime`, nothing else.
- Nothing else in `modules/<p>/` may import its own `integrations/` folder; only bootstrap does.
- Handler names keep their current strings (`notification.inapp-…`, `realtime.push-…`): they are inbox keys, and the folder they are declared in does not matter.

### P2.2 Realtime becomes a leaf module

- `realtime/contracts/routes.ts` (plain DTOs):
  ```ts
  export interface RealtimeRoute<P = unknown> {
    name: string               // handler name; keep the current names, for example 'realtime.push-session-revoked'
    eventType: string
    map(payload: P): RealtimePush | null
  }
  export const realtimeRoute = <P>(r: RealtimeRoute<P>) => r
  ```
- `createRealtimeModule({ …, routes: RealtimeRoute[] })` builds a `RealtimePushHandler` per route. `PurgeUserEvents` also receives the "account deleted" `eventType` from its deps instead of importing `PrivacyEvents`.
- `realtime/contracts` also exports `RealtimeIntegration = { routes: RealtimeRoute[] }`.
- Move the mapping that now lives in `realtime.module.ts` into `modules/<producer>/integrations/realtime.ts` unchanged.

### P2.3 Notification becomes a leaf module

The mapping now in `notification.module.ts` covers in-app (`inApp(name, eventType, build)`), mail (`MailEventHandler`) and push. Split it like this:

- `notification/contracts/definitions.ts`:
  ```ts
  export interface InAppDefinition<P> { name: string; eventType: string; build(p: P): NotificationDraft | null }
  export interface MailDefinition<P>  { name: string; eventType: string; to(p: P): string; template: string; params(p: P): Record<string, string|number>; expiresAt?(p: P): Date | null }
  export interface DropPushSubscriptionsOn<P> { eventType: string; sessionId(p: P): string }
  ```
  `NotificationDraft` and these DTOs move into contracts, because contracts must stand on their own (rule `contracts-are-self-contained`).
- `NotificationIntegration = { inApp?: InAppDefinition[]; mails?: MailDefinition[]; dropPushOn?: DropPushSubscriptionsOn[]; messages?: Record<Locale, PartialCatalog> }`.
- `createNotificationModule({ …, integrations: NotificationIntegration[], messageOverrides? })`.
- **Locale**: `IdentityLocaleResolver` (which depends on `IdentityApi`) becomes a port `LocaleResolver { localeOf(userId): Promise<Locale | null> }`. The composition root passes an adapter wrapping `identity.api`. Notification drops its identity import entirely.
- **Catalogs**: `notification/application/messages/{en,vi}.ts` keeps only `common` and the mail shell. The `mail.*` and `inApp.*` branches of each producer move to `modules/<producer>/integrations/messages/{en,vi}.ts` and are merged back inside the notification module:
  ```ts
  const catalogs = mergeCatalogs(base, ...integrations.map((i) => i.messages), { overrides: messageOverrides })
  // deep merge; a duplicate key between two integrations is an error; `overrides` is the only layer allowed to replace a key
  ```
  `messageOverrides` is an extension point (P7.4): a project rewords a mail without ejecting the module. Each integration's `build`/`params` refers to its keys with the producer's own typed key union; the notification module checks at startup that every key referenced exists in every locale. The test `messages.test.ts` runs on the merged result of the reference app.
- `drop-push-subscriptions-handler` receives its `eventType` from the definition instead of importing `IdentityEvents`.

### P2.4 New architecture rules

In `.dependency-cruiser.cjs`:

```js
{
  name: 'generic-modules-are-leaves',
  comment: 'notification and realtime deliver for every module, so their core must not know any module.',
  severity: 'error',
  from: { path: '^src/modules/(notification|realtime)/', pathNot: '/integrations/' },
  to:   { path: '^src/modules/', pathNot: '^src/modules/(notification|realtime)/' },
},
{
  name: 'integrations-use-contracts-only',
  comment: 'An integration folder sees its own contracts and the consumer contracts, nothing else.',
  severity: 'error',
  from: { path: '^src/modules/([^/]+)/integrations/' },
  to:   { pathNot: ['^src/modules/$1/(contracts|integrations)/', '^src/modules/(notification|realtime)/contracts/', '^src/shared/', 'node_modules'] },
},
{
  name: 'module-core-does-not-load-its-integrations',
  comment: 'Only the composition root installs integrations; otherwise the consumer stops being optional.',
  severity: 'error',
  from: { path: '^src/modules/([^/]+)/', pathNot: '/integrations/' },
  to:   { path: '^src/modules/[^/]+/integrations/' },
},
```

`only-composition-root-wires-modules` keeps `ROOT` as it is; bootstrap is the only importer of `integrations/`.

### P2.5 Verify behaviour is unchanged

- A new test `integrations.test.ts` snapshots the list of `(handler.name, handler.eventType)` for the whole system before and after P2 and compares them. The two lists must be identical, because the handler name is the inbox key.
- The e2e for notifications, realtime, privacy, billing and web-push stay green.

**Acceptance P2**
- `rg "#/modules/" apps/api/src/modules/{notification,realtime} -g '!**/integrations/**'` shows only internal imports.
- `rg "modules/privacy" apps/api/src/modules/{identity,profile,billing}` finds nothing (T2b, from P1.5).
- `check-removal.ts billing`: only the billing folder (with its integrations), `container.ts` (factory + 2 integration list entries), `app.ts`, `module-catalog.ts` and billing's config remain. The config part is solved in P3, at which point T1 is met.

---

## P3 — Per-module config (D6)

### P3.1 Shared config infrastructure

`shared/config/` (moves to `kit-config` in P5):

```ts
export const duration = (def: string) => …         // moved from config.ts
export const csv = …; export const blank = …; export const pem = …; export const bool = (def) => …
export const allOrNone = (keys: string[]) => (env, ctx) => …   // replaces the "all 3 variables must be set" superRefines

export function loadConfig<S extends Record<string, z.ZodType>>(
  slices: S, env = process.env,
): { [K in keyof S]: z.infer<S[K]> }
// parses EACH slice against the same env, collects the errors of every slice, throws once (keeping today's error format)
```

### P3.2 Splitting the schema

| Slice | Variables | Lives in |
|---|---|---|
| `core` | NODE_ENV, PORT, APP_ROLES, APP_PROCESSES, PROCESS_SLOT, LOG_LEVEL, WEB_APP_URL, CORS_ORIGINS | `shared/config/core.ts` |
| `db` | DATABASE_URL, DB_POOL_MAX, DB_PREPARE | `shared/infrastructure/db/config.ts` |
| `outbox` | OUTBOX_* | `shared/infrastructure/outbox/config.ts` |
| `maintenance` | MAINTENANCE_POLL_INTERVAL_MS | maintenance |
| `telemetry` | OTEL_* | telemetry |
| `storage` | S3_* | storage |
| `mail` | SMTP_*, MAIL_FROM, MAIL_RATE_PER_SECOND, MAIL_BURST, MAIL_DAILY_QUOTA | mail |
| `identity` | JWT_*, ACCESS/REFRESH_TOKEN_TTL, STEP_UP_*, WEBAUTHN_*, GOOGLE_*, GITHUB_*, MAGIC_LINK_* | `modules/identity/config.ts` |
| `notification` | VAPID_*, PUSH_QUIET_WINDOW_SECONDS, NOTIFICATION_* | `modules/notification/config.ts` |
| `realtime` | REALTIME_REPLAY_WINDOW_SECONDS | `modules/realtime/config.ts` |
| `privacy` | PRIVACY_* | `modules/privacy/config.ts` |
| `billing` | STRIPE_*, BILLING_*, SELLER_*, TOPUP_CURRENCIES | `modules/billing/config.ts` |

The final transform (`WEBAUTHN_RP_ID` defaulting from `WEB_APP_URL`) needs data from `core`. Let the identity slice use a `.transform` that reads `WEB_APP_URL` straight from the env, since every slice parses the whole env.

### P3.3 Factories receive exactly their own slice

- `createIdentityModule({ …, config: IdentityConfig, webAppUrl })`: drop `import type { Config }` from `identity.module.ts`.
- Other modules: the loose parameters the container now computes from config (for example `retention`, `reconcile`, `policy`) can be handled in two ways. **Decided (D6): the module takes its config slice and converts it itself.** The container becomes smaller, and a module that moves into a package takes its own reading of config with it.

### P3.4 `.env.example` generated from the schema

- Every variable gets `.describe('…')`. Today the descriptions are JSDoc comments, which must move into `.describe`.
- `bun run config:example` walks the slices, prints each section with its description and default, and writes `.env.example`.
- Test: the `.env.example` on disk equals the generated one. CI fails if someone forgets to regenerate it.

### P3.5 Update

`main.ts`, `scripts/*.ts`, `tests/e2e/helpers.ts`, `config.test.ts` (split per slice).

**Acceptance P3**
- `rg "infrastructure/config" apps/api/src/modules` finds nothing.
- Every slice has its own test.
- `check-removal.ts billing` meets **T1**.

---

## P4 — Re-arrange `shared` as "folder = future package"

**Purpose**: P5 is then just lifting each folder out into a package. Everything still lives inside the app at this step, so rollback is cheap.

### P4.1 Target layout inside `apps/api/src/shared/`

```
shared/
  core/                 domain-event, aggregate-root, errors (domain + application), basic ports (Clock, IdGenerator, UnitOfWork, Log), system (SystemClock, UuidV7)
  config/               P3
  db/                   Database, advisory-lock, migrate, duration
  messaging/            envelope, errors (RetryLaterError), in-process-bus, ports (OutboxWriter, MessagePublisher, IntegrationEventHandler, InboxGuard), outbox/* (tables, writer, inbox guard, relay, erase-published)
  context/              request-context (ALS); used by http, messaging and telemetry
  http/                 error-handler, request-context.plugin, tracing.plugin, locale.plugin, maintenance.plugin, openapi, client-info, constants
  auth/                 AuthSession, TokenVerifier, auth macro (moved from http/auth.plugin), StepUpPolicy (moved from application/), crypto (keyedHash)
  mail/                 Mailer port, MailRateLimitedError, MailPermanentError (from application/mail-errors), SmtpMailer, classify-smtp-error
  storage/              ObjectStorage port, ObjectStat, S3ObjectStorage
  telemetry/            tracing, logger (pino)
  i18n/                 translator, format; agnostic of LOCALES (see P4.4)
  runtime/              maintenance-mode, cluster supervisor (moved from bootstrap/cluster.ts), app-module (P1.1), health routes (moved from app.ts)
  privacy-participant/  from application/privacy.ts + privacyParticipantHandlers (P1.5)
  testing/              fakes
```

The ports now gathered in the single file `application/ports/index.ts` are split to the package that owns them. `ObjectStorage` goes to `storage`, `Mailer` to `mail`, `InboxGuard` to `messaging`… Each module imports a port from the right place.

### P4.2 Each folder has a barrel `index.ts`; the graph is enforced by depcruise

Allowed graph (an arrow means "may be imported by"):

```
core ← config ← db ← messaging ← runtime
core ← i18n
core ← context ← telemetry, http, messaging
core ← auth ← http (http uses the auth macro)      telemetry ← http, messaging
core ← mail, storage, privacy-participant (← messaging)
testing ← everything (only in *.test.ts)
```

Add to depcruise:
- Rule `shared-package-graph`: from `shared/<a>/` only imports of the `shared/<b>/` folders on `a`'s allow-list are permitted. Written as a JS table that generates the rules.
- Rule `import-via-barrel`: from outside `shared/<x>/`, only `shared/<x>/index.ts` may be imported. This rule simulates a package's `exports` field, so P5 holds no surprises.
- Rule `no-framework-outside-adapters`: `elysia` only in `shared/http`, `shared/auth`, `shared/runtime`, `modules/*/presentation` and bootstrap; `nodemailer` only in `shared/mail`; and so on.

### P4.3 Move the misplaced pieces

| From | To | Note |
|---|---|---|
| `application/step-up-policy.ts` | `auth/step-up-policy.ts` | 10 import sites |
| `application/mail-errors.ts` | `mail/errors.ts` | 3 sites |
| `application/privacy.ts` | `privacy-participant/` | 15 sites; gather the P1.5 helpers here |
| `http/auth.plugin.ts` | `auth/plugin.ts` | 11 sites |
| `bootstrap/cluster.ts` | `runtime/cluster.ts` | only `main.ts` uses it |
| `healthRoutes` in `app.ts` | `runtime/health.ts`, taking a list of `checks: {name, ping}` | so another app can add checks (S3, SMTP) |

The old depcruise rules contain `^src/shared/(application|infrastructure|presentation|http|messaging)/`. Rewrite them for the new layout.

### P4.4 Split `packages/shared-types`

| Current content | Destination |
|---|---|
| `i18n.ts`: LOCALES, DEFAULT_LOCALE, LOCALE_NAMES, isLocale, matchLocale, negotiateLocale | The generic logic → `packages/kit-i18n` (earlier than P5, because the web uses it too) as a factory `defineLocales(['en','vi'] as const, { default: 'en', names })` returning `{ LOCALES, DEFAULT_LOCALE, isLocale, matchLocale, negotiateLocale }`. The product's real language list stays in `packages/shared-types/src/locales.ts` |
| `i18n-catalog.ts`: Catalog, diffCatalogs | `kit-i18n` |
| `translator.ts` (now in api `shared/i18n`) | `kit-i18n`, because the web may also use it for text outside React |
| `billing.ts` | subpath `@app/shared-types/billing`; P7 moves it into the `./public` of the billing module |
| AVATAR_*, COVER_*, DISPLAY_NAME_MAX, BIO_MAX | subpath `@app/shared-types/profile`; P7 moves them into the `./public` of the profile module |
| `ApiErrorBody` | `kit-http` (the error shape is the error handler's contract) |

Add an `exports` entry per subpath in the `package.json` of shared-types. Remove the barrel `index.ts` so that importing by subpath is mandatory.

**Acceptance P4**
- `apps/api/src/shared/application/` and `shared/infrastructure/` no longer exist.
- The new depcruise rules are green.
- Trying a deep import (`#/shared/messaging/outbox/outbox-relay`) from a module turns `check:arch` red.

---

## P5 — Extract the infrastructure packages `packages/kit-*`

### P5.1 Order (leaves first, following the P4.2 graph)

1. `kit-core`
2. `kit-context`
3. `kit-i18n` (exists since P4.4)
4. `kit-config`
5. `kit-db`
6. `kit-telemetry`
7. `kit-messaging`
8. `kit-auth`
9. `kit-http`
10. `kit-mail`
11. `kit-storage`
12. `kit-privacy-participant`
13. `kit-runtime`
14. `kit-testing`

Each package is **one commit**.

### P5.2 Checklist for each package

```
packages/kit-<x>/
  package.json        name @kit/<x>, "type": "module", "private": true (until P10),
                      "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" (if it has its own fakes) },
                      dependencies: only what the package really uses,
                      peerDependencies: elysia / drizzle-orm / postgres / zod / @opentelemetry/api (anything whose types cross the boundary)
  tsconfig.json       extends ../../tsconfig.base.json; NO '#/*' paths
  src/index.ts        barrel = public API (like the P4 barrel)
  src/**/*.test.ts    tests move along
  README.md           per the template in §P10.3
```

The repeated work for each package:
1. `git mv apps/api/src/shared/<x> packages/kit-<x>/src`.
2. Change the `#/shared/<y>` imports inside it to `@kit/<y>`; use relative paths for internal imports.
3. In `apps/api`: change `#/shared/<x>` to `@kit/<x>` (codemod: `rg -l "#/shared/<x>" | xargs sed -i '' "s#\#/shared/<x>#@kit/<x>#g"`). Add `"@kit/<x>": "workspace:*"` to `apps/api/package.json`.
4. Move npm dependencies from `apps/api/package.json` to the package. Remove them from api if api no longer uses them directly.
5. Update:
   - `knip.json`: add the workspace `packages/kit-<x>`.
   - `apps/api/.dependency-cruiser.cjs`: the P4.2 rules replace `^src/shared/<x>` with `node_modules/@kit/<x>` or `packages/kit-<x>`. Enable `combinedDependencies` so depcruise follows workspaces.
   - A separate root-level dependency-cruiser config for `packages/` (the P4.2 graph between packages; forbid packages from importing `apps/`).
   - `apps/api/Dockerfile`: `COPY packages/kit-<x>/package.json` in the deps stage, `COPY packages/kit-<x>` in the runtime stage. The compact way is `COPY packages ./packages` plus a `.dockerignore` that excludes tests.
   - `.github/filters.yml`: `packages/**` is already there.
   - `bun install` to update `bun.lock`.
6. Run every check. Check `bun run --filter @app/web typecheck` separately, because the Eden types travel through the packages.

### P5.3 Points to watch per package

- **kit-messaging**:
  - `outboxTable(schema)` and `inboxTable(schema)` take the app's `PgSchema`, so `drizzle-orm` must be a peer dependency.
  - `OutboxRelay` depends on `Database` from `kit-db`.
  - `request-context` (ALS) lives here because the relay restores the context. **Decided: split it into a small `kit-context`** (between `kit-core` and `kit-telemetry` in the P5.1 order), since http, messaging and telemetry all use it and `kit-http` must not depend on `kit-messaging` for it.
- **kit-http**:
  - Elysia plugins have a `name` (dedupe) and depend on the Elysia instance, so elysia is a peer dependency.
  - Check that the `auth` macro still infers `auth`/`maybeAuth` in module routes.
- **kit-auth**: only the **consumer side** (verify the JWT via JWKS or the public key, the macro, StepUpPolicy). The token-issuing side (`JwtTokenService`) stays in the identity module. Another service needs only `kit-auth` to verify tokens issued by identity.
- **kit-runtime**:
  - `superviseProcesses`, `MaintenanceMode` and `MaintenanceStore` (the maintenance table: check which schema it lives in; if it is in `public`, the package must export a migration or an `ensureTable` function).
  - `healthRoutes` and `AppModule`.
  - `scripts/deploy.ts` needs `MaintenanceStore`; split the shared deploy logic into `kit-runtime/deploy` so another app can call it.
- **kit-privacy-participant** (D5b): the protocol events and payloads from P1.5, the `PrivacyParticipation` types and `privacyParticipantHandlers`. It is the only thing identity, profile and billing know about privacy.
- **kit-testing**: `FakeClock`, `SequentialIds`, `InMemoryOutbox`, `PassthroughUnitOfWork`, `FakeStorage`, `InMemoryInbox`, `SimulatedCrash`. Marked as `devDependencies` in consumers.

### P5.4 After the last package

- Delete `apps/api/src/shared/`.
- The rule `shared-knows-no-module` becomes a rule "packages do not import apps/".
- If the baseline shows web typecheck more than 30% slower, revisit (`tsc --extendedDiagnostics`).

**Acceptance P5**: meets **T3**; the Docker image builds and runs (`docker compose --profile app up`); `bun run build` of api yields a bundle that runs.

---

## P6 — Light adapters and a contract test suite

### P6.1 Contract tests for ports (`@kit/testing/contracts`)

```ts
export function describeObjectStorage(name: string, make: () => Promise<{ storage: ObjectStorage; cleanup(): Promise<void> }>)
export function describeInboxGuard(name, make)          // includes the crash scenario between side effect and inbox write
export function describeOutboxWriter(name, make)
export function describeMailer(name, make)              // can send; permanent failure → MailPermanentError; rate → MailRateLimitedError
export function describeSendRateLimiter(name, make)
export function describeAdvisoryLock(name, make)
```

- Unit (`bun test`): runs on the fakes (`FakeStorage`, `InMemoryInbox`…).
- E2E or integration (`tests/integration`, needs infrastructure): runs the **same suite** on `S3ObjectStorage`, `DrizzleInboxGuard`, `SmtpMailer` (Mailpit).
- If a fake behaves differently from the real adapter, the test is red on one side or the other. This is the kit's promise to projects that reuse it.

### P6.2 Adapters that need no external infrastructure

| Adapter | Package | Note |
|---|---|---|
| `ConsoleMailer` | kit-mail | logs the mail through pino, with a flag to print links; used when `MAIL_DRIVER=console` |
| `MemoryMailer` | kit-testing | replaces `overrides.mailer` in e2e |
| `LocalFsObjectStorage` | kit-storage | `presignPut`/`presignGet` return URLs with an HMAC signature (expiring) pointing at the routes `PUT/GET /storage/local/*`; the route is an Elysia plugin `localStoragePlugin` in `kit-storage/http`. Writes to `STORAGE_LOCAL_DIR`. Runs the whole `describeObjectStorage` suite |
| `FakePaymentGateway` | already in billing | unchanged |

Driver settings in config:
- `STORAGE_DRIVER = s3 | local`: with `local`, `S3_*` is not required. Use a zod discriminated union in the `storage` slice.
- `MAIL_DRIVER = smtp | console`.

### P6.3 Modules are really switched on/off by configuration

Already true today: web push is off without VAPID, top-up is off without Stripe. Keep that approach. Add a startup check: a module that was left out of the list but still has migrations in the DB only produces a warning, not an error.

**Acceptance P6**: the contract suite is green on both the fakes and the real adapters; api runs with `STORAGE_DRIVER=local MAIL_DRIVER=console` without SeaweedFS or Mailpit (tried by hand, then automated in P9).

---

## P7 — Business modules become packages, with extension points (D1, D4)

### P7.1 Layout

```
modules/                      ← new workspace (add "modules/*" to the root package.json)
  billing/
    package.json              name @mod/billing
                              exports: {
                                ".":                          "./src/billing.module.ts",   // factory + module types
                                "./contracts":                "./src/contracts/index.ts",
                                "./public":                   "./src/public.ts",           // constants for clients (replaces the shared-types subpath)
                                "./config":                   "./src/config.ts",
                                "./schema":                   "./src/infrastructure/persistence/schema.ts",  // for drizzle-kit and the outbox CLI
                                "./integrations/notification": "./src/integrations/notification.ts",       // D5
                                "./integrations/realtime":     "./src/integrations/realtime.ts"
                              }
                              dependencies:     @kit/*, @mod/identity, @mod/profile (real business dependencies)
                              peerDependencies: @mod/notification, @mod/realtime with peerDependenciesMeta.optional = true
    src/{domain,application,infrastructure,presentation,contracts,integrations}
    migrations/
    drizzle.config.ts         // each module has its own, replacing the MODULE env
    .dependency-cruiser.cjs   // the layer rules (domain-is-pure, application-no-infrastructure…) apply inside the package
    README.md, CHANGELOG.md
```

- The `exports` field replaces the rule `modules-talk-only-through-contracts`: `import '@mod/billing/src/domain/…'` does not resolve. The depcruise rule stays as a second layer.
- Optional peers: the `integrations/*` subpaths use `import type` only, so a project without `@mod/notification` installed can still import `@mod/billing`; importing `@mod/billing/integrations/notification` without it is a type error, which is correct.
- `module-catalog.ts` (P1.4) points `migrations` at an absolute path exported by the package itself (`export const migrationsDir = new URL('../migrations', import.meta.url).pathname`).
- `scripts/db.ts generate` runs `drizzle-kit generate --config modules/<m>/drizzle.config.ts`.

### P7.2 Order of moves

Modules that fewer others depend on move first, so each step is small:
`realtime` → `notification` → `billing` → `privacy` → `profile` → `identity`.

### P7.3 After the moves

- `apps/api/src/` holds only `main.ts`, `app.ts` and `bootstrap/`.
- `apps/web/tsconfig.json`: drop `"#/*": ["../api/src/*"]`. This is the final proof that no `#/` import remains on the path that infers the `App` type.
- The web imports constants from `@mod/profile/public` instead of `@app/shared-types/profile`. At that point `packages/shared-types` holds only `locales.ts`, so consider renaming it `@app/product` (product configuration: languages, app name).

### P7.4 Extension points (D1)

A module package is customised **only** through these. Each one is documented in the module's README under "Extension points"; anything not on the list is not supported, and the answer is eject.

| Extension point | Mechanism | Example |
|---|---|---|
| Adapters | ports passed to the factory | swap `PaymentGateway`, `Mailer`, `ObjectStorage` |
| Configuration | the module's config slice (D6) | token TTLs, retention, currencies |
| Integrations | which `integrations/*` the app installs, and its own `NotificationIntegration`/`RealtimeIntegration` objects | a project adds a "top-up succeeded" SMS without touching billing |
| Wording | `messageOverrides` of the notification module, the web feature catalog | reword the magic-link mail |
| Reacting to events | an app-level `IntegrationEventHandler` subscribed to the module's contract events | award points on `TopUpSucceeded` |

What is deliberately **not** an extension point: hooks inside use cases, overriding domain rules, changing tables. Those change the module's invariants, so they require ejecting:

- `bun run gen:module --from @mod/billing` copies the package source into `modules/billing`, renames it to `@app/billing`, keeps the migrations folder and its `drizzle_billing.__migrations` table (so the DB is untouched), and records the ejected version in the module's README.
- After ejecting, the project owns the module; upstream CHANGELOG entries are merged by hand.

**Acceptance P7**: every check green; T1 re-checked (removing billing means `modules/billing`, one line in `apps/api/package.json`, `container.ts`, `app.ts`, `module-catalog.ts`); every module README lists its extension points; a scratch app outside the workspace installs `@mod/billing` without `@mod/notification` and typechecks.

---

## P8 — Web

### P8.1 `packages/kit-ui`

- Move `components/ui/*` along with `lib/utils.ts` (`cn`) and the colour tokens and theme in `index.css` into `@kit/ui/styles.css`.
- Peer dependencies: `react`, `react-dom`, `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `clsx`, `lucide-react`.
- **Tailwind v4**: in `apps/web/src/index.css` add `@import "@kit/ui/styles.css";` and `@source "../../../packages/kit-ui/src";`. Without `@source` the package's classes get purged and the UI breaks silently. Add a Playwright test that screenshots a button to catch this.
- `jscpd` currently ignores `**/components/ui/**`; change that to `packages/kit-ui/**`.

### P8.2 `packages/kit-web-core`

| From `apps/web/src/lib` | Becomes | Parameterised by |
|---|---|---|
| `auth-store.ts` | `createAuthStore()` | — |
| `session.ts` (single-flight refresh, 300 ms retry on `refresh_token_rotated`) | `createSessionRefresher({ refreshUrl, store })` | refresh path |
| `api.ts` (`authFetch`) | `createAuthFetch({ store, refresher, locale(), isAuthEndpoint, onNetworkFailure, onResponse, simulateLatency? })` plus `createApiClient<App>(origin, fetcher)` | everything it imports hard-wired today |
| `maintenance.ts` | `createOutageDetector({ healthUrl, … })` | health URL |
| `realtime.ts` | `createRealtimeClient({ url, getToken, onEvent, lastEventId })` | — |
| `push.ts`, `webauthn.ts`, `once.ts`, `theme.ts`, `query-client.ts`, `device.ts`, `format.ts` | keep their API, drop the hard i18n dependency | locale passed in |

Staying in the app (they belong to a feature): `stripe.ts`, `card.ts`, `money.ts` move to `features/billing/lib/`; `crop.ts` moves to `features/profile/lib/`. Tests (`*.test.ts`) travel with their files.

Also web-core: `components/layout/maintenance-dialog.tsx`, the offline page, `status-panel`. Put them under `@kit/web-core/react` (a subpath) so the non-React parts remain usable on their own.

### P8.3 Feature registry

- Each feature has a `features/<f>/index.ts`:
  ```ts
  export const feature = {
    name: 'billing',
    settingsTab: { to: '/settings/wallet', label: 'settings.nav.wallet', icon: Wallet, order: 50 },
    userMenu: [...],
    i18n: { en: () => import('./i18n/en'), vi: () => import('./i18n/vi') },
  } satisfies FeatureDefinition
  ```
- `apps/web/src/features/index.ts` lists the features (one line per feature).
- `settings.tsx` builds `TABS` from the registry.
- `user-menu.tsx` imports `features/auth` and `features/profile`. These two features are core (identity, profile), so they are allowed.
- TanStack's file-based routes stay in `src/routes`, thin, importing only feature components. Removing a feature means deleting `features/<f>` and `routes/**/<f>*`, plus one line in the registry. `check-removal.ts` is extended to the web.

### P8.4 Per-feature i18n

- Split `i18n/locales/{en,vi}.ts` (about 570 lines) into `features/<f>/i18n/{en,vi}.ts` along the top-level branches: `billing`, `privacy`, `notifications`, `realtime`, `profile`, `crop`, `email`, `sessions`, `security`, `passkeys`, `accounts`, `stepUp`… The shared part (`common`, `nav`, `theme`, `errors`, `outage`…) stays in `src/i18n/`.
- `i18n/index.ts` merges with `mergeCatalogs` (reused from `kit-i18n`, P2.3). The `i18next.d.ts` types take `typeof` the merged result.
- `catalogs.test.ts` runs on the merged result.

### P8.5 Cleanup

Remove the `#/*` alias (after P7); remove the web's direct dependency on `elysia` if Eden no longer needs it (check with knip).

**Acceptance P8**: web build, typecheck and Playwright green; bundle size grows by no more than 5% against the baseline; deleting `features/billing`, its routes and one registry line still leaves the web building.

---

## P9 — Tooling: generate a module, the starter, add a module

### P9.1 `bun run gen:module <name>` (no new dependency; a Bun script beside a template folder)

`templates/module/` (placeholders `__name__`, `__Name__`):

```
package.json, drizzle.config.ts, README.md, .dependency-cruiser.cjs
src/__name__.module.ts          // returns an AppModule, outbox/inbox ready
src/config.ts                   // empty slice
src/contracts/{index,events}.ts // event-versioning header like the other modules
src/domain/__name__.ts + .test.ts
src/application/ports.ts, use-cases/ (one sample use case + test with @kit/testing)
src/infrastructure/persistence/schema.ts   // pgSchema('__name__') + outboxTable + inboxTable
src/presentation/routes.ts      // GET /__name__/ping with the auth macro
```

The script does the following:
1. Copies the template and replaces the placeholders.
2. Inserts into the markers `// <kit:modules>` in `module-catalog.ts`, `container.ts` and `app.ts` (the same markers `kit:add` uses).
3. `bun install`.
4. `db:generate` for the new module.
5. Prints the remaining steps.

Variant `--from <@mod/x>`: the eject of P7.4.

Web variant: `bun run gen:feature <name>` (feature folder, `index.ts` registry entry, en/vi i18n, one route).

### P9.2 `examples/starter` (D8)

- An api + web app in the workspace, with only `@mod/identity` and `@mod/profile`, and the `// <kit:…>` markers in place.
- Runs with `STORAGE_DRIVER=local`, `MAIL_DRIVER=console`, no Stripe or VAPID.
- A container of about 60 lines.
- CI job `starter`: needs only Postgres; migrate; boot; `GET /health/ready`; the magic-link flow (read the link from the ConsoleMailer log); `GET /me`.
- This is the proof of **T4**, and the template a new project starts from: `bunx degit <owner>/<repo>/examples/starter my-app` (after P10, its `workspace:*` versions are replaced by real versions on publish; before P10 the starter is only usable inside the repo).

### P9.3 `bun run kit:add <module…>` (D8)

- Reads the module's manifest (`kit` field in its `package.json`: `requires`, `optionalIntegrations`, `webFeature`), refuses if a `requires` module is missing, and inserts at the markers: catalog entry, factory call, `.use(routes)`, the integrations whose consumer is installed (`billing` + installed `notification` → `billingNotifications`), and the config section of `.env.example`.
- Adding `notification` later also inserts the `integrations/notification` of every installed producer. The insertion is computed from the manifests, so the order of `kit:add` calls does not matter.
- `kit:remove <module>` is the inverse, using the same manifests.
- CI test `add-matrix`: starting from the starter, add `billing`, `privacy`, `realtime`, `notification` one at a time and in the reverse order, then remove each; every step runs typecheck, check:arch and unit. This is the automatic check of T1, replacing P0's `check-removal.ts`.

### P9.4 Mark it as a template

The README gets a "Start a new project" section pointing to the starter, `kit:add`, and the adoption guide.

**Acceptance P9**: meets **T4** and **T6**; add-matrix green.

---

## P10 — Versioning, publishing, docs

### P10.1 Versioning

- `@changesets/cli` for `packages/kit-*` and `modules/*`. Semver; a breaking change is a type change at an exported entry point, a removed or reworded message key, a changed event payload, a changed extension point, or a migration that is not purely additive.
- **Migrations of business modules**: they ship inside the package, and the app's `db:migrate` runs them from `migrationsDir` (P7.1). A minor version may only add migrations that are safe on a live table (add a nullable column, add an index concurrently…); anything else is a major version with an upgrade note.
- **Contract events** follow the event-versioning rules already in `docs/`: a new payload shape is a new event version, never an in-place change.
- **Migrations of infrastructure packages**: `kit-messaging` has no table of its own (the tables live in each module's schema, generated through that module's drizzle-kit). Keep it that way. If the outbox or inbox columns change, the CHANGELOG must say "run `db:generate` in every module".

### P10.2 Publishing (D1, D3)

- Applies to both `@kit/*` and `@mod/*`.
- Add a `build` per package: `bun build src/index.ts --outdir dist --target bun --packages external` plus `tsc --emitDeclarationOnly`.
- `exports` uses the conditions `"bun": "./src/index.ts"` and `"default": "./dist/index.js"`, `"types"`.
- Registry: GitHub Packages (private) or npm.
- CI publishes when the changesets "Version packages" PR is merged.

### P10.3 Docs

- A README for every package following the template:
  - Purpose (one sentence).
  - Install.
  - The ports it defines and the ports it implements.
  - Env variables (generated from the schema).
  - Tables or migrations it needs.
  - A wiring example of about 15 lines.
  - Guarantees (for example "at-least-once, handlers must be idempotent").
  - Limits.
  - Links to the related `docs/patterns/*`.
- `docs/guides/adopt-in-new-project.md`: start from the starter, `kit:add` a module, swap an adapter, override a message, eject.
- `docs/guides/use-a-kit-package-alone.md`: an example of using `@kit/messaging` in an existing Elysia app.
- Update `docs/architecture/01-modules-and-boundaries.md` (AppModule, integrations, package graph), `02-messaging.md` (paths), `12-testing-and-ci.md` (contract tests, add-matrix, starter).
- `docs/patterns/*.md`: each pattern gets an "Implemented in: `@kit/<x>` → `src/…`" line.
- Update the root README, including a diagram of the new repo.
- Write ADRs for D1, D4, D5, D5b, D6 and D8 in `docs/adr/`.

**Acceptance P10**: meets **T5**; `bunx changeset status` is clean; every package has a README following the template (a simple test checks the required headings).

---

## 4. Risks and mitigations

| Risk | Sign | Mitigation |
|---|---|---|
| Eden types break or slow down across many packages | Web typecheck more than 30% slower than baseline; `any` leaking into `http.api…` | Measure in P0.2 and after each P5 package; type tests with `expectTypeOf` for a few key routes |
| Two Elysia or Drizzle instances | The `auth` macro is missing from a route; `PgSchema` is not assignable | Use peer dependencies; run `bun pm ls elysia drizzle-orm` in CI and fail if there is more than one copy |
| Renaming a handler makes messages run again (inbox key) | After P1.5 or P2, the welcome mail is sent twice | The snapshot test of `(name, eventType)` (P2.5) in the same commit; treat handler names as data, never refactor them |
| A changed migration path makes drizzle-kit think the schema is new | `db:generate` produces a migration that recreates tables | After every module move, run `db:generate` and it **must not produce a new file**; add to CI (`git diff --exit-code migrations/`) |
| Tailwind purges kit-ui classes | The UI loses its styles in the build | `@source` plus the screenshot test (P8.1) |
| Scope creep | A phase takes more than 2× its estimate | Each phase has its own acceptance and can be a stopping point. P1–P3 on their own already carry value |
| Flaky e2e | Failures in web-push, mail-throttling, tracing | Stop `bun run dev` while running e2e; if it still fails, re-run that file alone before calling it a regression |
| Published modules drift into option hell | Requests for "just one more hook" in a use case | P7.4 is a closed list; anything else is eject. A new extension point needs an ADR |
| An integration file pulls a consumer in at runtime | Installing `@mod/billing` without `@mod/notification` fails at import | `import type` only in `integrations/`; the P7 acceptance installs billing alone in a scratch app |
| `kit:add` and the markers go out of sync | The add-matrix fails on one order but not the other | Insertions are derived from package manifests, never hand-listed in the script |
| Dockerfile misses a new package | Image fails with `Cannot find module @kit/x` | `COPY packages ./packages` once; the CI docker job runs the container and calls `/health/live` |

## 5. Rollback

- Every sub-step is one green commit, so each can be `git revert`ed.
- Tag the end of each phase: `kit-p1`, `kit-p2`, …
- P0–P4 do not change the DB structure or data (D7: no data migration).
- P5 and P7 only move files. A revert is enough and the DB is untouched, as long as `db:generate` stays clean (risk 4).

## 6. Checklist to run at the end of each step

```bash
# stop bun run dev first
bun run lint && bun run typecheck && bun run check:arch && bun run test && bun run build
bun run --filter @app/api db:generate && git diff --exit-code -- '**/migrations/**'   # no new migration generated
bun run test:e2e
bun run quality:unused && bun run quality:dup
```

## 7. Progress tracking

| Phase | Status | Tag | Notes |
|---|---|---|---|
| P0 | ☐ | | |
| P1 | ☐ | | |
| P2 | ☐ | | |
| P3 | ☐ | | |
| P4 | ☐ | | |
| P5 | ☐ | | |
| P6 | ☐ | | |
| P7 | ☐ | | |
| P8 | ☐ | | |
| P9 | ☐ | | |
| P10 | ☐ | | |
