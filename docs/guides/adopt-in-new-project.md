# Adopt the kit in a new project

The repository is both a reference app and a kit: infrastructure packages (`@kit/*`), business modules (`@mod/*`) and a minimal starter that uses a few of them. This guide takes you from "nothing" to "my own app with the modules I want", and shows the five ways to make it yours.

← [Architecture overview](../architecture.md)

## 1. Start from the starter

`examples/starter` is an API with only `identity` and `profile`. It needs nothing but Postgres: files go to the disk (`STORAGE_DRIVER=local`) and mail goes to the log (`MAIL_DRIVER=console`), so there is no S3, SMTP, Stripe or VAPID to set up.

```bash
cp -r examples/starter my-app && cd my-app
cp .env.example .env
bun run keys:generate      # JWT keys and secrets, written into .env
docker compose up -d postgres   # or any Postgres: set DATABASE_URL in .env
bun run db:migrate
bun run dev
```

Sign in with `POST /api/auth/magic-link`: the starter has no mail module, so a small app-level handler (`src/bootstrap/mailbox.ts`) prints the link to the log. Open it, or `POST /api/auth/magic-link/verify` with its `token`.

The starter's `package.json` points at the packages with `workspace:*` while it lives in this repository. In your own repository, install published versions (`bun add @mod/identity @mod/profile …`) once the packages are on a registry; until then keep the starter inside the monorepo.

## 2. Add a module

```bash
bun add @mod/billing
bun run kit:add billing
bun run db:migrate
```

`kit:add` reads the module's `kit.json` and edits four places (look at the diff, it is small): the catalog (`src/bootstrap/module-catalog.ts`), the container (the install block, the `modules` record), `src/app.ts` (one `.use(…)` per module, kept static so an Eden client can infer types) and `package.json`. It refuses when a module it requires is missing. It also wires **integrations in both directions** from what is installed: add `notification` and every installed producer's mails and in-app messages appear; add `billing` after `notification` and billing's appear. The order of `kit:add` calls does not matter, and `kit:remove` is the inverse.

Set the module's variables in `.env` (`bun run config:example` regenerates `.env.example` from the slices, so it lists them).

## 3. Swap an adapter

Every adapter is behind a port the module is written against; the host decides which one it gets.

- **Mail**: `MAIL_DRIVER=smtp|console`, or hand your own `Mailer` (an SES SDK adapter) to the host: `const host = { …, mailer: mySesMailer }`.
- **Files**: `STORAGE_DRIVER=s3|local`, or your own `ObjectStorage`.
- **Payments, Web Push, passkeys, OAuth**: `overrides` on `install` (`installBilling({ ...host, overrides: { paymentGateway } })`).

Write a new adapter against the contract suite so it behaves like the others:

```ts
import { describeObjectStorage } from '@kit/testing/contracts'
describeObjectStorage('GcsStorage', () => ({ storage: new GcsStorage(…) }))
```

## 4. Reword a message

Mails and notifications are produced by the notification module from catalogs the producers ship. Change the wording without ejecting anything:

```ts
installNotification({ ...host, integrations, messageOverrides: {
  en: { mail: { magicLink: { subject: 'Your Acme sign-in link' } } },
} })
```

`messageOverrides` is the one layer allowed to replace a key, and a key that does not exist fails at start-up (a typo cannot silently do nothing).

## 5. React to an event

Another module's events are its public contract. Subscribe with a handler of your own in the app (the starter's `mailbox` is one):

```ts
const awardPoints: IntegrationEventHandler = {
  name: 'acme.award-points',            // the consumer group; also the inbox key, so keep it stable
  eventType: BillingEvents.TopUpSucceeded,
  async handle(message) { /* idempotent: at-least-once delivery */ },
}
installed.push({ name: 'acme', handlers: [awardPoints] })
```

Or add your own `NotificationIntegration` / `RealtimeIntegration` to the lists: "a top-up succeeded" SMS without touching billing.

## 6. Write your own module

```bash
bun run gen:module orders
```

generates `modules/orders` (domain, a use case with a test, a Postgres schema with outbox and inbox, a route, a config slice, a manifest, `install`, its first migration) and wires it into the app. `bun run check:arch` keeps its boundaries honest from the first commit.

## 7. When the extension points are not enough

The extension points are a closed list on purpose: adapters, config, integrations, wording, reacting to events. Hooks inside a use case, changing a domain rule or a table change the module's invariants, so they are not offered. **Eject** instead: copy the package into `modules/<name>`, rename it `@app/<name>`, point the app's imports at it, and keep the schema name and the `migrations/` folder so the database is untouched. The copy is yours from then on; upstream CHANGELOG entries are merged by hand.

## Staying up to date

Packages are versioned with changesets (`bun run changeset`, `bun run version-packages`). A breaking change is a type change at an exported entry point, a removed or reworded message key, a changed event payload, a changed extension point or a migration that is not purely additive; a minor version only adds migrations that are safe on a live table. Read the CHANGELOG, bump, run `bun run db:migrate`.
