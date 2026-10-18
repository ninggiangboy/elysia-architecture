# @mod/notification

## Purpose

In-app notifications, Web Push and rate-limited mail for events other modules emit. It knows no producer: each module ships a `NotificationIntegration` (mappings, templates, wording) that the app installs.

## Install

```bash
bun add @mod/notification
bun run kit:add notification        # wires it into the app: catalog, container, routes and the integrations of what is installed
bun run db:migrate
```

Requires: the kit; `@mod/identity` only for the sample language lookup (`locales`) in the reference app.

## Ports

The factory takes the host's building blocks (`ModuleHost`: database, clock, ids, storage, mailer, config) and the modules it depends on; `install(host)` is the one entry the app calls. Cross-module calls go through `@mod/notification/contracts` only.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | unset | Web Push public key (URL-safe base64). |
| `VAPID_PRIVATE_KEY` | unset | Web Push private key. |
| `VAPID_SUBJECT` | unset | A `mailto:` or `https://` contact for the push services. |
| `PUSH_QUIET_WINDOW_SECONDS` | `30` | After a Web Push to a user, notifications in the same window of this length are stored but not pushed; 0 = push all. |
| `NOTIFICATION_RETENTION` | `90d` | In-app notifications older than this are deleted (read or not). |
| `NOTIFICATION_PRUNE_INTERVAL_SECONDS` | `3600` | How often notifications past the retention are looked for. |
<!-- config:end -->

## Tables and migrations

Schema `notification`: notifications, push subscriptions, the mail token bucket and daily quota, plus the outbox and inbox.

Migrations ship in `migrations/` and are applied by `bun run db:migrate` from the module's manifest (`@mod/notification/manifest`).

## Events

`notification.created.v1`, `read`, `seen` and the privacy answers.

## Wiring

```ts
const notification = use(installNotification({
  ...host, modules: { identity },
  integrations: [identityNotifications, billingNotifications],
  locales: identityLocaleResolver(identity.api),
}))
```

## Extension points

Integrations (the list passed to `install`), `messageOverrides` to reword a message without ejecting, adapters (Web Push sender, mailer), the `locales` resolver, and app handlers on its events.

Anything else (hooks inside a use case, changing a domain rule, changing a table) changes the module's invariants: eject it. Copy the package into `modules/notification`, rename it `@app/notification`, point the app's imports at it and keep the schema name and the `migrations/` folder, so the database is untouched. From then on the copy is yours and upstream CHANGELOG entries are merged by hand.

## Guarantees

Merged catalogs are checked at start-up (a template without a message in some language fails to boot); a duplicate key between integrations is an error; mail is rate limited across instances and expired links are not sent late.

## Limits

Web Push needs the three VAPID values; mail goes through the one configured `Mailer`.

## Related

[Modules and boundaries](../../docs/architecture/01-modules-and-boundaries.md) · [Adopt in a new project](../../docs/guides/adopt-in-new-project.md)
