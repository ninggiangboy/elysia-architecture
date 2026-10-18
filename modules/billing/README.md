# @mod/billing

## Purpose

Wallets topped up with Stripe: a ledger per currency, top-ups reconciled against the provider, webhooks handled idempotently, and gapless invoices, receipts and credit notes.

## Install

```bash
bun add @mod/billing
bun run kit:add billing        # wires it into the app: catalog, container, routes and the integrations of what is installed
bun run db:migrate
```

Requires: `@mod/identity`, `@mod/profile`.

## Ports

The factory takes the host's building blocks (`ModuleHost`: database, clock, ids, storage, mailer, config) and the modules it depends on; `install(host)` is the one entry the app calls. Cross-module calls go through `@mod/billing/contracts` only.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | unset | Stripe secret key (`sk_test_…`). |
| `STRIPE_PUBLISHABLE_KEY` | unset | Stripe publishable key (`pk_test_…`). |
| `STRIPE_WEBHOOK_SECRET` | unset | Signing secret of the webhook endpoint (`whsec_…`). |
| `BILLING_RECONCILE_INTERVAL_SECONDS` | `300` | How often payments whose webhook has not come are checked against Stripe. |
| `BILLING_SETTLE_GRACE` | `15m` | An open payment is left to its webhook this long; after that Stripe is asked, and again every this long. |
| `BILLING_RECONCILE_MAX_AGE` | `3d` | Payments older than this that never completed are no longer checked. |
| `SELLER_NAME` | `Elysia Architecture` | Who issues the invoices, receipts and credit notes; written onto each document when it is issued. |
| `SELLER_ADDRESS` | unset | Seller address. |
| `SELLER_TAX_ID` | unset | VAT number, MST or the like. |
| `SELLER_EMAIL` | unset | Seller contact email. |
| `TOPUP_CURRENCIES` | `usd,eur,vnd` | Currencies a wallet can be topped up in, comma separated (the ranges are in `@mod/billing/public`). |
<!-- config:end -->

## Tables and migrations

Schema `billing`: top-ups, ledger entries, wallet balances, payment events and anomalies, documents and their counters, plus the outbox and inbox.

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/billing/manifest`).

## Events

`billing.topup_succeeded.v1`, `billing.topup_failed.v1` and the privacy answers.

## Wiring

```ts
const billing = use(installBilling({ ...host, modules: { identity, profile } }))
```

## Extension points

The `PaymentGateway` port (Stripe by default, a fake in tests), the config slice (currencies, seller, reconcile timing), integrations it ships (notification and realtime), and app handlers on its events (for example points on `TopUpSucceeded`).

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/billing`, rename it `@app/billing`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

A webhook is applied once however often it arrives; a lost webhook is found by the reconcile job; money is integers in minor units; document numbers have no gaps.

## Limits

Top-ups are off unless the three Stripe values are set (balances and history still work).

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)
