# @kit/mail

## Purpose

The `Mailer` port with an SMTP adapter, a console adapter (prints mails and their links, for apps without a mail server), SMTP error classification and the two mail errors.

## Install

```bash
bun add @kit/mail
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `Mailer`. Implements it with `SmtpMailer` (Mailpit, Amazon SES over SMTP) and `ConsoleMailer`; `createMailer(config, log)` picks one from `MAIL_DRIVER`.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `MAIL_DRIVER` | `smtp` | `smtp` sends through SMTP_HOST; `console` sends nothing and prints each mail to the log (for trying the app without a mail server). |
| `MAIL_CONSOLE_PRINT_LINKS` | `true` | console: also print the links found in each mail (sign-in links!). Turn off anywhere the log is shared. |
| `SMTP_HOST` | `localhost` | SMTP server. |
| `SMTP_PORT` | `1025` | SMTP port. |
| `SMTP_USER` | unset | SMTP user, when the server needs auth. |
| `SMTP_PASSWORD` | unset | SMTP password. |
| `SMTP_SECURE` | `false` | TLS from the first byte: true for port 465. |
| `SMTP_REQUIRE_TLS` | `false` | Require STARTTLS: true for port 587. |
| `MAIL_FROM` | `App <no-reply@example.test>` | From address of every mail. |
| `MAIL_RATE_PER_SECOND` | `10` | Maximum send rate (mails/second); the provider's "max send rate" (SES sandbox: 1). |
| `MAIL_BURST` | unset | Mails that may go out in one burst; defaults to ceil(MAIL_RATE_PER_SECOND). |
| `MAIL_DAILY_QUOTA` | `0` | Quota per day (UTC); 0 = unlimited. SES: the "24-hour sending quota". |
<!-- config:end -->

## Tables and migrations

None (the send rate limiter lives in `@mod/notification`).

## Wiring

```ts
import { createMailer } from '@kit/mail'

const mailer = createMailer(config.mail, logger)
await mailer.send({ to, subject, text, html })
```

## Guarantees

A provider refusal is classified: `MailRateLimitedError` (retry later, free of attempts) or `MailPermanentError` (never retry). Both are covered by the contract suite against a scripted SMTP server.

## Limits

SMTP only; the console driver sends nothing.

## Related

[Retry-later deferral](../../docs/patterns/retry-later-deferral.md)
